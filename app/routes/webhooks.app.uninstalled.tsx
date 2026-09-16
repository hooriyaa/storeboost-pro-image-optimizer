// modified-2026-09-16
/**
 * Webhook handler: app/uninstalled
 *
 * Triggered when a merchant uninstalls the app.
 * HMAC verification is handled automatically by authenticate.webhook().
 *
 * Actions taken:
 * 1. Verify webhook authenticity (automatic via authenticate.webhook)
 * 2. Mark shop as inactive in database
 * 3. Cancel all queued/processing optimization jobs
 * 4. Prevent any future processing for this shop
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { cancelShopJobs } from "../services/job-queue.server";
import { logger } from "../utils/logger";

export const action = async ({ request }: ActionFunctionArgs) => {
  // authenticate.webhook() automatically verifies the Shopify HMAC signature.
  // It will throw (and return 401) if verification fails.
  // IMPORTANT: Pass the raw request - do NOT manually parse the body first,
  // as that would break HMAC verification.
  const { topic, shop, session } = await authenticate.webhook(request);

  if (topic !== "APP_UNINSTALLED") {
    logger.warn("Unexpected webhook topic on uninstalled handler", { topic, shop });
    return new Response("Unhandled topic", { status: 400 });
  }

  logger.info("App uninstalled webhook received", { shop });

  try {
    // Find and deactivate the shop record
    const shopRecord = await db.shop.findFirst({
      where: { shopDomain: shop },
    });

    if (shopRecord) {
      // Mark shop as inactive to prevent future processing
      await db.shop.update({
        where: { id: shopRecord.id },
        data: {
          isActive: false,
          uninstalledAt: new Date(),
        },
      });

      // Cancel all queued/processing optimization jobs for this shop
      await cancelShopJobs(shopRecord.id);

      logger.info("Shop deactivated on uninstall", {
        shopId: shopRecord.id,
        shop,
      });
    } else {
      logger.warn("Uninstall webhook received for unknown shop", { shop });
    }

    // Also clean up the session if it exists
    if (session) {
      await db.session.deleteMany({
        where: { shop },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Error processing uninstall webhook", { shop, error: message });
    // Return 200 even on error - Shopify will retry if we return non-2xx
    // but we've already deactivated the shop, so retries are safe
  }

  return new Response("OK", { status: 200 });
};
