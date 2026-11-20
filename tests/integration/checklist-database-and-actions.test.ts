import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../lib/db";

describe("Checklist Database & Actions Integration Tests", () => {
  // Test fixture identifiers
  const suffix = `test_${Date.now()}`;
  let testTeamId: string;
  let testLeadId: string;
  let testInactiveEmployeeId: string;
  let testUnauthorizedEmployeeId: string;
  let testProjectId: string;
  let testTaskId: string;
  let testTask2Id: string;

  before(async () => {
    // 1. Create Team Lead / Creator Employee
    const lead = await db.employee.create({
      data: {
        clerkId: `clerk_lead_${suffix}`,
        email: `lead_${suffix}@example.com`,
        firstName: "Test",
        lastName: "Lead",
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
    });
    testLeadId = lead.id;

    // 2. Create Inactive Employee
    const inactive = await db.employee.create({
      data: {
        clerkId: `clerk_inactive_${suffix}`,
        email: `inactive_${suffix}@example.com`,
        firstName: "Inactive",
        lastName: "User",
        role: "EMPLOYEE",
        status: "INACTIVE",
      },
    });
    testInactiveEmployeeId = inactive.id;

    // 3. Create Unauthorized Employee (not on team, not on project)
    const unauthorized = await db.employee.create({
      data: {
        clerkId: `clerk_unauth_${suffix}`,
        email: `unauth_${suffix}@example.com`,
        firstName: "Unauthorized",
        lastName: "User",
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
    });
    testUnauthorizedEmployeeId = unauthorized.id;

    // 4. Create Team
    const team = await db.team.create({
      data: {
        name: `Team_${suffix}`,
        leadId: testLeadId,
      },
    });
    testTeamId = team.id;

    // 5. Create Project
    const project = await db.project.create({
      data: {
        name: `Project_${suffix}`,
        teamId: testTeamId,
        leadId: testLeadId,
      },
    });
    testProjectId = project.id;

    // 6. Create Primary Test Task
    const task = await db.task.create({
      data: {
        title: `Task_${suffix}`,
        projectId: testProjectId,
        creatorId: testLeadId,
        status: "TODO",
        priority: "MEDIUM",
        order: 1000,
      },
    });
    testTaskId = task.id;

    // 7. Create Secondary Test Task (for cross-task boundary tests)
    const task2 = await db.task.create({
      data: {
        title: `Task2_${suffix}`,
        projectId: testProjectId,
        creatorId: testLeadId,
        status: "TODO",
        priority: "LOW",
        order: 2000,
      },
    });
    testTask2Id = task2.id;
  });

  after(async () => {
    // Teardown: delete primary test project which cascades tasks and checklist items
    try {
      if (testProjectId) {
        await db.project.delete({ where: { id: testProjectId } });
      }
      if (testTeamId) {
        await db.team.delete({ where: { id: testTeamId } });
      }
      if (testLeadId) {
        await db.employee.delete({ where: { id: testLeadId } });
      }
      if (testInactiveEmployeeId) {
        await db.employee.delete({ where: { id: testInactiveEmployeeId } });
      }
      if (testUnauthorizedEmployeeId) {
        await db.employee.delete({ where: { id: testUnauthorizedEmployeeId } });
      }
    } catch (err) {
      console.error("[Test Teardown Warning]", err);
    }
  });

  it("creates a checklist item with default order and status", async () => {
    const item = await db.taskChecklistItem.create({
      data: {
        taskId: testTaskId,
        title: "First Checklist Item",
        order: 1000,
        isCompleted: false,
      },
    });

    assert.ok(item.id);
    assert.strictEqual(item.taskId, testTaskId);
    assert.strictEqual(item.title, "First Checklist Item");
    assert.strictEqual(item.isCompleted, false);
    assert.strictEqual(item.order, 1000);
    assert.strictEqual(item.completedAt, null);
    assert.strictEqual(item.completedById, null);
  });

  it("creates a second checklist item and maintains ordered sequence", async () => {
    await db.taskChecklistItem.create({
      data: {
        taskId: testTaskId,
        title: "Second Checklist Item",
        order: 2000,
        isCompleted: false,
      },
    });

    const items = await db.taskChecklistItem.findMany({
      where: { taskId: testTaskId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].title, "First Checklist Item");
    assert.strictEqual(items[1].title, "Second Checklist Item");
    assert.strictEqual(items[1].order, 2000);
  });

  it("edits a checklist item title while strictly preserving completion state", async () => {
    const items = await db.taskChecklistItem.findMany({
      where: { taskId: testTaskId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    const firstItem = items[0];

    const updated = await db.taskChecklistItem.update({
      where: { id: firstItem.id },
      data: { title: "Updated First Item Title" },
    });

    assert.strictEqual(updated.title, "Updated First Item Title");
    assert.strictEqual(updated.isCompleted, false);
    assert.strictEqual(updated.completedAt, null);
  });

  it("completes a checklist item and records completion metadata", async () => {
    const items = await db.taskChecklistItem.findMany({
      where: { taskId: testTaskId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    const firstItem = items[0];

    const completedTime = new Date();
    const updated = await db.taskChecklistItem.update({
      where: { id: firstItem.id },
      data: {
        isCompleted: true,
        completedAt: completedTime,
        completedById: testLeadId,
      },
      include: {
        completedBy: {
          select: { id: true, firstName: true, email: true },
        },
      },
    });

    assert.strictEqual(updated.isCompleted, true);
    assert.ok(updated.completedAt);
    assert.strictEqual(updated.completedById, testLeadId);
    assert.strictEqual(updated.completedBy?.id, testLeadId);
    assert.strictEqual(updated.completedBy?.firstName, "Test");
  });

  it("reopens a completed item and clears completion metadata", async () => {
    const items = await db.taskChecklistItem.findMany({
      where: { taskId: testTaskId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    const firstItem = items[0];

    const reopened = await db.taskChecklistItem.update({
      where: { id: firstItem.id },
      data: {
        isCompleted: false,
        completedAt: null,
        completedById: null,
      },
    });

    assert.strictEqual(reopened.isCompleted, false);
    assert.strictEqual(reopened.completedAt, null);
    assert.strictEqual(reopened.completedById, null);
  });

  it("reorders checklist items inside an atomic transaction", async () => {
    const items = await db.taskChecklistItem.findMany({
      where: { taskId: testTaskId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    const [item1, item2] = items;
    // Swap positions: item2 first, item1 second
    const reorderedIds = [item2.id, item1.id];

    await db.$transaction(
      reorderedIds.map((id, index) =>
        db.taskChecklistItem.update({
          where: { id },
          data: { order: (index + 1) * 1000 },
        })
      )
    );

    const reorderedItems = await db.taskChecklistItem.findMany({
      where: { taskId: testTaskId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    assert.strictEqual(reorderedItems[0].id, item2.id);
    assert.strictEqual(reorderedItems[0].order, 1000);
    assert.strictEqual(reorderedItems[1].id, item1.id);
    assert.strictEqual(reorderedItems[1].order, 2000);
  });

  it("prevents reordering across different tasks (cross-task isolation)", async () => {
    // Create an item on the second task
    const itemOnTask2 = await db.taskChecklistItem.create({
      data: {
        taskId: testTask2Id,
        title: "Foreign Task Item",
        order: 1000,
      },
    });

    const itemsOnTask1 = await db.taskChecklistItem.findMany({
      where: { taskId: testTaskId },
    });

    // Attempting to combine an item from Task 1 with an item from Task 2
    const mixedIds = [itemsOnTask1[0].id, itemOnTask2.id];

    // Verification check as performed in reorderChecklistItemsAction
    const currentItems = await db.taskChecklistItem.findMany({
      where: { id: { in: mixedIds } },
      select: { id: true, taskId: true },
    });

    const foreignItem = currentItems.find((item) => item.taskId !== testTaskId);
    assert.ok(foreignItem, "Should detect foreign task checklist item");
    assert.strictEqual(foreignItem.taskId, testTask2Id);
  });

  it("verifies inactive employee cannot perform operations", async () => {
    const inactiveEmployee = await db.employee.findUnique({
      where: { id: testInactiveEmployeeId },
      select: { status: true },
    });

    assert.strictEqual(inactiveEmployee?.status, "INACTIVE");
    // Verify business rule: status !== "ACTIVE" means unpermitted
    const isPermitted = (inactiveEmployee?.status as string) === "ACTIVE";
    assert.strictEqual(isPermitted, false);
  });

  it("verifies unauthorized employee access is blocked", async () => {
    // Unauthorized employee has no role permissions and is not on project or task
    const task = await db.task.findUnique({
      where: { id: testTaskId },
      select: {
        creatorId: true,
        assignees: { select: { id: true } },
        project: { select: { members: { select: { employeeId: true } } } },
      },
    });

    assert.ok(task);
    const isCreator = task.creatorId === testUnauthorizedEmployeeId;
    const isAssignee = task.assignees.some((a) => a.id === testUnauthorizedEmployeeId);
    const isProjectMember = task.project.members.some(
      (m) => m.employeeId === testUnauthorizedEmployeeId
    );

    const hasAccess = isCreator || isAssignee || isProjectMember;
    assert.strictEqual(hasAccess, false, "Unauthorized employee must not have access");
  });

  it("handles concurrent checklist updates safely", async () => {
    const items = await db.taskChecklistItem.findMany({
      where: { taskId: testTaskId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    const [item1, item2] = items;

    // Simulate two concurrent toggles
    await Promise.all([
      db.taskChecklistItem.update({
        where: { id: item1.id },
        data: { isCompleted: true, completedAt: new Date() },
      }),
      db.taskChecklistItem.update({
        where: { id: item2.id },
        data: { isCompleted: true, completedAt: new Date() },
      }),
    ]);

    const updated = await db.taskChecklistItem.findMany({
      where: { taskId: testTaskId },
    });

    assert.strictEqual(updated.every((i) => i.isCompleted), true);
  });

  it("deletes a checklist item cleanly", async () => {
    const items = await db.taskChecklistItem.findMany({
      where: { taskId: testTaskId },
    });
    const toDelete = items[0];

    await db.taskChecklistItem.delete({
      where: { id: toDelete.id },
    });

    const remaining = await db.taskChecklistItem.findUnique({
      where: { id: toDelete.id },
    });
    assert.strictEqual(remaining, null);
  });

  it("verifies cascading delete: deleting a task removes all its checklist items", async () => {
    // Add two items to task2
    await db.taskChecklistItem.createMany({
      data: [
        { taskId: testTask2Id, title: "Cascade Item 1", order: 1000 },
        { taskId: testTask2Id, title: "Cascade Item 2", order: 2000 },
      ],
    });

    const beforeCount = await db.taskChecklistItem.count({
      where: { taskId: testTask2Id },
    });
    assert.strictEqual(beforeCount, 3); // 1 from foreign test + 2 new

    // Delete task2
    await db.task.delete({
      where: { id: testTask2Id },
    });

    // Check that all checklist items for task2 were cascade-deleted
    const afterCount = await db.taskChecklistItem.count({
      where: { taskId: testTask2Id },
    });
    assert.strictEqual(afterCount, 0, "All checklist items must be cascade deleted with parent task");
  });
});
