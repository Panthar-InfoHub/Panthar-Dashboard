"use server";

import { db } from "@/lib/db";
import { requireAuth, getCurrentEmployee, checkPermission, type AuthEmployee } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { getKanbanTasks } from "@/lib/queries/task.queries";
import type { TaskPriority } from "@/lib/generated/prisma";
import { deleteObjects } from "@/lib/r2";

// ─── Validation Helpers ───

const VALID_PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function assertValidPriority(value: unknown): asserts value is TaskPriority {
  if (!VALID_PRIORITIES.includes(value as TaskPriority)) {
    throw new Error(`Invalid task priority: ${String(value)}`);
  }
}

function safeRevalidatePath(path: string, type?: "page" | "layout") {
  try {
    revalidatePath(path, type);
  } catch {
    // In tests or non-request contexts, static generation store is not present
  }
}

// ─── Actions ───

export async function createTaskAction(data: {
  title: string;
  description?: string;
  projectId: string;
  assigneeIds?: string[];
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  startDate?: Date;
  dueDate?: Date;
  blockers?: string;
  columnId?: string;
}) {
  const employee = await requireAuth("task:create", data.projectId);

  if (!data.title?.trim()) throw new Error("Task title is required.");
  if (!data.projectId?.trim()) throw new Error("Project ID is required.");
  assertValidPriority(data.priority);

  // Resolve target column (defaults to BACKLOG system column if omitted/empty)
  let resolvedColumnId: string;
  let targetCol: { id: string; systemKey: string | null } | null = null;
  if (data.columnId && data.columnId.trim()) {
    targetCol = await db.boardColumn.findUnique({
      where: { id: data.columnId.trim() },
      select: { id: true, systemKey: true },
    });
    if (!targetCol) {
      throw new Error(`Invalid board column: ${data.columnId}`);
    }
    resolvedColumnId = targetCol.id;
  } else {
    targetCol = await db.boardColumn.findFirst({
      where: { systemKey: "BACKLOG" },
      select: { id: true, systemKey: true },
    });
    resolvedColumnId = targetCol ? targetCol.id : "col_backlog";
  }

  // Position new tasks at the top of the resolved column
  const firstTask = await db.task.findFirst({
    where: { projectId: data.projectId, columnId: resolvedColumnId },
    orderBy: { order: "asc" },
    select: { order: true },
  });
  const initialOrder = firstTask ? firstTask.order - 1000 : 1000;

  const isDone = targetCol?.systemKey === "DONE";

  const task = await db.task.create({
    data: {
      title: data.title.trim(),
      description: data.description?.trim() || null,
      projectId: data.projectId,
      creatorId: employee.id,
      priority: data.priority,
      order: initialOrder,
      columnId: resolvedColumnId,
      completedAt: isDone ? new Date() : undefined,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      blockers: data.blockers,
      assignees: data.assigneeIds && data.assigneeIds.length > 0 
        ? { connect: data.assigneeIds.map(id => ({ id })) } 
        : undefined,
    }
  });

  if (data.assigneeIds && data.assigneeIds.length > 0) {
    const assigneesToNotify = data.assigneeIds.filter(id => id !== employee.id);
    if (assigneesToNotify.length > 0) {
      await db.notification.createMany({
        data: assigneesToNotify.map(id => ({
          recipientId: id,
          type: "TASK_ASSIGNED",
          title: "New Task Assigned",
          message: `You were assigned a new task: ${task.title}`,
          actionUrl: `/tasks/${task.id}`
        }))
      });
    }
  }

  safeRevalidatePath("/projects");
  safeRevalidatePath(`/tasks/${task.id}`);
  safeRevalidatePath("/");
  return { success: true, taskId: task.id };
}

