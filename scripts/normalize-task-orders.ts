import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma";

async function main() {
  console.log("Normalizing existing task orders in database by BoardColumn...");

  const columns = await db.boardColumn.findMany({
    orderBy: { position: "asc" },
    select: { id: true, name: true, position: true }
  });

  console.log(`Found ${columns.length} board columns.`);

  let totalUpdated = 0;

  for (const column of columns) {
    const tasks = await db.task.findMany({
      where: { columnId: column.id },
      orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
      select: { id: true, title: true, order: true }
    });

    console.log(`Column "${column.name}" (${column.id}): ${tasks.length} tasks`);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const newOrder = (i + 1) * 1000;
      await db.task.update({
        where: { id: task.id },
        data: { order: newOrder }
      });
      totalUpdated++;
    }
  }

  // Check for any unassigned tasks as a safety safeguard
  const unassignedTasks = await db.task.findMany({
    where: { columnId: null } as unknown as Prisma.TaskWhereInput,
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true }
  });

  if (unassignedTasks.length > 0) {
    console.warn(`WARNING: Found ${unassignedTasks.length} tasks with null columnId!`);
  }

  console.log(`Task order normalization complete! Normalized ${totalUpdated} tasks across ${columns.length} columns.`);
}

main().catch(console.error).finally(() => process.exit(0));
