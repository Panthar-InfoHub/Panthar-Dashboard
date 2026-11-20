/**
 * Server-side validation helpers for Task Checklist operations.
 */

export const MAX_CHECKLIST_TITLE_LENGTH = 255;

export function validateChecklistTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Checklist item title must be a string.");
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("Checklist item title cannot be empty or whitespace only.");
  }

  if (trimmed.length > MAX_CHECKLIST_TITLE_LENGTH) {
    throw new Error(`Checklist item title cannot exceed ${MAX_CHECKLIST_TITLE_LENGTH} characters.`);
  }

  return trimmed;
}

export function validateTaskId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Task ID is required.");
  }
  return value.trim();
}

export function validateItemId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Checklist item ID is required.");
  }
  return value.trim();
}

export function validateReorderItemIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid reorder payload: itemIds must be an array.");
  }

  if (value.length === 0) {
    return [];
  }

  const sanitized: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error("Invalid checklist item ID in reorder list.");
    }
    const id = item.trim();
    if (seen.has(id)) {
      throw new Error(`Duplicate checklist item ID detected in reorder list: ${id}`);
    }
    seen.add(id);
    sanitized.push(id);
  }

  return sanitized;
}