export async function updateTaskAction(taskId: string, data: {
  title: string;
  projectId: string;
  description?: string;
  assigneeIds?: string[];
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  startDate?: Date;
  dueDate?: Date;
  blockers?: string;
}) {
  const employee = await getCurrentEmployee();
  const hasGlobalPerm = await checkPermission("task:update", data.projectId);

  if (!data.title?.trim()) throw new Error("Task title is required.");
  assertValidPriority(data.priority);

  const existingTask = await db.task.findUnique({
    where: { id: taskId },
    include: { project: { include: { members: true } }, assignees: true }
  });

  if (!existingTask) throw new Error("Task not found");

  if (!hasGlobalPerm) {
    const isAssignee = existingTask.assignees.some(a => a.id === employee.id);
    if (existingTask.creatorId !== employee.id && !isAssignee) {
      throw new Error("You do not have permission to edit this task's details.");
    }
  }

  const updatedTask = await db.task.update({
    where: { id: taskId },
    data: {
      title: data.title.trim(),
      description: data.description,
      projectId: data.projectId,
      priority: data.priority,
      startDate: data.startDate ? new Date(data.startDate) : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      blockers: data.blockers,
      assignees: {
        set: data.assigneeIds && data.assigneeIds.length > 0 
          ? data.assigneeIds.map(id => ({ id })) 
          : []
      }
    }
  });

  safeRevalidatePath("/projects");
  safeRevalidatePath(`/tasks/${taskId}`);
  safeRevalidatePath("/");
  return { success: true, taskId: updatedTask.id };
}

export async function updateTaskStatusAction(taskId: string, targetColumnIdOrStatus: string, newOrder?: number) {
  if (!targetColumnIdOrStatus || !targetColumnIdOrStatus.trim()) {
    throw new Error("Target column is required");
  }
  if (newOrder !== undefined && (typeof newOrder !== "number" || isNaN(newOrder))) {
    throw new Error("Invalid task order value");
  }

  // Resolve target column from BoardColumn (accepts valid columnId or legacy status/systemKey fallback)
  let targetColumn = await db.boardColumn.findUnique({
    where: { id: targetColumnIdOrStatus.trim() },
  });

  if (!targetColumn) {
    const legacyMapping: Record<string, string> = {
      BACKLOG: "col_backlog",
      TODO: "col_todo",
      IN_PROGRESS: "col_in_progress",
      REVIEW: "col_review",
      TESTING: "col_testing",
      DONE: "col_done",
    };
    const mappedId = legacyMapping[targetColumnIdOrStatus.trim().toUpperCase()];
    if (mappedId) {
      targetColumn = await db.boardColumn.findUnique({
        where: { id: mappedId },
      });
    } else {
      targetColumn = await db.boardColumn.findFirst({
        where: { systemKey: targetColumnIdOrStatus.trim().toUpperCase() },
      });
    }
  }

  if (!targetColumn) {
    throw new Error(`Invalid board column: ${targetColumnIdOrStatus}`);
  }

  const employee = await getCurrentEmployee();
  const hasGlobalPerm = await checkPermission("task:update");

  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      column: true,
      project: { include: { members: true } },
      assignees: true,
      blocking: true,
    },
  });

  if (!task) throw new Error("Task not found");

  if (!hasGlobalPerm) {
    const isCreator = task.creatorId === employee.id;
    const isAssignee = task.assignees.some((a) => a.id === employee.id);
    const isProjectMember = task.project.members.some((m) => m.employeeId === employee.id);
    if (!isCreator && !isAssignee && !isProjectMember) {
      throw new Error("You do not have permission for this action.");
    }
  }

  const wasDone = task.column?.systemKey === "DONE";
  const isDone = targetColumn.systemKey === "DONE";

  const isEnteringDone = isDone && !wasDone;
  const isLeavingDone = !isDone && wasDone;
  // If staying in Done (isDone && wasDone), completion fields are preserved and NOT reset

  const updatedTask = await db.task.update({
    where: { id: taskId },
    data: {
      columnId: targetColumn.id,
      ...(newOrder !== undefined ? { order: newOrder } : {}),
      ...(isEnteringDone ? { completedAt: new Date() } : {}),
      ...(isLeavingDone ? { completedAt: null, completionNote: null, prLink: null } : {}),
    },
    include: { blocking: true, column: true },
  });

  // Auto-unblock dependent tasks if this task is now DONE
  if (isEnteringDone && updatedTask.blocking && updatedTask.blocking.length > 0) {
    await db.task.updateMany({
      where: { id: { in: updatedTask.blocking.map((t) => t.id) } },
      data: { blockedById: null },
    });
  }

  safeRevalidatePath("/tasks");
  safeRevalidatePath(`/tasks/${taskId}`);
  safeRevalidatePath("/projects");
  safeRevalidatePath("/");
  return { success: true, task: updatedTask };
}

