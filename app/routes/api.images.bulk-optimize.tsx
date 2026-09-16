// modified-2026-09-16
/**
 * API: Bulk Image Optimization
 *
 * POST /api/images/bulk-optimize
 *
 * Creates optimization jobs for multiple images in one request.
 * Each image is processed independently in the background queue.
 *
 * Body: { imageIds: string[] } (validated with Zod)
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { createBulkOptimizationJobs } from "../services/job-queue.server";
import { logger } from "../utils/logger";

const BulkOptimizeSchema = z.object({
  imageIds: z
    .array(z.string().regex(/^[a-zA-Z0-9_-]+$/, "Invalid image ID format"))
    .min(1, "At least one image ID is required")
    .max(100, "Maximum 100 images per bulk request"),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let body: unknown;
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      body = await request.json();
    } else {
      const formData = await request.formData();
      const rawImageIds = formData.get("imageIds");
      if (typeof rawImageIds === "string") {
        try {
          body = { imageIds: JSON.parse(rawImageIds) };
        } catch {
          body = { imageIds: rawImageIds.split(",").filter(Boolean) };
        }
      }
    }
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  const parseResult = BulkOptimizeSchema.safeParse(body);
  if (!parseResult.success) {
    return json(
      { error: "Validation failed", details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const { imageIds } = parseResult.data;

  // Tenant isolation
  const shopRecord = await db.shop.findFirst({
    where: { shopDomain, isActive: true },
  });

  if (!shopRecord) {
    return json({ error: "Shop not found or inactive" }, { status: 404 });
  }

  logger.info("Bulk optimization request received", {
    shopDomain,
    imageCount: imageIds.length,
  });

  const result = await createBulkOptimizationJobs(shopRecord.id, imageIds);

  return json({
    success: true,
    created: result.created,
    duplicates: result.duplicates,
    errors: result.errors,
    message: `Queued ${result.created} optimization job(s). ${result.duplicates} already in progress. ${result.errors.length} error(s).`,
  });
};
