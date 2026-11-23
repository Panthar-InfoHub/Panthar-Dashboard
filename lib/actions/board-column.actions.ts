"use server";

import { db } from "@/lib/db";
import { getCurrentEmployee, type AuthEmployee } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  validateColumnName,
  assertNotReservedColumnName,
  validateColumnColor,
  validateColumnId,
  validateReorderManageableIds,
} from "@/lib/validations/board-column";

const MAX_MANAGEABLE_COLUMNS = 10;

/**
 * Ensures caller is an authenticated administrator.
 */
async function requireAdmin() {
  const employee = await getCurrentEmployee();
  if (employee.role !== "ADMIN") {
    throw new Error("FORBIDDEN: Only administrators can manage board columns.");
  }
  return employee;
}

/**
 * Revalidates all pages that display or reference board columns.
 */
function revalidateBoardPaths() {
  try {
    revalidatePath("/settings");
    revalidatePath("/tasks");
    revalidatePath("/projects");
    revalidatePath("/");
  } catch {
    // In tests or non-request contexts, static generation store is not present
  }
}

/**
 * Fetch all board columns in ascending position order with task counts.
 */
export async function getBoardColumnsAction() {
  await getCurrentEmployee();
  return await db.boardColumn.findMany({
    orderBy: { position: "asc" },
    include: {
      _count: {
        select: { tasks: true },
      },
    },
  });
}

/**
 * Create a new user-manageable board column.
 * - Enforces admin authorization.
 * - Rejects reserved names "Backlog" and "Done" (case-insensitive).
 * - Enforces max 10 user-manageable columns inside transaction with FOR UPDATE row lock.
 * - Calculates position before Done: (M + 2) * 1000, and advances Done to (M + 3) * 1000.
 */
export async function createBoardColumnAction(name: string, color: string) {
  await requireAdmin();

  const validatedName = validateColumnName(name);
  assertNotReservedColumnName(validatedName);
  const validatedColor = validateColumnColor(color);

  const newColumn = await db.$transaction(async (tx) => {
    // Acquire table row-level lock to serialize concurrent column mutations
    await tx.$queryRawUnsafe('SELECT id FROM "BoardColumn" FOR UPDATE');

    // Quota check: Count existing user-manageable columns (systemKey IS NULL)
    const currentManageableCount = await tx.boardColumn.count({
      where: { systemKey: null },
    });

    if (currentManageableCount >= MAX_MANAGEABLE_COLUMNS) {
      throw new Error(`MAX_LIMIT_REACHED: Maximum limit of ${MAX_MANAGEABLE_COLUMNS} user-manageable columns reached.`);
    }

    // Name uniqueness check (case-insensitive)
    const existing = await tx.boardColumn.findFirst({
      where: {
        name: { equals: validatedName, mode: "insensitive" },
      },
    });

    if (existing) {
      throw new Error(`DUPLICATE_NAME: A board column named "${validatedName}" already exists.`);
    }

    // Discrete grid position:
    // Backlog is at 1000.0
    // Manageable columns at index i (0..M-1) are at (i + 2) * 1000.0
    // New column is at index M: (M + 2) * 1000.0
    // Done advances to (M + 3) * 1000.0
    const newPosition = (currentManageableCount + 2) * 1000.0;
    const newDonePosition = (currentManageableCount + 3) * 1000.0;

    // Advance Done column position
    await tx.boardColumn.update({
      where: { systemKey: "DONE" },
      data: { position: newDonePosition },
    });

    // Create the new user-manageable column
    const created = await tx.boardColumn.create({
      data: {
        name: validatedName,
        color: validatedColor,
        position: newPosition,
        systemKey: null,
      },
    });

    return created;
  }, { maxWait: 15000, timeout: 30000 });

  revalidateBoardPaths();
  return { success: true, column: newColumn };
}

/**
 * Rename any board column (including Backlog and Done).
 * - If renaming a custom column, rejects reserved names "Backlog" / "Done".
 * - System columns (systemKey != null) can be renamed, but their systemKey is immutable.
 * - Enforces case-insensitive name uniqueness against all other columns.
 */
export async function renameBoardColumnAction(id: string, name: string) {
  await requireAdmin();

  const validatedId = validateColumnId(id);
  const validatedName = validateColumnName(name);

  const updatedColumn = await db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT id FROM "BoardColumn" FOR UPDATE');

    const column = await tx.boardColumn.findUnique({
      where: { id: validatedId },
    });

    if (!column) {
      throw new Error("NOT_FOUND: Board column not found.");
    }

    // If renaming a custom column, reject reserved system names
    if (column.systemKey === null) {
      assertNotReservedColumnName(validatedName);
    }

    // Check name uniqueness against all other columns
    const duplicate = await tx.boardColumn.findFirst({
      where: {
        name: { equals: validatedName, mode: "insensitive" },
        id: { not: validatedId },
      },
    });

    if (duplicate) {
      throw new Error(`DUPLICATE_NAME: A board column named "${validatedName}" already exists.`);
    }

    return await tx.boardColumn.update({
      where: { id: validatedId },
      data: { name: validatedName },
    });
  }, { maxWait: 15000, timeout: 30000 });

  revalidateBoardPaths();
  return { success: true, column: updatedColumn };
}

