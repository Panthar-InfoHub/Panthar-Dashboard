// ── Neon Database Connectivity Smoke Test ──
// Verifies connection to PostgreSQL without mutating or querying application data.
// Safe for CI/CD and deployment health checks.

import { db } from "../lib/db";
import { getServerEnv } from "../lib/env";

async function checkDatabase() {
  console.log("─────────────────────────────────────────────────────────────");
  console.log("Panthar Teams — Neon Database Smoke Test");
  console.log("─────────────────────────────────────────────────────────────");

  try {
    // 1. Verify environment configuration
    const env = getServerEnv();
    const isDirectConfigured = Boolean(env.DIRECT_URL);
    console.log(`[Config] DATABASE_URL: Configured (pooled connection)`);
    console.log(`[Config] DIRECT_URL: ${isDirectConfigured ? "Configured" : "Not configured"}`);
    console.log(`[Config] Environment: ${env.NODE_ENV}`);

    // 2. Perform connection probe via SELECT 1
    console.log("[Probe] Executing SELECT 1 probe against Neon PostgreSQL...");
    const startTime = Date.now();
    const result = await db.$queryRawUnsafe<{ connected: number }[]>("SELECT 1 as connected");
    const durationMs = Date.now() - startTime;

    if (Array.isArray(result) && result[0]?.connected === 1) {
      console.log(`[Success] Database connectivity verified in ${durationMs}ms.`);
      console.log("[Status] Neon WebSocket adapter connection is active and healthy.");
    } else {
      throw new Error("Unexpected query result received from database server.");
    }
  } catch (error: unknown) {
    const err = error as Error & { code?: string };
    console.error("[Failure] Database connection probe failed.");
    console.error(`[Error Code] ${err.code || "UNKNOWN"}`);
    console.error(`[Message] ${err.message?.split("\n")?.[0] || "Unknown error"}`);
    process.exitCode = 1;
  } finally {
    try {
      await db.$disconnect();
      console.log("[Cleanup] Disconnected client cleanly.");
    } catch {
      // Disconnect error ignored
    }
    console.log("─────────────────────────────────────────────────────────────\n");
  }
}

checkDatabase().catch(() => {
  process.exitCode = 1;
});
