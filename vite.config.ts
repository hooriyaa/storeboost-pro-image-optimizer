// modified-2026-09-16
import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Required for Shopify CLI App Bridge integration
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const { SHOPIFY_APP_URL, NODE_ENV } = process.env;

export default defineConfig({
  server: {
    port: Number(process.env.PORT || 3000),
    hmr: {
      protocol: "ws",
      host: "localhost",
    },
    allowedHosts: true,
  },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
      },
    }),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    exclude: ["sharp"],
  },
});