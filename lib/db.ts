// ── Prisma Client Singleton ──
// Prevents multiple Prisma instances during Next.js hot reload in development.
// Uses @prisma/adapter-neon for Neon Serverless PostgreSQL over WebSockets.

import { PrismaClient } from "./generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";
import { getServerEnv } from "./env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const env = getServerEnv();
  const adapter = new PrismaNeon({
    connectionString: env.DATABASE_URL,
  });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
