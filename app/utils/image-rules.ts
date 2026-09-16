// modified-2026-09-16
/**
 * Image Classification Rules for StoreBoost Pro.
 *
 * CLASSIFICATION THRESHOLDS AND RULES
 * =====================================
 *
 * HIGH_PRIORITY_BYTES = 1,500,000 (1.5 MB)
 *   Any image exceeding 1.5 MB has significant savings potential.
 *
 * OPTIMIZATION_RECOMMENDED_BYTES = 500,000 (500 KB)
 *   Images between 500 KB and 1.5 MB on inefficient formats benefit from conversion.
 *
 * HIGH_PRIORITY_DIMENSION = 3000 (px)
 *   Images wider or taller than 3000px on JPEG/PNG waste bandwidth.
 *
 * OPTIMIZATION_RECOMMENDED_DIMENSION = 2000 (px)
 *   Images wider or taller than 2000px on JPEG/PNG benefit from optimization.
 *
 * CLASSIFICATION RULES (applied in priority order, first match wins):
 *
 * 1. HIGH_PRIORITY  — BMP/TIFF (always inefficient for web)
 * 2. HIGH_PRIORITY  — originalBytes > 1.5 MB
 * 3. HIGH_PRIORITY  — (width > 3000 OR height > 3000) AND JPEG/PNG
 * 4. OPTIM_RECOM.   — originalBytes > 500 KB AND JPEG/PNG
 * 5. OPTIM_RECOM.   — (width > 2000 OR height > 2000) AND JPEG/PNG
 * 6. OPTIMIZED      — WebP/AVIF AND originalBytes <= 500 KB
 * 7. OPTIM_RECOM.   — WebP/AVIF AND originalBytes > 500 KB (large but modern)
 * 8. OPTIM_RECOM.   — JPEG/PNG format with dimensions or measurable size
 * 9. PENDING        — completely unmeasured and unknown metadata
 */

import type { OptimizationStatus } from "@prisma/client";

// ─── Thresholds ───────────────────────────────────────────────────────────────
export const IMAGE_THRESHOLDS = {
  HIGH_PRIORITY_BYTES: 1_500_000,           // 1.5 MB
  OPTIMIZATION_RECOMMENDED_BYTES: 500_000,  // 500 KB
  HIGH_PRIORITY_DIMENSION: 3000,            // px
  OPTIMIZATION_RECOMMENDED_DIMENSION: 2000, // px
} as const;

export const EFFICIENT_FORMATS = ["webp", "avif"] as const;
export const INEFFICIENT_FORMATS = ["bmp", "tiff", "tif"] as const;
export const JPEG_PNG_FORMATS = ["jpeg", "jpg", "png"] as const;

type ImageInput = {
  originalBytes: number | bigint | null | undefined;
  format: string | null | undefined;
  width: number | null | undefined;
  height: number | null | undefined;
};

/**
 * Classify an image based on its metadata.
 * Returns the appropriate OptimizationStatus enum value.
 */
export function classifyImage(image: ImageInput): OptimizationStatus {
  const bytes =
    image.originalBytes !== null && image.originalBytes !== undefined
      ? typeof image.originalBytes === "bigint"
        ? Number(image.originalBytes)
        : image.originalBytes
      : null;

  const fmt = image.format?.toLowerCase() ?? null;
  const width = image.width ?? null;
  const height = image.height ?? null;

  const {
    HIGH_PRIORITY_BYTES,
    OPTIMIZATION_RECOMMENDED_BYTES,
    HIGH_PRIORITY_DIMENSION,
    OPTIMIZATION_RECOMMENDED_DIMENSION,
  } = IMAGE_THRESHOLDS;

  const isInefficient =
    fmt !== null && (INEFFICIENT_FORMATS as readonly string[]).includes(fmt);
  const isJpegOrPng =
    fmt !== null && (JPEG_PNG_FORMATS as readonly string[]).includes(fmt);
  const isEfficientFormat =
    fmt !== null && (EFFICIENT_FORMATS as readonly string[]).includes(fmt);

  // Rule 1: Cannot classify without file size
  if (bytes === null) {
    return "PENDING";
  }

  // Rule 2: BMP/TIFF — always inefficient for web
  if (isInefficient) return "HIGH_PRIORITY";

  // Rule 3: Very large file (> 1.5 MB)
  if (bytes > HIGH_PRIORITY_BYTES) return "HIGH_PRIORITY";

  // Rule 4: Large dimensions (> 3000px) on inefficient format
  if (
    isJpegOrPng &&
    ((width !== null && width > HIGH_PRIORITY_DIMENSION) ||
      (height !== null && height > HIGH_PRIORITY_DIMENSION))
  ) {
    return "HIGH_PRIORITY";
  }

  // Rule 5: Medium-large file on inefficient format (> 500 KB)
  if (isJpegOrPng && bytes > OPTIMIZATION_RECOMMENDED_BYTES) {
    return "OPTIMIZATION_RECOMMENDED";
  }

  // Rule 6: Large dimensions on inefficient format (> 2000px)
  if (
    isJpegOrPng &&
    ((width !== null && width > OPTIMIZATION_RECOMMENDED_DIMENSION) ||
      (height !== null && height > OPTIMIZATION_RECOMMENDED_DIMENSION))
  ) {
    return "OPTIMIZATION_RECOMMENDED";
  }

  // Rule 7: Already optimized (small efficient format)
  if (isEfficientFormat && bytes <= OPTIMIZATION_RECOMMENDED_BYTES) {
    return "OPTIMIZED";
  }

  // Rule 8: Large efficient format — still worth re-encoding
  if (isEfficientFormat && bytes > OPTIMIZATION_RECOMMENDED_BYTES) {
    return "OPTIMIZATION_RECOMMENDED";
  }

  // Default fallback
  return "OPTIMIZATION_RECOMMENDED";
}

/**
 * Calculate actual savings after optimization.
 * Guards against false positives: if optimized >= original, savings = 0.
 */
export function calculateSavings(
  originalBytes: number,
  optimizedBytes: number
) {
  if (optimizedBytes >= originalBytes) {
    return { savedBytes: 0, reductionPercent: 0, improved: false };
  }

  const savedBytes = originalBytes - optimizedBytes;
  const reductionPercent = (savedBytes / originalBytes) * 100;

  return { savedBytes, reductionPercent, improved: true };
}

/**
 * Estimate potential savings for an unoptimized image (before actual processing).
 * Clearly labeled as ESTIMATED in the UI — never shown as actual savings.
 */
export function estimateSavings(
  originalBytes: number,
  format: string | null | undefined
): { estimatedBytes: number; estimatedReductionPercent: number } {
  const fmt = format?.toLowerCase() ?? null;

  let estimatedReductionPercent: number;

  if (fmt === null) {
    estimatedReductionPercent = 20;
  } else if ((JPEG_PNG_FORMATS as readonly string[]).includes(fmt)) {
    estimatedReductionPercent = 30;
  } else if ((INEFFICIENT_FORMATS as readonly string[]).includes(fmt)) {
    estimatedReductionPercent = 55;
  } else if ((EFFICIENT_FORMATS as readonly string[]).includes(fmt)) {
    estimatedReductionPercent = 10;
  } else {
    estimatedReductionPercent = 20;
  }

  const estimatedBytes = Math.round(
    originalBytes * (1 - estimatedReductionPercent / 100)
  );

  return { estimatedBytes, estimatedReductionPercent };
}
