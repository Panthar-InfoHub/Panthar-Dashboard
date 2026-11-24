/**
 * Phase 9.3.2: Runtime Dashboard Behavior Verification on Disposable PostgreSQL Database
 * Creates a disposable DB, applies all 9 migrations (Contract schema with Task.status dropped),
 * seeds realistic data, and executes actual dashboard queries.
 */

import { execSync } from "child_process";
import { PrismaClient } from "../lib/generated/prisma";
import { ColumnTypeEnum } from "@prisma/driver-adapter-utils";
import { subDays, startOfDay } from "date-fns";

const PG_HOST = "localhost";
const PG_PORT = 5432;
const PG_USER = "postgres";
const PG_PASS = "postgres";

function runSql(dbName: string, sql: string): string {
  const env = { ...process.env, PGPASSWORD: PG_PASS };
  return execSync(
    `psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${dbName} -v ON_ERROR_STOP=1`,
    { input: sql, env, encoding: "utf8", shell: "/usr/bin/bash" }
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

/**
 * Creates a DriverAdapter connecting to the disposable database via psql JSON queries over stdin
 */
function createDisposableAdapter(dbName: string) {
  return {
    provider: "postgres" as const,
    adapterName: "disposable-psql-adapter",
    connect: async () => ({
      provider: "postgres" as const,
      adapterName: "disposable-psql-adapter",
      getConnectionInfo: () => ({ schemaName: "public", supportsRelationJoins: true }),
      queryRaw: async ({ sql, args }: { sql: string; args: unknown[] }) => {
        // Replace positional parameters $1, $2, etc. with formatted SQL literals for execution
        let interpolatedSql = sql;
        if (args && args.length > 0) {
          args.forEach((arg, index) => {
            const paramIdx = `$${index + 1}`;
            let literal: string;
            if (arg === null || arg === undefined) {
              literal = "NULL";
            } else if (arg instanceof Date) {
              literal = `'${arg.toISOString()}'::timestamptz`;
            } else if (typeof arg === "number") {
              literal = `${arg}`;
            } else if (typeof arg === "boolean") {
              literal = arg ? "TRUE" : "FALSE";
            } else {
              literal = `'${String(arg).replace(/'/g, "''")}'`;
            }
            interpolatedSql = interpolatedSql.split(paramIdx).join(literal);
          });
        }

        const env = { ...process.env, PGPASSWORD: PG_PASS };
        // Query column names and types alongside row data safely via stdin
        const wrapperQuery = `
          WITH raw_q AS (${interpolatedSql})
          SELECT json_build_object(
            'rows', COALESCE((SELECT json_agg(r) FROM raw_q r), '[]'::json)
          );
        `;
        const rawOut = execSync(
          `psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${dbName} -t -A -v ON_ERROR_STOP=1`,
          { input: wrapperQuery, env, encoding: "utf8", shell: "/usr/bin/bash" }
        ).trim();

        const parsed = JSON.parse(rawOut);
        const rowsArray = parsed.rows as Record<string, unknown>[];

        const columnNames = rowsArray.length > 0 ? Object.keys(rowsArray[0]) : [];
        const columnTypes = columnNames.map(() => ColumnTypeEnum.Text);
        const rows = rowsArray.map((row) => columnNames.map((col) => row[col]));

        return {
          columnNames,
          columnTypes,
          rows,
        };
      },
      executeRaw: async () => 1,
      executeScript: async () => {},
      startTransaction: async () => { throw new Error("Transactions not needed for dashboard queries"); },
      dispose: async () => {},
    }),
  };
}

async function main() {
  console.log("================================================================================");
  console.log("PHASE 9.3.2: DISPOSABLE DATABASE DASHBOARD RUNTIME TEST");
  console.log("================================================================================");

  const dbName = `disposable_dashboard_test_${Date.now()}`;
  console.log(`\n[1/5] Creating disposable database: ${dbName}`);
  createDb(dbName);

  try {
    const dbUrl = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${dbName}?schema=public`;

    console.log("[2/5] Applying all 9 migrations via Prisma CLI...");
    const deployOut = execSync(
      `DATABASE_URL="${dbUrl}" DIRECT_URL="${dbUrl}" npx prisma migrate deploy`,
      { encoding: "utf8", shell: "/usr/bin/bash" }
    );
    console.log(deployOut.trim());

    // Assert Task.status column does NOT exist in pg_catalog
    const colCheck = runSql(
      dbName,
      `SELECT count(*)::int as count FROM information_schema.columns WHERE table_name = 'Task' AND column_name = 'status';`
    );
    if (!colCheck.includes("0")) throw new Error("Task.status column unexpectedly exists in Contract database!");
    console.log("✓ Confirmed: Task.status column does NOT exist in the disposable database.");

    // Assert TaskStatus enum does NOT exist
    const enumCheck = runSql(
      dbName,
      `SELECT count(*)::int as count FROM pg_type WHERE typname = 'TaskStatus';`
    );
    if (!enumCheck.includes("0")) throw new Error("TaskStatus enum unexpectedly exists in Contract database!");
    console.log("✓ Confirmed: TaskStatus enum does NOT exist in the disposable database.");

    console.log("\n[3/5] Seeding test data into Contract schema...");
    const now = new Date();
    const todayStr = now.toISOString();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Seed custom column (in addition to the 6 baseline columns created by Stage 1A)
    runSql(
      dbName,
      `INSERT INTO "BoardColumn" (id, name, color, position, "systemKey", "createdAt", "updatedAt")
       VALUES ('col_qa', 'QA Staging', '#a855f7', 4500.0, NULL, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING;`
    );

    // 2. Seed Employee, Team, Project
    runSql(
      dbName,
      `INSERT INTO "Employee" (id, "clerkId", "firstName", "lastName", "email", "role", "status", "createdAt", "updatedAt")
       VALUES 
         ('emp_admin', 'clerk_admin', 'Alice', 'Admin', 'admin@example.com', 'ADMIN', 'ACTIVE', NOW(), NOW()),
         ('emp_member', 'clerk_member', 'Bob', 'Member', 'bob@example.com', 'MEMBER', 'ACTIVE', NOW(), NOW());

       INSERT INTO "Team" (id, name, "leadId", "createdAt", "updatedAt")
       VALUES 
         ('team_eng', 'Engineering', 'emp_admin', NOW(), NOW()),
         ('team_des', 'Design', 'emp_admin', NOW(), NOW());

       INSERT INTO "Project" (id, name, "teamId", "leadId", "status", "createdAt", "updatedAt")
       VALUES 
         ('proj_alpha', 'Project Alpha', 'team_eng', 'emp_admin', 'ACTIVE', NOW(), NOW()),
         ('proj_beta', 'Project Beta', 'team_des', 'emp_admin', 'ACTIVE', NOW(), NOW());`
    );

    // 3. Seed Tasks across columns
    runSql(
      dbName,
      `INSERT INTO "Task" (id, title, "columnId", "projectId", "creatorId", "order", "completedAt", "createdAt", "updatedAt")
       VALUES 
         -- Velocity Tasks: In col_done (systemKey = DONE)
         ('task_done_today', 'Done Today Task', 'col_done', 'proj_alpha', 'emp_admin', 1000.0, '${todayStr}', '${twentyDaysAgo}', NOW()),
         ('task_done_3d', 'Done 3 Days Ago Task', 'col_done', 'proj_alpha', 'emp_admin', 2000.0, '${threeDaysAgo}', '${twentyDaysAgo}', NOW()),
         ('task_done_old', 'Done 20 Days Ago Task', 'col_done', 'proj_alpha', 'emp_admin', 3000.0, '${twentyDaysAgo}', '${twentyDaysAgo}', NOW()),

         -- Workload Tasks: In non-Done columns (systemKey IS DISTINCT FROM 'DONE')
         ('task_in_prog', 'Active Progress Task', 'col_in_progress', 'proj_alpha', 'emp_admin', 1000.0, NULL, NOW(), NOW()),
         ('task_qa', 'QA Staging Task', 'col_qa', 'proj_alpha', 'emp_admin', 2000.0, NULL, NOW(), NOW()),
         ('task_backlog', 'Design Backlog Task', 'col_backlog', 'proj_beta', 'emp_admin', 1000.0, NULL, NOW(), NOW());`
    );

    console.log("✓ Seeded: 6 tasks across 4 columns (3 in Done, 3 active in Eng & Design teams).");

    console.log("\n[4/5] Executing actual dashboard queries against disposable database...");
    const client = new PrismaClient({ adapter: createDisposableAdapter(dbName) });

    // Test A: getTaskVelocity Raw SQL Query Execution
    const rangeStart = startOfDay(subDays(now, 13));
    console.log(`- Running getTaskVelocity query (rangeStart = ${rangeStart.toISOString()})...`);
    
    const [velocityCompletedRows, velocityCreatedRows] = await Promise.all([
      client.$queryRaw<{ date: string; count: number }[]>`
        SELECT DATE(t."completedAt") as date, COUNT(*)::int as count 
        FROM "Task" t 
        LEFT JOIN "BoardColumn" c ON t."columnId" = c.id
        WHERE c."systemKey" = 'DONE'
          AND t."completedAt" >= ${rangeStart} 
        GROUP BY DATE(t."completedAt")
      `,
      client.$queryRaw<{ date: string; count: number }[]>`
        SELECT DATE("createdAt") as date, COUNT(*)::int as count 
        FROM "Task" 
        WHERE "createdAt" >= ${rangeStart} 
        GROUP BY DATE("createdAt")
      `
    ]);

    console.log("  getTaskVelocity raw query results (completed):", velocityCompletedRows);
    console.log("  getTaskVelocity raw query results (created):", velocityCreatedRows);

    // Verify velocity results
    const totalCompletedIn14Days = velocityCompletedRows.reduce((acc, r) => acc + Number(r.count), 0);
    if (totalCompletedIn14Days !== 2) {
      throw new Error(`getTaskVelocity expected exactly 2 completed tasks within 14-day window, got ${totalCompletedIn14Days}`);
    }
    console.log("✓ getTaskVelocity successfully filtered tasks: exactly 2 tasks counted (today + 3 days ago). Old task (20d ago) correctly excluded.");

    // Test B: getDashboardChartsData Team Workload Query Execution
    console.log("- Running getDashboardChartsData teamWorkload query...");
    const teamWorkloadRows = await client.$queryRaw<{ name: string; value: number }[]>`
      SELECT tm.name, COUNT(t.id)::int as value
      FROM "Task" t
      JOIN "Project" p ON t."projectId" = p.id
      JOIN "Team" tm ON p."teamId" = tm.id
      LEFT JOIN "BoardColumn" c ON t."columnId" = c.id
      WHERE c."systemKey" IS DISTINCT FROM 'DONE'
      GROUP BY tm.id, tm.name
      ORDER BY value DESC
      LIMIT 6
    `;

    console.log("  getDashboardChartsData teamWorkload rows:", teamWorkloadRows);

    // Verify team workload counts
    const engRow = teamWorkloadRows.find((r) => r.name === "Engineering");
    const desRow = teamWorkloadRows.find((r) => r.name === "Design");

    if (!engRow || Number(engRow.value) !== 2) {
      throw new Error(`Expected Engineering workload = 2 (in_progress + qa), got ${engRow?.value}`);
    }
    if (!desRow || Number(desRow.value) !== 1) {
      throw new Error(`Expected Design workload = 1 (backlog), got ${desRow?.value}`);
    }
    console.log("✓ getDashboardChartsData successfully calculated team workload: Engineering = 2, Design = 1. Done tasks correctly excluded.");

    // Test C: Verify negative assertion - query referencing t.status MUST fail on Contract schema
    console.log("- Negative test: Executing legacy query with t.status to confirm it fails on Contract schema...");
    let caughtExpectedError = false;
    try {
      await client.$queryRaw`
        SELECT DATE(t."completedAt") as date, COUNT(*)::int as count 
        FROM "Task" t 
        LEFT JOIN "BoardColumn" c ON t."columnId" = c.id
        WHERE (c."systemKey" = 'DONE' OR (t."columnId" IS NULL AND t.status = 'DONE'))
        GROUP BY DATE(t."completedAt")
      `;
    } catch (err: unknown) {
      const errMsg = (err as Error).message;
      caughtExpectedError = true;
      console.log(`✓ Caught expected error on legacy query: ${errMsg.split("\n")[0]}`);
    }
    if (!caughtExpectedError) {
      throw new Error("Old query unexpectedly succeeded without failing on missing t.status!");
    }

    console.log("\n[5/5] All runtime tests against Contract schema passed with 100% success!");
  } finally {
    console.log(`\nCleaning up disposable database: ${dbName}...`);
    dropDb(dbName);
    console.log("✓ Disposable database dropped.");
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in runtime test:", err);
  process.exit(1);
});
