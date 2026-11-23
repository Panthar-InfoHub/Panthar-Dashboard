/**
 * ============================================================================
 * HISTORICAL STAGE 1 MIGRATION TEST: Operational Task Column Backfill (Stage 1A.1)
 * ============================================================================
 * This integration test suite validates the transitional backfill procedure
 * (scripts/backfill-task-columns.ts) that migrated legacy Task.status to Task.columnId.
 *
 * NOTE: This test suite requires the transitional schema (where Task.columnId is
 * nullable, Task.status exists, and sync_task_status_and_column_trigger is present).
 * It is intentionally preserved for historical migration verification and auditability,
 * but excluded from standard CI / post-Contract regression suites (npm run test:all).
 * ============================================================================
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../lib/db";
import {
  backfillTaskColumns,
  BASELINE_STATUS_MAPPINGS,
} from "../../scripts/backfill-task-columns";

describe("Stage 1A.1 Task Column Backfill Integration Tests (Historical Stage 1)", () => {
  const suffix = `bf_${Date.now()}`;
  let testTeamId: string;
  let testLeadId: string;
  let testProjectId: string;
  const createdTaskIds: string[] = [];

  // Helper to create a fixture task with columnId = null (simulating pre-migration tasks)
  async function createUnbackfilledTask(
    title: string,
    status: "BACKLOG" | "TODO" | "IN_PROGRESS" | "REVIEW" | "TESTING" | "DONE",
    customId?: string
  ): Promise<string> {
    const id = customId ?? `task_bf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    createdTaskIds.push(id);

    // Disable trigger temporarily to allow inserting raw unbackfilled state (columnId IS NULL)
    await db.$executeRawUnsafe(
      'ALTER TABLE "Task" DISABLE TRIGGER "sync_task_status_and_column_trigger"'
    );

    try {
      await db.$executeRawUnsafe(
        `INSERT INTO "Task" (id, title, "columnId", status, "projectId", "creatorId", "createdAt", "updatedAt")
         VALUES ('${id}', '${title}', NULL, '${status}'::"TaskStatus", '${testProjectId}', '${testLeadId}', NOW(), NOW())`
      );
    } finally {
      await db.$executeRawUnsafe(
        'ALTER TABLE "Task" ENABLE TRIGGER "sync_task_status_and_column_trigger"'
      );
    }

    return id;
  }

  before(async () => {
    // 1. Create Team Lead / Creator Employee
    const lead = await db.employee.create({
      data: {
        clerkId: `clerk_lead_${suffix}`,
        email: `lead_${suffix}@example.com`,
        firstName: "Backfill",
        lastName: "Tester",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    testLeadId = lead.id;

    // 2. Create Team
    const team = await db.team.create({
      data: {
        name: `Backfill Team ${suffix}`,
        leadId: testLeadId,
      },
    });
    testTeamId = team.id;

    // 3. Create Project
    const project = await db.project.create({
      data: {
        name: `Backfill Test Project ${suffix}`,
        teamId: testTeamId,
        leadId: testLeadId,
      },
    });
    testProjectId = project.id;
  });

  after(async () => {
    // Clean up created fixture tasks
    if (createdTaskIds.length > 0) {
      await db.task.deleteMany({
        where: { id: { in: createdTaskIds } },
      });
    }

    // Clean up project, team, employee
    if (testProjectId) {
      await db.project.delete({ where: { id: testProjectId } }).catch(() => {});
    }
    if (testTeamId) {
      await db.team.delete({ where: { id: testTeamId } }).catch(() => {});
    }
    if (testLeadId) {
      await db.employee.delete({ where: { id: testLeadId } }).catch(() => {});
    }
  });

  it("1. maps all six legacy statuses to their exact baseline columns", async () => {
    const taskMap: Record<string, string> = {};

    for (const mapping of BASELINE_STATUS_MAPPINGS) {
      const taskId = await createUnbackfilledTask(
        `Task for ${mapping.status}`,
        mapping.status
      );
      taskMap[mapping.status] = taskId;
    }

    // Verify tasks start with columnId = null
    const beforeTasks = await db.task.findMany({
      where: { id: { in: Object.values(taskMap) } },
      select: { id: true, status: true, columnId: true } as any,
    });
    for (const t of beforeTasks) {
      assert.strictEqual(t.columnId, null, `Task ${t.id} should initially have columnId = null`);
    }

    // Run backfill
    const result = await backfillTaskColumns({
      batchSize: 10,
      pacingMs: 0,
      logger: () => {}, // silence output in automated tests
    });

    assert.ok(result.totalBackfilled >= 6, "Expected at least 6 tasks backfilled");

    // Verify exact columnId mapping for each of the six statuses
    for (const mapping of BASELINE_STATUS_MAPPINGS) {
      const taskId = taskMap[mapping.status];
      const task = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true, status: true, columnId: true } as any,
      });

      assert.ok(task, `Task ${taskId} should exist`);
      assert.strictEqual(
        task.columnId,
        mapping.colId,
        `Status ${mapping.status} should map to ${mapping.colId}, received ${task.columnId}`
      );
      assert.strictEqual(
        (task as any).status,
        mapping.status,
        `Status ${mapping.status} should remain unchanged`
      );
    }
  });

  it("2. processes tasks in configurable batches with independent commits", async () => {
    const batchTaskIds: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const id = await createUnbackfilledTask(`Batch Test Task ${i}`, "TODO");
      batchTaskIds.push(id);
    }

    // Process with batchSize = 2 (5 tasks -> 3 batches of sizes 2, 2, 1)
    const result = await backfillTaskColumns({
      batchSize: 2,
      pacingMs: 10,
      logger: () => {},
    });

    assert.ok(result.batchesExecuted >= 3, `Expected at least 3 batches, executed ${result.batchesExecuted}`);
    assert.strictEqual(result.finalRemaining, 0, "No tasks should remain with columnId = NULL");

    const tasks = await db.task.findMany({
      where: { id: { in: batchTaskIds } },
      select: { id: true, columnId: true },
    });
    for (const t of tasks) {
      assert.strictEqual(t.columnId, "col_todo", `Task ${t.id} should have columnId = col_todo`);
    }
  });

  it("3. guarantees idempotency: re-running on fully backfilled data changes zero rows", async () => {
    // All current tasks in DB are already backfilled
    const initialNullCount = await db.task.count({ where: { columnId: null } as any });
    assert.strictEqual(initialNullCount, 0, "Initial null count should be 0 before idempotent run");

    const result = await backfillTaskColumns({
      batchSize: 1000,
      pacingMs: 0,
      logger: () => {},
    });

    assert.strictEqual(result.initialRemaining, 0, "initialRemaining should be 0");
    assert.strictEqual(result.totalBackfilled, 0, "totalBackfilled should be 0 on re-run");
    assert.strictEqual(result.batchesExecuted, 0, "batchesExecuted should be 0 on re-run");
    assert.strictEqual(result.finalRemaining, 0, "finalRemaining should remain 0");
    assert.strictEqual(result.orphanedCount, 0, "orphanedCount should be 0");

    // All parity matches must be true
    for (const item of result.parityAudit) {
      assert.strictEqual(item.match, true, `Parity match for ${item.status} must be true`);
    }
  });

  it("4. supports safe resumption after simulated interruption", async () => {
    // Create 4 unbackfilled tasks
    const resumeTaskIds: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const id = await createUnbackfilledTask(`Resume Test Task ${i}`, "IN_PROGRESS");
      resumeTaskIds.push(id);
    }

    // Step 4a: Simulate partial batch 1 (process 2 rows independently)
    await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2000ms'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30000ms'");
        await tx.$executeRaw`
          WITH batch AS (
            SELECT id, status
            FROM "Task"
            WHERE "columnId" IS NULL
            ORDER BY id
            LIMIT 2
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "Task" t
          SET "columnId" = 'col_in_progress'
          FROM batch b
          WHERE t.id = b.id;
        `;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    // Verify exactly 2 tasks are now committed with columnId, and 2 remain null
    const afterBatch1 = await db.task.findMany({
      where: { id: { in: resumeTaskIds } },
      select: { id: true, columnId: true },
    });
    const backfilledCount = afterBatch1.filter((t) => t.columnId !== null).length;
    const remainingCount = afterBatch1.filter((t) => t.columnId === null).length;
    assert.strictEqual(backfilledCount, 2, "Batch 1 should have committed 2 tasks");
    assert.strictEqual(remainingCount, 2, "2 tasks should remain unbackfilled before resumption");

    // Step 4b: Resume backfill using backfillTaskColumns
    const resumeResult = await backfillTaskColumns({
      batchSize: 2,
      pacingMs: 0,
      logger: () => {},
    });

    assert.ok(resumeResult.totalBackfilled >= 2, "Resumption should backfill the remaining 2 tasks");
    assert.strictEqual(resumeResult.finalRemaining, 0, "Zero tasks should remain with columnId = null");

    // Verify all 4 tasks are now backfilled to col_in_progress
    const finalTasks = await db.task.findMany({
      where: { id: { in: resumeTaskIds } },
      select: { id: true, columnId: true },
    });
    for (const t of finalTasks) {
      assert.strictEqual(t.columnId, "col_in_progress", `Task ${t.id} must be backfilled to col_in_progress`);
    }
  });

  it("5. validates that unexpected or unmapped status values are rejected", async () => {
    // Verify that the pre-flight check query properly detects invalid status values
    // Using a raw SQL query that checks the pre-flight logic
    const testQuery = await db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count
      FROM "Task"
      WHERE "columnId" IS NULL
        AND status::text NOT IN ('BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'TESTING', 'DONE');
    `;
    assert.strictEqual(
      Number(testQuery[0]?.count ?? 0),
      0,
      "No unmapped statuses should exist in current valid dataset"
    );

    // Test that CASE statement produces trigger rejection if an unknown status is encountered
    // By testing the trigger abort behavior directly
    try {
      await db.$executeRawUnsafe(
        `INSERT INTO "Task" (id, title, "columnId", status, "projectId", "creatorId", "createdAt", "updatedAt")
         VALUES ('test_bad_col_${Date.now()}', 'Bad Col', 'invalid_unmapped_status', 'BACKLOG', '${testProjectId}', '${testLeadId}', NOW(), NOW())`
      );
      assert.fail("Trigger should have rejected invalid_unmapped_status columnId");
    } catch (err: any) {
      assert.ok(
        err.message?.includes("Trigger safety abort") || err.message?.includes("Invalid columnId"),
        `Expected trigger safety abort error, received: ${err.message}`
      );
    }
  });

  it("6. guarantees concurrent update safety: legacy writes are never overwritten with stale status", async () => {
    // Create an unbackfilled task originally in BACKLOG
    const taskId = await createUnbackfilledTask("Concurrent Safety Task", "BACKLOG");

    // Simulate concurrent legacy write BEFORE backfill batch locks it:
    // User updates task to REVIEW via legacy status update (trigger enabled)
    await db.$executeRawUnsafe(
      `UPDATE "Task" SET status = 'REVIEW'::"TaskStatus" WHERE id = '${taskId}'`
    );

    // The compatibility trigger automatically synchronized columnId to 'col_review'
    const afterConcurrentWrite = await db.task.findUnique({
      where: { id: taskId },
      select: { id: true, status: true, columnId: true } as any,
    });
    assert.strictEqual((afterConcurrentWrite as any)?.status, "REVIEW");
    assert.strictEqual(afterConcurrentWrite?.columnId, "col_review");

    // Now run backfill. Because columnId IS NOT NULL, backfill query (WHERE "columnId" IS NULL) skips it!
    await backfillTaskColumns({
      batchSize: 10,
      pacingMs: 0,
      logger: () => {},
    });

    // Verify task status and columnId were preserved and NOT overwritten with stale BACKLOG/col_backlog
    const finalTask = await db.task.findUnique({
      where: { id: taskId },
      select: { id: true, status: true, columnId: true } as any,
    });
    assert.strictEqual((finalTask as any)?.status, "REVIEW", "Status must remain REVIEW");
    assert.strictEqual(finalTask?.columnId, "col_review", "ColumnId must remain col_review");
  });

  it("7. post-backfill audit verifies zero nulls, zero orphaned FKs, and exact status count parity", async () => {
    // Run full audit
    const result = await backfillTaskColumns({
      batchSize: 1000,
      pacingMs: 0,
      logger: () => {},
    });

    assert.strictEqual(result.finalRemaining, 0, "Audit confirms 0 tasks with columnId = null");
    assert.strictEqual(result.orphanedCount, 0, "Audit confirms 0 orphaned columnId references");

    for (const item of result.parityAudit) {
      assert.strictEqual(
        item.match,
        true,
        `Status count parity failed for ${item.status}: statusCount=${item.statusCount}, colCount=${item.colCount}`
      );
    }
  });
});

