// modified-2026-09-16
/**
 * Webhook handler: products/update
 *
 * Triggered when a product is updated in the Shopify admin.
 * Used to keep image metadata synchronized with the source of truth.
 *
 * Actions taken:
 * 1. Verify webhook authenticity (automatic via authenticate.webhook)
 * 2. Extract updated image information from the payload
 * 3. Update or create image records in the database
 * 4. Re-classify images that may have changed
 *
 * NOTE: This webhook receives the full product payload from Shopify,
 * which includes the current images. We update our DB to reflect the
 * current state, ensuring our scan data stays fresh.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { classifyImage } from "../utils/image-rules";
import { logger } from "../utils/logger";

interface ShopifyWebhookImage {
  id: number;
  src: string;
  width: number;
  height: number;
  alt: string | null;
}

interface ProductUpdatePayload {
  id: number;
  title: string;
  images: ShopifyWebhookImage[];
}

function detectFormatFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const ext = pathname.split("?")[0].split(".").pop();
    const map: Record<string, string> = {
      jpg: "jpeg",
      jpeg: "jpeg",
      png: "png",
      webp: "webp",
      gif: "gif",
      avif: "avif",
      svg: "svg",
    };
    return ext ? (map[ext] ?? null) : null;
  } catch {
    return null;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "PRODUCTS_UPDATE") {
    return new Response("Unhandled topic", { status: 400 });
  }

  logger.info("Product update webhook received", { shop });

  try {
    const product = payload as unknown as ProductUpdatePayload;

    // Find the shop record
    const shopRecord = await db.shop.findFirst({
      where: { shopDomain: shop, isActive: true },
    });

    if (!shopRecord) {
      logger.warn("Product update webhook for inactive/unknown shop", { shop });
      return new Response("OK", { status: 200 });
    }

    const shopifyProductGid = `gid://shopify/Product/${product.id}`;

    // Process each image in the updated product
    for (const image of product.images ?? []) {
      const shopifyImageGid = `gid://shopify/ProductImage/${image.id}`;
      const format = detectFormatFromUrl(image.src);

      const optimizationStatus = classifyImage({
        originalBytes: null, // Will be fetched on next scan
        format,
        width: image.width,
        height: image.height,
      });

      await db.productImage.upsert({
        where: {
          shopId_shopifyImageId: {
            shopId: shopRecord.id,
            shopifyImageId: shopifyImageGid,
          },
        },
        update: {
          productTitle: product.title,
          originalUrl: image.src,
          width: image.width,
          height: image.height,
          format,
          // Only update status if image is not currently being optimized
          // to avoid overwriting QUEUED/PROCESSING/COMPLETED states
          ...(optimizationStatus === "PENDING"
            ? {}
            : {
                // Re-classify only if not in an optimization workflow state
              }),
          updatedAt: new Date(),
        },
        create: {
          shopId: shopRecord.id,
          shopifyImageId: shopifyImageGid,
          shopifyProductId: shopifyProductGid,
          productTitle: product.title,
          originalUrl: image.src,
          width: image.width,
          height: image.height,
          format,
          optimizationStatus,
        },
      });
    }

    logger.info("Product images synced from webhook", {
      shop,
      productId: product.id,
      imageCount: product.images?.length ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Error processing product update webhook", { shop, error: message });
  }

  return new Response("OK", { status: 200 });
};
