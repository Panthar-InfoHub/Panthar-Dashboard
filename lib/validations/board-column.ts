/**
 * Server-side validation helpers for Board Column operations.
 */

export const MAX_COLUMN_NAME_LENGTH = 30;
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
export const RESERVED_COLUMN_NAMES = ["backlog", "done"] as const;

export function validateColumnName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Column name must be a string.");
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("Column name cannot be empty or whitespace only.");
  }

  if (trimmed.length > MAX_COLUMN_NAME_LENGTH) {
    throw new Error(`Column name cannot exceed ${MAX_COLUMN_NAME_LENGTH} characters.`);
  }

  return trimmed;
}

export function assertNotReservedColumnName(name: string): void {
  const normalized = name.trim().toLowerCase();
  if (RESERVED_COLUMN_NAMES.includes(normalized as (typeof RESERVED_COLUMN_NAMES)[number])) {
    throw new Error(`RESERVED_NAME: Cannot use reserved column name '${name}'.`);
  }
}

export function validateColumnColor(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Column color must be a string.");
  }

  const trimmed = value.trim();

  if (!HEX_COLOR_REGEX.test(trimmed)) {
    throw new Error("Invalid color format. Must be a 6-character hex code starting with # (e.g. #3b82f6).");
  }

  return trimmed.toLowerCase();
}

export function validateColumnId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Column ID is required.");
  }
  return value.trim();
}

export function validateReorderManageableIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid reorder payload: columnIds must be an array.");
  }

  const sanitized: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error("Invalid column ID in reorder list.");
    }
    const id = item.trim();
    if (seen.has(id)) {
      throw new Error(`Duplicate column ID detected in reorder list: ${id}`);
    }
    seen.add(id);
    sanitized.push(id);
  }

  return sanitized;
}

export interface KanbanColumn {
  id: string;
  name: string;
  color: string;
  position: number;
  systemKey: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  _count?: {
    tasks: number;
  };
}

export const PRESET_COLUMN_COLORS = [
  { name: "Gray", hex: "#6b7280" },
  { name: "Slate", hex: "#64748b" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Purple", hex: "#a855f7" },
  { name: "Amber", hex: "#f59e0b" },
  { name: "Emerald", hex: "#10b981" },
  { name: "Rose", hex: "#f43f5e" },
  { name: "Indigo", hex: "#6366f1" },
] as const;

export const BASELINE_COLUMNS: KanbanColumn[] = [
  { id: "col_backlog", name: "Backlog", color: "#6b7280", position: 1000.0, systemKey: "BACKLOG" },
  { id: "col_todo", name: "Todo", color: "#3b82f6", position: 2000.0, systemKey: null },
  { id: "col_in_progress", name: "In Progress", color: "#f59e0b", position: 3000.0, systemKey: null },
  { id: "col_review", name: "Review", color: "#a855f7", position: 4000.0, systemKey: null },
  { id: "col_testing", name: "Testing", color: "#f59e0b", position: 5000.0, systemKey: null },
  { id: "col_done", name: "Done", color: "#10b981", position: 6000.0, systemKey: "DONE" },
];

export const LEGACY_STATUS_TO_COLUMN_ID: Record<string, string> = {
  BACKLOG: "col_backlog",
  TODO: "col_todo",
  IN_PROGRESS: "col_in_progress",
  REVIEW: "col_review",
  TESTING: "col_testing",
  DONE: "col_done",
};

/**
 * Defensive column resolution:
 * Uses authoritative non-null columnId when present.
 * During the transitional expand phase, maps legacy task.status to corresponding baseline column.
 * Defaults to Backlog if neither is available.
 */
export function getEffectiveColumnId(task: { columnId?: string | null; status?: string | null }): string {
  if (task.columnId) return task.columnId;
  if (task.status && LEGACY_STATUS_TO_COLUMN_ID[task.status]) {
    return LEGACY_STATUS_TO_COLUMN_ID[task.status];
  }
  return "col_backlog";
}


