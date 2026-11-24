"use client";

import { useState, useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  ListChecks,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createChecklistItemAction,
  updateChecklistItemAction,
  toggleChecklistItemAction,
  deleteChecklistItemAction,
} from "@/lib/actions/checklist.actions";
import { toast } from "sonner";
import { format } from "date-fns";

export interface ChecklistEmployee {
  id: string;
  firstName: string;
  lastName?: string | null;
  avatarUrl?: string | null;
}

export interface TaskChecklistItemData {
  id: string;
  taskId: string;
  title: string;
  isCompleted: boolean;
  order: number;
  completedAt?: Date | string | null;
  completedById?: string | null;
  completedBy?: ChecklistEmployee | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

interface TaskChecklistProps {
  taskId: string;
  initialItems: TaskChecklistItemData[];
  canEdit?: boolean;
  currentEmployee?: ChecklistEmployee | null;
}

export function TaskChecklist({
  taskId,
  initialItems = [],
  canEdit = true,
  currentEmployee,
}: TaskChecklistProps) {
  const [items, setItems] = useState<TaskChecklistItemData[]>(() =>
    [...initialItems].sort((a, b) => a.order - b.order)
  );

  // Sync state if initialItems prop updates from server revalidation
  const [prevInitialItems, setPrevInitialItems] = useState(initialItems);
  if (prevInitialItems !== initialItems) {
    setPrevInitialItems(initialItems);
    setItems([...initialItems].sort((a, b) => a.order - b.order));
  }

  const [newItemTitle, setNewItemTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ─── Create Handler ───
  const handleAddItem = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const title = newItemTitle.trim();
    if (!title || !canEdit || isAdding) return;

    setIsAdding(true);
    const tempId = `temp-${Date.now()}`;
    const nextOrder = items.length > 0 ? items[items.length - 1].order + 1000 : 1000;

    const optimisticItem: TaskChecklistItemData = {
      id: tempId,
      taskId,
      title,
      isCompleted: false,
      order: nextOrder,
    };

    // Optimistic insert
    setItems((prev) => [...prev, optimisticItem]);
    setNewItemTitle("");

    try {
      const res = await createChecklistItemAction({ taskId, title });
      if (res?.success && res.item) {
        setItems((prev) =>
          prev.map((i) => (i.id === tempId ? (res.item as TaskChecklistItemData) : i))
        );
        toast.success("Checklist item added");
      } else {
        throw new Error("Failed to add checklist item");
      }
    } catch (err: unknown) {
      setItems((prev) => prev.filter((i) => i.id !== tempId));
      toast.error(err instanceof Error ? err.message : "Failed to add checklist item");
    } finally {
      setIsAdding(false);
      inputRef.current?.focus();
    }
  };

  // ─── Toggle Handler ───
  const handleToggle = async (itemId: string, currentCompleted: boolean) => {
    if (!canEdit) return;

    const nextCompleted = !currentCompleted;
    const now = new Date();

    // Optimistic toggle
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? {
              ...i,
              isCompleted: nextCompleted,
              completedAt: nextCompleted ? now : null,
              completedById: nextCompleted ? currentEmployee?.id || null : null,
              completedBy: nextCompleted ? currentEmployee : null,
            }
          : i
      )
    );

