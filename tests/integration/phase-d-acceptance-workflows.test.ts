/**
 * Phase D: Final Feature Acceptance Test Suite
 * Automated End-to-End Verification of all 16 user-facing acceptance workflows.
 */

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
  updateTaskAction,
  updateTaskStatusAction,
  createSubtaskAction,
} from "../../lib/actions/task.actions";
import {
  createChecklistItemAction,
  toggleChecklistItemAction,
  deleteChecklistItemAction,
} from "../../lib/actions/checklist.actions";
import {
  createAttachmentUploadAction,
} from "../../lib/actions/attachment.actions";
import { runWithTestEmployee, type AuthEmployee } from "../../lib/auth";

describe("Phase D: 16 User-Facing Acceptance Workflows", () => {
  const suffix = `d${Date.now().toString().slice(-4)}`;
  let adminEmployee: AuthEmployee;
  let regularEmployee: AuthEmployee;
  let testTeamId: string;
  let testProjectId: string;
  const createdTaskIds: string[] = [];
  let customColId: string | null = null;

  const withAdmin = <T>(fn: () => Promise<T>): Promise<T> => runWithTestEmployee(adminEmployee, fn);
  const withRegular = <T>(fn: () => Promise<T>): Promise<T> => runWithTestEmployee(regularEmployee, fn);

  before(async () => {
    // 0. Clean up stray columns
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

    // Restore baseline Done column
    await db.boardColumn.updateMany({
      where: { id: "col_done" },
      data: { name: "Done" },
    });

    // 1. Setup Admin Employee
    adminEmployee = await db.employee.create({
      data: {
        clerkId: `clerk_admin_${suffix}`,
        email: `admin_${suffix}@example.com`,
        firstName: "Admin",
        lastName: "Acceptance",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });

    // 2. Setup Regular Employee
    regularEmployee = await db.employee.create({
      data: {
        clerkId: `clerk_regular_${suffix}`,
        email: `regular_${suffix}@example.com`,
        firstName: "Regular",
        lastName: "Acceptance",
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
    });

    // 3. Setup Team
    const team = await db.team.create({
      data: {
        name: `Team_${suffix}`,
        leadId: adminEmployee.id,
      },
    });
    testTeamId = team.id;

    // 4. Setup Project
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
    // Clean up tasks
    if (createdTaskIds.length > 0) {
      await db.task.deleteMany({
        where: { id: { in: createdTaskIds } },
      });
    }

    // Clean up custom column
    if (customColId) {
      try {
        await withAdmin(() => deleteBoardColumnAction(customColId!));
      } catch {
        // Ignored
      }
    }

    // Restore baseline Done column name
    await db.boardColumn.updateMany({
      where: { id: "col_done" },
      data: { name: "Done" },
    });

    // Clean up test team, project, employees
    try {
      await db.project.deleteMany({ where: { id: testProjectId } });
      await db.team.deleteMany({ where: { id: testTeamId } });
      await db.employee.deleteMany({ where: { id: { in: [adminEmployee.id, regularEmployee.id] } } });
    } catch {
      // Ignored
    }
  });

  it("1. Admin opens Settings -> Board Columns", async () => {
    const columns = await withAdmin(() => getBoardColumnsAction());
    assert.ok(Array.isArray(columns));
    assert.ok(columns.length >= 6);
    const colBacklog = columns.find((c) => c.systemKey === "BACKLOG");
    const colDone = columns.find((c) => c.systemKey === "DONE");
    assert.ok(colBacklog);
    assert.ok(colDone);
    assert.strictEqual(colBacklog.id, "col_backlog");
    assert.strictEqual(colDone.id, "col_done");
  });

  it("2. Admin creates a custom column", async () => {
    const res = await withAdmin(() =>
      createBoardColumnAction(`QA Verification ${suffix}`, "#8b5cf6")
    );
    assert.strictEqual(res.success, true);
    assert.ok(res.column.id);
    assert.strictEqual(res.column.name, `QA Verification ${suffix}`);
    assert.strictEqual(res.column.color, "#8b5cf6");
    assert.strictEqual(res.column.systemKey, null);
    customColId = res.column.id;
  });

  it("3. Admin changes its name and color", async () => {
    assert.ok(customColId);
    const renameRes = await withAdmin(() =>
      renameBoardColumnAction(customColId!, `Staging QA ${suffix}`)
    );
    assert.strictEqual(renameRes.success, true);
    assert.strictEqual(renameRes.column.name, `Staging QA ${suffix}`);

    const recolorRes = await withAdmin(() =>
      updateBoardColumnColorAction(customColId!, "#ec4899")
    );
    assert.strictEqual(recolorRes.success, true);
    assert.strictEqual(recolorRes.column.color, "#ec4899");
  });

  it("4. Admin reorders it", async () => {
    assert.ok(customColId);
    const columns = await withAdmin(() => getBoardColumnsAction());
    const manageableCols = columns.filter((c) => c.systemKey === null);
    const otherManageable = manageableCols.filter((c) => c.id !== customColId);
    const newOrderIds = [customColId!, ...otherManageable.map((c) => c.id)];

    const reorderRes = await withAdmin(() => reorderBoardColumnsAction(newOrderIds));
    assert.strictEqual(reorderRes.success, true);

    const reorderedCols = await withAdmin(() => getBoardColumnsAction());
    const customInReordered = reorderedCols.find((c) => c.id === customColId);
    assert.strictEqual(customInReordered?.position, 2000.0);
  });

  it("5. Admin moves tasks between columns", async () => {
    assert.ok(customColId);
    const taskRes = await withAdmin(() =>
      createTaskAction({
        title: `Acceptance Task 1 ${suffix}`,
        projectId: testProjectId,
        priority: "MEDIUM",
        columnId: "col_backlog",
      })
    );
    createdTaskIds.push(taskRes.taskId);

    const moveRes = await withAdmin(() =>
      updateTaskStatusAction(taskRes.taskId, customColId!)
    );
    assert.strictEqual(moveRes.success, true);
    assert.strictEqual(moveRes.task.columnId, customColId);
  });

  it("6. Board reload preserves the new column and task positions", async () => {
    assert.ok(customColId);
    const columns = await withAdmin(() => getBoardColumnsAction());
    const foundCustom = columns.find((c) => c.id === customColId);
    assert.ok(foundCustom);
    assert.strictEqual(foundCustom.name, `Staging QA ${suffix}`);

    const task = await db.task.findUniqueOrThrow({ where: { id: createdTaskIds[0] } });
    assert.strictEqual(task.columnId, customColId);
  });

  it("7. Admin cannot delete a non-empty custom column", async () => {
    assert.ok(customColId);
    await assert.rejects(
      async () => {
        await withAdmin(() => deleteBoardColumnAction(customColId!));
      },
      { message: /CANNOT_DELETE_NON_EMPTY_COLUMN/ }
    );
  });

  it("8. Admin can delete an empty custom column", async () => {
    assert.ok(customColId);
    // Move task out of custom column
    const moveRes = await withAdmin(() =>
      updateTaskStatusAction(createdTaskIds[0], "col_todo")
    );
    assert.strictEqual(moveRes.success, true);

    // Delete empty column
    const deleteRes = await withAdmin(() => deleteBoardColumnAction(customColId!));
    assert.strictEqual(deleteRes.success, true);

    const columns = await withAdmin(() => getBoardColumnsAction());
    assert.ok(!columns.some((c) => c.id === customColId));
    customColId = null;
  });

  it("9. Backlog and Done remain protected", async () => {
    await assert.rejects(
      async () => {
        await withAdmin(() => deleteBoardColumnAction("col_backlog"));
      },
      { message: /Cannot delete system columns/ }
    );

    await assert.rejects(
      async () => {
        await withAdmin(() => deleteBoardColumnAction("col_done"));
      },
      { message: /Cannot delete system columns/ }
    );
  });

  it("10. Renaming Done does not break completion behavior", async () => {
    const renameRes = await withAdmin(() =>
      renameBoardColumnAction("col_done", `Shipped ${suffix}`)
    );
    assert.strictEqual(renameRes.success, true);
    assert.strictEqual(renameRes.column.name, `Shipped ${suffix}`);
    assert.strictEqual(renameRes.column.systemKey, "DONE");
  });

  it("11. Moving a task into Done sets completion metadata", async () => {
    const moveRes = await withAdmin(() =>
      updateTaskStatusAction(createdTaskIds[0], "col_done")
    );
    assert.strictEqual(moveRes.success, true);
    assert.strictEqual(moveRes.task.columnId, "col_done");
    assert.ok(moveRes.task.completedAt instanceof Date);

    await db.task.update({
      where: { id: createdTaskIds[0] },
      data: {
        completionNote: "Finished all acceptance criteria",
        prLink: "https://github.com/Panthar-InfoHub/Panthar-Dashboard/pull/42",
      },
    });
  });

  it("12. Moving a completed task out of Done clears completion metadata", async () => {
    const moveRes = await withAdmin(() =>
      updateTaskStatusAction(createdTaskIds[0], "col_in_progress")
    );
    assert.strictEqual(moveRes.success, true);
    assert.strictEqual(moveRes.task.columnId, "col_in_progress");
    assert.strictEqual(moveRes.task.completedAt, null);
    assert.strictEqual(moveRes.task.completionNote, null);
    assert.strictEqual(moveRes.task.prLink, null);
  });

  it("13. Unrelated edits while remaining Done preserve completion metadata", async () => {
    // Move to Done
    await withAdmin(() => updateTaskStatusAction(createdTaskIds[0], "col_done"));
    await db.task.update({
      where: { id: createdTaskIds[0] },
      data: {
        completionNote: "Permanent Note",
        prLink: "https://github.com/Panthar-InfoHub/Panthar-Dashboard/pull/42",
      },
    });
    const beforeEdit = await db.task.findUniqueOrThrow({ where: { id: createdTaskIds[0] } });
    assert.ok(beforeEdit.completedAt);

    // Edit title
    const editRes = await withAdmin(() =>
      updateTaskAction(createdTaskIds[0], {
        title: `Updated Title in Done ${suffix}`,
        projectId: testProjectId,
        priority: "MEDIUM",
      })
    );
    assert.strictEqual(editRes.success, true);

    const afterEdit = await db.task.findUniqueOrThrow({ where: { id: createdTaskIds[0] } });
    assert.strictEqual(afterEdit.title, `Updated Title in Done ${suffix}`);
    assert.strictEqual(afterEdit.completionNote, "Permanent Note");
    assert.strictEqual(afterEdit.prLink, "https://github.com/Panthar-InfoHub/Panthar-Dashboard/pull/42");
    assert.strictEqual(afterEdit.completedAt?.toISOString(), beforeEdit.completedAt?.toISOString());
  });

  it("14. Subtasks inherit the intended parent column", async () => {
    const parentRes = await withAdmin(() =>
      createTaskAction({
        title: `Parent Task ${suffix}`,
        projectId: testProjectId,
        priority: "HIGH",
        columnId: "col_review",
      })
    );
    createdTaskIds.push(parentRes.taskId);

    const subtaskRes = await withAdmin(() =>
      createSubtaskAction(parentRes.taskId, {
        title: `Subtask ${suffix}`,
        priority: "LOW",
      })
    );
    assert.strictEqual(subtaskRes.success, true);
    createdTaskIds.push(subtaskRes.subtask.id);
    assert.strictEqual(subtaskRes.subtask.columnId, "col_review");
  });

  it("15. Non-admin users cannot manage columns", async () => {
    await assert.rejects(
      async () => {
        await withRegular(() =>
          createBoardColumnAction(`Hacker Col ${suffix}`, "#ff0000")
        );
      },
      { message: /Only administrators can manage/ }
    );

    await assert.rejects(
      async () => {
        await withRegular(() => deleteBoardColumnAction("col_todo"));
      },
      { message: /Only administrators can manage/ }
    );
  });

  it("16. Ticket 1 checklist and Ticket 2 attachments continue working", async () => {
    // Ticket 1: Checklist CRUD
    const checklistRes = await withAdmin(() =>
      createChecklistItemAction({
        taskId: createdTaskIds[0],
        title: `Acceptance checklist item ${suffix}`,
      })
    );
    assert.strictEqual(checklistRes.success, true);
    assert.ok(checklistRes.item.id);
    assert.strictEqual(checklistRes.item.isCompleted, false);

    const toggled = await withAdmin(() =>
      toggleChecklistItemAction({
        itemId: checklistRes.item.id,
        isCompleted: true,
      })
    );
    assert.strictEqual(toggled.success, true);
    assert.strictEqual(toggled.item.isCompleted, true);

    const deleteRes = await withAdmin(() =>
      deleteChecklistItemAction({ itemId: checklistRes.item.id })
    );
    assert.strictEqual(deleteRes.success, true);

    // Ticket 2: Attachment Presigned URL
    const uploadUrlData = await withAdmin(() =>
      createAttachmentUploadAction(createdTaskIds[0], {
        fileName: "acceptance_report.pdf",
        size: 2048,
        contentType: "application/pdf",
      })
    );
    assert.ok(uploadUrlData.uploadUrl.includes("https://"));
    assert.ok(uploadUrlData.key.includes(createdTaskIds[0]));
  });
});
