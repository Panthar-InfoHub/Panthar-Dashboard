import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../lib/db";
import {
  getBoardColumnsAction,
  createBoardColumnAction,
  renameBoardColumnAction,
  updateBoardColumnColorAction,
  reorderBoardColumnsAction,
  deleteBoardColumnAction,
} from "../../lib/actions/board-column.actions";
import {
  createTaskAction,
  createSubtaskAction,
  updateTaskAction,
  updateTaskStatusAction,
} from "../../lib/actions/task.actions";
import { runWithTestEmployee, type AuthEmployee } from "../../lib/auth";

describe("Board Columns Database & Actions Integration Tests", () => {
  const suffix = `b${Date.now().toString().slice(-4)}`;
  let adminEmployee: AuthEmployee;
  let regularEmployee: AuthEmployee;
  let testTeamId: string;
  let testProjectId: string;
  const createdTaskIds: string[] = [];
  const createdColumnIds: string[] = [];

  const withAdmin = <T>(fn: () => Promise<T>): Promise<T> => runWithTestEmployee(adminEmployee, fn);
  const withRegular = <T>(fn: () => Promise<T>): Promise<T> => runWithTestEmployee(regularEmployee, fn);
  const itAdmin = (name: string, fn: () => Promise<void>) => it(name, () => withAdmin(fn));

  before(async () => {
    // 0. Clean up any stray non-baseline columns from previous test runs
    await db.boardColumn.deleteMany({
      where: {
        id: {
          notIn: [
            "col_backlog",
            "col_todo",
            "col_in_progress",
            "col_review",
            "col_testing",
            "col_done",
          ],
        },
      },
    });

    // Restore baseline names and positions
    await db.boardColumn.updateMany({
      where: { id: "col_backlog" },
      data: { name: "Backlog", color: "#6b7280", position: 1000.0 },
    });
    await db.boardColumn.updateMany({
      where: { id: "col_todo" },
      data: { name: "Todo", color: "#3b82f6", position: 2000.0 },
    });
    await db.boardColumn.updateMany({
      where: { id: "col_in_progress" },
      data: { name: "In Progress", color: "#f59e0b", position: 3000.0 },
    });
    await db.boardColumn.updateMany({
      where: { id: "col_review" },
      data: { name: "Review", color: "#a855f7", position: 4000.0 },
    });
    await db.boardColumn.updateMany({
      where: { id: "col_testing" },
      data: { name: "Testing", color: "#f59e0b", position: 5000.0 },
    });
    await db.boardColumn.updateMany({
      where: { id: "col_done" },
      data: { name: "Done", color: "#10b981", position: 6000.0 },
    });

    // 1. Create Admin Employee
    const admin = await db.employee.create({
      data: {
        clerkId: `clerk_admin_${suffix}`,
        email: `admin_${suffix}@example.com`,
        firstName: "Admin",
        lastName: "Tester",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    adminEmployee = admin;

    // 2. Create Regular Employee (Non-Admin)
    const regular = await db.employee.create({
      data: {
        clerkId: `clerk_regular_${suffix}`,
        email: `regular_${suffix}@example.com`,
        firstName: "Regular",
        lastName: "Employee",
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
    });
    regularEmployee = regular;

    // 3. Create Team
    const team = await db.team.create({
      data: {
        name: `Team_${suffix}`,
        leadId: adminEmployee.id,
      },
    });
    testTeamId = team.id;

    // 4. Create Project
    const project = await db.project.create({
      data: {
        name: `Project_${suffix}`,
        teamId: testTeamId,
        leadId: adminEmployee.id,
      },
    });
    testProjectId = project.id;
  });

  after(async () => {
    // Clean up created tasks
    if (createdTaskIds.length > 0) {
      await db.task.deleteMany({
        where: { id: { in: createdTaskIds } },
      });
    }

    // Clean up created custom columns
    if (createdColumnIds.length > 0) {
      await db.boardColumn.deleteMany({
        where: { id: { in: createdColumnIds } },
      });
    }

    // Restore baseline names and positions if any were modified during tests
    await db.boardColumn.updateMany({
      where: { id: "col_backlog" },
      data: { name: "Backlog", color: "#6b7280", position: 1000.0 },
    });
    await db.boardColumn.updateMany({
      where: { id: "col_todo" },
      data: { name: "Todo", color: "#3b82f6", position: 2000.0 },
    });
    await db.boardColumn.updateMany({
      where: { id: "col_in_progress" },
      data: { name: "In Progress", color: "#f59e0b", position: 3000.0 },
    });
    await db.boardColumn.updateMany({
      where: { id: "col_review" },
      data: { name: "Review", color: "#a855f7", position: 4000.0 },
    });
    await db.boardColumn.updateMany({
      where: { id: "col_testing" },
      data: { name: "Testing", color: "#f59e0b", position: 5000.0 },
    });
    await db.boardColumn.updateMany({
      where: { id: "col_done" },
      data: { name: "Done", color: "#10b981", position: 6000.0 },
    });

    // Clean up project, team, employees
    if (testProjectId) {
      await db.project.delete({ where: { id: testProjectId } }).catch(() => {});
    }
    if (testTeamId) {
      await db.team.delete({ where: { id: testTeamId } }).catch(() => {});
    }
    if (adminEmployee) {
      await db.employee.delete({ where: { id: adminEmployee.id } }).catch(() => {});
    }
    if (regularEmployee) {
      await db.employee.delete({ where: { id: regularEmployee.id } }).catch(() => {});
    }
  });

  // ─── 1. Authorization Tests ───
  describe("1. Board Column Authorization Guards", () => {
    it("rejects non-admin from creating columns", async () => {
      await assert.rejects(
        () => withRegular(() => createBoardColumnAction("QA Column", "#a855f7")),
        {
          name: "Error",
          message: /FORBIDDEN: Only administrators can manage board columns/,
        }
      );
    });

    it("rejects non-admin from renaming columns", async () => {
      await assert.rejects(
        () => withRegular(() => renameBoardColumnAction("col_todo", "New Todo Name")),
        {
          name: "Error",
          message: /FORBIDDEN: Only administrators can manage board columns/,
        }
      );
    });

    it("rejects non-admin from recoloring columns", async () => {
      await assert.rejects(
        () => withRegular(() => updateBoardColumnColorAction("col_todo", "#ff0000")),
        {
          name: "Error",
          message: /FORBIDDEN: Only administrators can manage board columns/,
        }
      );
    });

    it("rejects non-admin from reordering columns", async () => {
      await assert.rejects(
        () => withRegular(() => reorderBoardColumnsAction(["col_todo", "col_in_progress"])),
        {
          name: "Error",
          message: /FORBIDDEN: Only administrators can manage board columns/,
        }
      );
    });

    it("rejects non-admin from deleting columns", async () => {
      await assert.rejects(
        () => withRegular(() => deleteBoardColumnAction("col_todo")),
        {
          name: "Error",
          message: /FORBIDDEN: Only administrators can manage board columns/,
        }
      );
    });

    it("rejects unauthenticated requests when no session/caller is present", async () => {
      await assert.rejects(
        () => createBoardColumnAction("QA Column", "#a855f7"),
        {
          name: "Error",
          message: /Unauthorized/,
        }
      );
    });

    it("rejects client attempts to spoof admin identity via extra argument injection", async () => {
      // Attempting to pass a spoofed admin identity as an extra argument to the server action
      await assert.rejects(
        () => (createBoardColumnAction as unknown as (...args: unknown[]) => Promise<unknown>)("Hacked Column", "#a855f7", { id: "fake_id", role: "ADMIN" }),
        {
          name: "Error",
          message: /Unauthorized/,
        }
      );
    });

    it("allows admin to perform queries", async () => {
      const columns = await withAdmin(() => getBoardColumnsAction());
      assert.ok(Array.isArray(columns));
      assert.ok(columns.length >= 6);
    });
  });

  // ─── 2. Column Management Tests ───
  describe("2. Board Column Management Operations", () => {
    it("confirms six baseline columns exist with correct positions", async () => {
      const columns = await db.boardColumn.findMany({
        orderBy: { position: "asc" },
      });
      assert.ok(columns.length >= 6);

      const backlog = columns.find((c) => c.systemKey === "BACKLOG");
      const done = columns.find((c) => c.systemKey === "DONE");
      assert.ok(backlog);
      assert.ok(done);
      assert.strictEqual(backlog.id, "col_backlog");
      assert.strictEqual(backlog.position, 1000.0);
      assert.strictEqual(done.id, "col_done");
    });

    itAdmin("rejects reserved names 'Backlog' and 'Done' (case-insensitive)", async () => {
      await assert.rejects(
        async () => {
          await createBoardColumnAction("Backlog", "#3b82f6");
        },
        { message: /RESERVED_NAME/ }
      );

      await assert.rejects(
        async () => {
          await createBoardColumnAction("  DONE  ", "#10b981");
        },
        { message: /RESERVED_NAME/ }
      );
    });

    itAdmin("creates custom column before Done and advances Done position", async () => {
      const initialDone = await db.boardColumn.findUniqueOrThrow({
        where: { systemKey: "DONE" },
      });
      const manageableCountBefore = await db.boardColumn.count({
        where: { systemKey: null },
      });

      const res = await createBoardColumnAction(`QA Review ${suffix}`, "#a855f7");
      assert.strictEqual(res.success, true);
      assert.ok(res.column.id);
      createdColumnIds.push(res.column.id);

      // Verify position algorithm: (M_old + 2) * 1000.0
      const expectedNewPosition = (manageableCountBefore + 2) * 1000.0;
      assert.strictEqual(res.column.position, expectedNewPosition);
      assert.strictEqual(res.column.systemKey, null);

      // Verify Done position was advanced to (M_old + 3) * 1000.0
      const updatedDone = await db.boardColumn.findUniqueOrThrow({
        where: { systemKey: "DONE" },
      });
      assert.strictEqual(updatedDone.position, (manageableCountBefore + 3) * 1000.0);
      assert.ok(updatedDone.position > initialDone.position);
    });

    itAdmin("renames and recolors custom column", async () => {
      const customColId = createdColumnIds[0];
      assert.ok(customColId);

      const renamedRes = await renameBoardColumnAction(customColId, `Staging QA ${suffix}`);
      assert.strictEqual(renamedRes.success, true);
      assert.strictEqual(renamedRes.column.name, `Staging QA ${suffix}`);

      const recoloredRes = await updateBoardColumnColorAction(customColId, "#6366f1");
      assert.strictEqual(recoloredRes.success, true);
      assert.strictEqual(recoloredRes.column.color, "#6366f1");
    });

    itAdmin("allows renaming and recoloring system columns while preserving systemKey", async () => {
      const renamedBacklog = await renameBoardColumnAction("col_backlog", "Product Backlog");
      assert.strictEqual(renamedBacklog.success, true);
      assert.strictEqual(renamedBacklog.column.name, "Product Backlog");
      assert.strictEqual(renamedBacklog.column.systemKey, "BACKLOG");

      const recoloredDone = await updateBoardColumnColorAction("col_done", "#059669");
      assert.strictEqual(recoloredDone.success, true);
      assert.strictEqual(recoloredDone.column.color, "#059669");
      assert.strictEqual(recoloredDone.column.systemKey, "DONE");
    });

    itAdmin("rejects duplicate column name (case-insensitive)", async () => {
      await assert.rejects(
        async () => {
          await createBoardColumnAction("todo", "#3b82f6");
        },
        { message: /DUPLICATE_NAME/ }
      );
    });

    itAdmin("enforces maximum 10 user-manageable columns limit", async () => {
      const currentManageable = await db.boardColumn.count({
        where: { systemKey: null },
      });

      // Fill up to 10 manageable columns
      const tempIds: string[] = [];
      for (let i = currentManageable; i < 10; i++) {
        const res = await createBoardColumnAction(`Temp Col ${i} ${suffix}`, "#3b82f6");
        tempIds.push(res.column.id);
        createdColumnIds.push(res.column.id);
      }

      const totalManageable = await db.boardColumn.count({
        where: { systemKey: null },
      });
      assert.strictEqual(totalManageable, 10);

      // 11th creation attempt must throw MAX_LIMIT_REACHED
      await assert.rejects(
        async () => {
          await createBoardColumnAction(`Overflow Col ${suffix}`, "#f43f5e");
        },
        { message: /MAX_LIMIT_REACHED: Maximum limit of 10 user-manageable columns reached/ }
      );

      // Clean up the temporary columns created to test quota
      for (const id of tempIds) {
        const exists = await db.boardColumn.findUnique({ where: { id } });
        if (exists) {
          await deleteBoardColumnAction(id);
        }
        const idx = createdColumnIds.indexOf(id);
        if (idx !== -1) createdColumnIds.splice(idx, 1);
      }
    });

    itAdmin("reorders manageable columns with valid complete ID sets", async () => {
      const manageableCols = await db.boardColumn.findMany({
        where: { systemKey: null },
        orderBy: { position: "asc" },
      });
      assert.ok(manageableCols.length >= 2);

      // Reverse the order of manageable columns
      const reversedIds = manageableCols.map((c) => c.id).reverse();
      const reorderRes = await reorderBoardColumnsAction(reversedIds);
      assert.strictEqual(reorderRes.success, true);

      // Verify Backlog is at 1000.0, Done is at (M + 2) * 1000.0
      const backlog = await db.boardColumn.findUniqueOrThrow({ where: { systemKey: "BACKLOG" } });
      const done = await db.boardColumn.findUniqueOrThrow({ where: { systemKey: "DONE" } });
      const M = reversedIds.length;

      assert.strictEqual(backlog.position, 1000.0);
      assert.strictEqual(done.position, (M + 2) * 1000.0);

      // Verify each manageable column position matches (i + 2) * 1000.0
      for (let i = 0; i < reversedIds.length; i++) {
        const col = await db.boardColumn.findUniqueOrThrow({ where: { id: reversedIds[i] } });
        assert.strictEqual(col.position, (i + 2) * 1000.0);
      }
    });

    itAdmin("rejects invalid, incomplete, duplicate, or protected IDs in reorder payload", async () => {
      const manageableCols = await db.boardColumn.findMany({
        where: { systemKey: null },
      });
      const validIds = manageableCols.map((c) => c.id);

      // Incomplete list
      await assert.rejects(
        async () => {
          await reorderBoardColumnsAction(validIds.slice(0, 1));
        },
        { message: /VALIDATION_ERROR: Reorder list count/ }
      );

      // Duplicate list
      await assert.rejects(
        async () => {
          await reorderBoardColumnsAction([validIds[0], validIds[0]]);
        },
        { message: /Duplicate column ID detected in reorder list/ }
      );

      // Protected system ID included
      const withProtected = [...validIds.slice(0, -1), "col_done"];
      await assert.rejects(
        async () => {
          await reorderBoardColumnsAction(withProtected);
        },
        { message: /VALIDATION_ERROR: Invalid or protected column ID/ }
      );

      // Unknown ID included
      const withUnknown = [...validIds.slice(0, -1), "col_nonexistent_999"];
      await assert.rejects(
        async () => {
          await reorderBoardColumnsAction(withUnknown);
        },
        { message: /VALIDATION_ERROR: Invalid or protected column ID/ }
      );
    });

    itAdmin("rejects deletion of protected system columns (Backlog and Done)", async () => {
      await assert.rejects(
        async () => {
          await deleteBoardColumnAction("col_backlog");
        },
        { message: /FORBIDDEN: Cannot delete system columns/ }
      );

      await assert.rejects(
        async () => {
          await deleteBoardColumnAction("col_done");
        },
        { message: /FORBIDDEN: Cannot delete system columns/ }
      );
    });

    itAdmin("rejects deletion when tasks or subtasks remain in the column", async () => {
      // Create a fresh custom column for this test
      const colRes = await createBoardColumnAction(`Test Delete Col ${suffix}`, "#3b82f6");
      createdColumnIds.push(colRes.column.id);

      // Create a task inside this column
      const taskRes = await createTaskAction({
        title: "Blocking Task",
        projectId: testProjectId,
        priority: "MEDIUM",
        columnId: colRes.column.id,
      });
      createdTaskIds.push(taskRes.taskId);

      // Attempt deletion -> must be refused with CANNOT_DELETE_NON_EMPTY_COLUMN
      await assert.rejects(
        async () => {
          await deleteBoardColumnAction(colRes.column.id);
        },
        { message: /CANNOT_DELETE_NON_EMPTY_COLUMN: Cannot delete column containing 1 task/ }
      );

      // Delete the task, then deletion of the empty column must succeed
      await db.task.delete({ where: { id: taskRes.taskId } });
      const delRes = await deleteBoardColumnAction(colRes.column.id);
      assert.strictEqual(delRes.success, true);
    });

    itAdmin("normalizes remaining column positions after deletion", async () => {
      // Clean up any custom columns created earlier in this test suite
      for (const id of [...createdColumnIds]) {
        const exists = await db.boardColumn.findUnique({ where: { id } });
        if (exists) {
          await deleteBoardColumnAction(id);
        }
      }
      createdColumnIds.length = 0;

      // Ensure no stray custom columns remain from other tests
      const remainingCustom = await db.boardColumn.findMany({
        where: {
          id: {
            notIn: [
              "col_backlog",
              "col_todo",
              "col_in_progress",
              "col_review",
              "col_testing",
              "col_done",
            ],
          },
        },
      });
      for (const col of remainingCustom) {
        const exists = await db.boardColumn.findUnique({ where: { id: col.id } });
        if (exists) {
          await deleteBoardColumnAction(col.id);
        }
      }

      // Now exactly the 4 baseline manageable columns remain: Todo, In Progress, Review, Testing
      const manageableCols = await db.boardColumn.findMany({
        where: { systemKey: null },
        orderBy: { position: "asc" },
      });
      assert.strictEqual(manageableCols.length, 4);

      // Check normalized positions: 2000, 3000, 4000, 5000, Done at 6000
      for (let i = 0; i < manageableCols.length; i++) {
        assert.strictEqual(manageableCols[i].position, (i + 2) * 1000.0);
      }
      const done = await db.boardColumn.findUniqueOrThrow({ where: { systemKey: "DONE" } });
      assert.strictEqual(done.position, 6000.0);
    });
  });

  // ─── 3. Task Workflow Tests ───
  describe("3. Task Creation, Update, and Completion Workflow", () => {
    itAdmin("task creation defaults to Backlog when columnId is omitted", async () => {
      const res = await createTaskAction({
        title: `Task Default Backlog ${suffix}`,
        projectId: testProjectId,
        priority: "LOW",
      });
      assert.ok(res.taskId);
      createdTaskIds.push(res.taskId);

      const task = await db.task.findUniqueOrThrow({
        where: { id: res.taskId },
        include: { column: true },
      });

      assert.strictEqual(task.columnId, "col_backlog");
      assert.strictEqual(task.column?.systemKey, "BACKLOG");
      assert.strictEqual(task.completedAt, null);
    });

    itAdmin("explicit valid column selection assigns selected column", async () => {
      const res = await createTaskAction({
        title: `Task Explicit Col ${suffix}`,
        projectId: testProjectId,
        priority: "HIGH",
        columnId: "col_in_progress",
      });
      assert.ok(res.taskId);
      createdTaskIds.push(res.taskId);

      const task = await db.task.findUniqueOrThrow({
        where: { id: res.taskId },
        include: { column: true },
      });

      assert.strictEqual(task.columnId, "col_in_progress");
    });

    itAdmin("rejects invalid or non-existent columnId during creation", async () => {
      await assert.rejects(
        async () => {
          await createTaskAction({
            title: "Invalid Col Task",
            projectId: testProjectId,
            priority: "MEDIUM",
            columnId: "non_existent_col_id_999",
          });
        },
        { message: /Invalid board column: non_existent_col_id_999/ }
      );
    });

    itAdmin("subtask inherits parent columnId when omitted", async () => {
      const parentRes = await createTaskAction({
        title: `Parent Task ${suffix}`,
        projectId: testProjectId,
        priority: "HIGH",
        columnId: "col_review",
      });
      createdTaskIds.push(parentRes.taskId);

      const subtaskRes = await createSubtaskAction(parentRes.taskId, {
        title: `Subtask Inherited ${suffix}`,
        priority: "MEDIUM",
      });
      assert.ok(subtaskRes.subtask.id);
      createdTaskIds.push(subtaskRes.subtask.id);

      assert.strictEqual(subtaskRes.subtask.columnId, "col_review");
      assert.strictEqual(subtaskRes.subtask.parentId, parentRes.taskId);
    });

    itAdmin("unrelated task edits preserve existing columnId", async () => {
      const taskRes = await createTaskAction({
        title: `Task to Edit ${suffix}`,
        projectId: testProjectId,
        priority: "LOW",
        columnId: "col_testing",
      });
      createdTaskIds.push(taskRes.taskId);

      // Perform unrelated edit (title, priority, description)
      const updateRes = await updateTaskAction(taskRes.taskId, {
        title: `Task Edited Title ${suffix}`,
        projectId: testProjectId,
        priority: "CRITICAL",
        description: "Updated description text",
      });
      assert.strictEqual(updateRes.success, true);

      const updated = await db.task.findUniqueOrThrow({
        where: { id: taskRes.taskId },
      });
      assert.strictEqual(updated.title, `Task Edited Title ${suffix}`);
      assert.strictEqual(updated.priority, "CRITICAL");
      assert.strictEqual(updated.columnId, "col_testing");
    });

    itAdmin("entering Done sets completedAt and auto-unblocks dependent tasks", async () => {
      // 1. Create Blocker Task in Todo
      const blockerRes = await createTaskAction({
        title: `Blocker Task ${suffix}`,
        projectId: testProjectId,
        priority: "HIGH",
        columnId: "col_todo",
      });
      createdTaskIds.push(blockerRes.taskId);

      // 2. Create Dependent Task blocked by Blocker Task
      const dependentRes = await createTaskAction({
        title: `Dependent Task ${suffix}`,
        projectId: testProjectId,
        priority: "MEDIUM",
        columnId: "col_todo",
      });
      createdTaskIds.push(dependentRes.taskId);

      await db.task.update({
        where: { id: dependentRes.taskId },
        data: { blockedById: blockerRes.taskId },
      });

      // Verify initial blocker state
      const initialDep = await db.task.findUniqueOrThrow({ where: { id: dependentRes.taskId } });
      assert.strictEqual(initialDep.blockedById, blockerRes.taskId);

      // 3. Move Blocker Task to Done
      const doneRes = await updateTaskStatusAction(blockerRes.taskId, "col_done");
      assert.strictEqual(doneRes.success, true);
      assert.strictEqual(doneRes.task.columnId, "col_done");
      assert.ok(doneRes.task.completedAt instanceof Date);

      // 4. Verify dependent task was auto-unblocked
      const unblockedDep = await db.task.findUniqueOrThrow({ where: { id: dependentRes.taskId } });
      assert.strictEqual(unblockedDep.blockedById, null);
    });

    itAdmin("leaving Done clears completedAt, completionNote, and prLink", async () => {
      // Create task in Done with completion metadata
      const taskRes = await createTaskAction({
        title: `Task Leaving Done ${suffix}`,
        projectId: testProjectId,
        priority: "MEDIUM",
        columnId: "col_done",
      });
      createdTaskIds.push(taskRes.taskId);

      await db.task.update({
        where: { id: taskRes.taskId },
        data: {
          completionNote: "Completed successfully",
          prLink: "https://github.com/Panthar-InfoHub/Panthar-Dashboard/pull/42",
        },
      });

      const initialDone = await db.task.findUniqueOrThrow({ where: { id: taskRes.taskId } });
      assert.ok(initialDone.completedAt);
      assert.strictEqual(initialDone.completionNote, "Completed successfully");
      assert.strictEqual(initialDone.prLink, "https://github.com/Panthar-InfoHub/Panthar-Dashboard/pull/42");

      // Move task out of Done to Review
      const moveRes = await updateTaskStatusAction(taskRes.taskId, "col_review");
      assert.strictEqual(moveRes.success, true);
      assert.strictEqual(moveRes.task.columnId, "col_review");
      assert.strictEqual(moveRes.task.completedAt, null);
      assert.strictEqual(moveRes.task.completionNote, null);
      assert.strictEqual(moveRes.task.prLink, null);
    });

    itAdmin("unrelated edits while remaining in Done strictly preserve completion metadata", async () => {
      // Create task in Done
      const taskRes = await createTaskAction({
        title: `Task Staying in Done ${suffix}`,
        projectId: testProjectId,
        priority: "HIGH",
        columnId: "col_done",
      });
      createdTaskIds.push(taskRes.taskId);

      const fixedDate = new Date("2026-11-20T10:00:00Z");
      await db.task.update({
        where: { id: taskRes.taskId },
        data: {
          completedAt: fixedDate,
          completionNote: "Original Note",
          prLink: "https://github.com/pull/1",
        },
      });

      // 1. Unrelated update via updateTaskAction
      await updateTaskAction(taskRes.taskId, {
        title: `Task Staying in Done Renamed ${suffix}`,
        projectId: testProjectId,
        priority: "CRITICAL",
      });

      let task = await db.task.findUniqueOrThrow({ where: { id: taskRes.taskId } });
      assert.strictEqual(task.title, `Task Staying in Done Renamed ${suffix}`);
      assert.strictEqual(task.completedAt?.toISOString(), fixedDate.toISOString());
      assert.strictEqual(task.completionNote, "Original Note");
      assert.strictEqual(task.prLink, "https://github.com/pull/1");

      // 2. Re-applying Done column status (staying in Done) preserves completion fields
      await updateTaskStatusAction(taskRes.taskId, "col_done", 1500);

      task = await db.task.findUniqueOrThrow({ where: { id: taskRes.taskId } });
      assert.strictEqual(task.order, 1500);
      assert.strictEqual(task.completedAt?.toISOString(), fixedDate.toISOString());
      assert.strictEqual(task.completionNote, "Original Note");
      assert.strictEqual(task.prLink, "https://github.com/pull/1");
    });
  });
});

