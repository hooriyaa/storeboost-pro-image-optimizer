// modified-2026-09-16
/**
 * Remix app layout route.
 * Wraps all authenticated app pages with Polaris AppProvider.
 * Uses App Bridge for embedded Shopify admin integration.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { authenticate } from "../shopify.server";
import "../styles/nexhunar.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY ?? "" });
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <PolarisAppProvider i18n={polarisTranslations}>
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify-recommended error boundary for embedded apps
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = boundary.headers;
