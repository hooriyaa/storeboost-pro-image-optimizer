// modified-2026-09-16
/**
 * Prisma client singleton for use across the Remix app.
 * In development, we attach to a global to avoid creating multiple instances
 * during HMR (hot module reloads).
 */
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

const db: PrismaClient = global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = db;
}

export { db };
