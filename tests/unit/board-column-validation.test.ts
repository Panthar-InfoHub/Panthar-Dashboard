import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateColumnName,
  assertNotReservedColumnName,
  validateColumnColor,
  validateColumnId,
  validateReorderManageableIds,
  MAX_COLUMN_NAME_LENGTH,
} from "../../lib/validations/board-column";

describe("Board Column Validation Unit Tests", () => {
  describe("validateColumnName", () => {
    it("accepts valid normal column name and trims whitespace", () => {
      assert.strictEqual(validateColumnName("  Quality Assurance  "), "Quality Assurance");
      assert.strictEqual(validateColumnName("Design Review"), "Design Review");
    });

    it("accepts name at exact max length (30 characters)", () => {
      const name30 = "A".repeat(30);
      assert.strictEqual(validateColumnName(name30), name30);
    });

    it("rejects empty or whitespace-only name", () => {
      assert.throws(() => validateColumnName(""), {
        name: "Error",
        message: /Column name cannot be empty/,
      });
      assert.throws(() => validateColumnName("   "), {
        name: "Error",
        message: /Column name cannot be empty/,
      });
    });

    it("rejects name exceeding 30 characters", () => {
      const name31 = "A".repeat(31);
      assert.throws(() => validateColumnName(name31), {
        name: "Error",
        message: new RegExp(`Column name cannot exceed ${MAX_COLUMN_NAME_LENGTH} characters`),
      });
    });

    it("rejects non-string values", () => {
      assert.throws(() => validateColumnName(null), {
        name: "Error",
        message: /Column name must be a string/,
      });
      assert.throws(() => validateColumnName(123), {
        name: "Error",
        message: /Column name must be a string/,
      });
      assert.throws(() => validateColumnName({}), {
        name: "Error",
        message: /Column name must be a string/,
      });
    });
  });

  describe("assertNotReservedColumnName", () => {
    it("rejects reserved name 'backlog' (case-insensitive)", () => {
      assert.throws(() => assertNotReservedColumnName("backlog"), {
        name: "Error",
        message: /RESERVED_NAME: Cannot use reserved column name 'backlog'/,
      });
      assert.throws(() => assertNotReservedColumnName("BACKLOG"), {
        name: "Error",
        message: /RESERVED_NAME: Cannot use reserved column name 'BACKLOG'/,
      });
      assert.throws(() => assertNotReservedColumnName("  Backlog  "), {
        name: "Error",
        message: /RESERVED_NAME: Cannot use reserved column name '  Backlog  '/,
      });
    });

    it("rejects reserved name 'done' (case-insensitive)", () => {
      assert.throws(() => assertNotReservedColumnName("done"), {
        name: "Error",
        message: /RESERVED_NAME: Cannot use reserved column name 'done'/,
      });
      assert.throws(() => assertNotReservedColumnName("DONE"), {
        name: "Error",
        message: /RESERVED_NAME: Cannot use reserved column name 'DONE'/,
      });
      assert.throws(() => assertNotReservedColumnName("  Done  "), {
        name: "Error",
        message: /RESERVED_NAME: Cannot use reserved column name '  Done  '/,
      });
    });

    it("allows non-reserved custom column names", () => {
      assert.doesNotThrow(() => assertNotReservedColumnName("Quality Assurance"));
      assert.doesNotThrow(() => assertNotReservedColumnName("In Review"));
      assert.doesNotThrow(() => assertNotReservedColumnName("Done Deal")); // contains "done" but is not "done"
      assert.doesNotThrow(() => assertNotReservedColumnName("Product Backlog")); // contains "backlog" but is not "backlog"
    });
  });

  describe("validateColumnColor", () => {
    it("accepts valid 6-character hex color and normalizes to lowercase", () => {
      assert.strictEqual(validateColumnColor("#3b82f6"), "#3b82f6");
      assert.strictEqual(validateColumnColor("#3B82F6"), "#3b82f6");
      assert.strictEqual(validateColumnColor("  #10B981  "), "#10b981");
      assert.strictEqual(validateColumnColor("#ffffff"), "#ffffff");
      assert.strictEqual(validateColumnColor("#000000"), "#000000");
    });

    it("rejects invalid hex formats", () => {
      assert.throws(() => validateColumnColor("#fff"), {
        name: "Error",
        message: /Invalid color format/,
      });
      assert.throws(() => validateColumnColor("3b82f6"), {
        name: "Error",
        message: /Invalid color format/,
      });
      assert.throws(() => validateColumnColor("#3b82f6aa"), {
        name: "Error",
        message: /Invalid color format/,
      });
      assert.throws(() => validateColumnColor("red"), {
        name: "Error",
        message: /Invalid color format/,
      });
      assert.throws(() => validateColumnColor("#gggggg"), {
        name: "Error",
        message: /Invalid color format/,
      });
    });

    it("rejects non-string values", () => {
      assert.throws(() => validateColumnColor(null), {
        name: "Error",
        message: /Column color must be a string/,
      });
      assert.throws(() => validateColumnColor(123), {
        name: "Error",
        message: /Column color must be a string/,
      });
    });
  });

  describe("validateColumnId", () => {
    it("accepts valid non-empty IDs", () => {
      assert.strictEqual(validateColumnId("col_123"), "col_123");
      assert.strictEqual(validateColumnId("  col_abc  "), "col_abc");
    });

    it("rejects empty, whitespace, or non-string IDs", () => {
      assert.throws(() => validateColumnId(""), {
        name: "Error",
        message: /Column ID is required/,
      });
      assert.throws(() => validateColumnId("   "), {
        name: "Error",
        message: /Column ID is required/,
      });
      assert.throws(() => validateColumnId(null), {
        name: "Error",
        message: /Column ID is required/,
      });
    });
  });

  describe("validateReorderManageableIds", () => {
    it("accepts valid array of unique IDs", () => {
      const result = validateReorderManageableIds(["col_1", "col_2", "col_3"]);
      assert.deepStrictEqual(result, ["col_1", "col_2", "col_3"]);
    });

    it("rejects non-array input", () => {
      assert.throws(() => validateReorderManageableIds(null), {
        name: "Error",
        message: /Invalid reorder payload: columnIds must be an array/,
      });
      assert.throws(() => validateReorderManageableIds("col_1"), {
        name: "Error",
        message: /Invalid reorder payload: columnIds must be an array/,
      });
    });

    it("rejects duplicates in reorder list", () => {
      assert.throws(() => validateReorderManageableIds(["col_1", "col_2", "col_1"]), {
        name: "Error",
        message: /Duplicate column ID detected in reorder list: col_1/,
      });
    });

    it("rejects invalid item within array", () => {
      assert.throws(() => validateReorderManageableIds(["col_1", "  ", "col_2"]), {
        name: "Error",
        message: /Invalid column ID in reorder list/,
      });
      assert.throws(() => validateReorderManageableIds(["col_1", null as unknown as string]), {
        name: "Error",
        message: /Invalid column ID in reorder list/,
      });
    });
  });
});

