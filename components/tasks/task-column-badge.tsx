import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BASELINE_COLUMNS, LEGACY_STATUS_TO_COLUMN_ID } from "@/lib/validations/board-column";

export interface TaskColumnBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  column?: {
    id?: string;
    name: string;
    color: string;
    systemKey?: string | null;
  } | null;
  status?: string | null;
  name?: string;
  color?: string;
  showDot?: boolean;
  size?: "sm" | "default";
}

/**
 * Theme-safe dynamic Kanban column badge.
 * - Background: 10% opacity tint (`${color}1a`)
 * - Border: 25% opacity border (`${color}40`)
 * - Text: High-contrast foreground (`var(--foreground)`)
 * - Swatch: Solid circular dot indicator in `${color}`
 */
export function TaskColumnBadge({
  column,
  status,
  name: propName,
  color: propColor,
  showDot = true,
  size = "default",
  className,
  children,
  ...props
}: TaskColumnBadgeProps) {
  // Determine resolved column details defensively
  let resolvedName = propName || column?.name;
  let resolvedColor = propColor || column?.color;

  // Defensive fallback if only legacy status is provided
  if (!resolvedName && status) {
    const colId = LEGACY_STATUS_TO_COLUMN_ID[status.toUpperCase()];
    const baseline = BASELINE_COLUMNS.find((c) => c.id === colId);
    if (baseline) {
      resolvedName = baseline.name;
      resolvedColor = baseline.color;
    } else {
      resolvedName = status.replace(/_/g, " ");
      resolvedColor = "#6b7280";
    }
  }

  // Final fallback to Backlog
  if (!resolvedName) resolvedName = "Backlog";
  if (!resolvedColor) resolvedColor = "#6b7280";

  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5 font-medium shadow-none transition-colors",
        size === "sm" ? "text-[10px] px-1.5 py-0.5 rounded-sm" : "text-xs px-2 py-0.5 rounded-md",
        className
      )}
      style={{
        backgroundColor: `${resolvedColor}1a`,
        borderColor: `${resolvedColor}40`,
        color: "var(--foreground)",
      }}
      {...props}
    >
      {showDot && (
        <span
          className={cn("rounded-full shrink-0", size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2")}
          style={{ backgroundColor: resolvedColor }}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{children || resolvedName}</span>
    </Badge>
  );
}

