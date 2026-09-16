// modified-2026-09-16
/**
 * Catch-all authentication route for Shopify OAuth and session token verification.
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};
