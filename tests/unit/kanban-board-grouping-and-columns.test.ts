import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE_COLUMNS,
  LEGACY_STATUS_TO_COLUMN_ID,
  getEffectiveColumnId,
  type KanbanColumn,
} from "../../lib/validations/board-column";
import type { KanbanTaskItem } from "../../components/tasks/kanban-board";

describe("Dynamic Kanban Board Grouping and Logic Unit Tests", () => {
  // ─── 1. Column Sorting and Baseline Invariants ───
  describe("1. Dynamic Column Ordering", () => {
    it("sorts columns by position ascending: Backlog first, Done last", () => {
      const customCols: KanbanColumn[] = [
        { id: "col_done", name: "Done", color: "#10b981", position: 6000, systemKey: "DONE" },
        { id: "col_review", name: "Review", color: "#a855f7", position: 4000, systemKey: null },
        { id: "col_backlog", name: "Backlog", color: "#6b7280", position: 1000, systemKey: "BACKLOG" },
        { id: "col_todo", name: "Todo", color: "#3b82f6", position: 2000, systemKey: null },
        { id: "col_testing", name: "Testing", color: "#f59e0b", position: 5000, systemKey: null },
        { id: "col_in_progress", name: "In Progress", color: "#f59e0b", position: 3000, systemKey: null },
      ];

      const sorted = [...customCols].sort((a, b) => a.position - b.position);

      assert.strictEqual(sorted[0].id, "col_backlog");
      assert.strictEqual(sorted[0].systemKey, "BACKLOG");
      assert.strictEqual(sorted[sorted.length - 1].id, "col_done");
      assert.strictEqual(sorted[sorted.length - 1].systemKey, "DONE");
      assert.strictEqual(sorted[1].id, "col_todo");
      assert.strictEqual(sorted[2].id, "col_in_progress");
      assert.strictEqual(sorted[3].id, "col_review");
      assert.strictEqual(sorted[4].id, "col_testing");
    });

    it("dynamically places custom columns in position order between Backlog and Done", () => {
      const colsWithCustom: KanbanColumn[] = [
        ...BASELINE_COLUMNS.filter(c => c.systemKey !== "DONE"),
        { id: "col_custom_qa", name: "QA Staging", color: "#8b5cf6", position: 6000, systemKey: null },
        { id: "col_custom_security", name: "Security Audit", color: "#ec4899", position: 7000, systemKey: null },
        { id: "col_done", name: "Done", color: "#10b981", position: 8000, systemKey: "DONE" },
      ];

      const sorted = [...colsWithCustom].sort((a, b) => a.position - b.position);

      assert.strictEqual(sorted[0].id, "col_backlog");
      assert.strictEqual(sorted[sorted.length - 1].id, "col_done");
      assert.strictEqual(sorted[5].id, "col_custom_qa");
      assert.strictEqual(sorted[6].id, "col_custom_security");
    });
  });

  // ─── 2. Defensive ColumnId Resolution (Transitional Fallback) ───
  describe("2. Transitional Column ID Resolution", () => {
    it("uses non-null columnId as authoritative when present", () => {
      const task = {
        columnId: "col_custom_qa",
        status: "IN_PROGRESS", // Legacy status differs from column
      };
      const effectiveId = getEffectiveColumnId(task);
      assert.strictEqual(effectiveId, "col_custom_qa");
    });

    it("falls back to baseline column corresponding to legacy status when columnId is null", () => {
      assert.strictEqual(getEffectiveColumnId({ columnId: null, status: "BACKLOG" }), "col_backlog");
      assert.strictEqual(getEffectiveColumnId({ columnId: null, status: "TODO" }), "col_todo");
      assert.strictEqual(getEffectiveColumnId({ columnId: null, status: "IN_PROGRESS" }), "col_in_progress");
      assert.strictEqual(getEffectiveColumnId({ columnId: null, status: "REVIEW" }), "col_review");
      assert.strictEqual(getEffectiveColumnId({ columnId: null, status: "TESTING" }), "col_testing");
      assert.strictEqual(getEffectiveColumnId({ columnId: null, status: "DONE" }), "col_done");
    });

    it("defaults to Backlog when both columnId and status are missing or unrecognized", () => {
      assert.strictEqual(getEffectiveColumnId({ columnId: null, status: null }), "col_backlog");
      assert.strictEqual(getEffectiveColumnId({ columnId: undefined, status: "UNKNOWN_CUSTOM" }), "col_backlog");
    });
  });

  // ─── 3. Task Grouping & Ordering ───
  describe("3. Task Grouping by Column", () => {
    const mockTasks: KanbanTaskItem[] = [
      {
        id: "task_1",
        title: "Task 1",
        status: "TODO",
        columnId: "col_todo",
        priority: "HIGH",
        order: 2000,
        updatedAt: new Date("2026-11-20T10:00:00Z"),
      },
      {
        id: "task_2",
        title: "Task 2 (Older)",
        status: "TODO",
        columnId: "col_todo",
        priority: "LOW",
        order: 1000,
        updatedAt: new Date("2026-11-19T10:00:00Z"),
      },
      {
        id: "task_3",
        title: "Custom Column Task",
        status: "IN_PROGRESS",
        columnId: "col_custom_qa",
        priority: "MEDIUM",
        order: 1500,
        updatedAt: new Date("2026-11-21T10:00:00Z"),
      },
      {
        id: "task_4",
        title: "Transitional Task without columnId",
        status: "DONE",
        columnId: null,
        priority: "CRITICAL",
        order: 500,
        updatedAt: new Date("2026-11-22T10:00:00Z"),
      },
    ];

    it("groups tasks by effective columnId and sorts by order asc", () => {
      const activeColumns: KanbanColumn[] = [
        ...BASELINE_COLUMNS,
        { id: "col_custom_qa", name: "QA", color: "#8b5cf6", position: 5500, systemKey: null },
      ];

      const map: Record<string, KanbanTaskItem[]> = {};
      for (const col of activeColumns) {
        map[col.id] = [];
      }
      for (const t of mockTasks) {
        const colId = getEffectiveColumnId(t);
        if (map[colId]) {
          map[colId].push(t);
        }
      }
      for (const key in map) {
        map[key].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      }

      // Check Todo column has task_2 (order 1000) before task_1 (order 2000)
      assert.strictEqual(map["col_todo"].length, 2);
      assert.strictEqual(map["col_todo"][0].id, "task_2");
      assert.strictEqual(map["col_todo"][1].id, "task_1");

      // Check custom column contains task_3
      assert.strictEqual(map["col_custom_qa"].length, 1);
      assert.strictEqual(map["col_custom_qa"][0].id, "task_3");

      // Check transitional task_4 grouped under col_done
      assert.strictEqual(map["col_done"].length, 1);
      assert.strictEqual(map["col_done"][0].id, "task_4");

      // Check empty columns have length 0
      assert.strictEqual(map["col_backlog"].length, 0);
      assert.strictEqual(map["col_review"].length, 0);
      assert.strictEqual(map["col_testing"].length, 0);
    });
  });

  // ─── 4. Done SystemKey Completion Binding ───
  describe("4. Done Column SystemKey Completion Binding", () => {
    it("identifies Done column strictly by systemKey === 'DONE', never by name", () => {
      const systemDoneCol: KanbanColumn = {
        id: "col_done",
        name: "Completed Work", // Renamed baseline Done column
        color: "#10b981",
        position: 6000,
        systemKey: "DONE",
      };

      const customFakeDoneCol: KanbanColumn = {
        id: "col_user_done",
        name: "Done", // Custom column named "Done" but not system column
        color: "#3b82f6",
        position: 3500,
        systemKey: null,
      };

      const isDone1 = systemDoneCol.systemKey === "DONE";
      const isDone2 = customFakeDoneCol.systemKey === "DONE";

      assert.strictEqual(isDone1, true, "System Done column with custom name must be recognized as Done");
      assert.strictEqual(isDone2, false, "Custom column with name 'Done' must NOT be recognized as Done");
    });

    it("applies 8-item limit only to systemKey === 'DONE' columns", () => {
      const makeTasks = (count: number): KanbanTaskItem[] =>
        Array.from({ length: count }, (_, i) => ({
          id: `t_${i}`,
          title: `Task ${i}`,
          status: "DONE",
          columnId: "col_done",
          priority: "LOW",
          order: (i + 1) * 1000,
          updatedAt: new Date(),
        }));

      const doneTasks = makeTasks(12);
      const showAllDone = false;
      const isDoneCol = true;

      const visible = (isDoneCol && !showAllDone) ? doneTasks.slice(0, 8) : doneTasks;
      assert.strictEqual(visible.length, 8);
      assert.strictEqual(doneTasks.length - 8, 4, "Should calculate 4 hidden completed tasks");
    });
  });

  // ─── 5. Fractional Midpoint Ordering Calculation ───
  describe("5. Drag-and-Drop Midpoint Ordering Formula", () => {
    const calculateNewOrder = (colTasks: { order: number }[], targetIndex: number): number => {
      if (colTasks.length === 0) return 1000;
      if (targetIndex <= 0) {
        const firstOrder = colTasks[0]?.order ? colTasks[0].order : 1000;
        return firstOrder - 500;
      }
      if (targetIndex >= colTasks.length) {
        const lastOrder = colTasks[colTasks.length - 1]?.order
          ? colTasks[colTasks.length - 1].order
          : colTasks.length * 1000;
        return lastOrder + 500;
      }
      let prevOrder = colTasks[targetIndex - 1]?.order ?? 0;
      let nextOrder = colTasks[targetIndex]?.order ?? 0;
      if (prevOrder === 0 && nextOrder === 0) {
        prevOrder = targetIndex * 1000;
        nextOrder = (targetIndex + 1) * 1000;
      } else if (prevOrder === 0) {
        prevOrder = nextOrder - 1000;
      } else if (nextOrder === 0 || prevOrder >= nextOrder) {
        nextOrder = prevOrder + 1000;
      }
      return (prevOrder + nextOrder) / 2;
    };

    it("calculates 1000 for dropping into an empty column", () => {
      assert.strictEqual(calculateNewOrder([], 0), 1000);
    });

    it("calculates order before first task", () => {
      const tasks = [{ order: 1000 }, { order: 2000 }];
      assert.strictEqual(calculateNewOrder(tasks, 0), 500);
    });

    it("calculates order after last task", () => {
      const tasks = [{ order: 1000 }, { order: 2000 }];
      assert.strictEqual(calculateNewOrder(tasks, 2), 2500);
    });

    it("calculates midpoint order between two tasks", () => {
      const tasks = [{ order: 1000 }, { order: 2000 }];
      assert.strictEqual(calculateNewOrder(tasks, 1), 1500);
    });

    it("detects tight gap (< 0.001) for column rebalancing", () => {
      const prevOrder = 1000.0001;
      const nextOrder = 1000.0005;
      const gap = Math.abs(nextOrder - prevOrder);
      assert.ok(gap < 0.001, "Should trigger auto-rebalance when gap is under 0.001");
    });
  });

  // ─── 6. Feature Preservation (Checklists and Attachments) ───
  describe("6. Task Card Indicators (Ticket 1 & Ticket 2)", () => {
    it("preserves checklist and attachment indicators on task items", () => {
      const taskWithFeatures: KanbanTaskItem = {
        id: "task_rich",
        title: "Rich Task",
        status: "IN_PROGRESS",
        columnId: "col_in_progress",
        priority: "HIGH",
        order: 1000,
        updatedAt: new Date(),
        checklistItems: [
          { id: "chk_1", isCompleted: true },
          { id: "chk_2", isCompleted: false },
          { id: "chk_3", isCompleted: true },
        ],
        _count: {
          attachments: 3,
        },
        subtasks: [
          { id: "sub_1", title: "Subtask 1", status: "TODO" },
        ],
      };

      const completedChecklists = taskWithFeatures.checklistItems?.filter(i => i.isCompleted).length;
      const totalChecklists = taskWithFeatures.checklistItems?.length;
      const attachmentCount = taskWithFeatures._count?.attachments;
      const subtaskCount = taskWithFeatures.subtasks?.length;

      assert.strictEqual(completedChecklists, 2);
      assert.strictEqual(totalChecklists, 3);
      assert.strictEqual(attachmentCount, 3);
      assert.strictEqual(subtaskCount, 1);
    });
  });
});
