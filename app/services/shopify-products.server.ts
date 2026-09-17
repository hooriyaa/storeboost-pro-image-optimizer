// modified-2026-09-16
/**
 * Shopify Product & Image Fetcher
 *
 * Fetches all product images from a Shopify store using GraphQL cursor-based
 * pagination. Designed for large stores (10,000+ images):
 *
 * - Fetches 50 products per request
 * - Uses media { ... on MediaImage } (NOT deprecated `images` field)
 * - Writes image metadata to the database incrementally
 * - Respects Shopify API rate limits via throttle detection and exponential backoff
 * - Updates scan job progress after each product batch
 *
 * API Version: 2026-07 (latest stable)
 */

import { db } from "../db.server";
import { classifyImage } from "../utils/image-rules";
import { logger } from "../utils/logger";

const PRODUCTS_PER_PAGE = 50;
const RATE_LIMIT_BACKOFF_MS = 2_000;
const MAX_RETRIES = 3;

interface ShopifyMediaImage {
  id: string;
  image: {
    url: string;
    altText: string | null;
    width: number | null;
    height: number | null;
  } | null;
}

interface ShopifyProduct {
  id: string;
  title: string;
  media: {
    edges: Array<{
      node: {
        mediaContentType: string;
        __typename: string;
      } & Partial<ShopifyMediaImage>;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface ProductsQueryResult {
  products: {
    edges: Array<{ node: ShopifyProduct; cursor: string }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

const PRODUCTS_WITH_MEDIA_QUERY = `
  query GetProductsWithMedia($cursor: String) {
    products(first: ${PRODUCTS_PER_PAGE}, after: $cursor) {
      edges {
        cursor
        node {
          id
          title
          media(first: 20) {
            edges {
              node {
                mediaContentType
                ... on MediaImage {
                  id
                  image {
                    url
                    altText
                    width
                    height
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PRODUCT_MEDIA_PAGE_QUERY = `
  query GetProductMediaPage($productId: ID!, $cursor: String) {
    product(id: $productId) {
      id
      title
      media(first: 50, after: $cursor) {
        edges {
          node {
            mediaContentType
            ... on MediaImage {
              id
              image {
                url
                altText
                width
                height
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

function detectFormatFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const cleanPath = pathname.split("?")[0].replace(/_\d+x\d+/g, "");
    const ext = cleanPath.split(".").pop();
    const formatMap: Record<string, string> = {
      jpg: "jpeg",
      jpeg: "jpeg",
      png: "png",
      webp: "webp",
      gif: "gif",
      avif: "avif",
      svg: "svg",
      bmp: "bmp",
      tiff: "tiff",
      tif: "tiff",
    };
    return ext ? (formatMap[ext] ?? ext) : null;
  } catch {
    return null;
  }
}

async function fetchImageFileSize(url: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);

    let response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "User-Agent": "StoreBoost-Pro/1.0 (Image Scanner)" },
    });

    let contentLength = response.headers.get("content-length");
    if (!contentLength || !response.ok) {
      response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "StoreBoost-Pro/1.0 (Image Scanner)",
          Range: "bytes=0-10",
        },
      });
      const range = response.headers.get("content-range");
      if (range) {
        contentLength = range.split("/")[1] ?? null;
      } else {
        contentLength = response.headers.get("content-length");
      }
    }

    clearTimeout(timeoutId);

    if (contentLength) {
      const bytes = parseInt(contentLength, 10);
      return isNaN(bytes) ? null : bytes;
    }
    return null;
  } catch {
    return null;
  }
}

type AdminGraphQL = (
  query: string,
  options?: { variables?: Record<string, unknown> }
) => Promise<{ json: () => Promise<{ data?: unknown; errors?: unknown[] }> }>;

async function executeQuery<T>(
  admin: { graphql: AdminGraphQL },
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt - 1);
      logger.info("Retrying GraphQL query after backoff", {
        attempt,
        backoffMs: backoff,
      });
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }

