// modified-2026-09-16
/**
 * Image Optimizer Service
 *
 * Uses Sharp to process images downloaded from Shopify CDN.
 * NEVER overwrites original Shopify product media.
 * Optimized outputs stored locally for assessment (production: S3/GCS).
 *
 * Format decisions:
 * - JPEG/PNG/BMP/TIFF → WebP (quality 82, effort 4)
 * - GIF → Skip: animated GIF would become broken static WebP
 * - SVG → Skip: vector format, Sharp cannot meaningfully optimize
 * - AVIF → Re-encode as WebP (broader browser compatibility)
 * - WebP → Re-compress at quality 82 (handle poorly compressed WebP)
 * - Unknown → Attempt WebP, fallback to PROCESSING_FAILED
 */

import sharp from "sharp";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

const WEBP_QUALITY = 82;  // 0-100; 82 = excellent quality ~30-40% size reduction
const WEBP_EFFORT = 4;    // 1-6; 4 = good compression/speed balance for production

const STORAGE_PATH = process.env.OPTIMIZED_STORAGE_PATH ?? "./tmp/optimized";

export interface OptimizationOutput {
  buffer: Buffer;
  outputBytes: number;
  outputFormat: string;
  qualitySetting: number;
  outputPath: string;
}

export class OptimizationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "UNSUPPORTED_FORMAT"
      | "PROCESSING_FAILED"
      | "CORRUPT_IMAGE"
      | "STORAGE_FAILED"
  ) {
    super(message);
    this.name = "OptimizationError";
  }
}

// Formats that should be skipped (non-raster or animated)
const SKIP_FORMATS = ["gif", "svg"];

// Formats convertible to WebP
const CONVERTIBLE_FORMATS = [
  "jpeg",
  "jpg",
  "png",
  "webp",
  "bmp",
  "tiff",
  "tif",
  "avif",
];

function ensureStorageDir(shopId: string): string {
  const dir = path.join(STORAGE_PATH, shopId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function generateOutputPath(shopId: string, imageId: string): string {
  const dir = ensureStorageDir(shopId);
  const safeImageId = imageId.replace(/[^a-zA-Z0-9-_]/g, "_");
  return path.join(dir, `${safeImageId}.webp`);
}

/**
 * Process an image buffer through Sharp → WebP.
 * Returns optimized buffer and metadata.
 */
export async function processImage(
  buffer: Buffer,
  format: string,
  imageId: string,
  shopId: string
): Promise<OptimizationOutput> {
  const normalizedFormat = format.toLowerCase().replace("jpg", "jpeg");

  if (SKIP_FORMATS.includes(normalizedFormat)) {
    throw new OptimizationError(
      normalizedFormat === "gif"
        ? "Animated GIF cannot be converted to WebP without breaking animation. Skipping."
        : "SVG is a vector format and cannot be meaningfully optimized by Sharp.",
      "UNSUPPORTED_FORMAT"
    );
  }

  if (!CONVERTIBLE_FORMATS.includes(normalizedFormat)) {
    throw new OptimizationError(
      `Unsupported format: ${format}`,
      "UNSUPPORTED_FORMAT"
    );
  }

  logger.info("Starting image optimization", {
    imageId,
    format: normalizedFormat,
    inputBytes: buffer.length,
  });

  let outputBuffer: Buffer;

  try {
    outputBuffer = await sharp(buffer)
      .webp({
        quality: WEBP_QUALITY,
        effort: WEBP_EFFORT,
      })
      .toBuffer();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Sharp processing failed", { imageId, format, error: message });

    if (
      message.includes("unsupported image format") ||
      message.includes("Input image") ||
      message.includes("corrupt")
    ) {
      throw new OptimizationError(
        `Corrupt or unreadable image: ${message}`,
        "CORRUPT_IMAGE"
      );
    }
    throw new OptimizationError(`Processing failed: ${message}`, "PROCESSING_FAILED");
  }

  const outputPath = generateOutputPath(shopId, imageId);

  try {
    fs.writeFileSync(outputPath, outputBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new OptimizationError(
      `Failed to save optimized image: ${message}`,
      "STORAGE_FAILED"
    );
  }

  logger.info("Image optimization completed", {
    imageId,
    originalFormat: format,
    outputFormat: "webp",
    inputBytes: buffer.length,
    outputBytes: outputBuffer.length,
    outputPath,
  });

  return {
    buffer: outputBuffer,
    outputBytes: outputBuffer.length,
    outputFormat: "webp",
    qualitySetting: WEBP_QUALITY,
    outputPath,
  };
}
