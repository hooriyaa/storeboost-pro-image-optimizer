// modified-2026-09-17
/**
 * Catch-all authentication route for Shopify OAuth and session token verification.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { authenticate, login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.pathname.includes("/auth/login")) {
    return await login(request);
  }
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  if (url.pathname.includes("/auth/login")) {
    return await login(request);
  }
  await authenticate.admin(request);
  return null;
};

