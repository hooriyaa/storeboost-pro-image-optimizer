# StoreBoost Pro — Image Optimization Opportunity Scanner

## Overview
**StoreBoost Pro** is a production-oriented embedded Shopify application built for the **NEXHUNAR** performance optimization ecosystem. It scans a merchant's Shopify catalog for product images, analyzes compression and format optimization opportunities, and executes asynchronous single and bulk image optimizations via background queues without modifying live merchant media.

---

## Features
- **GraphQL Store Scanner**: Scans 10,000+ images incrementally using cursor-based pagination via Shopify Admin GraphQL API `2026-07`.
- **Intelligent Classification**: Deterministic priority assignment (`HIGH_PRIORITY`, `OPTIMIZATION_RECOMMENDED`, `OPTIMIZED`) based on measurable file size, format, and dimension thresholds.
- **Async Queue Processing**: Decoupled HTTP actions backed by **Redis + BullMQ** workers with concurrency management, exponential backoff retries, and failure telemetry.
- **Idempotent Job Engine**: Dual-layer duplicate prevention at database constraint (`@@unique([shopId, imageId])`) and queue key levels.
- **Accurate Savings Measurement**: Explicit separation between *Estimated Potential Savings* and *Actual Measured Byte Reductions* generated via **Sharp** WebP processing.
- **Multi-Tenant Security**: Strict shop scoping across all database queries, raw payload HMAC webhook verification, and SSRF-protected image downloading.
- **Embedded Polaris UI**: Tailored with the **NEXHUNAR** design system palette (`#38204C`, `#7C7698`, `#B2ACBD`, `#EBD3CB`, `#FFF2E2`).

---

## Architecture

```
                  +-----------------------------------+
                  |           Shopify Store           |
                  +-----------------------------------+
                                    |
                    OAuth (Token Exchange) / Webhooks
                    GraphQL Admin API (2026-07)
                                    v
+-------------------------------------------------------------------------+
|                StoreBoost Pro (Remix / React Router v7)                 |
|                                                                         |
|  +--------------------+   +---------------------+   +----------------+  |
|  | Embedded Dashboard |   | API Routes & Auth   |   | HMAC Webhooks  |  |
|  +--------------------+   +---------------------+   +----------------+  |
+-------------------------------------------------------------------------+
            |                                         |
            v                                         v
+-----------------------+                 +-------------------------------+
|  PostgreSQL + Prisma  |                 |         Redis (BullMQ)        |
|  - Shop & Session     |                 |  Queue: 'image-optimization'  |
|  - ProductImage       |                 +-------------------------------+
|  - ScanJob            |                                 |
|  - OptimizationJob    |                                 v
|  - OptimizationResult |                 +-------------------------------+
+-----------------------+                 |     Optimization Worker       |
                                          |     - Safe Downloader (SSRF)  |
                                          |     - Sharp (WebP @ Q82)      |
                                          |     - Byte Savings Calculator |
                                          +-------------------------------+
                                                          |
                                                          v
                                          +-------------------------------+
                                          |   Optimized Output Previews   |
                                          |   (Local / S3 in Production)  |
                                          +-------------------------------+
```

---

## Technology Stack
- **Framework**: Remix / React Router v7 (`@shopify/shopify-app-remix` v5)
- **Language**: TypeScript (Strict Mode)
- **UI Components**: Shopify Polaris React v13 + NEXHUNAR Design System
- **Shopify API**: Admin GraphQL API `2026-07` with Token Exchange
- **Database**: PostgreSQL with Prisma ORM
- **Queue Engine**: Redis + BullMQ
- **Image Transformation**: Sharp (WebP compression & transcoding)
- **Validation**: Zod
- **Testing**: Vitest

---

## Shopify Scopes

| Scope | Purpose |
|---|---|
| `read_products` | Required to query products, media items, and image metadata via GraphQL. |

> [!NOTE]
> **Least Privilege Principle**: StoreBoost Pro requests only `read_products`. Write scopes are intentionally omitted during this assessment because live merchant media is never modified or overwritten.

---

## Environment Variables

Copy `.env.example` to `.env`:

```env
# Shopify Partner App Credentials
SHOPIFY_API_KEY=your_shopify_api_key_here
SHOPIFY_API_SECRET=your_shopify_api_secret_here

# Public Tunnel URL
SHOPIFY_APP_URL=https://your-tunnel-url.trycloudflare.com

# PostgreSQL Connection String
DATABASE_URL=postgresql://postgres:password@localhost:5432/storeboost_pro

# Redis Connection String
REDIS_URL=redis://localhost:6379

# Session Secret (min 32 characters)
SESSION_SECRET=a_secure_random_string_with_at_least_32_characters

# Local preview storage path (Assessment only)
OPTIMIZED_STORAGE_PATH=./tmp/optimized

# Worker Configuration
WORKER_CONCURRENCY=3
MAX_IMAGE_BYTES=20971520
IMAGE_DOWNLOAD_TIMEOUT_MS=15000
```

---

## Local Setup & Development

### Prerequisites
- Node.js >= 18.20.0
- PostgreSQL database
- Redis instance
- Shopify Partner Account & Development Store

