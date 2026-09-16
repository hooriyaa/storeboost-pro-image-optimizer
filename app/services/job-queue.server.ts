// modified-2026-09-16
/**
 * Job Queue Service — BullMQ + Redis
 *
 * IDEMPOTENCY / DUPLICATE PREVENTION:
 * Before creating a new optimization job, we check if there is already
 * an active job (QUEUED or PROCESSING) for the same shopId + imageId.
 * If one exists, we return the existing job without creating a duplicate.
 *
 * The @@unique([shopId, imageId]) constraint on OptimizationJob in Prisma
 * provides an additional DB-level safety net against race conditions.
 */

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { db } from "../db.server";
import { logger } from "../utils/logger";
import { safeDownloadImage, SafeDownloadError } from "../utils/safe-download.server";
import { processImage, OptimizationError } from "./image-optimizer.server";
import { calculateSavings } from "../utils/image-rules";

const QUEUE_NAME = "image-optimization";
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 3);

declare global {
  // eslint-disable-next-line no-var
  var __bullQueue: Queue | undefined;
  // eslint-disable-next-line no-var
  var __bullWorker: Worker<OptimizationJobData> | undefined;
  // eslint-disable-next-line no-var
  var __redisConn: IORedis | undefined;
}

function getRedisConnection(): IORedis {
  if (!global.__redisConn) {
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL environment variable is required");
    }
    global.__redisConn = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return global.__redisConn;
}

export interface OptimizationJobData {
  shopId: string;
  shopDomain: string;
  imageId: string;
  imageUrl: string;
  format: string;
  optimizationJobId: string;
}

export interface CreateOptimizationJobResult {
  optimizationJobId: string;
  queueJobId: string | undefined;
  isDuplicate: boolean;
}

