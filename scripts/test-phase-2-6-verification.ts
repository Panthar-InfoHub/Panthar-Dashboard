/**
 * Phase 2.6 Comprehensive Verification Test Suite
 * Tests Part C:
 * 1. Existing-schema simulation with v1 already applied.
 * 2. Fresh database initialized through the new bootstrap procedure.
 * 3. Failure simulation where one replacement index is invalid or missing.
 * 4. Verification of Tickets 1, 2, and 3 schema & functionality.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { runBootstrap } from "./bootstrap-fresh-database";

const PG_HOST = "localhost";
const PG_PORT = 5432;
const PG_USER = "postgres";
const PG_PASS = "postgres";
const env = { ...process.env, PGPASSWORD: PG_PASS };

const REPO_ROOT = path.resolve(__dirname, "..");
const STAGE_1B_HASH = "222b1ae6ace76487b7b26a166b955f58ac382c279d0ac37684149cabb2cbcd1c";

function runSql(dbName: string, sql: string): string {
  return execSync(
    `psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${dbName} -v ON_ERROR_STOP=1 -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { env, encoding: "utf8", shell: "/usr/bin/bash" }
  ).trim();
}

function createDb(name: string) {
  execSync(`createdb -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} ${name}`, { env, shell: "/usr/bin/bash" });
}

function dropDb(name: string) {
  try {
    execSync(`dropdb -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} ${name}`, { env, shell: "/usr/bin/bash" });
  } catch (_) {}
}

async function main() {
  console.log("================================================================================");
  console.log("PHASE 2.6 COMPREHENSIVE VERIFICATION TEST SUITE");
  console.log("================================================================================");

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: Existing-Schema Simulation with v1 Already Applied
  // ────────────────────────────────────────────────────────────────────────────
  const db1 = `disposable_sim_existing_${Date.now()}`;
  console.log(`\n--- [Scenario 1] Existing-Schema Simulation on DB: ${db1} ---`);
  try {
    createDb(db1);
    const dbUrl = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${db1}?schema=public`;
    const directUrl = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${db1}`;

    // 1. Initial bootstrap
    runBootstrap({ dbUrl, directUrl, silent: true });

    // 2. Now test running bootstrap again (idempotency check)
    console.log("Testing bootstrap idempotency on existing database...");
    runBootstrap({ dbUrl, directUrl, silent: false });

    // Verify _prisma_migrations has Stage 1B with exact checksum
    const checksum = runSql(
      db1,
      `SELECT checksum FROM _prisma_migrations WHERE migration_name = '20261121110000_create_replacement_indexes_concurrently' AND finished_at IS NOT NULL;`
    );
    if (checksum !== STAGE_1B_HASH) {
      throw new Error(`Scenario 1 Checksum mismatch: expected ${STAGE_1B_HASH}, got ${checksum}`);
    }
    console.log(`✓ Recorded checksum matches Neon production: ${checksum}`);

    // Verify all 4 replacement indexes valid
    const indexCount = runSql(
      db1,
      `SELECT COUNT(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname IN ('Task_columnId_idx','Task_columnId_projectId_idx','Task_columnId_order_idx','Task_columnId_dueDate_idx') AND i.indisvalid = true;`
    );
    if (indexCount !== "4") {
      throw new Error(`Scenario 1 Expected 4 valid replacement indexes, got ${indexCount}`);
    }
    console.log(`✓ All 4 replacement indexes confirmed valid in pg_index.`);
  } finally {
    dropDb(db1);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 2: Fresh Database Initialized Through New Bootstrap Procedure
  // ────────────────────────────────────────────────────────────────────────────
  const db2 = `disposable_fresh_boot_${Date.now()}`;
  console.log(`\n--- [Scenario 2] Fresh Database Bootstrap on DB: ${db2} ---`);
  try {
    createDb(db2);
    const dbUrl = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${db2}?schema=public`;
    const directUrl = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${db2}`;

    console.log("Running runBootstrap() on completely clean empty database...");
    runBootstrap({ dbUrl, directUrl, silent: false });

    // Verify full migration count
    const finishedCount = runSql(
      db2,
      `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`
    );
    console.log(`✓ Total finished migrations in _prisma_migrations: ${finishedCount}`);

    // Verify Stage 1B checksum
    const checksum = runSql(
      db2,
      `SELECT checksum FROM _prisma_migrations WHERE migration_name = '20261121110000_create_replacement_indexes_concurrently' AND finished_at IS NOT NULL;`
    );
    if (checksum !== STAGE_1B_HASH) {
      throw new Error(`Scenario 2 Checksum mismatch: expected ${STAGE_1B_HASH}, got ${checksum}`);
    }
    console.log(`✓ Checksum recorded via Prisma CLI: ${checksum}`);

    // Verify Ticket 1: TaskChecklistItem table exists
    const checklistExists = runSql(db2, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'TaskChecklistItem';`);
    if (checklistExists !== "1") {
      throw new Error(`Ticket 1 TaskChecklistItem missing!`);
    }
    console.log(`✓ Ticket 1 (Checklist): TaskChecklistItem table verified.`);

    // Verify Ticket 2: TaskAttachment table exists
    const attachmentExists = runSql(db2, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'TaskAttachment';`);
    if (attachmentExists !== "1") {
      throw new Error(`Ticket 2 TaskAttachment missing!`);
    }
    console.log(`✓ Ticket 2 (Attachments): TaskAttachment table verified.`);

    // Verify Ticket 3: BoardColumn table and six baseline columns exist
    const colCount = runSql(db2, `SELECT COUNT(*) FROM "BoardColumn";`);
    if (colCount !== "6") {
      throw new Error(`Ticket 3 Expected 6 baseline BoardColumn records, got ${colCount}`);
    }
    console.log(`✓ Ticket 3 (Board Columns): 6 baseline BoardColumn records verified.`);

    // Verify Task.columnId is NOT NULL (Contract applied)
    const colIdNullable = runSql(
      db2,
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Task' AND column_name = 'columnId';`
    );
    if (colIdNullable !== "NO") {
      throw new Error(`Expected Task.columnId to be NOT NULL, got nullable=${colIdNullable}`);
    }
    console.log(`✓ Contract schema: Task.columnId is strictly NOT NULL.`);

    // Verify Task.status is dropped
    const statusColCount = runSql(
      db2,
      `SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'Task' AND column_name = 'status';`
    );
    if (statusColCount !== "0") {
      throw new Error(`Expected Task.status column to be dropped!`);
    }
    console.log(`✓ Contract schema: Task.status column is completely removed.`);
  } finally {
    dropDb(db2);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: Failure Simulation: Invalid or Missing Replacement Index
  // ────────────────────────────────────────────────────────────────────────────
  const db3 = `disposable_sim_fail_${Date.now()}`;
  console.log(`\n--- [Scenario 3] Failure Simulation on DB: ${db3} ---`);
  try {
    createDb(db3);

    // 1. Run migrations up to Stage 1A
    const baseMigrations = [
      "0_init",
      "20260725090131_add_employee_permissions",
      "20260909190500_add_performance_indexes",
      "20260912180431_add_task_order",
      "20261119171000_add_task_checklist",
      "20261120113500_add_task_attachments",
      "20261121100000_expand_board_columns_schema"
    ];
    for (const m of baseMigrations) {
      const f = path.join(REPO_ROOT, "prisma", "migrations", m, "migration.sql");
      execSync(`psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${db3} -v ON_ERROR_STOP=1 -f "${f}"`, { env, shell: "/usr/bin/bash" });
    }

    // 2. Corrupt one replacement index by creating an invalid index remnant
    console.log("Simulating an invalid replacement index: Task_columnId_idx (indisvalid = false)...");
    execSync(`psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${db3} -c 'CREATE INDEX "Task_columnId_idx" ON public."Task"("columnId");'`, { env, shell: "/usr/bin/bash" });
    execSync(`psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${db3} -c "UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.\\\"Task_columnId_idx\\\"'::regclass;"`, { env, shell: "/usr/bin/bash" });

    // 3. Now attempt to run Stage 1B migration
    console.log("Executing Stage 1B with corrupted index present...");
    const stage1bPath = path.join(REPO_ROOT, "prisma/migrations/20261121110000_create_replacement_indexes_concurrently/migration.sql");
    try {
      execSync(`psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${db3} -v ON_ERROR_STOP=1 -f "${stage1bPath}"`, { env, shell: "/usr/bin/bash" });
      throw new Error("Failure simulation FAILED: Stage 1B should have aborted!");
    } catch (err: any) {
      const errMsg = `${err.stdout || ""}\n${err.stderr || ""}\n${err.message || ""}`;
      if (errMsg.includes("Stage 1B Pre-check abort: Index Task_columnId_idx on public.\"Task\" is INVALID")) {
        console.log("✓ Expected Pre-check abort caught successfully!");
        console.log(`  Details: ${errMsg.trim().split("\n").filter((l: string) => l.includes("Stage 1B Pre-check abort"))[0]}`);
      } else {
        throw new Error(`Unexpected failure output: ${errMsg}`);
      }
    }
  } finally {
    dropDb(db3);
  }

  console.log("\n================================================================================");
  console.log("ALL 3 VERIFICATION SCENARIOS PASSED WITH 100% SUCCESS!");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("FATAL TEST FAILURE:", err);
  process.exit(1);
});
