// modified-2026-09-16
/**
 * API: Dashboard Statistics
 *
 * GET /api/stats - Returns summary statistics for the dashboard.
 *
 * Returns:
 * - totalImages: total images scanned
 * - needsOptimization: images classified as HIGH_PRIORITY or OPTIMIZATION_RECOMMENDED
 * - potentialSavingsBytes: sum of estimated savings (before optimization)
 * - actualSavingsBytes: sum of actual savings (after optimization)
 * - completedImages: images successfully optimized
 * - progressPercent: (completed / needsOptimization) * 100
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { estimateSavings } from "../utils/image-rules";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shopRecord = await db.shop.findFirst({
    where: { shopDomain },
  });

  if (!shopRecord) {
    return json({
      totalImages: 0,
      needsOptimization: 0,
      potentialSavingsBytes: 0,
      actualSavingsBytes: 0,
      completedImages: 0,
      progressPercent: 0,
    });
  }

  const shopId = shopRecord.id;

  // Aggregate counts
  const [totalImages, highPriority, recommended, completed, failed] = await Promise.all([
    db.productImage.count({ where: { shopId } }),
    db.productImage.count({ where: { shopId, optimizationStatus: "HIGH_PRIORITY" } }),
    db.productImage.count({ where: { shopId, optimizationStatus: "OPTIMIZATION_RECOMMENDED" } }),
    db.productImage.count({ where: { shopId, optimizationStatus: "COMPLETED" } }),
    db.productImage.count({ where: { shopId, optimizationStatus: "FAILED" } }),
  ]);

  const needsOptimization = highPriority + recommended;

  // Calculate actual savings from completed optimizations
  const actualSavingsAgg = await db.optimizationResult.aggregate({
    where: { shopId },
    _sum: { savingsBytes: true },
  });
  const actualSavingsBytes = Number(actualSavingsAgg._sum.savingsBytes ?? 0n);

  // Estimate potential savings for unoptimized images
  const unoptimizedImages = await db.productImage.findMany({
    where: {
      shopId,
      optimizationStatus: { in: ["HIGH_PRIORITY", "OPTIMIZATION_RECOMMENDED"] },
      originalBytes: { not: null },
    },
    select: { originalBytes: true, format: true },
  });

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
    needsOptimization > 0
      ? Math.round((completed / (needsOptimization + completed)) * 100)
      : 0;

  return json({
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
  });
};
