import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateChecklistTitle,
  validateTaskId,
  validateItemId,
  validateReorderItemIds,
  MAX_CHECKLIST_TITLE_LENGTH,
} from "../../lib/validations/checklist";

function calculateProgress(items: { isCompleted: boolean }[]) {
  const totalItems = items.length;
  const completedItems = items.filter((i) => i.isCompleted).length;
  const remainingItems = totalItems - completedItems;
  const completionPercentage =
    totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 100);

  return { totalItems, completedItems, remainingItems, completionPercentage };
}

describe("Checklist Progress Formula Unit Tests", () => {
  it("calculates 0% when there are 0 items", () => {
    const res = calculateProgress([]);
    assert.strictEqual(res.totalItems, 0);
    assert.strictEqual(res.completedItems, 0);
    assert.strictEqual(res.remainingItems, 0);
    assert.strictEqual(res.completionPercentage, 0);
  });

  it("calculates 0% when no items are completed", () => {
    const res = calculateProgress([
      { isCompleted: false },
      { isCompleted: false },
      { isCompleted: false },
    ]);
    assert.strictEqual(res.totalItems, 3);
    assert.strictEqual(res.completedItems, 0);
    assert.strictEqual(res.remainingItems, 3);
    assert.strictEqual(res.completionPercentage, 0);
  });

  it("calculates 50% for 2 out of 4 completed", () => {
    const res = calculateProgress([
      { isCompleted: true },
      { isCompleted: true },
      { isCompleted: false },
      { isCompleted: false },
    ]);
    assert.strictEqual(res.totalItems, 4);
    assert.strictEqual(res.completedItems, 2);
    assert.strictEqual(res.remainingItems, 2);
    assert.strictEqual(res.completionPercentage, 50);
  });

  it("correctly rounds floating percentages (e.g. 1/3 = 33%, 2/3 = 67%)", () => {
    const oneThird = calculateProgress([
      { isCompleted: true },
      { isCompleted: false },
      { isCompleted: false },
    ]);
    assert.strictEqual(oneThird.completionPercentage, 33);
    assert.strictEqual(oneThird.remainingItems, 2);

    const twoThirds = calculateProgress([
      { isCompleted: true },
      { isCompleted: true },
      { isCompleted: false },
    ]);
    assert.strictEqual(twoThirds.completionPercentage, 67);
    assert.strictEqual(twoThirds.remainingItems, 1);
  });

  it("calculates 100% when all items are completed", () => {
    const res = calculateProgress([
      { isCompleted: true },
      { isCompleted: true },
      { isCompleted: true },
      { isCompleted: true },
    ]);
    assert.strictEqual(res.totalItems, 4);
    assert.strictEqual(res.completedItems, 4);
    assert.strictEqual(res.remainingItems, 0);
    assert.strictEqual(res.completionPercentage, 100);
  });
});

describe("Checklist Validation Unit Tests", () => {
  describe("validateChecklistTitle", () => {
    it("accepts valid normal title and returns trimmed version", () => {
      const res = validateChecklistTitle("  Write unit tests  ");
      assert.strictEqual(res, "Write unit tests");
    });

    it("accepts title at exact max length (255 characters)", () => {
      const longTitle = "a".repeat(MAX_CHECKLIST_TITLE_LENGTH);
      const res = validateChecklistTitle(longTitle);
      assert.strictEqual(res, longTitle);
    });

    it("rejects empty title", () => {
      assert.throws(() => validateChecklistTitle(""), {
        message: "Checklist item title cannot be empty or whitespace only.",
      });
    });

    it("rejects whitespace-only title", () => {
      assert.throws(() => validateChecklistTitle("   \t \n  "), {
        message: "Checklist item title cannot be empty or whitespace only.",
      });
    });

    it("rejects title exceeding 255 characters", () => {
      const tooLong = "a".repeat(MAX_CHECKLIST_TITLE_LENGTH + 1);
      assert.throws(() => validateChecklistTitle(tooLong), {
        message: `Checklist item title cannot exceed ${MAX_CHECKLIST_TITLE_LENGTH} characters.`,
      });
    });

    it("rejects non-string values", () => {
      assert.throws(() => validateChecklistTitle(null), {
        message: "Checklist item title must be a string.",
      });
      assert.throws(() => validateChecklistTitle(123), {
        message: "Checklist item title must be a string.",
      });
      assert.throws(() => validateChecklistTitle({}), {
        message: "Checklist item title must be a string.",
      });
    });
  });

  describe("validateTaskId and validateItemId", () => {
    it("accepts valid non-empty IDs", () => {
      assert.strictEqual(validateTaskId(" task_123 "), "task_123");
      assert.strictEqual(validateItemId(" item_456 "), "item_456");
    });

    it("rejects empty or whitespace IDs", () => {
      assert.throws(() => validateTaskId(""), { message: "Task ID is required." });
      assert.throws(() => validateTaskId("   "), { message: "Task ID is required." });
      assert.throws(() => validateItemId(""), { message: "Checklist item ID is required." });
      assert.throws(() => validateItemId("   "), { message: "Checklist item ID is required." });
    });
  });

  describe("validateReorderItemIds", () => {
    it("accepts an empty array and returns empty array", () => {
      const res = validateReorderItemIds([]);
      assert.deepStrictEqual(res, []);
    });

    it("accepts valid array of unique IDs", () => {
      const res = validateReorderItemIds(["id-1", "id-2", "id-3"]);
      assert.deepStrictEqual(res, ["id-1", "id-2", "id-3"]);
    });

    it("rejects non-array input", () => {
      assert.throws(() => validateReorderItemIds("not-array"), {
        message: "Invalid reorder payload: itemIds must be an array.",
      });
      assert.throws(() => validateReorderItemIds(null), {
        message: "Invalid reorder payload: itemIds must be an array.",
      });
    });

    it("rejects duplicates in reorder list", () => {
      assert.throws(() => validateReorderItemIds(["id-1", "id-2", "id-1"]), {
        message: "Duplicate checklist item ID detected in reorder list: id-1",
      });
    });

    it("rejects invalid item within array", () => {
      assert.throws(() => validateReorderItemIds(["id-1", "", "id-3"]), {
        message: "Invalid checklist item ID in reorder list.",
      });
    });
  });
});