export async function updateTaskPriorityAction(taskId: string, newPriority: string) {
  assertValidPriority(newPriority);

  const employee = await getCurrentEmployee();
  const hasGlobalPerm = await checkPermission("task:update");

  const existingTask = await db.task.findUnique({
    where: { id: taskId },
    include: { project: { include: { members: true } }, assignees: true }
  });

  if (!existingTask) throw new Error("Task not found");

  if (!hasGlobalPerm) {
    const isCreator = existingTask.creatorId === employee.id;
    const isAssignee = existingTask.assignees.some(a => a.id === employee.id);
    const isProjectMember = existingTask.project.members.some(m => m.employeeId === employee.id);
    if (!isCreator && !isAssignee && !isProjectMember) throw new Error("You do not have permission for this action.");
  }

  const task = await db.task.update({
    where: { id: taskId },
    data: { priority: newPriority }
  });

  safeRevalidatePath("/tasks");
  safeRevalidatePath(`/tasks/${taskId}`);
  safeRevalidatePath("/");
  return { success: true, task };
}

export async function setTaskBlockerAction(taskId: string, blockerTaskId: string | null) {
  const employee = await getCurrentEmployee();
  const hasGlobalPerm = await checkPermission("task:update");

  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: { include: { members: true } }, assignees: true }
  });

  if (!task) throw new Error("Task not found");

  if (!hasGlobalPerm) {
    const isCreator = task.creatorId === employee.id;
    const isAssignee = task.assignees.some(a => a.id === employee.id);
    const isProjectMember = task.project.members.some(m => m.employeeId === employee.id);
    if (!isCreator && !isAssignee && !isProjectMember) throw new Error("You do not have permission for this action.");
  }

  const updatedTask = await db.task.update({
    where: { id: taskId },
    data: { blockedById: blockerTaskId }
  });

  safeRevalidatePath("/tasks");
  safeRevalidatePath(`/tasks/${taskId}`);
  return { success: true, task: updatedTask };
}

export async function createSubtaskAction(
  parentId: string,
  data: {
    title: string;
    assigneeId?: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    columnId?: string;
  }
) {
  const employee = await getCurrentEmployee();
  const hasGlobalPerm = await checkPermission("task:create");

  if (!data.title?.trim()) throw new Error("Subtask title is required.");
  assertValidPriority(data.priority);

  const parentTask = await db.task.findUnique({ 
    where: { id: parentId },
    include: { project: { include: { members: true } }, assignees: true, column: true }
  });

  if (!parentTask) throw new Error("Parent task not found");

  if (!hasGlobalPerm) {
    const isCreator = parentTask.creatorId === employee.id;
    const isAssignee = parentTask.assignees.some(a => a.id === employee.id);
    const isProjectMember = parentTask.project.members.some(m => m.employeeId === employee.id);
    if (!isCreator && !isAssignee && !isProjectMember) throw new Error("You do not have permission for this action.");

    // Without task:create/task:update, you can only assign the subtask to yourself.
    if (data.assigneeId && data.assigneeId !== employee.id) {
      throw new Error("You can only assign this subtask to yourself.");
    }
  }

  // Resolve subtask columnId: explicit selection -> parent task columnId -> Backlog system column
  let resolvedColumnId: string;
  let targetCol: { id: string; systemKey: string | null } | null = null;
  if (data.columnId && data.columnId.trim()) {
    targetCol = await db.boardColumn.findUnique({
      where: { id: data.columnId.trim() },
      select: { id: true, systemKey: true },
    });
    if (!targetCol) {
      throw new Error(`Invalid board column: ${data.columnId}`);
    }
    resolvedColumnId = targetCol.id;
  } else if (parentTask.columnId) {
    resolvedColumnId = parentTask.columnId;
    targetCol = parentTask.column;
  } else {
    targetCol = await db.boardColumn.findFirst({
      where: { systemKey: "BACKLOG" },
      select: { id: true, systemKey: true },
    });
    resolvedColumnId = targetCol ? targetCol.id : "col_backlog";
  }

  const isDone = targetCol?.systemKey === "DONE";

  const subtask = await db.task.create({
    data: {
      title: data.title.trim(),
      projectId: parentTask.projectId,
      parentId: parentId,
      creatorId: employee.id,
      priority: data.priority,
      columnId: resolvedColumnId,
      completedAt: isDone ? new Date() : undefined,
      assignees: data.assigneeId ? { connect: [{ id: data.assigneeId }] } : undefined,
    }
  });

  safeRevalidatePath("/tasks");
  safeRevalidatePath(`/tasks/${parentId}`);
  return { success: true, subtask };
}

