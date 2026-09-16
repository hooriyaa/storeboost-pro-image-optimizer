// modified-2026-09-16
/**
 * API: Single Image Optimization
 *
 * POST /api/images/:id/optimize
 *
 * Creates an optimization job for a single image.
 * Returns immediately after queuing — processing happens in background worker.
 *
 * Security:
 * - Validates the image belongs to the authenticated shop
 * - Prevents duplicate jobs (idempotent)
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { createOptimizationJob } from "../services/job-queue.server";
import { logger } from "../utils/logger";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const imageId = params.id;

  if (!imageId) {
    return json({ error: "Image ID is required" }, { status: 400 });
  }

  // Validate image ID format
  if (!/^[a-zA-Z0-9_-]+$/.test(imageId)) {
    return json({ error: "Invalid image ID format" }, { status: 400 });
  }

  // Get shop record (tenant isolation)
  const shopRecord = await db.shop.findFirst({
    where: { shopDomain, isActive: true },
  });

  if (!shopRecord) {
    return json({ error: "Shop not found or inactive" }, { status: 404 });
  }

  try {
    const result = await createOptimizationJob(shopRecord.id, imageId);

    logger.info("Single image optimization queued", {
      imageId,
      shopDomain,
      optimizationJobId: result.optimizationJobId,
      isDuplicate: result.isDuplicate,
    });

    return json({
      success: true,
      optimizationJobId: result.optimizationJobId,
      queueJobId: result.queueJobId,
      isDuplicate: result.isDuplicate,
      message: result.isDuplicate
        ? "An optimization job is already running for this image"
        : "Image optimization queued successfully",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to queue optimization job", { imageId, shopDomain, error: message });

    if (message.includes("not found")) {
      return json({ error: "Image not found or not owned by this shop" }, { status: 404 });
    }

    return json({ error: "Failed to queue optimization job" }, { status: 500 });
  }
};
