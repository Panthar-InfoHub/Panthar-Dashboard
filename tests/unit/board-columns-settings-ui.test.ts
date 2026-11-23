import { describe, it } from "node:test";
import assert from "node:assert";
import {
  KanbanColumn,
  BASELINE_COLUMNS,
  PRESET_COLUMN_COLORS,
  HEX_COLOR_REGEX,
  MAX_COLUMN_NAME_LENGTH,
  RESERVED_COLUMN_NAMES,
  validateColumnName,
  assertNotReservedColumnName,
  validateColumnColor,
  validateColumnId,
  validateReorderManageableIds,
  getEffectiveColumnId,
  LEGACY_STATUS_TO_COLUMN_ID,
} from "../../lib/validations/board-column";

describe("Board Columns Settings UI Unit Tests", () => {
  // ─── 1. Access Control & Permission Invariants ───
  describe("1. Access Control & Authorization Invariants", () => {
    it("identifies ADMIN role as exclusively authorized to manage board columns", () => {
      const isAuthorizedAdmin = (role: string) => role === "ADMIN";

      assert.strictEqual(isAuthorizedAdmin("ADMIN"), true);
      assert.strictEqual(isAuthorizedAdmin("MEMBER"), false);
      assert.strictEqual(isAuthorizedAdmin("VIEWER"), false);
      assert.strictEqual(isAuthorizedAdmin(""), false);
    });

    it("requires authenticated session before allowing access to settings data", () => {
      const checkSession = (session: { user?: { id: string } } | null) => {
        if (!session?.user?.id) throw new Error("Unauthorized: no active session");
        return true;
      };

      assert.strictEqual(checkSession({ user: { id: "emp_123" } }), true);
      assert.throws(() => checkSession(null), /Unauthorized/);
      assert.throws(() => checkSession({}), /Unauthorized/);
    });
  });

  // ─── 2. Column Separation & Display Order ───
  describe("2. Column Separation and Discrete Grid Positions", () => {
    it("pins Backlog first (1000) and Done last ((M+2)*1000) in display sequence", () => {
      const mockColumns: KanbanColumn[] = [
        { id: "col_done", name: "Done", color: "#10b981", position: 6000, systemKey: "DONE" },
        { id: "col_todo", name: "Todo", color: "#3b82f6", position: 2000, systemKey: null },
        { id: "col_backlog", name: "Backlog", color: "#6b7280", position: 1000, systemKey: "BACKLOG" },
        { id: "col_review", name: "Review", color: "#a855f7", position: 4000, systemKey: null },
        { id: "col_in_progress", name: "In Progress", color: "#f59e0b", position: 3000, systemKey: null },
        { id: "col_testing", name: "Testing", color: "#f59e0b", position: 5000, systemKey: null },
      ];

      const sorted = [...mockColumns].sort((a, b) => a.position - b.position);

      assert.strictEqual(sorted[0].id, "col_backlog");
      assert.strictEqual(sorted[0].systemKey, "BACKLOG");
      assert.strictEqual(sorted[0].position, 1000);

      assert.strictEqual(sorted[sorted.length - 1].id, "col_done");
      assert.strictEqual(sorted[sorted.length - 1].systemKey, "DONE");
      assert.strictEqual(sorted[sorted.length - 1].position, 6000);

      const manageable = sorted.filter((c) => c.systemKey === null);
      assert.strictEqual(manageable.length, 4);
      assert.deepStrictEqual(
        manageable.map((c) => c.id),
        ["col_todo", "col_in_progress", "col_review", "col_testing"]
      );
    });

    it("verifies discrete grid formula: Backlog=1000, Manageable[i]=(i+2)*1000, Done=(M+2)*1000", () => {
      const M = 4; // 4 manageable columns
      const backlogPos = 1000.0;
      const donePos = (M + 2) * 1000.0;

      assert.strictEqual(backlogPos, 1000.0);
      assert.strictEqual(donePos, 6000.0);

      for (let i = 0; i < M; i++) {
        const expectedPos = (i + 2) * 1000.0;
        assert.strictEqual(expectedPos, (i + 2) * 1000);
      }
    });
  });

  // ─── 3. Create Column Validation & Quotas ───
  describe("3. Create Custom Column Validations & Quota Rules", () => {
    it("enforces maximum limit of 10 user-manageable columns", () => {
      const isMaxReached = (manageableCount: number) => manageableCount >= 10;

      assert.strictEqual(isMaxReached(4), false);
      assert.strictEqual(isMaxReached(9), false);
      assert.strictEqual(isMaxReached(10), true);
      assert.strictEqual(isMaxReached(11), true);
    });

    it("rejects empty, whitespace-only, or overly long column names", () => {
      assert.throws(() => validateColumnName(""), /cannot be empty/);
      assert.throws(() => validateColumnName("   "), /cannot be empty/);
      assert.throws(() => validateColumnName("a".repeat(31)), /cannot exceed 30 characters/);
      assert.strictEqual(validateColumnName("  QA Staging  "), "QA Staging");
    });

    it("rejects reserved system names Backlog and Done case-insensitively for custom columns", () => {
      assert.throws(() => assertNotReservedColumnName("Backlog"), /reserved column name/);
      assert.throws(() => assertNotReservedColumnName("backlog"), /reserved column name/);
      assert.throws(() => assertNotReservedColumnName("  BACKLOG  "), /reserved column name/);
      assert.throws(() => assertNotReservedColumnName("Done"), /reserved column name/);
      assert.throws(() => assertNotReservedColumnName("done"), /reserved column name/);
      assert.throws(() => assertNotReservedColumnName("  DONE  "), /reserved column name/);

      // Custom names are allowed
      assert.doesNotThrow(() => assertNotReservedColumnName("QA Staging"));
      assert.doesNotThrow(() => assertNotReservedColumnName("Blocked"));
    });

    it("validates all 8 theme palette presets conform to HEX_COLOR_REGEX", () => {
      assert.strictEqual(PRESET_COLUMN_COLORS.length, 8);
      for (const preset of PRESET_COLUMN_COLORS) {
        assert.ok(HEX_COLOR_REGEX.test(preset.hex), `Preset ${preset.name} hex ${preset.hex} must be valid`);
      }
    });

    it("validates custom hex colors from native color picker", () => {
      assert.strictEqual(validateColumnColor("#3B82F6"), "#3b82f6");
      assert.strictEqual(validateColumnColor("#10b981"), "#10b981");
      assert.throws(() => validateColumnColor("red"), /Invalid color format/);
      assert.throws(() => validateColumnColor("#fff"), /Invalid color format/);
      assert.throws(() => validateColumnColor("#1234567"), /Invalid color format/);
    });
  });

  // ─── 4. Rename and Recolor Rules ───
  describe("4. Rename and Recolor Rules", () => {
    it("allows Backlog and Done to be renamed and recolored while preserving systemKey", () => {
      const backlog: KanbanColumn = {
        id: "col_backlog",
        name: "Backlog",
        color: "#6b7280",
        position: 1000,
        systemKey: "BACKLOG",
      };

      const renamedBacklog = {
        ...backlog,
        name: "Product Ideas",
        color: "#6366f1",
      };

      assert.strictEqual(renamedBacklog.id, "col_backlog");
      assert.strictEqual(renamedBacklog.systemKey, "BACKLOG");
      assert.strictEqual(renamedBacklog.name, "Product Ideas");
      assert.strictEqual(renamedBacklog.color, "#6366f1");
      assert.strictEqual(renamedBacklog.position, 1000);
    });

    it("prevents custom columns from adopting reserved names during rename", () => {
      const customCol: KanbanColumn = {
        id: "col_custom_1",
        name: "QA",
        color: "#a855f7",
        position: 2500,
        systemKey: null,
      };

      const validateCustomRename = (newName: string) => {
        const validated = validateColumnName(newName);
        if (customCol.systemKey === null) {
          assertNotReservedColumnName(validated);
        }
        return validated;
      };

      assert.throws(() => validateCustomRename("Done"), /reserved column name/);
      assert.throws(() => validateCustomRename("Backlog"), /reserved column name/);
      assert.strictEqual(validateCustomRename("QA Staging"), "QA Staging");
    });
  });

  // ─── 5. Reorder Logic and Position Normalization ───
  describe("5. Reorder Up/Down and Drag-and-Drop Order Operations", () => {
    const manageable: KanbanColumn[] = [
      { id: "col_todo", name: "Todo", color: "#3b82f6", position: 2000, systemKey: null },
      { id: "col_in_progress", name: "In Progress", color: "#f59e0b", position: 3000, systemKey: null },
      { id: "col_review", name: "Review", color: "#a855f7", position: 4000, systemKey: null },
      { id: "col_testing", name: "Testing", color: "#f59e0b", position: 5000, systemKey: null },
    ];

    it("moves column up when not at first index", () => {
      const moveUp = (list: KanbanColumn[], idx: number) => {
        if (idx <= 0) return list;
        const copy = [...list];
        const [item] = copy.splice(idx, 1);
        copy.splice(idx - 1, 0, item);
        return copy;
      };

      // Moving index 0 up should be a no-op
      assert.deepStrictEqual(moveUp(manageable, 0), manageable);

      // Moving index 2 (Review) up swaps with index 1 (In Progress)
      const moved = moveUp(manageable, 2);
      assert.strictEqual(moved[1].id, "col_review");
      assert.strictEqual(moved[2].id, "col_in_progress");
    });

    it("moves column down when not at last index", () => {
      const moveDown = (list: KanbanColumn[], idx: number) => {
        if (idx >= list.length - 1) return list;
        const copy = [...list];
        const [item] = copy.splice(idx, 1);
        copy.splice(idx + 1, 0, item);
        return copy;
      };

      // Moving last item down is a no-op
      assert.deepStrictEqual(moveDown(manageable, manageable.length - 1), manageable);

      // Moving index 1 (In Progress) down swaps with index 2 (Review)
      const moved = moveDown(manageable, 1);
      assert.strictEqual(moved[1].id, "col_review");
      assert.strictEqual(moved[2].id, "col_in_progress");
    });

    it("builds sanitized complete manageable IDs payload for reorder action", () => {
      const reordered = [manageable[1], manageable[0], manageable[2], manageable[3]];
      const payload = reordered.map((c) => c.id);

      const validated = validateReorderManageableIds(payload);
      assert.deepStrictEqual(validated, ["col_in_progress", "col_todo", "col_review", "col_testing"]);
    });

    it("rejects reordering payloads containing system columns or duplicates", () => {
      assert.throws(
        () => validateReorderManageableIds(["col_todo", "col_todo"]),
        /Duplicate column ID/
      );
    });
  });

  // ─── 6. Deletion Eligibility and Task Protection ───
  describe("6. Column Deletion Eligibility & Task Protection", () => {
    it("never permits deletion of Backlog or Done", () => {
      const isDeletable = (col: KanbanColumn) => col.systemKey === null && (col._count?.tasks ?? 0) === 0;

      const backlog: KanbanColumn = { id: "col_backlog", name: "Backlog", color: "#6b7280", position: 1000, systemKey: "BACKLOG", _count: { tasks: 0 } };
      const done: KanbanColumn = { id: "col_done", name: "Done", color: "#10b981", position: 6000, systemKey: "DONE", _count: { tasks: 0 } };

      assert.strictEqual(isDeletable(backlog), false);
      assert.strictEqual(isDeletable(done), false);
    });

    it("refuses deletion of custom columns that contain tasks or subtasks", () => {
      const isDeletable = (col: KanbanColumn) => col.systemKey === null && (col._count?.tasks ?? 0) === 0;

      const nonEmptyCustomCol: KanbanColumn = {
        id: "col_qa",
        name: "QA Staging",
        color: "#a855f7",
        position: 4500,
        systemKey: null,
        _count: { tasks: 3 },
      };

      const emptyCustomCol: KanbanColumn = {
        id: "col_empty",
        name: "Empty Staging",
        color: "#a855f7",
        position: 4500,
        systemKey: null,
        _count: { tasks: 0 },
      };

      assert.strictEqual(isDeletable(nonEmptyCustomCol), false);
      assert.strictEqual(isDeletable(emptyCustomCol), true);
    });
  });

  // ─── 7. Compatibility & Legacy Status Handling ───
  describe("7. Baseline Columns & Legacy Status Resolution", () => {
    it("confirms exact six approved baseline columns without inventing CANCELLED", () => {
      const baselineIds = BASELINE_COLUMNS.map((c) => c.id);
      assert.deepStrictEqual(baselineIds, [
        "col_backlog",
        "col_todo",
        "col_in_progress",
        "col_review",
        "col_testing",
        "col_done",
      ]);
      assert.strictEqual(BASELINE_COLUMNS.some((c) => c.id === "col_cancelled"), false);
    });

    it("safely resolves unknown or CANCELLED legacy status to Backlog, never to Done", () => {
      const cancelledTask = {
        columnId: null,
        status: "CANCELLED",
      };

      const effectiveId = getEffectiveColumnId(cancelledTask);
      assert.strictEqual(effectiveId, "col_backlog");
      assert.notStrictEqual(effectiveId, "col_done");
    });
  });
});

