// ── Panthar Teams — Stage 1A.1 Operational Task Column Backfill ──
// Safely and idempotently backfills Task.columnId from legacy Task.status
// in independently committed batches of 1,000 tasks using FOR UPDATE SKIP LOCKED.
// Concurrency: Fully compatible with active legacy Version A traffic and Version B traffic.

import "./load-env";
import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma";

export interface BackfillOptions {
  batchSize?: number;
  pacingMs?: number;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxWaitMs?: number;
  transactionTimeoutMs?: number;
  logger?: (msg: string) => void;
}

export interface ParityAuditItem {
  status: string;
  colId: string;
  statusCount: number;
  colCount: number;
  match: boolean;
}

export interface BackfillResult {
  totalTasks: number;
  initialRemaining: number;
  totalBackfilled: number;
  batchesExecuted: number;
  finalRemaining: number;
  parityAudit: ParityAuditItem[];
  orphanedCount: number;
}

const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_PACING_MS = 50;
const DEFAULT_LOCK_TIMEOUT_MS = 2000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_WAIT_MS = 10000;
const DEFAULT_TX_TIMEOUT_MS = 30000;

export const BASELINE_STATUS_MAPPINGS = [
  { status: "BACKLOG", colId: "col_backlog" },
  { status: "TODO", colId: "col_todo" },
  { status: "IN_PROGRESS", colId: "col_in_progress" },
  { status: "REVIEW", colId: "col_review" },
  { status: "TESTING", colId: "col_testing" },
  { status: "DONE", colId: "col_done" },
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes the Stage 1A.1 batched data backfill.
 * Can be called programmatically by tests or invoked directly from CLI.
 */
export async function backfillTaskColumns(options: BackfillOptions = {}): Promise<BackfillResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const pacingMs = options.pacingMs ?? DEFAULT_PACING_MS;
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const statementTimeoutMs = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const transactionTimeoutMs = options.transactionTimeoutMs ?? DEFAULT_TX_TIMEOUT_MS;
  const log = options.logger ?? console.log;

  log("================================================================================");
  log("Stage 1A.1 Operational Backfill: Task.columnId Population");
  log(`Configuration: batchSize=${batchSize}, pacingMs=${pacingMs}ms, lockTimeout=${lockTimeoutMs}ms, statementTimeout=${statementTimeoutMs}ms`);
  log("================================================================================");

  // ── Step 1: Pre-flight Validations ──
  // 1a: Validate required baseline columns exist in BoardColumn
  const baselineIds = BASELINE_STATUS_MAPPINGS.map((m) => m.colId);
  const existingCols = await db.boardColumn.findMany({
    where: { id: { in: baselineIds } },
    select: { id: true },
  });
  const existingColIds = new Set(existingCols.map((c) => c.id));
  const missingCols = baselineIds.filter((id) => !existingColIds.has(id));
  if (missingCols.length > 0) {
    throw new Error(
      `BACKFILL PRE-FLIGHT ERROR: Missing baseline board columns in database: ${missingCols.join(", ")}. Please ensure Stage 1A migration has been applied.`
    );
  }

  // 1b: Verify no tasks have unmapped or unexpected status values
  const unmappedRows = await db.$queryRaw<{ id: string; status: string }[]>`
    SELECT id, status::text as status
    FROM "Task"
    WHERE "columnId" IS NULL
      AND status::text NOT IN ('BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'TESTING', 'DONE')
    LIMIT 10;
  `;
  if (unmappedRows.length > 0) {
    throw new Error(
      `BACKFILL PRE-FLIGHT ERROR: Found unmapped/unexpected task status values in Task table. First offending tasks: ${JSON.stringify(unmappedRows)}`
    );
  }

  // ── Step 2: Assessment of Work Required ──
  const totalTasks = await db.task.count();
  const initialRemaining = await db.task.count({ where: { columnId: null } as unknown as Prisma.TaskWhereInput });
  log(`[Status] Total tasks in database: ${totalTasks}`);
  log(`[Status] Tasks requiring backfill (columnId IS NULL): ${initialRemaining}`);

  if (initialRemaining === 0) {
    log("[Notice] No tasks require backfill (columnId is already populated on all tasks).");
  }

  // ── Step 3: Independently Committed Batched Execution ──
  let totalBackfilled = 0;
  let batchesExecuted = 0;

  while (true) {
    // Each batch executes inside its own independent transaction, committing on return
    const updatedInBatch = await db.$transaction(
      async (tx) => {
        // Enforce lock timeout and statement timeout to prevent lock queue starvation
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);

        // Atomic batch update with row-level serialization via FOR UPDATE SKIP LOCKED
        const affected = await tx.$executeRaw`
          WITH batch AS (
            SELECT id, status
            FROM "Task"
            WHERE "columnId" IS NULL
            ORDER BY id
            LIMIT ${batchSize}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "Task" t
          SET "columnId" = CASE b."status"::text
            WHEN 'BACKLOG' THEN 'col_backlog'
            WHEN 'TODO' THEN 'col_todo'
            WHEN 'IN_PROGRESS' THEN 'col_in_progress'
            WHEN 'REVIEW' THEN 'col_review'
            WHEN 'TESTING' THEN 'col_testing'
            WHEN 'DONE' THEN 'col_done'
            ELSE 'invalid_unmapped_status'
          END
          FROM batch b
          WHERE t.id = b.id;
        `;
        return affected;
      },
      { maxWait: maxWaitMs, timeout: transactionTimeoutMs }
    );

    if (updatedInBatch === 0) {
      // Check if any NULL tasks remain that were temporarily skipped due to active locks
      const remainingNull = await db.task.count({ where: { columnId: null } as unknown as Prisma.TaskWhereInput });
      if (remainingNull > 0) {
        log(`[Contention] ${remainingNull} task(s) currently locked by concurrent operations. Waiting 200ms...`);
        await sleep(200);
        continue;
      }
      break;
    }

    totalBackfilled += updatedInBatch;
    batchesExecuted++;
    const remainingNull = await db.task.count({ where: { columnId: null } as unknown as Prisma.TaskWhereInput });
    const progressPct =
      totalTasks > 0
        ? (((totalTasks - remainingNull) / totalTasks) * 100).toFixed(1)
        : "100.0";

    log(
      `[Batch ${batchesExecuted}] Committed ${updatedInBatch} tasks (Cumulative: ${totalBackfilled}/${initialRemaining}, Remaining NULL: ${remainingNull}, Progress: ${progressPct}%)`
    );

    // Yield control to allow PostgreSQL background writer and replica replication to flush WAL
    if (pacingMs > 0) {
      await sleep(pacingMs);
    }
  }

  // ── Step 4: Verification and Parity Audit ──
  log("────────────────────────────────────────────────────────────────────────────────");
  log("Execution Complete. Beginning Post-Backfill Integrity Audit...");
  log("────────────────────────────────────────────────────────────────────────────────");

  // 4a: Verify 0 tasks remain with columnId IS NULL
  const finalRemaining = await db.task.count({ where: { columnId: null } as unknown as Prisma.TaskWhereInput });
  if (finalRemaining > 0) {
    throw new Error(
      `BACKFILL AUDIT FAILURE: ${finalRemaining} tasks still have columnId = NULL after backfill loop completed.`
    );
  }
  log(`✓ Null check passed: 0 tasks remain with columnId = NULL`);

  // 4b: Verify all columnId values reference an existing BoardColumn
  const orphanedResult = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count
    FROM "Task" t
    LEFT JOIN "BoardColumn" c ON t."columnId" = c.id
    WHERE c.id IS NULL;
  `;
  const orphanedCount = Number(orphanedResult[0]?.count ?? 0);
  if (orphanedCount > 0) {
    throw new Error(
      `BACKFILL AUDIT FAILURE: Found ${orphanedCount} task(s) with columnId referencing non-existent BoardColumn!`
    );
  }
  log(`✓ Referential integrity check passed: 0 orphaned columnId references`);

  // 4c: Verify exact count parity for all 6 legacy statuses
  const parityAudit: ParityAuditItem[] = [];
  for (const mapping of BASELINE_STATUS_MAPPINGS) {
    const statusCount = await db.task.count({ where: { status: mapping.status } as unknown as Prisma.TaskWhereInput });
    const colCount = await db.task.count({ where: { columnId: mapping.colId } });
    const match = statusCount === colCount;
    parityAudit.push({
      status: mapping.status,
      colId: mapping.colId,
      statusCount,
      colCount,
      match,
    });
    log(
      `  [Parity] ${mapping.status.padEnd(12)} -> ${mapping.colId.padEnd(16)}: status=${statusCount}, columnId=${colCount} [${match ? "MATCH" : "MISMATCH"}]`
    );
    if (!match) {
      throw new Error(
        `BACKFILL AUDIT FAILURE: Status count parity mismatch for ${mapping.status}! Status count: ${statusCount}, Column count: ${colCount}`
      );
    }
  }

  log("================================================================================");
  log("✓ Stage 1A.1 Backfill & Integrity Audit COMPLETED SUCCESSFULLY");
  log(`  Processed: ${totalBackfilled} rows across ${batchesExecuted} independently committed transaction(s).`);
  log("================================================================================");

  return {
    totalTasks,
    initialRemaining,
    totalBackfilled,
    batchesExecuted,
    finalRemaining,
    parityAudit,
    orphanedCount,
  };
}

// ── CLI Runner ──
async function main() {
  try {
    await backfillTaskColumns();
  } catch (err: unknown) {
    const error = err as Error;
    console.error("\n❌ Backfill execution failed:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    try {
      await db.$disconnect();
    } catch {
      // Disconnect error ignored
    }
  }
}

// Execute CLI runner when invoked directly via node/tsx
const isDirectlyExecuted =
  process.argv[1]?.endsWith("backfill-task-columns.ts") ||
  process.argv[1]?.endsWith("backfill-task-columns.js");

if (isDirectlyExecuted) {
  main();
}
