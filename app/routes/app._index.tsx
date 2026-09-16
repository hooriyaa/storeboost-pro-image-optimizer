// modified-2026-09-16
/**
 * StoreBoost Pro — Main Dashboard Route
 * 
 * Embedded Shopify Admin page featuring:
 * - NEXHUNAR Visual Branding & Header
 * - Summary Metrics Cards (Scanned, Needs Optimization, Savings, Progress)
 * - Interactive Scan Store workflow with real-time progress polling
 * - Filterable, searchable, paginated Image Data Table
 * - Single & Bulk Image Optimization actions
 * - Before / After Optimization Result Modal
 */

import React, { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams, useNavigation, useRevalidator } from "@remix-run/react";
import {
  Page,
  BlockStack,
  Card,
  TextField,
  Select,
  InlineStack,
  Button,
  Banner,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { SummaryCards } from "../components/SummaryCards";
import { ScanProgress } from "../components/ScanProgress";
import { ImageTable, type ImageRecord } from "../components/ImageTable";
import {
  OptimizationResultModal,
  type OptimizationResultData,
} from "../components/OptimizationResultModal";
import { estimateSavings } from "../utils/image-rules";
import { scanShopImages } from "../services/shopify-products.server";
import { createOptimizationJob, createBulkOptimizationJobs } from "../services/job-queue.server";
import { logger } from "../utils/logger";
import "../styles/nexhunar.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = 25;
  const statusFilter = url.searchParams.get("status") ?? "ALL";
  const searchQuery = url.searchParams.get("search") ?? "";
  const offset = (page - 1) * limit;

  let shopRecord = await db.shop.findFirst({
    where: { shopDomain },
  });

  if (!shopRecord) {
    shopRecord = await db.shop.create({
      data: { shopDomain, isActive: true },
    });
  } else if (!shopRecord.isActive) {
    shopRecord = await db.shop.update({
      where: { id: shopRecord.id },
      data: { isActive: true, uninstalledAt: null },
    });
  }

  const shopId = shopRecord.id;

  // Build filter where clause
  const imageWhere: Record<string, unknown> = {
    shopId,
    ...(statusFilter !== "ALL" ? { optimizationStatus: statusFilter } : {}),
    ...(searchQuery ? { productTitle: { contains: searchQuery, mode: "insensitive" } } : {}),
  };

  // Run all queries in a single fast parallel batch
  const [
    statusGroups,
    actualSavingsAgg,
    unoptimizedImages,
    latestScan,
    imagesList,
    totalMatching,
  ] = await Promise.all([
    db.productImage.groupBy({
      by: ["optimizationStatus"],
      where: { shopId },
      _count: { _all: true },
    }),
    db.optimizationResult.aggregate({
      where: { shopId },
      _sum: { savingsBytes: true },
    }),
    db.productImage.findMany({
      where: {
        shopId,
        optimizationStatus: { in: ["HIGH_PRIORITY", "OPTIMIZATION_RECOMMENDED"] },
        originalBytes: { not: null },
      },
      select: { originalBytes: true, format: true },
    }),
    db.scanJob.findFirst({
      where: { shopId },
      orderBy: { createdAt: "desc" },
    }),
    db.productImage.findMany({
      where: imageWhere,
      orderBy: [
        { optimizationStatus: "asc" },
        { originalBytes: "desc" },
      ],
      skip: offset,
      take: limit,
      include: {
        optimizationResult: {
          select: {
            originalBytes: true,
            optimizedBytes: true,
            savingsBytes: true,
            reductionPercent: true,
            outputFormat: true,
            optimizedPath: true,
          },
        },
      },
    }),
    db.productImage.count({ where: imageWhere }),
  ]);

  let totalImages = 0;
  let highPriority = 0;
  let recommended = 0;
  let completed = 0;
  let failed = 0;

  for (const group of statusGroups) {
    const count = group._count._all;
    totalImages += count;
    if (group.optimizationStatus === "HIGH_PRIORITY") highPriority = count;
    else if (group.optimizationStatus === "OPTIMIZATION_RECOMMENDED") recommended = count;
    else if (group.optimizationStatus === "COMPLETED") completed = count;
    else if (group.optimizationStatus === "FAILED") failed = count;
  }

  const needsOptimization = highPriority + recommended;
  const actualSavingsBytes = Number(actualSavingsAgg._sum.savingsBytes ?? 0n);

  let estimatedSavingsBytes = 0;
  for (const img of unoptimizedImages) {
    if (img.originalBytes) {
      const { estimatedBytes } = estimateSavings(
        Number(img.originalBytes),
        img.format
      );
      estimatedSavingsBytes += Number(img.originalBytes) - estimatedBytes;
    }
  }

  const potentialSavingsBytes = actualSavingsBytes + estimatedSavingsBytes;
  const progressPercent =
    needsOptimization + completed > 0
      ? Math.round((completed / (needsOptimization + completed)) * 100)
      : 0;

  const images = imagesList.map((img) => ({
    ...img,
    originalBytes: img.originalBytes ? Number(img.originalBytes) : null,
    optimizationResult: img.optimizationResult
      ? {
          ...img.optimizationResult,
          originalBytes: Number(img.optimizationResult.originalBytes),
          optimizedBytes: Number(img.optimizationResult.optimizedBytes),
          savingsBytes: Number(img.optimizationResult.savingsBytes),
        }
      : null,
  }));

  return json({
    shopDomain,
    stats: {
      totalImages,
      needsOptimization,
      highPriority,
      recommended,
      completed,
      failed,
      potentialSavingsBytes,
      actualSavingsBytes,
      estimatedSavingsBytes,
      progressPercent,
    },
    latestScan: latestScan
      ? {
          status: latestScan.status,
          scannedImages: latestScan.scannedImages,
          totalImages: latestScan.totalImages,
          error: latestScan.error,
        }
      : null,
    images,
    total: totalMatching,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(totalMatching / limit)),
    statusFilter,
    searchQuery,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shopRecord = await db.shop.findFirst({
    where: { shopDomain },
  });

  if (!shopRecord) {
    shopRecord = await db.shop.create({
      data: { shopDomain, isActive: true },
    });
  } else if (!shopRecord.isActive) {
    shopRecord = await db.shop.update({
      where: { id: shopRecord.id },
      data: { isActive: true, uninstalledAt: null },
    });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "scan") {
    try {
      const scanJob = await db.scanJob.create({
        data: {
          shopId: shopRecord.id,
          status: "QUEUED",
        },
      });

      // Run async in background without blocking response
      setTimeout(() => {
        scanShopImages(admin, shopDomain, scanJob.id).catch((err) => {
          logger.error("Background scan error", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, 50);

      return json({
        success: true,
        message: "Store scan started in background.",
        scanJob,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: `Scan failed: ${message}` }, { status: 500 });
    }
  }

  if (intent === "optimize") {
    const imageId = formData.get("imageId") as string;
    if (!imageId) return json({ error: "Image ID required" }, { status: 400 });
    try {
      const result = await createOptimizationJob(shopRecord.id, imageId);
      return json({
        success: true,
        message: result.isDuplicate ? "Optimization already in progress" : "Image optimized successfully!",
        result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: message }, { status: 500 });
    }
  }

  if (intent === "bulk-optimize") {
    const rawIds = formData.get("imageIds") as string;
    let imageIds: string[] = [];
    try {
      imageIds = JSON.parse(rawIds);
    } catch {
      imageIds = (rawIds || "").split(",").filter(Boolean);
    }
    if (!imageIds.length) return json({ error: "No image IDs provided" }, { status: 400 });

    try {
      const result = await createBulkOptimizationJobs(shopRecord.id, imageIds);
      return json({
        success: true,
        message: `Queued ${result.created} image(s) for optimization.`,
        result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: message }, { status: 500 });
    }
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const actionFetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();

  const [searchInput, setSearchInput] = useState(data.searchQuery);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, string>>({});

  // Result modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [activeResult, setActiveResult] = useState<OptimizationResultData | null>(null);

  const { stats, latestScan, images, total, page, limit, totalPages, statusFilter } = data;

  // Clean up optimistic state when confirmed by server
  useEffect(() => {
    if (images && images.length) {
      setOptimisticStatuses((prev) => {
        let hasChanges = false;
        const next = { ...prev };
        images.forEach((img) => {
          if (img.optimizationStatus === "COMPLETED" && next[img.id]) {
            delete next[img.id];
            hasChanges = true;
          }
        });
        return hasChanges ? next : prev;
      });
    }
  }, [images]);

  // Merge optimistic statuses with loaded images
  const displayImages = (images || []).map((img) => {
    if (optimisticStatuses[img.id] && img.optimizationStatus !== "COMPLETED") {
      return {
        ...img,
        optimizationStatus: optimisticStatuses[img.id],
      };
    }
    return img;
  });

  // Handle action feedback message
  useEffect(() => {
    if (actionFetcher.data?.message) {
      setBannerMessage(actionFetcher.data.message);
    } else if (actionFetcher.data?.error) {
      setBannerMessage(`Error: ${actionFetcher.data.error}`);
    }
  }, [actionFetcher.data]);

  const scanStatus = latestScan?.status;
  const isScanActive = scanStatus === "RUNNING" || scanStatus === "QUEUED";

  // Background poll via native Remix revalidator ONLY when a full store scan is actively running
  useEffect(() => {
    if (isScanActive) {
      const timer = setInterval(() => {
        if (revalidator.state === "idle") {
          revalidator.revalidate();
        }
      }, 3000);
      return () => clearInterval(timer);
    }
  }, [isScanActive]);

  const actionLoading = actionFetcher.state === "submitting" || actionFetcher.state === "loading";

  const sendAction = (payload: Record<string, string>) => {
    const formData = new FormData();
    for (const [k, v] of Object.entries(payload)) {
      formData.append(k, v);
    }
    actionFetcher.submit(formData, { method: "POST" });
  };

  const handleStartScan = () => {
    sendAction({ intent: "scan" });
  };

  const handleOptimizeSingle = (id: string) => {
    setOptimisticStatuses((prev) => ({ ...prev, [id]: "PROCESSING" }));
    sendAction({ intent: "optimize", imageId: id });
  };

  const handleOptimizeBulk = (ids: string[]) => {
    const bulkMap: Record<string, string> = {};
    ids.forEach((id) => {
      bulkMap[id] = "QUEUED";
    });
    setOptimisticStatuses((prev) => ({ ...prev, ...bulkMap }));
    sendAction({ intent: "bulk-optimize", imageIds: JSON.stringify(ids) });
    setSelectedIds([]);
  };

  const handleViewResult = (image: ImageRecord) => {
    if (!image.optimizationResult) return;
    setActiveResult({
      productTitle: image.productTitle,
      originalUrl: image.originalUrl,
      format: image.format || "unknown",
      originalBytes: image.optimizationResult.originalBytes,
      optimizedBytes: image.optimizationResult.optimizedBytes,
      savingsBytes: image.optimizationResult.savingsBytes,
      reductionPercent: image.optimizationResult.reductionPercent,
      outputFormat: image.optimizationResult.outputFormat,
    });
    setModalOpen(true);
  };

  const handleStatusFilterChange = (newStatus: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("status", newStatus);
    next.set("page", "1");
    setSearchParams(next);
  };

  const handleSearchSubmit = () => {
    const next = new URLSearchParams(searchParams);
    if (searchInput) {
      next.set("search", searchInput);
    } else {
      next.delete("search");
    }
    next.set("page", "1");
    setSearchParams(next);
  };

  const handlePageChange = (newPage: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(newPage));
    setSearchParams(next);
  };

  const statusOptions = [
    { label: "All Statuses", value: "ALL" },
    { label: "High Priority", value: "HIGH_PRIORITY" },
    { label: "Optimization Recommended", value: "OPTIMIZATION_RECOMMENDED" },
    { label: "Optimized", value: "OPTIMIZED" },
    { label: "Queued", value: "QUEUED" },
    { label: "Processing", value: "PROCESSING" },
    { label: "Completed", value: "COMPLETED" },
    { label: "Failed", value: "FAILED" },
  ];

  const isScanning = latestScan?.status === "RUNNING" || latestScan?.status === "QUEUED";

  return (
    <Page fullWidth>
      <BlockStack gap="500">
        {/* NEXHUNAR Brand Header */}
        <div
          className="nex-brand-header"
          style={{
            background: "linear-gradient(135deg, #38204c 0%, #4a2d66 100%)",
            color: "#ffffff",
            padding: "1.5rem 2rem",
            borderRadius: "12px",
            boxShadow: "0 4px 12px rgba(56, 32, 76, 0.12)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <BlockStack gap="100">
            <h1
              className="nex-brand-title"
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: "#ffffff",
                margin: "0 0 0.25rem 0",
              }}
            >
              StoreBoost Pro — Image Optimization Scanner
            </h1>
            <p
              className="nex-brand-subtitle"
              style={{
                fontSize: "0.925rem",
                color: "#ebd3cb",
                margin: 0,
              }}
            >
              Find and reduce unnecessary image weight across your Shopify store.
            </p>
          </BlockStack>
          <InlineStack gap="300">
            <Button
              variant="primary"
              onClick={handleStartScan}
              loading={isScanning || actionLoading}
              disabled={isScanning || actionLoading}
            >
              {isScanning ? "Scanning Store..." : "Scan Store"}
            </Button>
          </InlineStack>
        </div>

        {bannerMessage && (
          <Banner onDismiss={() => setBannerMessage(null)} tone="info">
            <p>{bannerMessage}</p>
          </Banner>
        )}

        {/* Scan Progress Banner */}
        {latestScan && (
          <ScanProgress
            status={latestScan.status as any}
            scannedImages={latestScan.scannedImages}
            totalImages={latestScan.totalImages}
            error={latestScan.error}
          />
        )}

        {/* Summary Statistics Cards */}
        <SummaryCards stats={stats} />

        {/* Filters and Controls */}
        <Card>
          <InlineStack gap="400" align="space-between" blockAlign="center">
            <Box minWidth="320px">
              <TextField
                label="Search Products"
                labelHidden
                placeholder="Search products by title..."
                value={searchInput}
                onChange={setSearchInput}
                autoComplete="off"
                clearButton
                onClearButtonClick={() => {
                  setSearchInput("");
                  const next = new URLSearchParams(searchParams);
                  next.delete("search");
                  next.set("page", "1");
                  setSearchParams(next);
                }}
              />
            </Box>

            <InlineStack gap="300" blockAlign="center">
              <Button onClick={handleSearchSubmit}>
                Search
              </Button>
              <Select
                label="Filter by Status"
                labelHidden
                options={statusOptions}
                value={statusFilter}
                onChange={handleStatusFilterChange}
              />
              <Button onClick={() => revalidator.revalidate()} loading={revalidator.state === "loading"}>
                Refresh
              </Button>
            </InlineStack>
          </InlineStack>
        </Card>

        {/* Image Table */}
        <ImageTable
          images={displayImages}
          total={total}
          page={page}
          limit={limit}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          onOptimizeSingle={handleOptimizeSingle}
          onOptimizeBulk={handleOptimizeBulk}
          onViewResult={handleViewResult}
          loading={navigation.state === "loading"}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />

        {/* Optimization Result Comparison Modal */}
        <OptimizationResultModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          result={activeResult}
        />
      </BlockStack>
    </Page>
  );
}