/**
 * Update a board column's color (applies to both custom and system columns).
 */
export async function updateBoardColumnColorAction(id: string, color: string) {
  await requireAdmin();

  const validatedId = validateColumnId(id);
  const validatedColor = validateColumnColor(color);

  const updatedColumn = await db.boardColumn.update({
    where: { id: validatedId },
    data: { color: validatedColor },
  });

  revalidateBoardPaths();
  return { success: true, column: updatedColumn };
}

/**
 * Reorder user-manageable board columns.
 * - Receives the complete, ordered set of manageable column IDs.
 * - Rejects missing, duplicate, unknown, or protected system column IDs (col_backlog, col_done).
 * - Assigns normalized positions: Backlog = 1000, Manageable[i] = (i + 2) * 1000, Done = (M + 2) * 1000.
 */
export async function reorderBoardColumnsAction(orderedManageableIds: string[]) {
  await requireAdmin();

  const sanitizedIds = validateReorderManageableIds(orderedManageableIds);

  await db.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "BoardColumn" FOR UPDATE');

      // Fetch all current manageable columns
      const manageableColumns = await tx.boardColumn.findMany({
        where: { systemKey: null },
        select: { id: true },
      });

      const expectedSet = new Set(manageableColumns.map((c) => c.id));

      // Verify exact count matches
      if (sanitizedIds.length !== manageableColumns.length) {
        throw new Error(
          `VALIDATION_ERROR: Reorder list count (${sanitizedIds.length}) does not match existing manageable columns count (${manageableColumns.length}).`
        );
      }

      // Verify all IDs in payload match existing manageable columns exactly (no system IDs, no unknown IDs)
      for (const id of sanitizedIds) {
        if (!expectedSet.has(id)) {
          throw new Error(`VALIDATION_ERROR: Invalid or protected column ID in reorder list: ${id}`);
        }
      }

      const M = sanitizedIds.length;

      // Update positions concurrently inside transaction
      await Promise.all([
        tx.boardColumn.update({
          where: { systemKey: "BACKLOG" },
          data: { position: 1000.0 },
        }),
        tx.boardColumn.update({
          where: { systemKey: "DONE" },
          data: { position: (M + 2) * 1000.0 },
        }),
        ...sanitizedIds.map((id, i) =>
          tx.boardColumn.update({
            where: { id },
            data: { position: (i + 2) * 1000.0 },
          })
        ),
      ]);
    },
    { maxWait: 15000, timeout: 30000 }
  );

  revalidateBoardPaths();
  return { success: true };
}

/**
 * Delete an eligible custom board column.
 * - System columns (Backlog / Done) can NEVER be deleted.
 * - Refuses deletion if tasks or subtasks remain in the column.
 * - Renormalizes remaining manageable columns and advances Done.
 */
export async function deleteBoardColumnAction(id: string) {
  await requireAdmin();

  const validatedId = validateColumnId(id);

  await db.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "BoardColumn" FOR UPDATE');

      const column = await tx.boardColumn.findUnique({
        where: { id: validatedId },
      });

      if (!column) {
        throw new Error("NOT_FOUND: Board column not found.");
      }

      // Invariant: System columns cannot be deleted
      if (column.systemKey !== null) {
        throw new Error("FORBIDDEN: Cannot delete system columns (Backlog / Done).");
      }

      // Invariant: Refuse if tasks or subtasks remain in this column
      const taskCount = await tx.task.count({
        where: { columnId: validatedId },
      });

      if (taskCount > 0) {
        throw new Error(
          `CANNOT_DELETE_NON_EMPTY_COLUMN: Cannot delete column containing ${taskCount} task(s). Move or delete tasks first.`
        );
      }

      // Delete the column
      await tx.boardColumn.delete({
        where: { id: validatedId },
      });

      // Renormalize remaining manageable columns
      const remaining = await tx.boardColumn.findMany({
        where: { systemKey: null },
        orderBy: { position: "asc" },
        select: { id: true },
      });

      const M = remaining.length;

      // Update positions concurrently inside transaction
      await Promise.all([
        tx.boardColumn.update({
          where: { systemKey: "BACKLOG" },
          data: { position: 1000.0 },
        }),
        tx.boardColumn.update({
          where: { systemKey: "DONE" },
          data: { position: (M + 2) * 1000.0 },
        }),
        ...remaining.map((col, i) =>
          tx.boardColumn.update({
            where: { id: col.id },
            data: { position: (i + 2) * 1000.0 },
          })
        ),
      ]);
    },
    { maxWait: 15000, timeout: 30000 }
  );

  revalidateBoardPaths();
  return { success: true };
}
