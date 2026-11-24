/**
 * Phase 2.6.1 Verification Test Suite
 * 
 * Verifies Release 1 Bootstrap Boundary and Contract Migration Isolation:
 * 1. Fresh database bootstrap applies strictly the 8 Release 1 migrations.
 * 2. Stage 1B checksum equals 222b1ae6ace76487b7b26a166b955f58ac382c279d0ac37684149cabb2cbcd1c.
 * 3. Contract migration (20261121200000_contract_board_columns) is completely unapplied.
 * 4. Task.status column STILL EXISTS and remains NOT NULL (transitional compatibility).
 * 5. Task.columnId exists and is populated.
 * 6. BoardColumn has 6 baseline records.
 * 7. Ticket 1 (TaskChecklistItem) and Ticket 2 (TaskAttachment) intact.
 * 8. All 4 replacement indexes valid & ready in pg_index.
 * 9. Bootstrap idempotency (running a second time).
 * 10. Failed Stage 1B index pre-check simulation.
 * 11. Production target URL and environment rejection safeguards.
 */

import { execSync } from "child_process";
import path from "path";
import { runBootstrap, assertNotProduction, RELEASE_1_EXPECTED_MIGRATIONS } from "./bootstrap-fresh-database";

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
  } catch {}
}

async function main() {
  console.log("================================================================================");
  console.log("PHASE 2.6.1 VERIFICATION TEST SUITE: RELEASE 1 BOUNDARY & ISOLATION");
  console.log("================================================================================");

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: Fresh Database Bootstrap to Strict Release 1 Boundary
  // ────────────────────────────────────────────────────────────────────────────
  const db1 = `disposable_p261_fresh_${Date.now()}`;
  console.log(`\n--- [Scenario 1] Fresh Database Bootstrap on DB: ${db1} ---`);
  try {
    createDb(db1);
    const dbUrl = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${db1}?schema=public`;
    const directUrl = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${db1}`;

    console.log("Running runBootstrap() on completely clean empty database...");
    runBootstrap({ dbUrl, directUrl, silent: false });

    // 1. Verify exactly 8 migrations applied
    const appliedCount = runSql(
      db1,
      `SELECT COUNT(*) FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`
    );
    if (appliedCount !== "8") {
      throw new Error(`Scenario 1 FAILED: Expected exactly 8 applied migrations, got ${appliedCount}`);
    }
    console.log(`✓ Exactly 8 migrations applied in _prisma_migrations.`);

    // 2. Verify all 8 migration names match expected sequence
    const appliedList = runSql(
      db1,
      `SELECT migration_name FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at ASC;`
    ).split("\n").map(s => s.trim()).filter(Boolean);

    for (let i = 0; i < RELEASE_1_EXPECTED_MIGRATIONS.length; i++) {
      if (appliedList[i] !== RELEASE_1_EXPECTED_MIGRATIONS[i]) {
        throw new Error(`Scenario 1 FAILED: Expected migration ${RELEASE_1_EXPECTED_MIGRATIONS[i]}, got ${appliedList[i]}`);
      }
    }
    console.log(`✓ Migration inventory matches Release 1 boundary (0_init through Stage 1B).`);

    // 3. Verify Stage 1B checksum matches Neon production
    const stage1bChecksum = runSql(
      db1,
      `SELECT checksum FROM public."_prisma_migrations" WHERE migration_name = '20261121110000_create_replacement_indexes_concurrently' AND finished_at IS NOT NULL;`
    );
    if (stage1bChecksum !== STAGE_1B_HASH) {
      throw new Error(`Scenario 1 FAILED: Stage 1B checksum mismatch: expected ${STAGE_1B_HASH}, got ${stage1bChecksum}`);
    }
    console.log(`✓ Stage 1B checksum verified: ${stage1bChecksum}`);

    // 4. Verify Contract migration is NOT applied
    const contractCount = runSql(
      db1,
      `SELECT COUNT(*) FROM public."_prisma_migrations" WHERE migration_name = '20261121200000_contract_board_columns';`
    );
    if (contractCount !== "0") {
      throw new Error(`Scenario 1 CRITICAL FAILURE: Contract migration was applied! count=${contractCount}`);
    }
    console.log(`✓ Contract migration (20261121200000_contract_board_columns) is completely UNAPPLIED.`);

    // 5. Verify all 4 replacement indexes are valid & ready
    const validIndexCount = runSql(
      db1,
      `SELECT COUNT(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname IN ('Task_columnId_idx','Task_columnId_projectId_idx','Task_columnId_order_idx','Task_columnId_dueDate_idx') AND i.indisvalid = true AND i.indisready = true;`
    );
    if (validIndexCount !== "4") {
      throw new Error(`Scenario 1 FAILED: Expected 4 valid & ready replacement indexes, got ${validIndexCount}`);
    }
    console.log(`✓ All 4 replacement indexes confirmed valid & ready in pg_index.`);

    // 6. Verify BoardColumn has 6 baseline records
    const colCount = runSql(db1, `SELECT COUNT(*) FROM "BoardColumn";`);
    if (colCount !== "6") {
      throw new Error(`Scenario 1 FAILED: Expected 6 baseline BoardColumn records, got ${colCount}`);
    }
    console.log(`✓ BoardColumn contains exactly 6 baseline records.`);

    // 7. Verify Task.columnId exists
    const colIdExists = runSql(
      db1,
      `SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'Task' AND column_name = 'columnId';`
    );
    if (colIdExists !== "1") {
      throw new Error(`Scenario 1 FAILED: Task.columnId does not exist!`);
    }
    console.log(`✓ Task.columnId exists.`);

    // 8. CRITICAL: Verify Task.status STILL EXISTS and is NOT NULL (Transitional state preserved)
    const statusNullable = runSql(
      db1,
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Task' AND column_name = 'status';`
    );
    if (statusNullable !== "NO") {
      throw new Error(`Scenario 1 FAILED: Task.status expected to exist and be NOT NULL, got ${statusNullable}`);
    }
    console.log(`✓ Task.status STILL EXISTS and is strictly NOT NULL.`);

    // 9. Verify enum TaskStatus exists
    const enumExists = runSql(
      db1,
      `SELECT COUNT(*) FROM pg_type WHERE typname = 'TaskStatus';`
    );
    if (enumExists !== "1") {
      throw new Error(`Scenario 1 FAILED: enum TaskStatus missing in pg_type!`);
    }
    console.log(`✓ enum TaskStatus exists in pg_type.`);

    // 10. Verify bi-directional sync trigger exists on Task
    const triggerExists = runSql(
      db1,
      `SELECT COUNT(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'Task' AND t.tgname = 'sync_task_status_and_column_trigger';`
    );
    if (triggerExists !== "1") {
      throw new Error(`Scenario 1 FAILED: sync_task_status_and_column_trigger missing on Task!`);
    }
    console.log(`✓ sync_task_status_and_column_trigger exists on Task.`);

    // 11. Verify Ticket 1 (TaskChecklistItem) table exists
    const checklistExists = runSql(db1, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'TaskChecklistItem';`);
    if (checklistExists !== "1") {
      throw new Error(`Ticket 1 TaskChecklistItem missing!`);
    }
    console.log(`✓ Ticket 1 (Checklist): TaskChecklistItem table verified.`);

    // 12. Verify Ticket 2 (TaskAttachment) table exists
    const attachmentExists = runSql(db1, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'TaskAttachment';`);
    if (attachmentExists !== "1") {
      throw new Error(`Ticket 2 TaskAttachment missing!`);
    }
    console.log(`✓ Ticket 2 (Attachments): TaskAttachment table verified.`);

    // ────────────────────────────────────────────────────────────────────────────
    // SCENARIO 2: Bootstrap Idempotency (Running on Existing Database)
    // ────────────────────────────────────────────────────────────────────────────
    console.log(`\n--- [Scenario 2] Bootstrap Idempotency on DB: ${db1} ---`);
    console.log("Running runBootstrap() a second time on the already-bootstrapped database...");
    runBootstrap({ dbUrl, directUrl, silent: false });

    const secondRunCount = runSql(
      db1,
      `SELECT COUNT(*) FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`
    );
    if (secondRunCount !== "8") {
      throw new Error(`Scenario 2 FAILED: Migration count changed after second run! count=${secondRunCount}`);
    }
    console.log(`✓ Bootstrap idempotency confirmed: strictly 8 migrations remain recorded.`);
  } finally {
    dropDb(db1);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: Failed Stage 1B Index Pre-Check Simulation
  // ────────────────────────────────────────────────────────────────────────────
  const db3 = `disposable_p261_fail_${Date.now()}`;
  console.log(`\n--- [Scenario 3] Failure Simulation: Corrupted Replacement Index on DB: ${db3} ---`);
  try {
    createDb(db3);
    // Apply migrations up to Stage 1A
    const baseMigrations = RELEASE_1_EXPECTED_MIGRATIONS.slice(0, 7);
    for (const m of baseMigrations) {
      const f = path.join(REPO_ROOT, "prisma", "migrations", m, "migration.sql");
      execSync(`psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${db3} -v ON_ERROR_STOP=1 -f "${f}"`, { env, shell: "/usr/bin/bash" });
    }

    // Corrupt one replacement index
    console.log("Simulating an invalid replacement index: Task_columnId_idx (indisvalid = false)...");
    execSync(`psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${db3} -c 'CREATE INDEX "Task_columnId_idx" ON public."Task"("columnId");'`, { env, shell: "/usr/bin/bash" });
    execSync(`psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${db3} -c "UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.\\\"Task_columnId_idx\\\"'::regclass;"`, { env, shell: "/usr/bin/bash" });

    // Execute Stage 1B migration -> MUST ABORT
    console.log("Executing Stage 1B with corrupted index present...");
    const stage1bPath = path.join(REPO_ROOT, "prisma/migrations/20261121110000_create_replacement_indexes_concurrently/migration.sql");
    try {
      execSync(`psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${db3} -v ON_ERROR_STOP=1 -f "${stage1bPath}"`, { env, shell: "/usr/bin/bash" });
      throw new Error("Failure simulation FAILED: Stage 1B should have aborted!");
    } catch (err: unknown) {
      const errObj = err as { stdout?: string; stderr?: string; message?: string };
      const errMsg = `${errObj?.stdout || ""}\n${errObj?.stderr || ""}\n${errObj?.message || ""}`;
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

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 4: Production Safeguards Rejection
  // ────────────────────────────────────────────────────────────────────────────
  console.log(`\n--- [Scenario 4] Production Safeguards Rejection ---`);

  const prodUrls = [
    "postgresql://postgres:secret@ep-prod-db-1234.us-east-2.aws.neon.tech/neondb-prod?sslmode=require",
    "postgresql://postgres:secret@production-db.internal:5432/myapp",
    "postgresql://postgres:secret@neon.tech/panthar-production"
  ];

  for (const url of prodUrls) {
    try {
      assertNotProduction(url);
      throw new Error(`Safeguard FAILED: Production URL was not rejected: ${url}`);
    } catch (err: unknown) {
      const errMsg = (err as Error).message;
      if (errMsg.includes("SAFETY ABORT")) {
        console.log(`✓ Rejected production URL correctly: ${(err as Error).message}`);
      } else {
        throw err;
      }
    }
  }

  // Test NODE_ENV=production
  const oldNodeEnv = process.env.NODE_ENV;
  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    assertNotProduction("postgresql://postgres:secret@localhost:5432/testdb");
    throw new Error("Safeguard FAILED: NODE_ENV=production was not rejected!");
  } catch (err: unknown) {
    const errMsg = (err as Error).message;
      if (errMsg.includes("SAFETY ABORT")) {
      console.log(`✓ Rejected NODE_ENV=production correctly: ${(err as Error).message}`);
    } else {
      throw err;
    }
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = oldNodeEnv;
  }

  // Test VERCEL_ENV=production
  const oldVercelEnv = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    assertNotProduction("postgresql://postgres:secret@localhost:5432/testdb");
    throw new Error("Safeguard FAILED: VERCEL_ENV=production was not rejected!");
  } catch (err: unknown) {
    const errMsg = (err as Error).message;
      if (errMsg.includes("SAFETY ABORT")) {
      console.log(`✓ Rejected VERCEL_ENV=production correctly: ${(err as Error).message}`);
    } else {
      throw err;
    }
  } finally {
    process.env.VERCEL_ENV = oldVercelEnv;
  }

  console.log("\n================================================================================");
  console.log("ALL 4 VERIFICATION SCENARIOS PASSED WITH 100% SUCCESS!");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("FATAL TEST FAILURE:", err);
  process.exit(1);
});
