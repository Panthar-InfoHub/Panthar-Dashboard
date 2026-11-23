/**
 * Fresh Database Bootstrap Script (Release 1 Boundary)
 * 
 * Safely initializes fresh/disposable PostgreSQL development and test databases
 * containing Stage 1B (non-transactional concurrent indexes) without requiring
 * manual edits to _prisma_migrations or altering historical migration files.
 * 
 * RELEASE 1 BOUNDARY:
 * Applies strictly the eight approved Release 1 migrations:
 * 1. 0_init
 * 2. 20260725090131_add_employee_permissions
 * 3. 20260909190500_add_performance_indexes
 * 4. 20260912180431_add_task_order
 * 5. 20261119171000_add_task_checklist
 * 6. 20261120113500_add_task_attachments
 * 7. 20261121100000_expand_board_columns_schema
 * 8. 20261121110000_create_replacement_indexes_concurrently
 * 
 * Stops immediately at Stage 1B. Never applies Contract or subsequent migrations.
 * 
 * STRICT SAFETY: This script is explicitly prohibited from running in production.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const STAGE_1B_MIGRATION_NAME = "20261121110000_create_replacement_indexes_concurrently";
const STAGE_1B_FILE = path.join(
  REPO_ROOT,
  "prisma",
  "migrations",
  STAGE_1B_MIGRATION_NAME,
  "migration.sql"
);

export const RELEASE_1_EXPECTED_MIGRATIONS = [
  "0_init",
  "20260725090131_add_employee_permissions",
  "20260909190500_add_performance_indexes",
  "20260912180431_add_task_order",
  "20261119171000_add_task_checklist",
  "20261120113500_add_task_attachments",
  "20261121100000_expand_board_columns_schema",
  "20261121110000_create_replacement_indexes_concurrently"
];

export interface BootstrapOptions {
  dbUrl: string;
  directUrl?: string;
  silent?: boolean;
}

export function assertNotProduction(targetUrl: string) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SAFETY ABORT: bootstrap-fresh-database is strictly prohibited in production environment (NODE_ENV=production).");
  }
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("SAFETY ABORT: bootstrap-fresh-database is strictly prohibited in Vercel production environment (VERCEL_ENV=production).");
  }

  const lower = targetUrl.toLowerCase();
  const prodIndicators = [
    "neondb-prod",
    "prod-db",
    "production",
    "-prod.",
    ".prod.",
    "prod-pooler",
    "/prod"
  ];
  for (const indicator of prodIndicators) {
    if (lower.includes(indicator)) {
      throw new Error(`SAFETY ABORT: bootstrap-fresh-database is strictly prohibited on production databases. Target contains '${indicator}'.`);
    }
  }
}

export function runBootstrap({ dbUrl, directUrl, silent = false }: BootstrapOptions) {
  const targetDirectUrl = directUrl || dbUrl;
  const psqlUrl = targetDirectUrl.split("?")[0]; // psql does not accept query params like ?schema=public
  const log = (msg: string) => {
    if (!silent) console.log(`[Bootstrap] ${msg}`);
  };

  // 1. Safety Guard: Reject production environments
  assertNotProduction(targetDirectUrl);

  // 2. Pre-check: Verify Prisma migrations directory on disk enforces Release 1 boundary
  const migrationsDir = path.join(REPO_ROOT, "prisma", "migrations");
  const migrationsOnDisk = fs.readdirSync(migrationsDir)
    .filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory());

  if (migrationsOnDisk.includes("20261121200000_contract_board_columns")) {
    throw new Error("SAFETY ABORT: Contract migration 20261121200000_contract_board_columns found in prisma/migrations directory! Release 1 boundary violated.");
  }

  log(`Target: ${targetDirectUrl.replace(/:[^:@]+@/, ":****@")}`);

  // Helper to run psql queries
  const runPsqlQuery = (sql: string): string => {
    const env = { ...process.env };
    return execSync(
      `psql "${psqlUrl}" -v ON_ERROR_STOP=1 -t -A -c "${sql.replace(/"/g, '\\"')}"`,
      { env, encoding: "utf8", shell: "/usr/bin/bash" }
    ).trim();
  };

  // Helper to run psql script file (autocommit mode outside transactions)
  const runPsqlFile = (filePath: string): string => {
    const env = { ...process.env };
    return execSync(
      `psql "${psqlUrl}" -v ON_ERROR_STOP=1 -f "${filePath}"`,
      { env, encoding: "utf8", shell: "/usr/bin/bash" }
    ).trim();
  };

  // 3. Inspect target database state
  let hasPrismaMigrationsTable = false;
  let isStage1BApplied = false;

  try {
    const tableExists = runPsqlQuery(
      `SELECT to_regclass('public._prisma_migrations')::text;`
    );
    hasPrismaMigrationsTable = tableExists === "_prisma_migrations" || tableExists === "public._prisma_migrations";
    if (hasPrismaMigrationsTable) {
      const appliedCount = runPsqlQuery(
        `SELECT COUNT(*) FROM public."_prisma_migrations" WHERE migration_name = '${STAGE_1B_MIGRATION_NAME}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;`
      );
      isStage1BApplied = parseInt(appliedCount, 10) > 0;
    }
  } catch (err) {
    // Database is fresh/empty
    hasPrismaMigrationsTable = false;
    isStage1BApplied = false;
  }

  // 4. Existing database detection: If Stage 1B is already applied, STOP safely without executing further migrations
  if (isStage1BApplied) {
    log(`Stage 1B is already applied in target database. Checking Release 1 boundary & replacement indexes...`);

    // Verify replacement indexes
    const checkSql = `
      SELECT c.relname::text, i.indisvalid, i.indisready
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
      JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
      WHERE t.relname = 'Task' AND c.relname IN (
        'Task_columnId_idx',
        'Task_columnId_projectId_idx',
        'Task_columnId_order_idx',
        'Task_columnId_dueDate_idx'
      );
    `;
    const result = runPsqlQuery(checkSql);
    const rows = result.split("\n").filter(Boolean);
    if (rows.length !== 4) {
      throw new Error(`Existing database verification failed: Expected 4 replacement indexes, found ${rows.length}:\n${result}`);
    }
    for (const r of rows) {
      const [, valid, ready] = r.split("|");
      if (valid !== "t" || ready !== "t") {
        throw new Error(`Existing database verification failed: Index is not valid or ready: ${r}`);
      }
    }

    // Verify Contract migration is NOT applied
    const contractCount = runPsqlQuery(
      `SELECT COUNT(*) FROM public."_prisma_migrations" WHERE migration_name = '20261121200000_contract_board_columns';`
    );
    if (parseInt(contractCount, 10) > 0) {
      log(`Note: Contract migration already recorded on this database.`);
    } else {
      log(`✓ Release 1 boundary verified: Contract migration is NOT applied.`);
    }

    log(`✓ Existing database is already up to date at Stage 1B. Safely stopping without applying further migrations.`);
    return;
  }

  // 5. Fresh database execution
  log(`Fresh database detected. Starting automated non-transactional bootstrap...`);

  // Step 5a: Run prisma migrate deploy (expected to pause at Stage 1B with code 25001)
  log(`Step 1: Applying historical migrations up to Stage 1B...`);
  try {
    execSync(
      `DATABASE_URL="${dbUrl}" DIRECT_URL="${targetDirectUrl}" npx prisma migrate deploy`,
      { cwd: REPO_ROOT, encoding: "utf8", shell: "/usr/bin/bash" }
    );
  } catch (err: any) {
    const combinedMsg = `${err.stdout || ""}\n${err.stderr || ""}\n${err.message || ""}`;
    if (combinedMsg.includes("25001") || combinedMsg.includes("CREATE INDEX CONCURRENTLY cannot run inside a transaction block")) {
      log(`Caught known Prisma engine transaction wrapper limit on Stage 1B.`);
    } else {
      throw new Error(`Unexpected migration failure before Stage 1B: ${combinedMsg}`);
    }
  }

  // Step 5b: Mark the failed attempt as rolled back in Prisma history using official CLI
  log(`Step 2: Marking Stage 1B rolled back via Prisma CLI...`);
  execSync(
    `DATABASE_URL="${dbUrl}" DIRECT_URL="${targetDirectUrl}" npx prisma migrate resolve --rolled-back "${STAGE_1B_MIGRATION_NAME}"`,
    { cwd: REPO_ROOT, encoding: "utf8", shell: "/usr/bin/bash" }
  );

  // Step 5c: Execute Stage 1B SQL directly via psql in autocommit mode outside transactions
  log(`Step 3: Executing Stage 1B replacement indexes in PostgreSQL autocommit mode...`);
  if (!fs.existsSync(STAGE_1B_FILE)) {
    throw new Error(`Migration file not found: ${STAGE_1B_FILE}`);
  }
  runPsqlFile(STAGE_1B_FILE);
  log(`Stage 1B SQL executed successfully.`);

  // Step 5d: Mark Stage 1B applied using Prisma CLI (records correct canonical checksum)
  log(`Step 4: Recording Stage 1B completion via Prisma CLI...`);
  execSync(
    `DATABASE_URL="${dbUrl}" DIRECT_URL="${targetDirectUrl}" npx prisma migrate resolve --applied "${STAGE_1B_MIGRATION_NAME}"`,
    { cwd: REPO_ROOT, encoding: "utf8", shell: "/usr/bin/bash" }
  );

  // Step 5e: Verify Release 1 Boundary (EXACTLY 8 MIGRATIONS, CONTRACT EXCLUDED)
  log(`Step 5: Verifying Release 1 boundary in _prisma_migrations...`);
  const appliedMigrationsRaw = runPsqlQuery(
    `SELECT migration_name FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at ASC;`
  );
  const appliedMigrations = appliedMigrationsRaw.split("\n").map(s => s.trim()).filter(Boolean);
  if (appliedMigrations.length !== 8) {
    throw new Error(`Release 1 boundary violation: Expected exactly 8 applied migrations, found ${appliedMigrations.length}:\n${appliedMigrations.join("\n")}`);
  }
  for (let i = 0; i < RELEASE_1_EXPECTED_MIGRATIONS.length; i++) {
    if (appliedMigrations[i] !== RELEASE_1_EXPECTED_MIGRATIONS[i]) {
      throw new Error(`Migration sequence mismatch at index ${i}: expected ${RELEASE_1_EXPECTED_MIGRATIONS[i]}, got ${appliedMigrations[i]}`);
    }
  }

  // Assert Contract migration is NOT applied
  const contractCount = runPsqlQuery(
    `SELECT COUNT(*) FROM public."_prisma_migrations" WHERE migration_name = '20261121200000_contract_board_columns';`
  );
  if (parseInt(contractCount, 10) > 0) {
    throw new Error(`CRITICAL VIOLATION: Contract migration 20261121200000_contract_board_columns was applied!`);
  }

  // 6. Post-bootstrap schema & index verification
  log(`Step 6: Verifying all 4 replacement indexes on public."Task"...`);
  const checkSql = `
    SELECT 
      c.relname::text,
      i.indisvalid,
      i.indisready
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
    WHERE t.relname = 'Task' AND c.relname IN (
      'Task_columnId_idx',
      'Task_columnId_projectId_idx',
      'Task_columnId_order_idx',
      'Task_columnId_dueDate_idx'
    );
  `;
  const result = runPsqlQuery(checkSql);
  const rows = result.split("\n").filter(Boolean);
  if (rows.length !== 4) {
    throw new Error(`Bootstrap verification failed: Expected 4 indexes, found ${rows.length}:\n${result}`);
  }
  for (const r of rows) {
    const [, valid, ready] = r.split("|");
    if (valid !== "t" || ready !== "t") {
      throw new Error(`Bootstrap verification failed: Index is not valid or ready: ${r}`);
    }
  }

  // Verify Task.status still exists and is NOT NULL
  const statusNullable = runPsqlQuery(
    `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Task' AND column_name = 'status';`
  );
  if (statusNullable !== "NO") {
    throw new Error(`Release 1 Transitional Verification failed: Task.status expected to exist and be NOT NULL, got ${statusNullable}`);
  }

  // Verify trigger exists
  const triggerExists = runPsqlQuery(
    `SELECT COUNT(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'Task' AND t.tgname = 'sync_task_status_and_column_trigger';`
  );
  if (triggerExists !== "1") {
    throw new Error(`Release 1 Transitional Verification failed: sync_task_status_and_column_trigger missing on Task!`);
  }

  log(`✓ Bootstrap complete! Release 1 boundary strictly preserved. All 4 replacement indexes valid & ready. Contract migration unapplied.`);
}

// Standalone execution if invoked directly via CLI
if (require.main === module) {
  const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("Usage: DIRECT_URL=<url> npx tsx scripts/bootstrap-fresh-database.ts");
    process.exit(1);
  }
  try {
    runBootstrap({ dbUrl });
  } catch (err: any) {
    console.error("Bootstrap failed:", err.message);
    process.exit(1);
  }
}
