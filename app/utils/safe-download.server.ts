// modified-2026-09-16
/**
 * Safe Image Downloader for StoreBoost Pro.
 *
 * Security measures implemented:
 * - Only allows HTTPS URLs (prevents HTTP downgrade attacks)
 * - Only allows known Shopify CDN domains (SSRF protection)
 * - Enforces maximum file size (default 20 MB) to prevent memory exhaustion
 * - Enforces download timeout (default 15 seconds) to prevent hanging connections
 * - Validates Content-Type is an image MIME type
 * - Returns actual byte count from streaming (not from Content-Length header)
 */

import { logger } from "./logger";

const MAX_BYTES = Number(process.env.MAX_IMAGE_BYTES ?? 20_971_520); // 20 MB
const TIMEOUT_MS = Number(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS ?? 15_000); // 15s

// Allowed Shopify CDN hostnames only
const ALLOWED_HOSTNAMES = [
  "cdn.shopify.com",
  "cdn.shopifycloud.com",
];

const ALLOWED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
];

export class SafeDownloadError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_URL"
      | "DISALLOWED_HOST"
      | "TIMEOUT"
      | "TOO_LARGE"
      | "BAD_STATUS"
      | "INVALID_CONTENT_TYPE"
      | "NETWORK_ERROR"
  ) {
    super(message);
    this.name = "SafeDownloadError";
  }
}

export interface DownloadResult {
  buffer: Buffer;
  actualBytes: number;
  contentType: string;
  detectedFormat: string;
}

function validateUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SafeDownloadError(`Invalid URL: ${url}`, "INVALID_URL");
  }

  if (parsed.protocol !== "https:") {
    throw new SafeDownloadError(
      `Only HTTPS URLs are allowed. Got: ${parsed.protocol}`,
      "INVALID_URL"
    );
  }

  const isAllowed = ALLOWED_HOSTNAMES.some(
    (host) =>
      parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
  );

  if (!isAllowed) {
    throw new SafeDownloadError(
      `Host not allowed: ${parsed.hostname}. Only Shopify CDN URLs are permitted.`,
      "DISALLOWED_HOST"
    );
  }

  return parsed;
}

function contentTypeToFormat(contentType: string): string {
  const lower = contentType.toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
  };
  return map[lower] ?? "unknown";
}

/**
 * Safely download an image from a Shopify CDN URL.
 * Returns the image buffer and actual byte count.
 */
export async function safeDownloadImage(
  url: string,
  context: { imageId: string; shopId: string }
): Promise<DownloadResult> {
  // 1. Validate URL (SSRF protection)
  validateUrl(url);

  logger.info("Downloading image", { imageId: context.imageId, url });

  // 2. Set up abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "StoreBoost-Pro/1.0 (Image Optimizer Scanner)",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("abort") || message.includes("timeout")) {
      throw new SafeDownloadError(
        `Download timed out after ${TIMEOUT_MS}ms`,
        "TIMEOUT"
      );
    }
    throw new SafeDownloadError(`Network error: ${message}`, "NETWORK_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }

  // 3. Validate HTTP status
  if (!response.ok) {
    throw new SafeDownloadError(
      `HTTP ${response.status} ${response.statusText}`,
      "BAD_STATUS"
    );
  }

  // 4. Validate Content-Type
  const contentType = response.headers.get("content-type") ?? "";
  const isAllowedType = ALLOWED_IMAGE_CONTENT_TYPES.some((allowed) =>
    contentType.toLowerCase().startsWith(allowed)
  );

  if (!isAllowedType) {
    throw new SafeDownloadError(
      `Invalid content type: ${contentType}`,
      "INVALID_CONTENT_TYPE"
    );
  }

  // 5. Stream with size enforcement
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  const reader = response.body?.getReader();
  if (!reader) {
    throw new SafeDownloadError("No response body", "NETWORK_ERROR");
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      if (totalBytes > MAX_BYTES) {
        reader.cancel();
        throw new SafeDownloadError(
          `Image exceeds maximum allowed size of ${MAX_BYTES} bytes`,
          "TOO_LARGE"
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));

  logger.info("Image downloaded successfully", {
    imageId: context.imageId,
    actualBytes: buffer.length,
    contentType,
  });

  return {
    buffer,
    actualBytes: buffer.length,
    contentType,
    detectedFormat: contentTypeToFormat(contentType),
  };
}
