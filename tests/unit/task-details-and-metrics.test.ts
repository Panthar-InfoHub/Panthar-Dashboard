import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASELINE_COLUMNS, LEGACY_STATUS_TO_COLUMN_ID, type KanbanColumn } from "../../lib/validations/board-column";

describe("Task Details, Project Metrics and Dashboard Integration Unit Tests", () => {
  // ─── 1. TaskColumnBadge Theme & Color Resolution ───
  describe("1. TaskColumnBadge Dynamic Styling & Fallbacks", () => {
    // Pure logic simulation of TaskColumnBadge resolution rules
    function resolveBadgeStyles(props: {
      column?: { id?: string; name: string; color: string; systemKey?: string | null } | null;
      status?: string | null;
      name?: string;
      color?: string;
      size?: "sm" | "default";
    }) {
      let resolvedName = props.name || props.column?.name;
      let resolvedColor = props.color || props.column?.color;

      if (!resolvedName && props.status) {
        const colId = LEGACY_STATUS_TO_COLUMN_ID[props.status.toUpperCase()];
        const baseline = BASELINE_COLUMNS.find((c) => c.id === colId);
        if (baseline) {
          resolvedName = baseline.name;
          resolvedColor = baseline.color;
        } else {
          resolvedName = props.status.replace(/_/g, " ");
          resolvedColor = "#6b7280";
        }
      }

      if (!resolvedName) resolvedName = "Backlog";
      if (!resolvedColor) resolvedColor = "#6b7280";

      return {
        name: resolvedName,
        color: resolvedColor,
        style: {
          backgroundColor: `${resolvedColor}1a`,
          borderColor: `${resolvedColor}40`,
          color: "var(--foreground)",
        },
        dotSize: props.size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2",
        textSize: props.size === "sm" ? "text-[10px]" : "text-xs",
      };
    }

    it("applies theme-safe 10% tint, 25% border, and --foreground text contrast", () => {
      const col = { id: "col_review", name: "In Review", color: "#a855f7", systemKey: null };
      const badge = resolveBadgeStyles({ column: col });

      assert.strictEqual(badge.name, "In Review");
      assert.strictEqual(badge.color, "#a855f7");
      assert.strictEqual(badge.style.backgroundColor, "#a855f71a"); // 10% opacity tint
      assert.strictEqual(badge.style.borderColor, "#a855f740");     // 25% opacity border
      assert.strictEqual(badge.style.color, "var(--foreground)");  // high-contrast text
      assert.strictEqual(badge.dotSize, "h-2 w-2");
      assert.strictEqual(badge.textSize, "text-xs");
    });

    it("supports 'sm' size variant with compact dimensions", () => {
      const col = { id: "col_todo", name: "Todo", color: "#3b82f6", systemKey: null };
      const badge = resolveBadgeStyles({ column: col, size: "sm" });

      assert.strictEqual(badge.dotSize, "h-1.5 w-1.5");
      assert.strictEqual(badge.textSize, "text-[10px]");
    });

    it("dynamically resolves custom columns with arbitrary colors", () => {
      const customCol = { id: "c_qa_staging", name: "QA Staging", color: "#ec4899", systemKey: null };
      const badge = resolveBadgeStyles({ column: customCol });

      assert.strictEqual(badge.name, "QA Staging");
      assert.strictEqual(badge.color, "#ec4899");
      assert.strictEqual(badge.style.backgroundColor, "#ec48991a");
      assert.strictEqual(badge.style.borderColor, "#ec489940");
    });

    it("falls back to baseline column when column is null but legacy status is provided", () => {
      const testCases = [
        { status: "BACKLOG", expectedName: "Backlog", expectedColor: "#6b7280" },
        { status: "TODO", expectedName: "Todo", expectedColor: "#3b82f6" },
        { status: "IN_PROGRESS", expectedName: "In Progress", expectedColor: "#f59e0b" },
        { status: "REVIEW", expectedName: "Review", expectedColor: "#a855f7" },
        { status: "TESTING", expectedName: "Testing", expectedColor: "#f59e0b" },
        { status: "DONE", expectedName: "Done", expectedColor: "#10b981" },
      ];

      for (const tc of testCases) {
        const badge = resolveBadgeStyles({ column: null, status: tc.status });
        assert.strictEqual(badge.name, tc.expectedName);
        assert.strictEqual(badge.color, tc.expectedColor);
      }
    });

    it("defensively handles unmapped legacy status gracefully", () => {
      const badge = resolveBadgeStyles({ column: null, status: "READY_FOR_DEPLOY" });
      assert.strictEqual(badge.name, "READY FOR DEPLOY");
      assert.strictEqual(badge.color, "#6b7280");
      assert.strictEqual(badge.style.backgroundColor, "#6b72801a");
    });

    it("defaults to Backlog when both column and status are missing", () => {
      const badge = resolveBadgeStyles({ column: null, status: null });
      assert.strictEqual(badge.name, "Backlog");
      assert.strictEqual(badge.color, "#6b7280");
    });

    it("allows prop overrides for name and color to take precedence", () => {
      const col = { id: "col_backlog", name: "Backlog", color: "#6b7280", systemKey: "BACKLOG" };
      const badge = resolveBadgeStyles({ column: col, name: "Overridden", color: "#06b6d4" });

      assert.strictEqual(badge.name, "Overridden");
      assert.strictEqual(badge.color, "#06b6d4");
      assert.strictEqual(badge.style.backgroundColor, "#06b6d41a");
    });
  });

  // ─── 2. Project Completion Formula & Anti-Spoofing ───
  describe("2. Project Completion Formula & Anti-Spoofing Invariants", () => {
    const isTaskCompleted = (t: { status?: string; columnId?: string | null; column?: { systemKey?: string | null; name?: string } | null }) => {
      return t.column?.systemKey === "DONE";
    };

    function computeProjectProgress(tasks: Array<{ status?: string; columnId?: string | null; column?: { systemKey?: string | null; name?: string } | null }>, baselineProgress = 0) {
      const totalTasks = tasks.length;
      if (totalTasks === 0) return baselineProgress;
      const completedTasks = tasks.filter(isTaskCompleted).length;
      return Math.round((completedTasks / totalTasks) * 100);
    }

    it("considers task completed strictly when column.systemKey === 'DONE'", () => {
      const doneTask = {
        status: "DONE",
        columnId: "col_done",
        column: { systemKey: "DONE", name: "Done" },
      };
      assert.strictEqual(isTaskCompleted(doneTask), true);
    });

    it("considers renamed system column as completed as long as systemKey === 'DONE'", () => {
      const renamedDoneTask = {
        status: "DONE",
        columnId: "col_done",
        column: { systemKey: "DONE", name: "Shipped & Released" },
      };
      assert.strictEqual(isTaskCompleted(renamedDoneTask), true);
    });

    it("ANTI-SPOOFING: rejects custom column named 'Done' without systemKey === 'DONE'", () => {
      const spoofedTask = {
        status: "IN_PROGRESS",
        columnId: "c_custom_done",
        column: { systemKey: null, name: "Done" }, // Custom column with name Done but systemKey null
      };
      assert.strictEqual(isTaskCompleted(spoofedTask), false);
    });

    it("ANTI-SPOOFING: rejects custom column named 'Completed' with systemKey === null", () => {
      const spoofedTask = {
        status: "IN_PROGRESS",
        columnId: "c_custom_completed",
        column: { systemKey: null, name: "Completed" },
      };
      assert.strictEqual(isTaskCompleted(spoofedTask), false);
    });

    it("identifies completed tasks strictly via column.systemKey === 'DONE'", () => {
      const taskDone = { column: { systemKey: "DONE", name: "Done" } };
      const taskTodo = { column: { systemKey: null, name: "Todo" } };

      assert.strictEqual(isTaskCompleted(taskDone), true);
      assert.strictEqual(isTaskCompleted(taskTodo), false);
    });

    it("ignores legacy status when dynamic column is assigned", () => {
      // If task has column with systemKey null, but legacy status is DONE, dynamic column is authoritative!
      const migratedTaskInReview = {
        status: "DONE", // stale trigger/db column
        columnId: "col_review",
        column: { systemKey: null, name: "Review" },
      };
      assert.strictEqual(isTaskCompleted(migratedTaskInReview), false);
    });

    it("correctly computes project completion percentage across mixed task collections", () => {
      const tasks = [
        { status: "DONE", column: { systemKey: "DONE", name: "Done" } },
        { status: "DONE", column: { systemKey: "DONE", name: "Done" } },
        { status: "DONE", column: { systemKey: "DONE", name: "Shipped" } },
        { status: "IN_PROGRESS", column: { systemKey: null, name: "In Progress" } },
        { status: "BACKLOG", column: { systemKey: "BACKLOG", name: "Backlog" } },
        { status: "TODO", column: { systemKey: null, name: "Todo" } },
      ];

      // Completed: 3 systemKey:DONE out of 6 tasks = 50%
      const progress = computeProjectProgress(tasks);
      assert.strictEqual(progress, 50);
    });

    it("computes 0% when no tasks are completed", () => {
      const tasks = [
        { status: "BACKLOG", column: { systemKey: "BACKLOG", name: "Backlog" } },
        { status: "IN_PROGRESS", column: { systemKey: null, name: "In Progress" } },
      ];
      assert.strictEqual(computeProjectProgress(tasks), 0);
    });

    it("computes 100% when all tasks are completed", () => {
      const tasks = [
        { status: "DONE", column: { systemKey: "DONE", name: "Done" } },
        { status: "DONE", column: { systemKey: "DONE", name: "Done" } },
      ];
      assert.strictEqual(computeProjectProgress(tasks), 100);
    });

    it("accurately rounds floating ratios (1/3 = 33%, 2/3 = 67%)", () => {
      const tasks3 = [
        { status: "DONE", column: { systemKey: "DONE", name: "Done" } },
        { status: "TODO", column: { systemKey: null, name: "Todo" } },
        { status: "TODO", column: { systemKey: null, name: "Todo" } },
      ];
      assert.strictEqual(computeProjectProgress(tasks3), 33);

      tasks3[1] = { status: "DONE", column: { systemKey: "DONE", name: "Done" } };
      assert.strictEqual(computeProjectProgress(tasks3), 67);
    });

    it("returns baseline progress when project has 0 tasks", () => {
      assert.strictEqual(computeProjectProgress([], 45), 45);
    });
  });

  // ─── 3. Dashboard Priority Radar Invariants ───
  describe("3. Dashboard Priority Radar Filter Invariants", () => {
    function filterRadarTasks(tasks: Array<{
      id: string;
      title: string;
      status: string;
      columnId?: string | null;
      column?: { systemKey?: string | null; name: string } | null;
      dueDate?: Date | null;
    }>) {
      return tasks.filter((t) => {
        // Exclude tasks in DONE system column
        const isCompleted = t.column?.systemKey === "DONE";
        return !isCompleted;
      });
    }

    it("filters out completed tasks and retains active tasks in radar", () => {
      const allTasks = [
        { id: "1", title: "Active 1", status: "TODO", column: { systemKey: null, name: "Todo" } },
        { id: "2", title: "Backlog 2", status: "BACKLOG", column: { systemKey: "BACKLOG", name: "Backlog" } },
        { id: "3", title: "Custom QA", status: "IN_PROGRESS", column: { systemKey: null, name: "QA" } },
        { id: "4", title: "Done Task", status: "DONE", column: { systemKey: "DONE", name: "Done" } },
        { id: "5", title: "Shipped", status: "DONE", column: { systemKey: "DONE", name: "Shipped" } },
      ];

      const radar = filterRadarTasks(allTasks);
      assert.strictEqual(radar.length, 3);
      assert.deepStrictEqual(radar.map(t => t.id), ["1", "2", "3"]);
    });

    it("evaluates overdue calendar midnight boundaries correctly", () => {
      const now = new Date("2026-11-23T12:00:00Z");

      function checkIsOverdue(date: Date | null | undefined, referenceNow: Date): boolean {
        if (!date) return false;
        const hours = date.getUTCHours();
        const minutes = date.getUTCMinutes();
        if ((hours === 18 && minutes === 30) || (hours === 0 && minutes === 0)) {
          // Calendar day expires at the end of the day (24 hours after the midnight timestamp)
          return new Date(date.getTime() + 24 * 60 * 60 * 1000) < referenceNow;
        }
        return date < referenceNow;
      }

      // Today midnight UTC (2026-11-23T00:00:00Z) should NOT be overdue at 12:00:00Z
      const todayMidnight = new Date("2026-11-23T00:00:00Z");
      assert.strictEqual(checkIsOverdue(todayMidnight, now), false);

      // Yesterday midnight UTC (2026-11-22T00:00:00Z) should be overdue at 12:00:00Z on Nov 23
      const yesterdayMidnight = new Date("2026-11-22T00:00:00Z");
      assert.strictEqual(checkIsOverdue(yesterdayMidnight, now), true);
    });
  });

  // ─── 4. Task Creation Defaults & Edit Preservation ───
  describe("4. Task Creation Defaults & Column Preservation", () => {
    it("defaults to 'col_backlog' when columnId is not provided", () => {
      const defaultColumn = (columns: KanbanColumn[], selectedColumnId?: string) => {
        if (selectedColumnId) return selectedColumnId;
        const backlog = columns.find((c) => c.systemKey === "BACKLOG");
        return backlog?.id || columns[0]?.id || "col_backlog";
      };

      const columns: KanbanColumn[] = [
        { id: "col_backlog", name: "Backlog", color: "#6b7280", position: 1000, systemKey: "BACKLOG" },
        { id: "col_todo", name: "Todo", color: "#3b82f6", position: 2000, systemKey: null },
        { id: "col_done", name: "Done", color: "#10b981", position: 6000, systemKey: "DONE" },
      ];

      assert.strictEqual(defaultColumn(columns), "col_backlog");
      assert.strictEqual(defaultColumn(columns, "col_todo"), "col_todo");
    });

    it("identifies 'Mark as Done' target strictly from systemKey === 'DONE'", () => {
      const columns: KanbanColumn[] = [
        { id: "col_backlog", name: "Backlog", color: "#6b7280", position: 1000, systemKey: "BACKLOG" },
        { id: "col_custom_done", name: "Done Review", color: "#ec4899", position: 4000, systemKey: null },
        { id: "col_final_done", name: "Production Shipped", color: "#10b981", position: 6000, systemKey: "DONE" },
      ];

      const doneColumn = columns.find((c) => c.systemKey === "DONE");
      assert.ok(doneColumn);
      assert.strictEqual(doneColumn.id, "col_final_done");
      assert.strictEqual(doneColumn.name, "Production Shipped");
    });

    it("hides 'Mark as Done' button if task is already in Done column", () => {
      const isDone = (task: { columnId?: string | null; column?: { systemKey?: string | null } | null; status?: string }) => {
        return task.column?.systemKey === "DONE";
      };

      const taskInDone = {
        columnId: "col_done",
        column: { systemKey: "DONE", name: "Done" },
        status: "DONE",
      };
      const taskInTodo = {
        columnId: "col_todo",
        column: { systemKey: null, name: "Todo" },
        status: "TODO",
      };

      assert.strictEqual(isDone(taskInDone), true); // "Mark as Done" should be hidden
      assert.strictEqual(isDone(taskInTodo), false); // "Mark as Done" should be visible
    });
  });

  // ─── 5. Dashboard Velocity & Workload Completion Filtering ───
  describe("5. Dashboard Velocity & Workload Completion Filtering (Raw SQL Logic)", () => {
    interface SimulatedTask {
      id: string;
      columnId: string;
      column?: { systemKey?: string | null; name: string } | null;
      completedAt?: Date | null;
    }

    // Mirrors getTaskVelocity predicate: WHERE c."systemKey" = 'DONE' AND t."completedAt" >= rangeStart
    function filterTaskVelocity(tasks: SimulatedTask[], rangeStart: Date) {
      return tasks.filter((t) => {
        const isDone = t.column?.systemKey === "DONE";
        const hasCompletedAt = t.completedAt && t.completedAt >= rangeStart;
        return isDone && Boolean(hasCompletedAt);
      });
    }

    // Mirrors getDashboardChartsData predicate: WHERE c."systemKey" IS DISTINCT FROM 'DONE'
    function filterActiveTeamWorkload(tasks: SimulatedTask[]) {
      return tasks.filter((t) => {
        return t.column?.systemKey !== "DONE";
      });
    }

    it("evaluates getTaskVelocity strictly via column.systemKey === 'DONE'", () => {
      const now = new Date();
      const rangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const tasks: SimulatedTask[] = [
        { id: "1", columnId: "col_done", column: { systemKey: "DONE", name: "Done" }, completedAt: now },
        { id: "2", columnId: "col_done_renamed", column: { systemKey: "DONE", name: "Shipped & Released" }, completedAt: now },
        { id: "3", columnId: "col_custom_done", column: { systemKey: null, name: "Done Check" }, completedAt: now },
        { id: "4", columnId: "col_in_progress", column: { systemKey: null, name: "In Progress" }, completedAt: null },
      ];

      const velocity = filterTaskVelocity(tasks, rangeStart);
      assert.strictEqual(velocity.length, 2);
      assert.deepStrictEqual(velocity.map((t) => t.id), ["1", "2"]);
    });

    it("evaluates getDashboardChartsData workload strictly via systemKey IS DISTINCT FROM 'DONE'", () => {
      const tasks: SimulatedTask[] = [
        { id: "1", columnId: "col_backlog", column: { systemKey: "BACKLOG", name: "Backlog" } },
        { id: "2", columnId: "col_todo", column: { systemKey: null, name: "Todo" } },
        { id: "3", columnId: "col_qa", column: { systemKey: null, name: "QA Staging" } },
        { id: "4", columnId: "col_done", column: { systemKey: "DONE", name: "Done" } },
        { id: "5", columnId: "col_done_shipped", column: { systemKey: "DONE", name: "Shipped" } },
      ];

      const workload = filterActiveTeamWorkload(tasks);
      assert.strictEqual(workload.length, 3);
      assert.deepStrictEqual(workload.map((t) => t.id), ["1", "2", "3"]);
    });
  });
});

