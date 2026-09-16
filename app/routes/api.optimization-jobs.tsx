// modified-2026-09-16
/**
 * API: Optimization Job Status
 *
 * GET /api/optimization-jobs?imageIds=id1,id2,id3
 *
 * Returns the status of optimization jobs for specified images.
 * Used by the dashboard to poll job progress after bulk optimization.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const url = new URL(request.url);
  const imageIdsParam = url.searchParams.get("imageIds");

  const shopRecord = await db.shop.findFirst({
    where: { shopDomain },
  });

  if (!shopRecord) {
    return json({ jobs: [] });
  }

  const shopId = shopRecord.id;

  const where: Record<string, unknown> = imageIdsParam
    ? {
        shopId,
        imageId: {
          in: imageIdsParam.split(",").slice(0, 100),
        },
      }
    : {
        shopId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      };

  const jobs = await db.optimizationJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      imageId: true,
      status: true,
      attempts: true,
      failureReason: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      result: {
        select: {
          originalBytes: true,
          optimizedBytes: true,
          savingsBytes: true,
          reductionPercent: true,
          outputFormat: true,
        },
      },
    },
  });

  const serializedJobs = jobs.map((job) => ({
    ...job,
    result: job.result
      ? {
          ...job.result,
          originalBytes: Number(job.result.originalBytes),
          optimizedBytes: Number(job.result.optimizedBytes),
          savingsBytes: Number(job.result.savingsBytes),
        }
      : null,
  }));

  return json({ jobs: serializedJobs });
};
