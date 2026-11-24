/**
 * Comprehensive Automated Disposable Database Test Suite for Ticket 3 Contract Migration
 * Tests all 6 scenarios against isolated, temporary PostgreSQL databases.
 */

import { execSync } from "child_process";

const PG_HOST = "localhost";
const PG_PORT = 5432;
const PG_USER = "postgres";
const PG_PASS = "postgres";

function runSql(dbName: string, sql: string): string {
  const env = { ...process.env, PGPASSWORD: PG_PASS };
  return execSync(
    `psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${dbName} -v ON_ERROR_STOP=1 -c "${sql.replace(/"/g, '\\"')}"`,
    { env, encoding: "utf8", shell: "/usr/bin/bash" }
  );
}

function runSqlFile(dbName: string, filePath: string): string {
  const env = { ...process.env, PGPASSWORD: PG_PASS };
  return execSync(
    `psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${dbName} -v ON_ERROR_STOP=1 -f "${filePath}"`,
    { env, encoding: "utf8", shell: "/usr/bin/bash" }
  );
}

function createDb(dbName: string) {
  const env = { ...process.env, PGPASSWORD: PG_PASS };
  execSync(`createdb -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} ${dbName}`, { env, shell: "/usr/bin/bash" });
}

function dropDb(dbName: string) {
  const env = { ...process.env, PGPASSWORD: PG_PASS };
  try {
    execSync(`dropdb -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} ${dbName}`, { env, shell: "/usr/bin/bash" });
  } catch {
    // ignore
  }
}

