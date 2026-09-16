// modified-2026-09-16
/**
 * BullMQ Optimization Worker
 *
 * Runs as a SEPARATE PROCESS from the Remix app server.
 * Start with: npm run worker
 *
 * Architecture:
 * 1. Listens to the "image-optimization" BullMQ queue
 * 2. Validates shop is still active (uninstall protection)
 * 3. Downloads image safely using safeDownloadImage
 * 4. Processes with Sharp (WebP conversion)
 * 5. Saves result locally (assessment) / S3 in production
 * 6. Updates database with actual savings metrics
 * 7. Concurrency: 3 parallel jobs (configurable)
 * 8. Retry: 3 attempts, exponential backoff (2s, 4s, 8s)
 *
 * IMPORTANT: This worker NEVER modifies live Shopify product media.
 */

import "dotenv/config";
import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { safeDownloadImage, SafeDownloadError } from "../app/utils/safe-download.server.js";
import { processImage, OptimizationError } from "../app/services/image-optimizer.server.js";
import { calculateSavings } from "../app/utils/image-rules.js";

const QUEUE_NAME = "image-optimization";
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 3);

if (!process.env.REDIS_URL) {
  console.error("[worker] REDIS_URL environment variable is required");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("[worker] DATABASE_URL environment variable is required");
  process.exit(1);
}