    try {
      const response = await admin.graphql(query, { variables });
      const json = await response.json();

      if (json.errors && json.errors.length > 0) {
        const errorMsg = JSON.stringify(json.errors);
        if (
          errorMsg.includes("THROTTLED") ||
          errorMsg.toLowerCase().includes("rate")
        ) {
          logger.warn("Shopify API rate limited", { attempt, errorMsg });
          lastError = new Error(`Rate limited: ${errorMsg}`);
          continue;
        }
        throw new Error(`GraphQL errors: ${errorMsg}`);
      }

      return json.data as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (
        !lastError.message.includes("rate") &&
        !lastError.message.includes("THROTTLED")
      ) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error("Query failed after retries");
}

async function upsertImageFromMedia(
  shopId: string,
  product: { id: string; title: string },
  mediaNode: Partial<ShopifyMediaImage>
): Promise<void> {
  if (!mediaNode.id || !mediaNode.image) return;

  const { url, width, height } = mediaNode.image;
  const shopifyImageId = mediaNode.id;
  const format = detectFormatFromUrl(url);
  const originalBytes = await fetchImageFileSize(url);

  // Check if image already exists and has been optimized or is currently queued/processing
  const existingImage = await db.productImage.findUnique({
    where: {
      shopId_shopifyImageId: { shopId, shopifyImageId },
    },
    select: {
      id: true,
      optimizationStatus: true,
      optimizationResult: { select: { id: true } },
    },
  });

  const isAlreadyOptimizedOrActive =
    existingImage &&
    (existingImage.optimizationStatus === "COMPLETED" ||
      existingImage.optimizationStatus === "PROCESSING" ||
      existingImage.optimizationStatus === "QUEUED" ||
      existingImage.optimizationResult !== null);

  const initialClassification = classifyImage({
    originalBytes: originalBytes ? BigInt(originalBytes) : null,
    format,
    width,
    height,
  });

  const nextStatus = isAlreadyOptimizedOrActive
    ? existingImage.optimizationStatus
    : initialClassification;

  await db.productImage.upsert({
    where: {
      shopId_shopifyImageId: { shopId, shopifyImageId },
    },
    update: {
      productTitle: product.title,
      originalUrl: url,
      width,
      height,
      format,
      originalBytes: originalBytes ? BigInt(originalBytes) : undefined,
      optimizationStatus: nextStatus,
      updatedAt: new Date(),
    },
    create: {
      shopId,
      shopifyImageId,
      shopifyProductId: product.id,
      productTitle: product.title,
      originalUrl: url,
      width,
      height,
      format,
      originalBytes: originalBytes ? BigInt(originalBytes) : null,
      optimizationStatus: nextStatus,
    },
  });
}

export async function scanShopImages(
  admin: { graphql: AdminGraphQL },
  shopDomain: string,
  scanJobId: string
): Promise<{ totalImages: number }> {
  const shopRecord = await db.shop.upsert({
    where: { shopDomain },
    update: { isActive: true },
    create: { shopDomain, isActive: true },
  });

  await db.scanJob.update({
    where: { id: scanJobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  let productCursor: string | null = null;
  let totalImagesProcessed = 0;
  let hasMoreProducts = true;

  logger.info("Scan started", { shopDomain, scanJobId });

  try {
    while (hasMoreProducts) {
      const queryResponse: ProductsQueryResult =
        await executeQuery<ProductsQueryResult>(
          admin,
          PRODUCTS_WITH_MEDIA_QUERY,
          { cursor: productCursor }
        );

      for (const { node: product } of queryResponse.products.edges) {
        for (const { node: mediaNode } of product.media.edges) {
          if (mediaNode.mediaContentType === "IMAGE") {
            await upsertImageFromMedia(
              shopRecord.id,
              product,
              mediaNode as Partial<ShopifyMediaImage>
            );
            totalImagesProcessed++;
          }
        }

        if (product.media.pageInfo.hasNextPage) {
          let mediaCursor: string | null =
            product.media.pageInfo.endCursor;

          while (mediaCursor) {
            const mediaData: {
              product: {
                id: string;
                title: string;
                media: {
                  edges: Array<{
                    node: {
                      mediaContentType: string;
                    } & Partial<ShopifyMediaImage>;
                  }>;
                  pageInfo: {
                    hasNextPage: boolean;
                    endCursor: string | null;
                  };
                };
              };
            } = await executeQuery(admin, PRODUCT_MEDIA_PAGE_QUERY, {
              productId: product.id,
              cursor: mediaCursor,
            });

            for (const { node: mediaNode } of mediaData.product.media.edges) {
              if (mediaNode.mediaContentType === "IMAGE") {
                await upsertImageFromMedia(
                  shopRecord.id,
                  mediaData.product,
                  mediaNode as Partial<ShopifyMediaImage>
                );
                totalImagesProcessed++;
              }
            }

            mediaCursor = mediaData.product.media.pageInfo.hasNextPage
              ? mediaData.product.media.pageInfo.endCursor
              : null;
          }
        }

        await db.scanJob.update({
          where: { id: scanJobId },
          data: { scannedImages: totalImagesProcessed },
        });
      }

      hasMoreProducts = queryResponse.products.pageInfo.hasNextPage;
      productCursor = queryResponse.products.pageInfo.endCursor;

      logger.info("Product batch completed", {
        scanJobId,
        totalImagesProcessed,
        hasMoreProducts,
      });
    }

    await db.scanJob.update({
      where: { id: scanJobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        totalImages: totalImagesProcessed,
        scannedImages: totalImagesProcessed,
      },
    });

    logger.info("Scan completed", { scanJobId, totalImagesProcessed });
    return { totalImages: totalImagesProcessed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Scan failed", { scanJobId, error: message });

    await db.scanJob.update({
      where: { id: scanJobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: message,
      },
    });

    throw err;
  }
}