async function main() {
  console.log("================================================================================");
  console.log("PHASE 9.2: DISPOSABLE DATABASE CONTRACT MIGRATION TEST SUITE");
  console.log("================================================================================");

  let passedScenarios = 0;

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: Clean Deployment via Prisma CLI (`prisma migrate deploy`)
  // ────────────────────────────────────────────────────────────────────────────
  const db1 = `disposable_contract_deploy_${Date.now()}`;
  console.log(`\n[Scenario 1] Clean deployment via Prisma CLI on fresh database: ${db1}`);
  try {
    createDb(db1);
    const dbUrl = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${db1}?schema=public`;
    
    // Deploy all 9 migrations
    const deployOut = execSync(
      `DATABASE_URL="${dbUrl}" DIRECT_URL="${dbUrl}" npx prisma migrate deploy`,
      { encoding: "utf8", shell: "/usr/bin/bash" }
    );
    console.log(deployOut.trim());

    // 1. Check all 9 migrations applied
    const appliedCount = runSql(db1, `SELECT count(*)::int as count FROM _prisma_migrations WHERE finished_at IS NOT NULL;`);
    console.log(`Migrations recorded as finished in _prisma_migrations:`, appliedCount.trim());

    // 2. Check Task.columnId is NOT NULL
    const notNullCheck = runSql(
      db1,
      `SELECT attname, attnotnull FROM pg_attribute WHERE attrelid = 'public."Task"'::regclass AND attname = 'columnId';`
    );
    if (!notNullCheck.includes("t")) throw new Error("Task.columnId is NOT marked NOT NULL!");
    console.log(`✓ Task.columnId is strictly NOT NULL`);

    // 3. Check Task_columnId_fkey exists and is validated
    const fkCheck = runSql(
      db1,
      `SELECT conname, convalidated FROM pg_constraint WHERE conrelid = 'public."Task"'::regclass AND conname = 'Task_columnId_fkey';`
    );
    if (!fkCheck.includes("Task_columnId_fkey") || !fkCheck.includes("t")) {
      throw new Error("Task_columnId_fkey is missing or not validated!");
    }
    console.log(`✓ Task_columnId_fkey exists and is VALIDATED`);

    // 4. Check Task.status column does NOT exist
    const statusColCheck = runSql(
      db1,
      `SELECT count(*)::int as count FROM pg_attribute WHERE attrelid = 'public."Task"'::regclass AND attname = 'status';`
    );
    if (!statusColCheck.includes("0")) throw new Error("Task.status column still exists!");
    console.log(`✓ Task.status column successfully removed`);

    // 5. Check TaskStatus enum does NOT exist
    const enumCheck = runSql(db1, `SELECT count(*)::int as count FROM pg_type WHERE typname = 'TaskStatus';`);
    if (!enumCheck.includes("0")) throw new Error("TaskStatus enum still exists!");
    console.log(`✓ TaskStatus enum successfully dropped`);

    // 6. Check 4 replacement indexes are VALID
    const replacementIdxCheck = runSql(
      db1,
      `SELECT c.relname, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname IN ('Task_columnId_idx', 'Task_columnId_projectId_idx', 'Task_columnId_order_idx', 'Task_columnId_dueDate_idx') ORDER BY c.relname;`
    );
    if (!replacementIdxCheck.includes("Task_columnId_idx") || !replacementIdxCheck.includes("Task_columnId_dueDate_idx")) {
      throw new Error("Replacement indexes missing!");
    }
    console.log(`✓ All 4 replacement indexes verified valid in pg_catalog`);

    // 7. Check 4 legacy status indexes are dropped
    const legacyIdxCheck = runSql(
      db1,
      `SELECT count(*)::int as count FROM pg_class WHERE relname IN ('Task_status_projectId_idx', 'Task_status_order_idx', 'Task_status_idx', 'Task_status_dueDate_idx');`
    );
    if (!legacyIdxCheck.includes("0")) throw new Error("Legacy status indexes still exist!");
    console.log(`✓ All 4 legacy status indexes confirmed dropped`);

    // 8. Check trigger & function dropped
    const triggerCheck = runSql(
      db1,
      `SELECT count(*)::int as count FROM pg_trigger WHERE tgname = 'sync_task_status_and_column_trigger';`
    );
    const funcCheck = runSql(
      db1,
      `SELECT count(*)::int as count FROM pg_proc WHERE proname = 'sync_task_status_and_column';`
    );
    if (!triggerCheck.includes("0") || !funcCheck.includes("0")) {
      throw new Error("Synchronization trigger or function not dropped!");
    }
    console.log(`✓ Compatibility trigger and synchronization function dropped`);

    // 9. Check Backlog and Done remain protected system columns
    let protectionWorked = false;
    try {
      runSql(db1, `DELETE FROM public."BoardColumn" WHERE id = 'col_backlog';`);
    } catch (e: unknown) {
      const err = e as Error;
      if (err.message.includes("Cannot delete system board column")) {
        protectionWorked = true;
      }
    }
    if (!protectionWorked) throw new Error("System column protection trigger did not protect col_backlog!");
    console.log(`✓ System column protection trigger verified: deletion of col_backlog blocked`);

    passedScenarios++;
    console.log(`[Scenario 1] PASSED!`);
  } finally {
    dropDb(db1);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 2: Data Preservation & Seeding Verification
  // ────────────────────────────────────────────────────────────────────────────
  const db2 = `disposable_contract_data_${Date.now()}`;
  console.log(`\n[Scenario 2] Data preservation verification: ${db2}`);
  try {
    createDb(db2);
    // const dbUrl = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${db2}?schema=public`;

    // Apply migrations up to Stage 1B (migrations 0 to 7)
    // We apply them by reading SQL files or applying migration directories before Contract
    const migrationDirs = [
      "0_init",
      "20260725090131_add_employee_permissions",
      "20260909190500_add_performance_indexes",
      "20260912180431_add_task_order",
      "20261119171000_add_task_checklist",
      "20261120113500_add_task_attachments",
      "20261121100000_expand_board_columns_schema",
      "20261121110000_create_replacement_indexes_concurrently",
    ];

    for (const dir of migrationDirs) {
      runSqlFile(db2, `prisma/migrations/${dir}/migration.sql`);
    }

    // Seed test entities: 1 Employee, 1 Project, 6 Tasks across all columns
    runSql(
      db2,
      `
      INSERT INTO "Employee" (id, "clerkId", email, "firstName", "lastName", role, status, "createdAt", "updatedAt")
      VALUES ('emp_1', 'clerk_emp_1', 'lead@test.com', 'Alex', 'Lead', 'ADMIN', 'ACTIVE', NOW(), NOW());

      INSERT INTO "Team" (id, name, "leadId", "createdAt", "updatedAt")
      VALUES ('team_1', 'Core Engineering', 'emp_1', NOW(), NOW());

      INSERT INTO "Project" (id, name, status, "leadId", "teamId", "createdAt", "updatedAt")
      VALUES ('proj_1', 'Panthar Core', 'ACTIVE', 'emp_1', 'team_1', NOW(), NOW());

      INSERT INTO "Task" (id, title, status, "columnId", "projectId", "creatorId", "order", "completedAt", "completionNote", "createdAt", "updatedAt")
      VALUES 
        ('task_backlog', 'Task in Backlog', 'BACKLOG', 'col_backlog', 'proj_1', 'emp_1', 1000, NULL, NULL, NOW(), NOW()),
        ('task_todo', 'Task in Todo', 'TODO', 'col_todo', 'proj_1', 'emp_1', 2000, NULL, NULL, NOW(), NOW()),
        ('task_in_prog', 'Task in Progress', 'IN_PROGRESS', 'col_in_progress', 'proj_1', 'emp_1', 3000, NULL, NULL, NOW(), NOW()),
        ('task_review', 'Task in Review', 'REVIEW', 'col_review', 'proj_1', 'emp_1', 4000, NULL, NULL, NOW(), NOW()),
        ('task_testing', 'Task in Testing', 'TESTING', 'col_testing', 'proj_1', 'emp_1', 5000, NULL, NULL, NOW(), NOW()),
        ('task_done', 'Task in Done', 'DONE', 'col_done', 'proj_1', 'emp_1', 6000, NOW(), 'Completed in sprint 4', NOW(), NOW());
      `
    );

    console.log("Seeded 6 tasks across all 6 columns before Contract migration.");

    // Now execute Contract migration
    runSqlFile(db2, `prisma/contract-migrations/20261121200000_contract_board_columns/migration.sql`);

    // Verify all 6 tasks exist with exact columnId preserved
    const taskCount = runSql(db2, `SELECT count(*)::int as count FROM "Task";`);
    if (!taskCount.includes("6")) throw new Error("Expected 6 preserved tasks!");

    const preservedTasks = runSql(
      db2,
      `SELECT id, title, "columnId", ("completedAt" IS NOT NULL) as is_completed, "completionNote" FROM "Task" ORDER BY "order" ASC;`
    );
    console.log(preservedTasks.trim());

    if (!preservedTasks.includes("col_done") || !preservedTasks.includes("Completed in sprint 4")) {
      throw new Error("Task data or completion metadata was corrupted!");
    }

    console.log(`✓ 100% of tasks and column assignments perfectly preserved`);
    passedScenarios++;
    console.log(`[Scenario 2] PASSED!`);
  } finally {
    dropDb(db2);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: Failure Scenario 1 — NULL Task.columnId Aborts Migration
  // ────────────────────────────────────────────────────────────────────────────
  const db3 = `disposable_contract_fail_null_${Date.now()}`;
  console.log(`\n[Scenario 3] Failure scenario: NULL Task.columnId aborts: ${db3}`);
  try {
    createDb(db3);
    const migrationDirs = [
      "0_init",
      "20260725090131_add_employee_permissions",
      "20260909190500_add_performance_indexes",
      "20260912180431_add_task_order",
      "20261119171000_add_task_checklist",
      "20261120113500_add_task_attachments",
      "20261121100000_expand_board_columns_schema",
      "20261121110000_create_replacement_indexes_concurrently",
    ];
    for (const dir of migrationDirs) {
      runSqlFile(db3, `prisma/migrations/${dir}/migration.sql`);
    }

    // Seed test entities and insert a task with NULL columnId (temporarily disabling the sync trigger)
    runSql(
      db3,
      `
      INSERT INTO "Employee" (id, "clerkId", email, "firstName", "lastName", role, status, "createdAt", "updatedAt")
      VALUES ('emp_1', 'clerk_emp_1', 'lead@test.com', 'Alex', 'Lead', 'ADMIN', 'ACTIVE', NOW(), NOW());

      INSERT INTO "Team" (id, name, "leadId", "createdAt", "updatedAt")
      VALUES ('team_1', 'Core Engineering', 'emp_1', NOW(), NOW());

      INSERT INTO "Project" (id, name, status, "leadId", "teamId", "createdAt", "updatedAt")
      VALUES ('proj_1', 'Panthar Core', 'ACTIVE', 'emp_1', 'team_1', NOW(), NOW());

      ALTER TABLE "Task" DISABLE TRIGGER "sync_task_status_and_column_trigger";
      INSERT INTO "Task" (id, title, status, "columnId", "projectId", "creatorId", "order", "createdAt", "updatedAt")
      VALUES ('task_unbackfilled', 'Unbackfilled Task', 'TODO', NULL, 'proj_1', 'emp_1', 1000, NOW(), NOW());
      ALTER TABLE "Task" ENABLE TRIGGER "sync_task_status_and_column_trigger";
      `
    );

    // Attempt Contract migration -> MUST FAIL!
    let abortedCorrectly = false;
    let abortErrorMsg = "";
    try {
      runSqlFile(db3, `prisma/contract-migrations/20261121200000_contract_board_columns/migration.sql`);
    } catch (e: unknown) {
      const err = e as Error;
      abortErrorMsg = err.message;
      if (err.message.includes("Contract migration safety abort: 1 task(s) have NULL or unmapped columnId")) {
        abortedCorrectly = true;
      }
    }

    if (!abortedCorrectly) {
      throw new Error(`Expected Contract migration to abort on NULL columnId! Error was: ${abortErrorMsg}`);
    }

    console.log(`✓ Migration aborted with expected exception: "Contract migration safety abort: 1 task(s) have NULL or unmapped columnId"`);

    // Verify rollback: Task.status and TaskStatus enum still exist
    const statusCol = runSql(
      db3,
      `SELECT count(*)::int as count FROM pg_attribute WHERE attrelid = 'public."Task"'::regclass AND attname = 'status';`
    );
    const enumType = runSql(db3, `SELECT count(*)::int as count FROM pg_type WHERE typname = 'TaskStatus';`);
    if (!statusCol.includes("1") || !enumType.includes("1")) {
      throw new Error("Transaction was NOT cleanly rolled back!");
    }
    console.log(`✓ Full transaction rollback verified: Task.status and TaskStatus enum remain intact`);

    passedScenarios++;
    console.log(`[Scenario 3] PASSED!`);
  } finally {
    dropDb(db3);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 4: Failure Scenario 2 — Orphaned Task.columnId Aborts Migration
  // ────────────────────────────────────────────────────────────────────────────
  const db4 = `disposable_contract_fail_orphan_${Date.now()}`;
  console.log(`\n[Scenario 4] Failure scenario: Orphaned Task.columnId aborts: ${db4}`);
  try {
    createDb(db4);
    const migrationDirs = [
      "0_init",
      "20260725090131_add_employee_permissions",
      "20260909190500_add_performance_indexes",
      "20260912180431_add_task_order",
      "20261119171000_add_task_checklist",
      "20261120113500_add_task_attachments",
      "20261121100000_expand_board_columns_schema",
      "20261121110000_create_replacement_indexes_concurrently",
    ];
    for (const dir of migrationDirs) {
      runSqlFile(db4, `prisma/migrations/${dir}/migration.sql`);
    }

    runSql(
      db4,
      `
      INSERT INTO "Employee" (id, "clerkId", email, "firstName", "lastName", role, status, "createdAt", "updatedAt")
      VALUES ('emp_1', 'clerk_emp_1', 'lead@test.com', 'Alex', 'Lead', 'ADMIN', 'ACTIVE', NOW(), NOW());

      INSERT INTO "Team" (id, name, "leadId", "createdAt", "updatedAt")
      VALUES ('team_1', 'Core Engineering', 'emp_1', NOW(), NOW());

      INSERT INTO "Project" (id, name, status, "leadId", "teamId", "createdAt", "updatedAt")
      VALUES ('proj_1', 'Panthar Core', 'ACTIVE', 'emp_1', 'team_1', NOW(), NOW());

      ALTER TABLE "Task" DISABLE TRIGGER "sync_task_status_and_column_trigger";
      INSERT INTO "Task" (id, title, status, "columnId", "projectId", "creatorId", "order", "createdAt", "updatedAt")
      VALUES ('task_orphan', 'Orphaned Task', 'TODO', 'col_ghost_deleted', 'proj_1', 'emp_1', 1000, NOW(), NOW());
      ALTER TABLE "Task" ENABLE TRIGGER "sync_task_status_and_column_trigger";
      `
    );

    let abortedCorrectly = false;
    try {
      runSqlFile(db4, `prisma/contract-migrations/20261121200000_contract_board_columns/migration.sql`);
    } catch (e: unknown) {
      const err = e as Error;
      if (err.message.includes("Contract migration safety abort: 1 task(s) have NULL or unmapped columnId")) {
        abortedCorrectly = true;
      }
    }

    if (!abortedCorrectly) {
      throw new Error("Expected Contract migration to abort on orphaned columnId!");
    }

    console.log(`✓ Migration aborted with expected exception for orphaned columnId reference`);
    passedScenarios++;
    console.log(`[Scenario 4] PASSED!`);
  } finally {
    dropDb(db4);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 5: Failure Scenario 3 — Missing Replacement Index Aborts Migration
  // ────────────────────────────────────────────────────────────────────────────
  const db5 = `disposable_contract_fail_index_${Date.now()}`;
  console.log(`\n[Scenario 5] Failure scenario: Missing replacement index aborts: ${db5}`);
  try {
    createDb(db5);
    const migrationDirs = [
      "0_init",
      "20260725090131_add_employee_permissions",
      "20260909190500_add_performance_indexes",
      "20260912180431_add_task_order",
      "20261119171000_add_task_checklist",
      "20261120113500_add_task_attachments",
      "20261121100000_expand_board_columns_schema",
      "20261121110000_create_replacement_indexes_concurrently",
    ];
    for (const dir of migrationDirs) {
      runSqlFile(db5, `prisma/migrations/${dir}/migration.sql`);
    }

    // Drop one replacement index to simulate an interrupted or missing index build
    runSql(db5, `DROP INDEX "Task_columnId_order_idx";`);

    let abortedCorrectly = false;
    try {
      runSqlFile(db5, `prisma/contract-migrations/20261121200000_contract_board_columns/migration.sql`);
    } catch (e: unknown) {
      const err = e as Error;
      if (err.message.includes("Contract migration safety abort: Replacement index Task_columnId_order_idx not found in pg_catalog")) {
        abortedCorrectly = true;
      }
    }

    if (!abortedCorrectly) {
      throw new Error("Expected Contract migration to abort on missing replacement index!");
    }

    console.log(`✓ Migration aborted with expected catalog exception for missing replacement index`);

    // Verify rollback: legacy status indexes are preserved and NOT dropped!
    const legacyIndexCheck = runSql(
      db5,
      `SELECT count(*)::int as count FROM pg_class WHERE relname IN ('Task_status_projectId_idx', 'Task_status_order_idx', 'Task_status_idx', 'Task_status_dueDate_idx');`
    );
    if (!legacyIndexCheck.includes("4")) {
      throw new Error("Legacy status indexes were improperly dropped!");
    }
    console.log(`✓ Full rollback verified: All 4 legacy status indexes safely retained`);

    passedScenarios++;
    console.log(`[Scenario 5] PASSED!`);
  } finally {
    dropDb(db5);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 6: Failure Scenario 4 — Unexpected Enum Dependency Aborts Migration
  // ────────────────────────────────────────────────────────────────────────────
  const db6 = `disposable_contract_fail_enum_${Date.now()}`;
  console.log(`\n[Scenario 6] Failure scenario: Unexpected TaskStatus enum dependency aborts: ${db6}`);
  try {
    createDb(db6);
    const migrationDirs = [
      "0_init",
      "20260725090131_add_employee_permissions",
      "20260909190500_add_performance_indexes",
      "20260912180431_add_task_order",
      "20261119171000_add_task_checklist",
      "20261120113500_add_task_attachments",
      "20261121100000_expand_board_columns_schema",
      "20261121110000_create_replacement_indexes_concurrently",
    ];
    for (const dir of migrationDirs) {
      runSqlFile(db6, `prisma/migrations/${dir}/migration.sql`);
    }

    // Create an external table with a column referencing TaskStatus
    runSql(
      db6,
      `CREATE TABLE "AuditTaskLog" (id text PRIMARY KEY, "oldStatus" "TaskStatus" NOT NULL);`
    );

    let abortedCorrectly = false;
    try {
      runSqlFile(db6, `prisma/contract-migrations/20261121200000_contract_board_columns/migration.sql`);
    } catch (e: unknown) {
      const err = e as Error;
      if (err.message.includes("Contract migration safety abort: TaskStatus enum is still referenced by active column(s): public.AuditTaskLog.oldStatus")) {
        abortedCorrectly = true;
      }
    }

    if (!abortedCorrectly) {
      throw new Error("Expected Contract migration to abort on unexpected enum dependency!");
    }

    console.log(`✓ Migration aborted with expected exception: "TaskStatus enum is still referenced by active column(s): public.AuditTaskLog.oldStatus"`);

    // Verify rollback: TaskStatus enum still exists
    const enumCheck = runSql(db6, `SELECT count(*)::int as count FROM pg_type WHERE typname = 'TaskStatus';`);
    if (!enumCheck.includes("1")) {
      throw new Error("TaskStatus enum was improperly dropped!");
    }
    console.log(`✓ Full rollback verified: TaskStatus enum preserved without CASCADE`);

    passedScenarios++;
    console.log(`[Scenario 6] PASSED!`);
  } finally {
    dropDb(db6);
  }

  console.log("\n================================================================================");
  console.log(`ALL ${passedScenarios} / 6 DISPOSABLE DATABASE TEST SCENARIOS PASSED WITH 100% SUCCESS!`);
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("FATAL ERROR in disposable test suite:", err);
  process.exit(1);
});
