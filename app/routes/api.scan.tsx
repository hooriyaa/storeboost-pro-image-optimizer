// modified-2026-09-16
/**
 * API: Scan endpoints
 *
 * POST /api/scan - Start a new store scan
 * GET  /api/scan   - Get current scan job status + progress
 *
 * The scan runs asynchronously in the background (not in the HTTP request).
 * The request creates a scan job, starts the async process, and returns immediately.
 * The client polls /api/scan for progress.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { scanShopImages } from "../services/shopify-products.server";
import { logger } from "../utils/logger";

// GET /api/scan - Returns current scan status
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Find the shop record
  const shopRecord = await db.shop.findFirst({
    where: { shopDomain },
  });

  if (!shopRecord) {
    return json({ status: null, scanJob: null });
  }

  // Get the most recent scan job
  const latestScanJob = await db.scanJob.findFirst({
    where: { shopId: shopRecord.id },
    orderBy: { createdAt: "desc" },
  });

  if (!latestScanJob) {
    return json({ status: "NONE", scanJob: null });
  }

  return json({
    status: latestScanJob.status,
    scanJob: {
      id: latestScanJob.id,
      status: latestScanJob.status,
      totalImages: latestScanJob.totalImages,
      scannedImages: latestScanJob.scannedImages,
      startedAt: latestScanJob.startedAt,
      completedAt: latestScanJob.completedAt,
      error: latestScanJob.error,
    },
  });
};

// POST /api/scan - Start a new scan
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Ensure shop record exists
  const shopRecord = await db.shop.upsert({
    where: { shopDomain },
    update: { isActive: true },
    create: { shopDomain, isActive: true },
  });

  // Prevent starting a new scan if one is already running
  const activeScan = await db.scanJob.findFirst({
    where: {
      shopId: shopRecord.id,
      status: { in: ["QUEUED", "RUNNING"] },
    },
  });

  if (activeScan) {
    return json({
      message: "A scan is already in progress",
      scanJob: { id: activeScan.id, status: activeScan.status },
    });
  }

  // Create scan job record
  const scanJob = await db.scanJob.create({
    data: {
      shopId: shopRecord.id,
      status: "QUEUED",
    },
  });

  logger.info("Scan job created", { scanJobId: scanJob.id, shopDomain });

  // Run scan asynchronously (don't await - return quickly to client)
  // The scan runs in the background and updates the DB incrementally.
  // Client polls /api/scan for progress.
  setImmediate(async () => {
    try {
      await scanShopImages(admin, shopDomain, scanJob.id);
    } catch (err) {
      logger.error("Background scan failed", {
        scanJobId: scanJob.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return json({
    message: "Scan started",
    scanJob: { id: scanJob.id, status: "QUEUED" },
  });
};