    try {
      const res = await toggleChecklistItemAction({ itemId, isCompleted: nextCompleted });
      if (!res?.success) {
        throw new Error("Failed to toggle item");
      }
    } catch (err: unknown) {
      // Revert optimistic update
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? {
                ...i,
                isCompleted: currentCompleted,
                completedAt: currentCompleted ? i.completedAt : null,
                completedById: currentCompleted ? i.completedById : null,
                completedBy: currentCompleted ? i.completedBy : null,
              }
            : i
        )
      );
      toast.error(err instanceof Error ? err.message : "Failed to update item");
    }
  };

  // ─── Start Edit ───
  const handleStartEdit = (item: TaskChecklistItemData) => {
    if (!canEdit) return;
    setEditingItemId(item.id);
    setEditingTitle(item.title);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 50);
  };

  // ─── Save Edit ───
  const handleSaveEdit = async (itemId: string) => {
    const title = editingTitle.trim();
    if (!title) {
      toast.error("Checklist item title cannot be empty");
      return;
    }

    const previousItem = items.find((i) => i.id === itemId);
    if (!previousItem || previousItem.title === title) {
      setEditingItemId(null);
      return;
    }

    // Optimistic update
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, title } : i)));
    setEditingItemId(null);

    try {
      const res = await updateChecklistItemAction({ itemId, title });
      if (!res?.success) {
        throw new Error("Failed to update item title");
      }
      toast.success("Checklist item updated");
    } catch (err: unknown) {
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, title: previousItem.title } : i))
      );
      toast.error(err instanceof Error ? err.message : "Failed to update checklist item");
    }
  };

  // ─── Delete Handler ───
  const handleDelete = async (itemId: string) => {
    if (!canEdit) return;

    const previousItems = [...items];
    setItems((prev) => prev.filter((i) => i.id !== itemId));

    try {
      const res = await deleteChecklistItemAction({ itemId });
      if (!res?.success) {
        throw new Error("Failed to delete checklist item");
      }
      toast.success("Checklist item deleted");
    } catch (err: unknown) {
      setItems(previousItems);
      toast.error(err instanceof Error ? err.message : "Failed to delete item");
    }
  };

  return (
    <div className="pt-6 border-t border-border/40 space-y-3">
      {/* Checklist Heading */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-muted-foreground" /> Checklist
        </h3>
      </div>

      {/* Checklist Items Container */}
      <div className="border border-border/50 rounded-lg overflow-hidden bg-background/50 divide-y divide-border/30">
        {items.map((item) => {
          const isEditing = editingItemId === item.id;

          return (
            <div
              key={item.id}
              className="group relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/30 select-none"
            >
              {/* Checkbox */}
              <Checkbox
                id={`check-${item.id}`}
                checked={item.isCompleted}
                onCheckedChange={() => handleToggle(item.id, item.isCompleted)}
                disabled={!canEdit}
                className="mt-0.5"
                aria-label={`Mark "${item.title}" as ${item.isCompleted ? "incomplete" : "complete"}`}
              />

              {/* Item Title / Inline Editor */}
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveEdit(item.id);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Input
                      ref={editInputRef}
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditingItemId(null);
                      }}
                      className="h-7 text-xs px-2 py-0"
                      maxLength={255}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                      title="Save (Enter)"
                      aria-label="Save changes"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingItemId(null)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      title="Cancel (Esc)"
                      aria-label="Cancel editing"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span
                      onDoubleClick={() => handleStartEdit(item)}
                      className={cn(
                        "text-xs leading-relaxed break-words cursor-pointer transition-all",
                        item.isCompleted
                          ? "line-through text-muted-foreground/80 dark:text-muted-foreground/60"
                          : "text-foreground font-normal hover:text-primary/90"
                      )}
                      title={canEdit ? "Double-click to edit" : undefined}
                    >
                      {item.title}
                    </span>

                    {/* Completion Metadata Badge/Tooltip */}
                    {item.isCompleted && item.completedBy && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded cursor-default">
                              <Avatar className="h-3.5 w-3.5">
                                <AvatarImage src={item.completedBy.avatarUrl || undefined} />
                                <AvatarFallback className="text-[7px]">
                                  {item.completedBy.firstName?.charAt(0) || "U"}
                                </AvatarFallback>
                              </Avatar>
                              <span className="hidden sm:inline">
                                {item.completedBy.firstName}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            Completed by {item.completedBy.firstName}{" "}
                            {item.completedBy.lastName || ""}
                            {item.completedAt && (
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {format(new Date(item.completedAt), "MMM d, yyyy h:mm a")}
                              </div>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons (Edit & Delete) */}
              {canEdit && !isEditing && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleStartEdit(item)}
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    title="Edit item"
                    aria-label="Edit item"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(item.id)}
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Delete item"
                    aria-label="Delete item"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {/* Empty State */}
        {items.length === 0 && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No checklist items yet. Add the first step below.
          </div>
        )}
      </div>

      {/* Add New Checklist Item Form */}
      {canEdit && (
        <form onSubmit={handleAddItem} className="flex items-center gap-2">
          <Input
            ref={inputRef}
            placeholder="Add a checklist item... (press Enter to add)"
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.target.value)}
            disabled={isAdding}
            maxLength={255}
            className="text-xs h-8 bg-background border-dashed focus:border-solid transition-colors"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!newItemTitle.trim() || isAdding}
            className="h-8 text-xs shrink-0 px-3"
          >
            {isAdding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </>
            )}
          </Button>
        </form>
      )}
    </div>
  );
}