### Step-by-Step Instructions

1. **Clone and Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   ```bash
   cp .env.example .env
   # Fill in SHOPIFY_API_KEY, SHOPIFY_API_SECRET, DATABASE_URL, and REDIS_URL
   ```

3. **Database Migration**:
   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```

4. **Start Background Optimization Worker**:
   ```bash
   npm run worker
   ```

5. **Start Remix App with Shopify Dev Tunnel**:
   ```bash
   npm run dev
   ```

6. **Install App into Development Store**:
   - Follow the terminal prompt or open the generated preview link to complete Token Exchange and open the embedded dashboard.

---

## Running Tests
Run Vitest automated test suite:
```bash
npm run test
```

---

## Image Classification Logic

Classification thresholds are defined in [`app/utils/image-rules.ts`](file:///c:/Users/PMLS/OneDrive/Desktop/projects/image_optimizer/app/utils/image-rules.ts):

| Classification | Trigger Conditions |
|---|---|
| **`HIGH_PRIORITY`** | - Inefficient format (`BMP`, `TIFF`)<br>- Original file size > 1.5 MB (`1,500,000` bytes)<br>- Dimensions > 3000px on `JPEG`/`PNG` |
| **`OPTIMIZATION_RECOMMENDED`** | - Original file size > 500 KB on `JPEG`/`PNG`<br>- Dimensions > 2000px on `JPEG`/`PNG`<br>- Large `WebP`/`AVIF` > 500 KB (can benefit from re-encoding) |
| **`OPTIMIZED`** | - `WebP` or `AVIF` format with size ≤ 500 KB |
| **`PENDING`** | - File size not yet measured (awaiting head/download probe) |

---

## Estimated vs. Actual Savings

StoreBoost Pro maintains complete mathematical transparency:
- **Estimated Savings**: Displayed *before* optimization has taken place based on empirical compression expectations (e.g. 30% for JPEG/PNG → WebP, 55% for BMP/TIFF). Always labeled `(Est.)`.
- **Actual Savings**: Computed exclusively after Sharp finishes processing:
  $$\text{savedBytes} = \max(0, \text{originalBytes} - \text{optimizedBytes})$$
  $$\text{reductionPercent} = \left(\frac{\text{savedBytes}}{\text{originalBytes}}\right) \times 100$$
- If an image cannot be compressed further ($\text{optimizedBytes} \ge \text{originalBytes}$), savings are clamped to $0$ and no false improvement is reported.

---

## Security Implementation

1. **Server-Side Token Handling**: Shopify access tokens are handled strictly within server loaders/actions and persisted via `@shopify/shopify-app-session-storage-prisma`. No token is ever exposed in client bundles or network responses.
2. **Tenant Isolation**: Every database query explicitly filters by `shopId`. Store A can never access or trigger jobs for Store B.
3. **Webhook HMAC Verification**: Webhook payloads are verified using `crypto.timingSafeEqual` across raw request buffers via `authenticate.webhook(request)`.
4. **Safe Image Downloader (SSRF Protection)**:
   - Validates HTTPS protocol only.
   - Enforces strict whitelist of official Shopify CDN domains (`cdn.shopify.com`, `cdn.shopifycloud.com`).
   - Caps response sizes at 20 MB and enforces a 15-second request timeout.
5. **App Uninstalled Hook**: Automatically deactivates the merchant shop record, revokes active sessions, and purges pending queue jobs.

---

## Large Store Strategy (10,000+ Images)
- **Cursor-Based GraphQL Pagination**: Queries products in chunks of 50 using `endCursor` and processes media edges incrementally.
- **Zero In-Memory Buffering**: Discovered images are written to PostgreSQL batch-by-batch during scanning rather than loaded all at once.
- **Bounded Worker Concurrency**: BullMQ worker processes images at a controlled concurrency rate (default 3), preventing outbound network saturation or memory exhaustion.
- **Shopify Rate-Limit Backoff**: Automatic exponential retry on GraphQL query throttling (`THROTTLED` / 429).

---

## Known Limitations (Assessment Scope)
- **No Live Media Overwrite**: Optimized files are saved locally under `./tmp/optimized/` for inspection and comparison. Replacing live Shopify product media in production requires a staged mutation workflow using `productCreateMedia` and `productDeleteMedia`.
- **Local File System Storage**: Local preview files are used instead of S3/GCS buckets.

---

## Production Improvements
1. **Cloud Object Storage**: Push optimized outputs to Amazon S3 or Google Cloud Storage with CloudFront/Fastly CDN distribution.
2. **Shopify Media Replacement Workflow**: Implement an explicit merchant approval step to upload optimized WebP assets to Shopify via `stagedUploadsCreate` + `productCreateMedia`.
3. **Horizontal Worker Scaling**: Deploy workers as independent autoscaling containers on AWS ECS / Kubernetes managed with KEDA.
4. **Perceptual Quality Metrics**: Integrate SSIM (Structural Similarity Index) and butteraugli scores to ensure image fidelity matches original assets.
5. **Dead Letter Queues & Alerting**: Route persistent failures to a Dead Letter Queue (DLQ) with Datadog/Sentry incident alerting.