export async function processOptimizationJobDirectly(data: OptimizationJobData): Promise<void> {
  const { shopId, shopDomain, imageId, imageUrl, format, optimizationJobId } = data;

  logger.info("Processing optimization job directly", {
    optimizationJobId,
    imageId,
    shopDomain,
  });

  const shop = await db.shop.findFirst({
    where: { id: shopId, isActive: true },
  });

  if (!shop) {
    logger.warn("Skipping job: shop is not active", { shopId, shopDomain });
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

  const image = await db.productImage.findFirst({
    where: { id: imageId, shopId },
  });

  if (!image) {
    logger.warn(`Image ${imageId} not found for shop ${shopId}`);
    return;
  }

  await db.optimizationJob.update({
    where: { id: optimizationJobId },
    data: {
      status: "PROCESSING",
      startedAt: new Date(),
    },
  });

  await db.productImage.update({
    where: { id: imageId },
    data: { optimizationStatus: "PROCESSING" },
  });

  const downloadResult = await safeDownloadImage(imageUrl, {
    imageId,
    shopId,
  });

  const actualOriginalBytes = downloadResult.actualBytes;
  const detectedFormat = downloadResult.detectedFormat || format;

  const optimizationOutput = await processImage(
    downloadResult.buffer,
    detectedFormat,
    imageId,
    shopId
  );

  const savings = calculateSavings(
    actualOriginalBytes,
    optimizationOutput.outputBytes
  );

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

  logger.info("Optimization job completed successfully", {
    optimizationJobId,
    imageId,
    originalBytes: actualOriginalBytes,
    optimizedBytes: optimizationOutput.outputBytes,
    savedBytes: savings.savedBytes,
    reductionPercent: savings.reductionPercent.toFixed(1),
  });
}

async function processOptimizationJob(job: Job<OptimizationJobData>): Promise<void> {
  await processOptimizationJobDirectly(job.data);
}

async function handleJobFailure(job: Job<OptimizationJobData>, error: Error): Promise<void> {
  const { imageId, optimizationJobId } = job.data;

  logger.error("Optimization job failed", {
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
    logger.error("Failed to update job failure in DB", {
      optimizationJobId,
      error: dbError instanceof Error ? dbError.message : String(dbError),
    });
  }
}

export function ensureWorkerStarted(): void {
  if (typeof window !== "undefined") return;
  if (!process.env.REDIS_URL || !process.env.DATABASE_URL) return;

  if (!global.__bullWorker) {
    try {
      const worker = new Worker<OptimizationJobData>(
        QUEUE_NAME,
        processOptimizationJob,
        {
          connection: getRedisConnection(),
          concurrency: CONCURRENCY,
        }
      );

      worker.on("completed", (job) => {
        logger.info("BullMQ Worker completed job", { jobId: job.id, imageId: job.data.imageId });
      });

      worker.on("failed", async (job, error) => {
        if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
          await handleJobFailure(job, error);
        } else {
          logger.warn("BullMQ Worker job failed, will retry", {
            jobId: job?.id,
            attempt: job?.attemptsMade,
            error: error.message,
          });
        }
      });

      worker.on("error", (error) => {
        logger.error("BullMQ Worker error", { error: error.message });
      });

      global.__bullWorker = worker;
      logger.info("Embedded BullMQ Worker started", { queue: QUEUE_NAME, concurrency: CONCURRENCY });
    } catch (err) {
      logger.error("Failed to start embedded BullMQ worker", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export function getOptimizationQueue(): Queue {
  if (!global.__bullQueue) {
    global.__bullQueue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2_000,
        },
        removeOnComplete: { count: 100, age: 24 * 60 * 60 },
        removeOnFail: { count: 50, age: 7 * 24 * 60 * 60 },
      },
    });
  }
  ensureWorkerStarted();
  return global.__bullQueue;
}

ensureWorkerStarted();

/**
 * Create an optimization job for a single image.
 * Idempotent: returns existing job if one is already active.
 */
export async function createOptimizationJob(
  shopId: string,
  imageId: string
): Promise<CreateOptimizationJobResult> {
  // Validate image ownership
  const image = await db.productImage.findFirst({
    where: { id: imageId, shopId },
    include: { shop: true },
  });

  if (!image) {
    throw new Error(`Image not found or not owned by shop: ${imageId}`);
  }

  // Check for existing active job (IDEMPOTENCY CHECK)
  const existingJob = await db.optimizationJob.findFirst({
    where: {
      shopId,
      imageId,
      status: { in: ["QUEUED", "PROCESSING"] },
    },
  });

  if (existingJob) {
    logger.info("Duplicate optimization job prevented", {
      imageId,
      shopId,
      existingJobId: existingJob.id,
      existingStatus: existingJob.status,
    });
    return {
      optimizationJobId: existingJob.id,
      queueJobId: existingJob.queueJobId ?? undefined,
      isDuplicate: true,
    };
  }

  // Upsert DB record (status: QUEUED)
  let dbJob = await db.optimizationJob.findFirst({
    where: { shopId, imageId },
  });

  if (dbJob) {
    dbJob = await db.optimizationJob.update({
      where: { id: dbJob.id },
      data: {
        status: "QUEUED",
        failureReason: null,
        completedAt: null,
        startedAt: null,
      },
    });
  } else {
    try {
      dbJob = await db.optimizationJob.create({
        data: { shopId, imageId, status: "QUEUED" },
      });
    } catch (err: unknown) {
      const existing = await db.optimizationJob.findFirst({
        where: { shopId, imageId },
      });
      if (existing) {
        dbJob = existing;
      } else {
        throw err;
      }
    }
  }

  // Enqueue in BullMQ with deterministic job ID for additional dedup
  const queue = getOptimizationQueue();
  const jobData: OptimizationJobData = {
    shopId,
    shopDomain: image.shop.shopDomain,
    imageId,
    imageUrl: image.originalUrl,
    format: image.format ?? "unknown",
    optimizationJobId: dbJob.id,
  };

  const queueJob = await queue.add("optimize", jobData, {
    jobId: `opt:${shopId}:${imageId}`,
  });

  // Update DB record with BullMQ job ID
  await db.optimizationJob.update({
    where: { id: dbJob.id },
    data: { queueJobId: queueJob.id?.toString() },
  });

  // Update image status to QUEUED
  await db.productImage.update({
    where: { id: imageId },
    data: { optimizationStatus: "QUEUED" },
  });

  logger.info("Optimization job created", {
    optimizationJobId: dbJob.id,
    queueJobId: queueJob.id,
    imageId,
    shopId,
  });

  // Process optimization directly so the response immediately contains the completed state
  try {
    await processOptimizationJobDirectly(jobData);
  } catch (err) {
    logger.error("Optimization processing error", {
      imageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    optimizationJobId: dbJob.id,
    queueJobId: queueJob.id?.toString(),
    isDuplicate: false,
  };
}

/**
 * Create optimization jobs for multiple images.
 * Skips duplicates, processes each image independently.
 */
export async function createBulkOptimizationJobs(
  shopId: string,
  imageIds: string[]
): Promise<{
  created: number;
  duplicates: number;
  errors: Array<{ imageId: string; error: string }>;
}> {
  let created = 0;
  let duplicates = 0;
  const errors: Array<{ imageId: string; error: string }> = [];

  for (const imageId of imageIds) {
    try {
      const result = await createOptimizationJob(shopId, imageId);
      if (result.isDuplicate) {
        duplicates++;
      } else {
        created++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to create optimization job", {
        imageId,
        shopId,
        error: message,
      });
      errors.push({ imageId, error: message });
    }
  }

  logger.info("Bulk optimization jobs created", {
    shopId,
    created,
    duplicates,
    errors: errors.length,
  });

  return { created, duplicates, errors };
}

/**
 * Cancel all queued/processing jobs for a shop.
 * Called when a shop uninstalls the app.
 */
export async function cancelShopJobs(shopId: string): Promise<void> {
  const queue = getOptimizationQueue();

  const activeJobs = await db.optimizationJob.findMany({
    where: {
      shopId,
      status: { in: ["QUEUED", "PROCESSING"] },
    },
  });

  logger.info("Cancelling shop jobs on uninstall", {
    shopId,
    count: activeJobs.length,
  });

  for (const job of activeJobs) {
    if (job.queueJobId) {
      try {
        const queueJob = await queue.getJob(job.queueJobId);
        if (queueJob) {
          await queueJob.remove();
        }
      } catch (err) {
        logger.warn("Could not remove BullMQ job", {
          queueJobId: job.queueJobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await db.optimizationJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        failureReason: "Cancelled: shop uninstalled",
        completedAt: new Date(),
      },
    });
  }
}
