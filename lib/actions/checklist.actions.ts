"use server";

import { db } from "@/lib/db";
import { getCurrentEmployee, type AuthEmployee } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { assertCanViewTask } from "@/lib/queries/task.queries";

function safeRevalidatePath(path: string, type?: "page" | "layout") {
  try {
    revalidatePath(path, type);
  } catch {
    // In tests or non-request contexts, static generation store is not present
  }
}
import {
  validateChecklistTitle,
  validateTaskId,
  validateItemId,
  validateReorderItemIds,
} from "@/lib/validations/checklist";

// ─── Authorization Helpers ───

/**
 * Ensures the authenticated caller has permission to view and modify checklist items for a given task.
 * Centralized authorization delegates to `assertCanViewTask`.
 */
async function assertCanEditTaskChecklist(taskId: string, employee: AuthEmployee) {
  const task = await assertCanViewTask(taskId, employee);
  if (!task) {
    throw new Error("Task not found.");
  }
  return task;
}

/**
 * Resolves a checklist item and verifies the caller's permission against its parent task.
 */
async function assertCanEditChecklistItem(itemId: string, employee: AuthEmployee) {
  const item = await db.taskChecklistItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      taskId: true,
    },
  });

  if (!item) {
    throw new Error("Checklist item not found.");
  }

  await assertCanViewTask(item.taskId, employee);
  return item;
}

// ─── Actions ───

/**
 * Creates a new checklist item under an existing task.
 */
export async function createChecklistItemAction(data: { taskId: string; title: string }) {
  const employee = await getCurrentEmployee();
  const taskId = validateTaskId(data.taskId);
  const title = validateChecklistTitle(data.title);

  await assertCanEditTaskChecklist(taskId, employee);

  // Position new checklist item at the end of the existing list
  const lastItem = await db.taskChecklistItem.findFirst({
    where: { taskId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const nextOrder = lastItem ? lastItem.order + 1000 : 1000;

  const newItem = await db.taskChecklistItem.create({
    data: {
      taskId,
      title,
      order: nextOrder,
      isCompleted: false,
      createdById: employee.id,
    },
    include: {
      completedBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },
    },
  });

  safeRevalidatePath(`/tasks/${taskId}`);
  safeRevalidatePath("/tasks");
  safeRevalidatePath("/");

  return { success: true, item: newItem };
}

/**
 * Updates the title of an existing checklist item. Preserves completion status and metadata.
 */
export async function updateChecklistItemAction(data: { itemId: string; title: string }) {
  const employee = await getCurrentEmployee();
  const itemId = validateItemId(data.itemId);
  const title = validateChecklistTitle(data.title);

  const existingItem = await assertCanEditChecklistItem(itemId, employee);

  const updatedItem = await db.taskChecklistItem.update({
    where: { id: itemId },
    data: { title },
    include: {
      completedBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },
    },
  });

  safeRevalidatePath(`/tasks/${existingItem.taskId}`);
  safeRevalidatePath("/tasks");
  safeRevalidatePath("/");

  return { success: true, item: updatedItem };
}

/**
 * Toggles or updates the completion status of a checklist item.
 * When marked completed, records current timestamp and completedBy employee.
 * When marked incomplete, clears completion metadata.
 */
export async function toggleChecklistItemAction(data: { itemId: string; isCompleted: boolean }) {
  const employee = await getCurrentEmployee();
  const itemId = validateItemId(data.itemId);
  const isCompleted = Boolean(data.isCompleted);

  const existingItem = await assertCanEditChecklistItem(itemId, employee);

  const updatedItem = await db.taskChecklistItem.update({
    where: { id: itemId },
    data: {
      isCompleted,
      completedAt: isCompleted ? new Date() : null,
      completedById: isCompleted ? employee.id : null,
    },
    include: {
      completedBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },
    },
  });

  safeRevalidatePath(`/tasks/${existingItem.taskId}`);
  safeRevalidatePath("/tasks");
  safeRevalidatePath("/");

  return { success: true, item: updatedItem };
}

/**
 * Deletes a checklist item.
 */
export async function deleteChecklistItemAction(data: { itemId: string }) {
  const employee = await getCurrentEmployee();
  const itemId = validateItemId(data.itemId);

  const existingItem = await assertCanEditChecklistItem(itemId, employee);

  await db.taskChecklistItem.delete({
    where: { id: itemId },
  });

  safeRevalidatePath(`/tasks/${existingItem.taskId}`);
  safeRevalidatePath("/tasks");
  safeRevalidatePath("/");

  return { success: true, itemId };
}

/**
 * Reorders checklist items belonging to a single task atomically inside a transaction.
 * Validates that all IDs belong strictly to the target task before applying updates.
 */
export async function reorderChecklistItemsAction(data: { taskId: string; orderedItemIds: string[] }) {
  const employee = await getCurrentEmployee();
  const taskId = validateTaskId(data.taskId);
  const orderedItemIds = validateReorderItemIds(data.orderedItemIds);

  if (orderedItemIds.length === 0) {
    return { success: true };
  }

  await assertCanEditTaskChecklist(taskId, employee);

  // Validate that all items exist and strictly belong to this taskId
  const currentItems = await db.taskChecklistItem.findMany({
    where: { id: { in: orderedItemIds } },
    select: { id: true, taskId: true },
  });

  if (currentItems.length !== orderedItemIds.length) {
    throw new Error("One or more checklist items in the reorder list could not be found.");
  }

  const foreignItem = currentItems.find((item) => item.taskId !== taskId);
  if (foreignItem) {
    throw new Error("Cannot reorder checklist items across different tasks.");
  }

  // Update orders atomically in a Prisma transaction
  await db.$transaction(
    orderedItemIds.map((id, index) =>
      db.taskChecklistItem.update({
        where: { id },
        data: { order: (index + 1) * 1000 },
      })
    )
  );

  safeRevalidatePath(`/tasks/${taskId}`);
  return { success: true };
}