const db = new PrismaClient({
  log:
    process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

type LogFn = (msg: string, ctx?: Record<string, unknown>) => void;
const wlog: Record<"info" | "warn" | "error", LogFn> = {
  info: (msg, ctx) =>
    console.log(
      JSON.stringify({
        level: "info",
        service: "optimization-worker",
        msg,
        ...ctx,
        ts: new Date().toISOString(),
      })
    ),
  warn: (msg, ctx) =>
    console.warn(
      JSON.stringify({
        level: "warn",
        service: "optimization-worker",
        msg,
        ...ctx,
        ts: new Date().toISOString(),
      })
    ),
  error: (msg, ctx) =>
    console.error(
      JSON.stringify({
        level: "error",
        service: "optimization-worker",
        msg,
        ...ctx,
        ts: new Date().toISOString(),
      })
    ),
};

export interface OptimizationJobData {
  shopId: string;
  shopDomain: string;
  imageId: string;
  imageUrl: string;
  format: string;
  optimizationJobId: string;
}

async function validateShopActive(shopId: string): Promise<boolean> {
  const shop = await db.shop.findFirst({
    where: { id: shopId, isActive: true },
  });
  return shop !== null;
}

async function processOptimizationJob(
  job: Job<OptimizationJobData>
): Promise<void> {
  const { shopId, shopDomain, imageId, imageUrl, format, optimizationJobId } =
    job.data;

  wlog.info("Processing optimization job", {
    jobId: job.id,
    optimizationJobId,
    imageId,
    shopDomain,
    attempt: job.attemptsMade + 1,
  });

  // STEP 1: Validate shop is still active (uninstall protection)
  const isActive = await validateShopActive(shopId);
  if (!isActive) {
    wlog.warn("Skipping job: shop is not active", { shopId, shopDomain });
    await db.optimizationJob.update({
      where: { id: optimizationJobId },
      data: {
        status: "FAILED",
        failureReason: "Shop is not active (may have uninstalled the app)",
        completedAt: new Date(),
      },
    });
    return;
  }

  // STEP 2: Validate image still exists (ownership check)
  const image = await db.productImage.findFirst({
    where: { id: imageId, shopId },
  });

  if (!image) {
    throw new Error(`Image ${imageId} not found for shop ${shopId}`);
  }

  // STEP 3: Mark as PROCESSING
  await db.optimizationJob.update({
    where: { id: optimizationJobId },
    data: {
      status: "PROCESSING",
      startedAt: new Date(),
      attempts: job.attemptsMade + 1,
    },
  });

  await db.productImage.update({
    where: { id: imageId },
    data: { optimizationStatus: "PROCESSING" },
  });

  // STEP 4: Download image safely
  const downloadResult = await safeDownloadImage(imageUrl, {
    imageId,
    shopId,
  });

  const actualOriginalBytes = downloadResult.actualBytes;
  const detectedFormat = downloadResult.detectedFormat || format;

  // STEP 5: Process with Sharp
  wlog.info("Processing image with Sharp", {
    imageId,
    format: detectedFormat,
    bytes: actualOriginalBytes,
  });

  const optimizationOutput = await processImage(
    downloadResult.buffer,
    detectedFormat,
    imageId,
    shopId
  );

  // STEP 6: Calculate actual savings
  const savings = calculateSavings(
    actualOriginalBytes,
    optimizationOutput.outputBytes
  );

  // STEP 7: Store result
  await db.optimizationResult.upsert({
    where: { imageId },
    update: {
      originalBytes: BigInt(actualOriginalBytes),
      optimizedBytes: BigInt(optimizationOutput.outputBytes),
      savingsBytes: BigInt(savings.savedBytes),
      reductionPercent: savings.reductionPercent,
      optimizedPath: optimizationOutput.outputPath,
      outputFormat: optimizationOutput.outputFormat,
      qualitySetting: optimizationOutput.qualitySetting,
    },
    create: {
      shopId,
      imageId,
      optimizationJobId,
      originalBytes: BigInt(actualOriginalBytes),
      optimizedBytes: BigInt(optimizationOutput.outputBytes),
      savingsBytes: BigInt(savings.savedBytes),
      reductionPercent: savings.reductionPercent,
      optimizedPath: optimizationOutput.outputPath,
      outputFormat: optimizationOutput.outputFormat,
      qualitySetting: optimizationOutput.qualitySetting,
    },
  });

  // STEP 8: Mark COMPLETED
  await db.optimizationJob.update({
    where: { id: optimizationJobId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  await db.productImage.update({
    where: { id: imageId },
    data: {
      originalBytes: BigInt(actualOriginalBytes),
      optimizationStatus: "COMPLETED",
    },
  });

  wlog.info("Optimization job completed", {
    optimizationJobId,
    imageId,
    originalBytes: actualOriginalBytes,
    optimizedBytes: optimizationOutput.outputBytes,
    savedBytes: savings.savedBytes,
    reductionPercent: savings.reductionPercent.toFixed(1),
    improved: savings.improved,
  });
}

async function handleJobFailure(
  job: Job<OptimizationJobData>,
  error: Error
): Promise<void> {
  const { imageId, optimizationJobId, shopId } = job.data;

  wlog.error("Optimization job failed (retries exhausted)", {
    jobId: job.id,
    optimizationJobId,
    imageId,
    error: error.message,
    attempts: job.attemptsMade,
  });

  let failureReason = error.message;

  if (error instanceof SafeDownloadError) {
    failureReason = `Download failed (${error.code}): ${error.message}`;
  } else if (error instanceof OptimizationError) {
    failureReason = `Optimization failed (${error.code}): ${error.message}`;
  }

  try {
    await db.optimizationJob.update({
      where: { id: optimizationJobId },
      data: {
        status: "FAILED",
        failureReason,
        completedAt: new Date(),
      },
    });

    await db.productImage.update({
      where: { id: imageId },
      data: { optimizationStatus: "FAILED" },
    });
  } catch (dbError) {
    wlog.error("Failed to update job failure status in DB", {
      optimizationJobId,
      error:
        dbError instanceof Error ? dbError.message : String(dbError),
    });
  }
}

// Create the BullMQ worker
const worker = new Worker<OptimizationJobData>(
  QUEUE_NAME,
  processOptimizationJob,
  {
    connection,
    concurrency: CONCURRENCY,
  }
);

worker.on("completed", (job) => {
  wlog.info("Worker: job completed", {
    jobId: job.id,
    imageId: job.data.imageId,
  });
});

worker.on("failed", async (job, error) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
    await handleJobFailure(job, error);
  } else {
    wlog.warn("Worker: job failed, will retry", {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      error: error.message,
    });
  }
});

worker.on("error", (error) => {
  wlog.error("Worker error", { error: error.message });
});

worker.on("ready", () => {
  wlog.info("Optimization worker started", {
    queue: QUEUE_NAME,
    concurrency: CONCURRENCY,
  });
});

// Graceful shutdown
async function shutdown() {
  wlog.info("Worker shutting down gracefully...");
  await worker.close();
  await db.$disconnect();
  connection.disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

wlog.info("Worker process starting...", { concurrency: CONCURRENCY });
