"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  KanbanColumn,
  PRESET_COLUMN_COLORS,
  HEX_COLOR_REGEX,
  MAX_COLUMN_NAME_LENGTH,
  RESERVED_COLUMN_NAMES,
} from "@/lib/validations/board-column";
import {
  getBoardColumnsAction,
  createBoardColumnAction,
  renameBoardColumnAction,
  updateBoardColumnColorAction,
  reorderBoardColumnsAction,
  deleteBoardColumnAction,
} from "@/lib/actions/board-column.actions";
import {
  Lock,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Columns3,
  AlertCircle,
  Check,
  Layers,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface BoardColumnsTabProps {
  initialColumns: KanbanColumn[];
}

const MAX_MANAGEABLE_COLUMNS = 10;

export function BoardColumnsTab({ initialColumns }: BoardColumnsTabProps) {
  const router = useRouter();
  const [columns, setColumns] = useState<KanbanColumn[]>(
    [...initialColumns].sort((a, b) => a.position - b.position)
  );
  const [isPending, startTransition] = useTransition();

  // Drag and drop state
  const [draggedColId, setDraggedColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  // Create modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>("#3b82f6");
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit modal state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingCol, setEditingCol] = useState<KanbanColumn | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>("#3b82f6");
  const [editError, setEditError] = useState<string | null>(null);

  // Delete dialog state
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingCol, setDeletingCol] = useState<KanbanColumn | null>(null);

  // Column separation
  const backlogCol = useMemo(() => columns.find((c) => c.systemKey === "BACKLOG"), [columns]);
  const doneCol = useMemo(() => columns.find((c) => c.systemKey === "DONE"), [columns]);
  const manageableCols = useMemo(() => columns.filter((c) => c.systemKey === null), [columns]);

  const isMaxManageableReached = manageableCols.length >= MAX_MANAGEABLE_COLUMNS;

  // Refresh authoritative column data from database
  const refreshColumns = async () => {
    try {
      const refreshed = await getBoardColumnsAction();
      setColumns([...refreshed].sort((a, b) => a.position - b.position));
      router.refresh();
    } catch (err: unknown) {
      console.error("Failed to refresh board columns:", err);
    }
  };

  // ─── Reorder Handlers ───
  const handleReorder = (newManageableList: KanbanColumn[]) => {
    const previousColumns = [...columns];
    const newManageableIds = newManageableList.map((c) => c.id);

    // Optimistically update local state
    const updatedFullList: KanbanColumn[] = [];
    if (backlogCol) updatedFullList.push(backlogCol);
    updatedFullList.push(...newManageableList);
    if (doneCol) updatedFullList.push(doneCol);

    setColumns(updatedFullList);

    startTransition(async () => {
      try {
        const res = await reorderBoardColumnsAction(newManageableIds);
        if (res?.success) {
          toast.success("Column order updated successfully.");
          await refreshColumns();
        }
      } catch (err: unknown) {
        setColumns(previousColumns);
        const msg = err instanceof Error ? err.message : "Failed to reorder columns.";
        toast.error(msg);
      }
    });
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const reordered = [...manageableCols];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(index - 1, 0, moved);
    handleReorder(reordered);
  };

  const handleMoveDown = (index: number) => {
    if (index >= manageableCols.length - 1) return;
    const reordered = [...manageableCols];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(index + 1, 0, moved);
    handleReorder(reordered);
  };

  // HTML5 Drag and drop
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedColId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverColId !== id) {
      setDragOverColId(id);
    }
  };

  const handleDragLeave = () => {
    setDragOverColId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverColId(null);
    const sourceId = draggedColId;
    setDraggedColId(null);

    if (!sourceId || sourceId === targetId) return;

    const sourceIndex = manageableCols.findIndex((c) => c.id === sourceId);
    const targetIndex = manageableCols.findIndex((c) => c.id === targetId);

    if (sourceIndex === -1 || targetIndex === -1) return;

    const reordered = [...manageableCols];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    handleReorder(reordered);
  };

  // ─── Create Column Handler ───
  const openCreateModal = () => {
    setNewName("");
    setNewColor("#3b82f6");
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const trimmed = newName.trim();
    if (!trimmed) {
      setCreateError("Column name cannot be empty.");
      return;
    }
    if (trimmed.length > MAX_COLUMN_NAME_LENGTH) {
      setCreateError(`Column name cannot exceed ${MAX_COLUMN_NAME_LENGTH} characters.`);
      return;
    }
    const normalized = trimmed.toLowerCase();
    if (RESERVED_COLUMN_NAMES.includes(normalized as (typeof RESERVED_COLUMN_NAMES)[number])) {
      setCreateError(`Cannot use reserved system name '${trimmed}'.`);
      return;
    }
    if (columns.some((c) => c.name.toLowerCase() === normalized)) {
      setCreateError(`A column named "${trimmed}" already exists.`);
      return;
    }
    if (!HEX_COLOR_REGEX.test(newColor)) {
      setCreateError("Invalid color format. Must be a valid 6-character hex string.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await createBoardColumnAction(trimmed, newColor);
        if (res?.success) {
          toast.success(`Column "${trimmed}" created successfully.`);
          setIsCreateOpen(false);
          await refreshColumns();
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to create board column.";
        setCreateError(msg);
        toast.error(msg);
      }
    });
  };

  // ─── Edit Column Handler ───
  const openEditModal = (col: KanbanColumn) => {
    setEditingCol(col);
    setEditName(col.name);
    setEditColor(col.color);
    setEditError(null);
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCol) return;
    setEditError(null);

    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError("Column name cannot be empty.");
      return;
    }
    if (trimmed.length > MAX_COLUMN_NAME_LENGTH) {
      setEditError(`Column name cannot exceed ${MAX_COLUMN_NAME_LENGTH} characters.`);
      return;
    }
    const normalized = trimmed.toLowerCase();
    if (
      editingCol.systemKey === null &&
      RESERVED_COLUMN_NAMES.includes(normalized as (typeof RESERVED_COLUMN_NAMES)[number])
    ) {
      setEditError(`Cannot use reserved system name '${trimmed}'.`);
      return;
    }
    if (columns.some((c) => c.id !== editingCol.id && c.name.toLowerCase() === normalized)) {
      setEditError(`A column named "${trimmed}" already exists.`);
      return;
    }
    if (!HEX_COLOR_REGEX.test(editColor)) {
      setEditError("Invalid color format. Must be a valid 6-character hex string.");
      return;
    }

    const nameChanged = trimmed !== editingCol.name;
    const colorChanged = editColor.toLowerCase() !== editingCol.color.toLowerCase();

    if (!nameChanged && !colorChanged) {
      setIsEditOpen(false);
      return;
    }

    startTransition(async () => {
      try {
        if (nameChanged) {
          await renameBoardColumnAction(editingCol.id, trimmed);
        }
        if (colorChanged) {
          await updateBoardColumnColorAction(editingCol.id, editColor);
        }

        toast.success(`Column "${trimmed}" updated successfully.`);
        setIsEditOpen(false);
        await refreshColumns();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to update board column.";
        setEditError(msg);
        toast.error(msg);
      }
    });
  };

  // ─── Delete Column Handler ───
  const openDeleteDialog = (col: KanbanColumn) => {
    setDeletingCol(col);
    setIsDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingCol) return;

    startTransition(async () => {
      try {
        const res = await deleteBoardColumnAction(deletingCol.id);
        if (res?.success) {
          toast.success(`Column "${deletingCol.name}" deleted successfully.`);
          setIsDeleteOpen(false);
          setDeletingCol(null);
          await refreshColumns();
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to delete board column.";
        toast.error(msg);
      }
    });
  };

  return (
    <div className="space-y-6 w-full">
      {/* Tab Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight flex items-center gap-2">
            <Columns3 className="h-5 w-5 text-primary" />
            Board Columns
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure Kanban workflow columns. Backlog is always first and Done is always last.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Badge variant="outline" className="text-xs px-2.5 py-1 gap-1.5 font-normal">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              <strong className="font-semibold text-foreground">{manageableCols.length}</strong> / {MAX_MANAGEABLE_COLUMNS} manageable
            </span>
          </Badge>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={openCreateModal}
                    disabled={isMaxManageableReached || isPending}
                    size="sm"
                    className="gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    Add Column
                  </Button>
                </span>
              </TooltipTrigger>
              {isMaxManageableReached && (
                <TooltipContent side="bottom">
                  Maximum limit of {MAX_MANAGEABLE_COLUMNS} user-manageable columns reached.
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Main Board Column Management List */}
      <Card className="border-border/50 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-border/40 pb-4 bg-muted/10 rounded-t-xl">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Workflow Sequence</span>
            <span className="text-xs font-normal text-muted-foreground">
              Total {columns.length} columns active
            </span>
          </CardTitle>
          <CardDescription>
            Reorder custom columns by dragging the handle or using the position controls.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-4 sm:p-6 space-y-2.5">
          {/* ── 1. PINNED BACKLOG COLUMN ── */}
          {backlogCol && (
            <div
              key={backlogCol.id}
              className="flex items-center justify-between p-3.5 rounded-lg border border-border/60 bg-muted/20"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs ring-2 ring-background"
                  style={{ backgroundColor: backlogCol.color }}
                  aria-hidden="true"
                />
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-medium text-sm text-foreground truncate">
                    {backlogCol.name}
                  </span>
                  <Badge variant="secondary" className="text-[11px] h-5 px-1.5 gap-1 font-normal bg-muted">
                    <Lock className="h-3 w-3 text-muted-foreground" />
                    System
                  </Badge>
                  <Badge variant="outline" className="text-[11px] h-5 px-1.5 font-normal text-muted-foreground">
                    Always first
                  </Badge>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-xs font-normal px-2 py-0.5">
                  {backlogCol._count?.tasks ?? 0} {backlogCol._count?.tasks === 1 ? "task" : "tasks"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => openEditModal(backlogCol)}
                  title="Rename or recolor Backlog"
                  aria-label="Edit Backlog column"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* ── 2. MANAGEABLE COLUMNS LIST ── */}
          {manageableCols.map((col, index) => {
            const isDragging = draggedColId === col.id;
            const isOver = dragOverColId === col.id;
            const taskCount = col._count?.tasks ?? 0;
            const hasTasks = taskCount > 0;

            return (
              <div
                key={col.id}
                draggable
                onDragStart={(e) => handleDragStart(e, col.id)}
                onDragOver={(e) => handleDragOver(e, col.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.id)}
                className={cn(
                  "flex items-center justify-between p-3.5 rounded-lg border bg-card transition-all duration-150",
                  isDragging && "opacity-40 scale-[0.99] border-dashed border-primary",
                  isOver && "border-primary ring-2 ring-primary/20 bg-primary/5",
                  !isDragging && !isOver && "border-border/60 hover:border-border hover:shadow-xs"
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Drag Handle */}
                  <div
                    className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5 -ml-1 transition-colors"
                    title="Drag to reorder column"
                    aria-label="Drag handle"
                  >
                    <GripVertical className="h-4 w-4" />
                  </div>

                  {/* Color Dot Swatch */}
                  <div
                    className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs ring-2 ring-background"
                    style={{ backgroundColor: col.color }}
                    aria-hidden="true"
                  />

                  {/* Column Title and Badges */}
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="font-medium text-sm text-foreground truncate">
                      {col.name}
                    </span>
                    <Badge variant="outline" className="text-[11px] h-5 px-1.5 font-normal text-muted-foreground">
                      Pos: {col.position}
                    </Badge>
                  </div>
                </div>

                {/* Actions & Ordering Controls */}
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {/* Task Count Badge */}
                  <Badge variant="outline" className="text-xs font-normal px-2 py-0.5">
                    {taskCount} {taskCount === 1 ? "task" : "tasks"}
                  </Badge>

                  {/* Up / Down accessible reordering controls */}
                  <div className="flex items-center border rounded-md overflow-hidden bg-background">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-none hover:bg-muted"
                      disabled={index === 0 || isPending}
                      onClick={() => handleMoveUp(index)}
                      title="Move column up"
                      aria-label="Move column up"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <div className="h-3 w-px bg-border" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-none hover:bg-muted"
                      disabled={index === manageableCols.length - 1 || isPending}
                      onClick={() => handleMoveDown(index)}
                      title="Move column down"
                      aria-label="Move column down"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Edit Column Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => openEditModal(col)}
                    title={`Edit ${col.name}`}
                    aria-label={`Edit ${col.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>

                  {/* Delete Column Button */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={hasTasks || isPending}
                            className={cn(
                              "h-8 w-8 transition-colors",
                              hasTasks
                                ? "text-muted-foreground/40 cursor-not-allowed"
                                : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            )}
                            onClick={() => openDeleteDialog(col)}
                            title={hasTasks ? `Cannot delete: contains ${taskCount} task(s)` : `Delete ${col.name}`}
                            aria-label={`Delete ${col.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {hasTasks && (
                        <TooltipContent side="left">
                          Cannot delete: contains {taskCount} {taskCount === 1 ? "task" : "tasks"}. Move or delete tasks first.
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            );
          })}

          {manageableCols.length === 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">
              No intermediate columns configured. Add columns using the button above.
            </div>
          )}

          {/* ── 3. PINNED DONE COLUMN ── */}
          {doneCol && (
            <div
              key={doneCol.id}
              className="flex items-center justify-between p-3.5 rounded-lg border border-border/60 bg-muted/20"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs ring-2 ring-background"
                  style={{ backgroundColor: doneCol.color }}
                  aria-hidden="true"
                />
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-medium text-sm text-foreground truncate">
                    {doneCol.name}
                  </span>
                  <Badge variant="secondary" className="text-[11px] h-5 px-1.5 gap-1 font-normal bg-muted">
                    <Lock className="h-3 w-3 text-muted-foreground" />
                    System
                  </Badge>
                  <Badge variant="outline" className="text-[11px] h-5 px-1.5 font-normal text-muted-foreground">
                    Always last
                  </Badge>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-xs font-normal px-2 py-0.5">
                  {doneCol._count?.tasks ?? 0} {doneCol._count?.tasks === 1 ? "task" : "tasks"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => openEditModal(doneCol)}
                  title="Rename or recolor Done"
                  aria-label="Edit Done column"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── CREATE COLUMN MODAL ── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Create Board Column
            </DialogTitle>
            <DialogDescription>
              Add a new column to your Kanban workflow. Custom columns are placed between Backlog and Done.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-4 py-2">
            {createError && (
              <div className="p-3 text-xs bg-destructive/10 text-destructive border border-destructive/20 rounded-md flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="create-column-name">Column Name</Label>
                <span className="text-[11px] text-muted-foreground">
                  {newName.trim().length} / {MAX_COLUMN_NAME_LENGTH}
                </span>
              </div>
              <Input
                id="create-column-name"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (createError) setCreateError(null);
                }}
                maxLength={MAX_COLUMN_NAME_LENGTH}
                placeholder="e.g. QA Staging, Design Review"
                autoFocus
                required
              />
            </div>

            <div className="space-y-2.5">
              <Label>Column Color</Label>

              {/* 8 Theme Palette Swatches */}
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {PRESET_COLUMN_COLORS.map((preset) => {
                  const isSelected = newColor.toLowerCase() === preset.hex.toLowerCase();
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => setNewColor(preset.hex)}
                      title={`${preset.name} (${preset.hex})`}
                      className={cn(
                        "h-8 w-full rounded-md flex items-center justify-center transition-all cursor-pointer shadow-xs",
                        isSelected ? "ring-2 ring-primary ring-offset-2 scale-105" : "hover:scale-105"
                      )}
                      style={{ backgroundColor: preset.hex }}
                    >
                      {isSelected && <Check className="h-4 w-4 text-white drop-shadow-sm" />}
                    </button>
                  );
                })}
              </div>

              {/* Native color picker & Hex Input */}
              <div className="flex items-center gap-2.5 pt-1">
                <div className="relative shrink-0">
                  <input
                    type="color"
                    id="create-color-picker"
                    value={HEX_COLOR_REGEX.test(newColor) ? newColor : "#3b82f6"}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-md border border-input p-1 bg-background"
                  />
                </div>
                <Input
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  placeholder="#3b82f6"
                  maxLength={7}
                  className="font-mono text-xs uppercase"
                />
              </div>

              {/* Live Preview Pill */}
              <div className="pt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Preview:</span>
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border"
                  style={{
                    backgroundColor: `${newColor}1a`,
                    borderColor: `${newColor}40`,
                    color: newColor,
                  }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: newColor }} />
                  {newName.trim() || "Column Preview"}
                </span>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !newName.trim()}>
                {isPending ? "Creating..." : "Create Column"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── EDIT COLUMN MODAL ── */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              Edit Column: {editingCol?.name}
            </DialogTitle>
            <DialogDescription>
              {editingCol?.systemKey !== null
                ? "System Column: Position and identity are locked, but you can customize the display name and color."
                : "Customize the column name and color."}
            </DialogDescription>
          </DialogHeader>

          {editingCol?.systemKey !== null && (
            <div className="p-3 text-xs bg-muted border rounded-md flex items-center gap-2 text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 text-primary" />
              <span>
                System keys cannot be modified. Completion logic and board positioning remain bound to this column.
              </span>
            </div>
          )}

          <form onSubmit={handleEditSubmit} className="space-y-4 py-2">
            {editError && (
              <div className="p-3 text-xs bg-destructive/10 text-destructive border border-destructive/20 rounded-md flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-column-name">Column Name</Label>
                <span className="text-[11px] text-muted-foreground">
                  {editName.trim().length} / {MAX_COLUMN_NAME_LENGTH}
                </span>
              </div>
              <Input
                id="edit-column-name"
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                  if (editError) setEditError(null);
                }}
                maxLength={MAX_COLUMN_NAME_LENGTH}
                required
              />
            </div>

            <div className="space-y-2.5">
              <Label>Column Color</Label>

              {/* 8 Theme Palette Swatches */}
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {PRESET_COLUMN_COLORS.map((preset) => {
                  const isSelected = editColor.toLowerCase() === preset.hex.toLowerCase();
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => setEditColor(preset.hex)}
                      title={`${preset.name} (${preset.hex})`}
                      className={cn(
                        "h-8 w-full rounded-md flex items-center justify-center transition-all cursor-pointer shadow-xs",
                        isSelected ? "ring-2 ring-primary ring-offset-2 scale-105" : "hover:scale-105"
                      )}
                      style={{ backgroundColor: preset.hex }}
                    >
                      {isSelected && <Check className="h-4 w-4 text-white drop-shadow-sm" />}
                    </button>
                  );
                })}
              </div>

              {/* Native color picker & Hex Input */}
              <div className="flex items-center gap-2.5 pt-1">
                <div className="relative shrink-0">
                  <input
                    type="color"
                    id="edit-color-picker"
                    value={HEX_COLOR_REGEX.test(editColor) ? editColor : "#3b82f6"}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-md border border-input p-1 bg-background"
                  />
                </div>
                <Input
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  placeholder="#3b82f6"
                  maxLength={7}
                  className="font-mono text-xs uppercase"
                />
              </div>

              {/* Live Preview */}
              <div className="pt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Preview:</span>
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border"
                  style={{
                    backgroundColor: `${editColor}1a`,
                    borderColor: `${editColor}40`,
                    color: editColor,
                  }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: editColor }} />
                  {editName.trim() || "Column Preview"}
                </span>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !editName.trim()}>
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── DELETE COLUMN CONFIRMATION ALERT DIALOG ── */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Delete Column &ldquo;{deletingCol?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {(deletingCol?._count?.tasks ?? 0) > 0 ? (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-md space-y-1">
                    <p className="font-semibold text-xs">Deletion Refused</p>
                    <p className="text-xs">
                      This column currently contains{" "}
                      <strong>{deletingCol?._count?.tasks} task(s)</strong>.
                      To protect project integrity, columns containing tasks cannot be deleted.
                      Please reassign or delete the tasks first.
                    </p>
                  </div>
                ) : (
                  <p>
                    Are you sure you want to permanently delete the custom column{" "}
                    <strong>&ldquo;{deletingCol?.name}&rdquo;</strong>?
                    Remaining columns will be automatically re-spaced. This action cannot be undone.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            {(deletingCol?._count?.tasks ?? 0) === 0 && (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleDeleteConfirm();
                }}
                disabled={isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isPending ? "Deleting..." : "Delete Column"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