export async function assignTaskAction(taskId: string, assigneeId: string | null) {
  const employee = await getCurrentEmployee();
  const hasGlobalPerm = await checkPermission("task:update");

  const existingTask = await db.task.findUnique({
    where: { id: taskId },
    include: { project: { include: { members: true } }, assignees: true }
  });

  if (!existingTask) throw new Error("Task not found");

  if (!hasGlobalPerm) {
    if (existingTask.creatorId !== employee.id) {
      throw new Error("You do not have permission to assign this task.");
    }
  }

  const task = await db.task.update({
    where: { id: taskId },
    data: {
      assignees: assigneeId ? { set: [{ id: assigneeId }] } : { set: [] }
    }
  });

  if (assigneeId && assigneeId !== employee.id) {
    const { createNotification } = await import("@/lib/notifications");
    await createNotification({
      recipientId: assigneeId,
      type: "TASK_ASSIGNED",
      title: "Task Assigned",
      message: `You were assigned to: ${task.title}`,
      actionUrl: `/tasks/${task.id}`
    });
  }

  safeRevalidatePath("/tasks");
  safeRevalidatePath(`/tasks/${taskId}`);
  return { success: true, task };
}

export async function loadMoreTasksAction(filters: { team?: string; project?: string; assignee?: string; search?: string }, skip: number) {
  // getKanbanTasks internally calls getCurrentEmployee() for auth
  return await getKanbanTasks(filters, skip, 50);
}

export async function deleteTaskAction(taskId: string) {
  await requireAuth("task:delete");

  const existingTask = await db.task.findUnique({
    where: { id: taskId }
  });

  if (!existingTask) throw new Error("Task not found");

  // Collect any attachment object keys to clean up from R2
  const attachments = await db.taskAttachment.findMany({
    where: { taskId },
    select: { fileKey: true }
  });

  await db.task.delete({ where: { id: taskId } });

  // Clean up R2 objects without blocking completion if storage fails
  if (attachments.length > 0) {
    try {
      await deleteObjects(attachments.map(a => a.fileKey));
    } catch (err: unknown) {
      console.warn(`[Task Deletion Cleanup] Failed to delete R2 objects for task ${taskId}:`, err instanceof Error ? err.message : err);
    }
  }

  safeRevalidatePath("/tasks");
  safeRevalidatePath("/projects");
  safeRevalidatePath("/");
  return { success: true };
}

export async function rebalanceColumnTasksAction(orderedTaskIds: string[]) {
  const employee = await getCurrentEmployee();
  const hasGlobalPerm = await checkPermission("task:update");

  if (!orderedTaskIds || orderedTaskIds.length === 0) return { success: true };

  if (!hasGlobalPerm) {
    const tasks = await db.task.findMany({
      where: { id: { in: orderedTaskIds } },
      select: {
        id: true,
        creatorId: true,
        assignees: { select: { id: true } },
        project: { select: { members: { select: { employeeId: true } } } },
      },
    });

    const isAuthorized = tasks.every((t) => {
      const isAssignee = t.assignees.some((a) => a.id === employee.id);
      const isProjectMember = t.project.members.some((m) => m.employeeId === employee.id);
      const isCreator = t.creatorId === employee.id;
      return isAssignee || isProjectMember || isCreator;
    });

    if (!isAuthorized) {
      throw new Error("You do not have permission for this action.");
    }
  }

  await db.$transaction(
    orderedTaskIds.map((id, index) => 
      db.task.update({
        where: { id },
        data: { order: (index + 1) * 1000 }
      })
    )
  );

  safeRevalidatePath("/tasks");
  return { success: true };
}

