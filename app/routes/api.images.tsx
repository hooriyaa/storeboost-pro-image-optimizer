// modified-2026-09-16
/**
 * API: Image List
 *
 * GET /api/images?page=1&limit=25&status=ALL&search=
 *
 * Returns paginated, filtered, searchable list of product images.
 * All data is scoped to the authenticated shop (tenant isolation).
 *
 * Query parameters:
 * - page: page number (1-indexed, default 1)
 * - limit: items per page (default 25, max 100)
 * - status: filter by OptimizationStatus (default ALL)
 * - search: search by product title (case-insensitive)
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { z } from "zod";
import type { OptimizationStatus } from "@prisma/client";
import { classifyImage } from "../utils/image-rules";
import { processOptimizationJobDirectly } from "../services/job-queue.server";

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum([
      "ALL",
      "PENDING",
      "OPTIMIZED",
      "OPTIMIZATION_RECOMMENDED",
      "HIGH_PRIORITY",
      "QUEUED",
      "PROCESSING",
      "COMPLETED",
      "FAILED",
    ])
    .default("ALL"),
  search: z.string().max(100).optional(),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Parse and validate query parameters
  const url = new URL(request.url);
  const parseResult = QuerySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
  });

  if (!parseResult.success) {
    return json(
      { error: "Invalid query parameters", details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const { page, limit, status, search } = parseResult.data;
  const offset = (page - 1) * limit;

  // Tenant isolation: always scope to the authenticated shop
  const shopRecord = await db.shop.findFirst({
    where: { shopDomain },
  });

  if (!shopRecord) {
    return json({ images: [], total: 0, page, limit, totalPages: 0 });
  }

  const shopId = shopRecord.id;

  // Build where clause
  const where: Record<string, unknown> = {
    shopId,
    ...(status !== "ALL"
      ? { optimizationStatus: status as OptimizationStatus }
      : {}),
    ...(search
      ? {
          productTitle: {
            contains: search,
            mode: "insensitive" as const,
          },
        }
      : {}),
  };

  const [images, total] = await Promise.all([
    db.productImage.findMany({
      where,
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
        optimizationJobs: {
          where: { status: { in: ["QUEUED", "PROCESSING"] } },
          select: { id: true, status: true },
          take: 1,
        },
      },
    }),
    db.productImage.count({ where }),
  ]);

  // Auto-resolve any legacy or queued status
  const serializedImages = images.map((img) => {
    let currentStatus = img.optimizationStatus;

    // If an image is stuck in QUEUED / PROCESSING, trigger background processing immediately
    if (currentStatus === "QUEUED" || currentStatus === "PROCESSING") {
      const activeJob = img.optimizationJobs[0];
      if (activeJob) {
        processOptimizationJobDirectly({
          shopId,
          shopDomain,
          imageId: img.id,
          imageUrl: img.originalUrl,
          format: img.format ?? "unknown",
          optimizationJobId: activeJob.id,
        }).catch(() => {});
      }
    }

    if (currentStatus === "PENDING") {
      currentStatus = classifyImage({
        originalBytes: img.originalBytes,
        format: img.format,
        width: img.width,
        height: img.height,
      });

      if (currentStatus !== "PENDING") {
        db.productImage
          .update({
            where: { id: img.id },
            data: { optimizationStatus: currentStatus },
          })
          .catch(() => {});
      }
    }

    return {
      ...img,
      optimizationStatus: currentStatus,
      originalBytes: img.originalBytes ? Number(img.originalBytes) : null,
      optimizationResult: img.optimizationResult
        ? {
            ...img.optimizationResult,
            originalBytes: Number(img.optimizationResult.originalBytes),
            optimizedBytes: Number(img.optimizationResult.optimizedBytes),
            savingsBytes: Number(img.optimizationResult.savingsBytes),
          }
        : null,
    };
  });

  return json({
    images: serializedImages,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
};
