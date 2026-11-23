"use client";

import { useState, useTransition, useMemo, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Filter, Search, ClipboardList, Clock, Loader2, X, CheckSquare, Paperclip, ListTree } from "lucide-react";
import { updateTaskStatusAction, rebalanceColumnTasksAction } from "@/lib/actions/task.actions";
import { toast } from "sonner";
import { format, isPast, isToday, endOfDay } from "date-fns";

const priorityColors: Record<string, string> = { 
  CRITICAL: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 hover:bg-red-500/20", 
  HIGH: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20 hover:bg-orange-500/20", 
  MEDIUM: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 hover:bg-blue-500/20", 
  LOW: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20 hover:bg-gray-500/20" 
};

const priorityDots: Record<string, string> = { 
  CRITICAL: "bg-red-500", 
  HIGH: "bg-orange-500", 
  MEDIUM: "bg-blue-500", 
  LOW: "bg-gray-500" 
};

import {
  type KanbanColumn,
  BASELINE_COLUMNS,
  LEGACY_STATUS_TO_COLUMN_ID,
  getEffectiveColumnId,
} from "@/lib/validations/board-column";

export {
  type KanbanColumn,
  BASELINE_COLUMNS,
  LEGACY_STATUS_TO_COLUMN_ID,
  getEffectiveColumnId,
};

export interface KanbanTaskAssignee {
  id: string;
  firstName: string;
  lastName?: string;
  avatarUrl?: string | null;
}

export interface KanbanSubtask {
  id: string;
  title: string;
  status?: string;
  columnId?: string | null;
}

export interface KanbanTaskProject {
  id: string;
  name: string;
  team?: {
    id: string;
    name: string;
  } | null;
}

export interface KanbanTaskItem {
  id: string;
  title: string;
  description?: string | null;
  status?: string;
  columnId?: string | null;
  column?: {
    id: string;
    name: string;
    color: string;
    position: number;
    systemKey: string | null;
  } | null;
  priority: string;
  order: number;
  updatedAt: Date | string;
  dueDate?: Date | string | null;
  isBlocked?: boolean;
  blockerReason?: string | null;
  creatorId?: string | null;
  completedAt?: Date | string | null;
  labels?: string[];
  project?: KanbanTaskProject | null;
  assignees?: KanbanTaskAssignee[];
  subtasks?: KanbanSubtask[];
  checklistItems?: { id: string; isCompleted: boolean }[];
  _count?: {
    attachments?: number;
    checklistItems?: number;
    subtasks?: number;
  };
}

export interface KanbanProjectOption {
  id: string;
  name: string;
}

export interface KanbanTeamOption {
  id: string;
  name: string;
}

export interface KanbanEmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
}

export function KanbanBoard({ 
  initialTasks, 
  columns = [],
  allowedProjects = [], 
  allowedTeams = [], 
  allEmployees = [],
  currentEmployeeId,
}: { 
  initialTasks: KanbanTaskItem[]; 
  columns?: KanbanColumn[];
  allowedProjects?: KanbanProjectOption[]; 
  allowedTeams?: KanbanTeamOption[]; 
  allEmployees?: KanbanEmployeeOption[];
  currentEmployeeId: string;
  employeeRole?: string;
}) {
  const [taskList, setTaskList] = useState(initialTasks);
  const searchParams = useSearchParams();
  const [isFilterPending, startFilterTransition] = useTransition();
  const [showAllDone, setShowAllDone] = useState(false);
  
  // Drag-and-drop snapping & insertion state
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverInfo, setDragOverInfo] = useState<{
    columnId: string;
    index: number; // insertion target index in the column
  } | null>(null);

  // In-flight column & order changes to protect optimistic UI against stale server revalidations
  const inFlightColumnUpdatesRef = useRef<Map<string, { columnId: string; order?: number }>>(new Map());

  const [optimisticFilters, setOptimisticFilters] = useState<{
    team?: string;
    project?: string;
    assignee?: string;
    search?: string;
  }>({});
  
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const router = useRouter();

  // Sort active columns by position ascending (Backlog first, manageable middle, Done last)
  const activeColumns = useMemo(() => {
    const list = columns && columns.length > 0 ? [...columns] : [...BASELINE_COLUMNS];
    return list.sort((a, b) => a.position - b.position);
  }, [columns]);

  useEffect(() => {
    // Preserve any optimistic updates that are still in flight with the server
    setTaskList(
      initialTasks.map(t => {
        const inFlight = inFlightColumnUpdatesRef.current.get(t.id);
        const effectiveColId = getEffectiveColumnId(t);
        return inFlight 
          ? { ...t, columnId: inFlight.columnId, ...(inFlight.order !== undefined ? { order: inFlight.order } : {}) } 
          : { ...t, columnId: effectiveColId };
      })
    );
    setOptimisticFilters({});
  }, [initialTasks]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  const urlTeam = optimisticFilters.team !== undefined ? optimisticFilters.team : (searchParams.get("team") || "ALL");
  const urlProject = optimisticFilters.project !== undefined ? optimisticFilters.project : (searchParams.get("project") || "ALL");
  const urlAssignee = optimisticFilters.assignee !== undefined ? optimisticFilters.assignee : (searchParams.get("assignee") || "ALL");
  const urlSearch = optimisticFilters.search !== undefined ? optimisticFilters.search : (searchParams.get("search") || "");

  // Build filter options combining explicit lists with task references
  const teams = useMemo(() => {
    const map = new Map(allowedTeams.map(t => [t.id, t]));
    initialTasks.forEach(t => {
      if (t.project?.team) map.set(t.project.team.id, t.project.team);
    });
    return Array.from(map.values());
  }, [allowedTeams, initialTasks]);

  const projects = useMemo(() => {
    const map = new Map(allowedProjects.map(p => [p.id, p]));
    initialTasks.forEach(t => {
      if (t.project) map.set(t.project.id, t.project);
    });
    return Array.from(map.values());
  }, [allowedProjects, initialTasks]);

  // Client-side filtering for immediate feedback
  const filteredTasks = useMemo(() => {
    return taskList.filter(t => {
      const matchSearch = !urlSearch || 
                          t.title.toLowerCase().includes(urlSearch.toLowerCase()) || 
                          (t.project?.name || "").toLowerCase().includes(urlSearch.toLowerCase());
      const matchTeam = urlTeam === "ALL" || t.project?.team?.id === urlTeam;
      const matchProject = urlProject === "ALL" || t.project?.id === urlProject;
      const matchAssignee = urlAssignee === "ALL" || 
                            (urlAssignee === "UNASSIGNED" ? (!t.assignees || t.assignees.length === 0) : (t.assignees && t.assignees.some((a: KanbanTaskAssignee) => a.id === urlAssignee)));
      
      return matchSearch && matchTeam && matchProject && matchAssignee;
    });
  }, [taskList, urlSearch, urlTeam, urlProject, urlAssignee]);

  // Tasks grouped dynamically by columnId, sorted by order asc, then updatedAt desc
  const tasksByColumn = useMemo(() => {
    const map: Record<string, KanbanTaskItem[]> = {};
    for (const col of activeColumns) {
      map[col.id] = [];
    }
    for (const t of filteredTasks) {
      const colId = getEffectiveColumnId(t);
      if (map[colId]) {
        map[colId].push(t);
      } else {
        map[colId] = [t];
      }
    }
    for (const key in map) {
      map[key].sort((a, b) => {
        const orderA = a.order ?? 0;
        const orderB = b.order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      });
    }
    return map;
  }, [activeColumns, filteredTasks]);

  // In the List view, push Done tasks to the bottom, then sort by order
  const listTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      const aDone = a.column?.systemKey === "DONE" || a.status === "DONE";
      const bDone = b.column?.systemKey === "DONE" || b.status === "DONE";
      if (aDone && !bDone) return 1;
      if (!aDone && bDone) return -1;
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });
  }, [filteredTasks]);

  const updateUrlFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "ALL" || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    setOptimisticFilters(prev => ({ ...prev, [key]: value }));
    startFilterTransition(() => {
      router.push(`?${params.toString()}`);
    });
  };

  const clearAllFilters = () => {
    setOptimisticFilters({
      team: "ALL",
      project: "ALL",
      assignee: "ALL",
      search: "",
    });
    startFilterTransition(() => {
      router.push("/tasks");
    });
  };

  // Collision-proof fractional indexing algorithm for midpoint ordering
  const calculateNewOrder = (colTasks: KanbanTaskItem[], targetIndex: number): number => {
    if (colTasks.length === 0) {
      return 1000;
    }
    if (targetIndex <= 0) {
      const firstOrder = (colTasks[0]?.order && colTasks[0].order !== 0) ? colTasks[0].order : 1000;
      return firstOrder - 500;
    }
    if (targetIndex >= colTasks.length) {
      const lastOrder = (colTasks[colTasks.length - 1]?.order && colTasks[colTasks.length - 1].order !== 0) 
        ? colTasks[colTasks.length - 1].order 
        : (colTasks.length * 1000);
      return lastOrder + 500;
    }
    
    // Effective orders with automatic zero-collision resolution
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

  // Drag and drop event handlers
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("taskId", taskId);
    e.dataTransfer.effectAllowed = "move";
    setDraggedTaskId(taskId);
  };

  const handleDragEnd = () => {
    setDraggedTaskId(null);
    setDragOverInfo(null);
  };

  const handleColumnDragOver = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const colTasks = (tasksByColumn[targetColumnId] || []).filter(t => t.id !== draggedTaskId);
    setDragOverInfo(prev => {
      if (prev && prev.columnId === targetColumnId) return prev;
      return { columnId: targetColumnId, index: colTasks.length };
    });
  };

  const handleCardDragOver = (e: React.DragEvent, targetColumnId: string, cardIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const insertIndex = e.clientY < midY ? cardIndex : cardIndex + 1;

    setDragOverInfo({
      columnId: targetColumnId,
      index: insertIndex,
    });
  };

  const handleDrop = async (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const taskId = e.dataTransfer.getData("taskId") || draggedTaskId;
    const currentDragInfo = dragOverInfo;
    
    setDraggedTaskId(null);
    setDragOverInfo(null);

    if (!taskId) return;
    const task = taskList.find(t => t.id === taskId);
    if (!task) return;

    const targetCol = activeColumns.find(c => c.id === targetColumnId);
    if (!targetCol) return;

    const oldColumnId = getEffectiveColumnId(task);
    const oldOrder = task.order ?? 0;

    // Remaining tasks in target column (excluding the dragged task)
    const otherTasksInTarget = (tasksByColumn[targetColumnId] || []).filter(t => t.id !== taskId);
    
    const targetIndex = currentDragInfo && currentDragInfo.columnId === targetColumnId
      ? Math.min(Math.max(0, currentDragInfo.index), otherTasksInTarget.length)
      : otherTasksInTarget.length;

    const newOrder = calculateNewOrder(otherTasksInTarget, targetIndex);

    // If neither column nor position changed, skip
    if (oldColumnId === targetColumnId && Math.abs((task.order ?? 0) - newOrder) < 0.0001) {
      return;
    }

    // Check if the gap between adjacent tasks is getting too tight (under 0.001)
    const prevOrder = targetIndex > 0 ? (otherTasksInTarget[targetIndex - 1]?.order ?? 0) : 0;
    const nextOrder = targetIndex < otherTasksInTarget.length ? (otherTasksInTarget[targetIndex]?.order ?? 0) : 0;
    const isGapTooTight = targetIndex > 0 && targetIndex < otherTasksInTarget.length && Math.abs(nextOrder - prevOrder) < 0.001;

    // 1. Instant Optimistic UI Update (Zero delay, zero loaders)
    const isDoneTransition = targetCol.systemKey === "DONE";
    const wasDone = task.column?.systemKey === "DONE";
    const updatedTask: KanbanTaskItem = {
      ...task,
      columnId: targetColumnId,
      column: targetCol,
      status: targetCol.systemKey || (targetCol.id === "col_backlog" ? "BACKLOG" : (targetCol.id === "col_done" ? "DONE" : task.status || "")),
      order: newOrder,
      completedAt: isDoneTransition ? new Date() : (wasDone ? null : task.completedAt),
    };

    if (isGapTooTight) {
      // Auto-rebalance the column tasks back to clean 1,000-unit spaced integers
      const rebalanced = [...otherTasksInTarget];
      rebalanced.splice(targetIndex, 0, updatedTask);
      const idToOrder = new Map(rebalanced.map((t, idx) => [t.id, (idx + 1) * 1000]));

      setTaskList(prev => prev.map(t => idToOrder.has(t.id) ? { ...t, order: idToOrder.get(t.id)!, ...(t.id === taskId ? { columnId: targetColumnId, column: targetCol } : {}) } : t));
      
      // Persist column change and column rebalance in background
      updateTaskStatusAction(taskId, targetColumnId, idToOrder.get(taskId)!)
        .then(() => rebalanceColumnTasksAction(rebalanced.map(t => t.id)))
        .then(() => toast.success("Task updated"))
        .catch(() => {
          setTaskList(prev => prev.map(t => t.id === taskId ? { ...t, columnId: oldColumnId, order: oldOrder } : t));
          toast.error("Failed to update task position");
        });
      return;
    }

    setTaskList(prev => prev.map(t => t.id === taskId ? updatedTask : t));

    // 2. Track in-flight update to prevent server revalidation race conditions
    inFlightColumnUpdatesRef.current.set(taskId, { columnId: targetColumnId, order: newOrder });

    // 3. Background Async Server Action
    try {
      const res = await updateTaskStatusAction(taskId, targetColumnId, newOrder);
      if (!res?.success) {
        throw new Error("Failed to update status");
      }
      toast.success("Task updated");
    } catch (err: unknown) {
      // Revert optimistic update
      setTaskList(prev => prev.map(t => t.id === taskId ? { ...t, columnId: oldColumnId, order: oldOrder } : t));
      toast.error(err instanceof Error ? err.message : "Failed to update task");
    } finally {
      inFlightColumnUpdatesRef.current.delete(taskId);
    }
  };

  const hasActiveFilters = urlTeam !== "ALL" || urlProject !== "ALL" || urlAssignee !== "ALL" || urlSearch !== "";

  return (
    <div className="flex flex-col gap-4 flex-1 min-w-0">
      {/* Top filter toolbar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0 flex-wrap">
        <div className="relative flex-1 w-full min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder="Search tasks…" 
            defaultValue={urlSearch}
            onChange={(e) => {
              const val = e.target.value;
              if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
              searchTimeoutRef.current = setTimeout(() => {
                updateUrlFilter("search", val || "ALL");
              }, 400);
            }}
            className="pl-9 pr-9 h-9 text-xs" 
          />
          {isFilterPending && (
            <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground pointer-events-none" />
          )}
        </div>
        
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className={cn("flex items-center gap-2 px-3 h-9 rounded-md border border-border/50 bg-background shrink-0 transition-colors", urlAssignee === currentEmployeeId && "border-primary/50 bg-primary/5 text-foreground")}>
            <Switch 
              id="my-tasks" 
              checked={urlAssignee === currentEmployeeId} 
              onCheckedChange={(checked) => updateUrlFilter("assignee", checked ? currentEmployeeId : "ALL")}
            />
            <Label htmlFor="my-tasks" className="text-xs font-medium cursor-pointer">My Tasks</Label>
          </div>

          <Select value={urlTeam} onValueChange={(v) => updateUrlFilter("team", v)}>
            <SelectTrigger className={cn("h-9 min-w-[130px] max-w-[160px] text-xs transition-colors", urlTeam !== "ALL" && "border-primary/50 bg-primary/5 text-foreground font-medium")}>
              <div className="flex items-center gap-1.5 truncate">
                <Filter className={cn("h-3.5 w-3.5 shrink-0", urlTeam !== "ALL" ? "text-primary" : "text-muted-foreground")} />
                <SelectValue placeholder="All Teams" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Teams</SelectItem>
              {teams.map((t: KanbanTeamOption) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={urlProject} onValueChange={(v) => updateUrlFilter("project", v)}>
            <SelectTrigger className={cn("h-9 min-w-[130px] max-w-[160px] text-xs transition-colors", urlProject !== "ALL" && "border-primary/50 bg-primary/5 text-foreground font-medium")}>
              <div className="flex items-center gap-1.5 truncate">
                <Filter className={cn("h-3.5 w-3.5 shrink-0", urlProject !== "ALL" ? "text-primary" : "text-muted-foreground")} />
                <SelectValue placeholder="All Projects" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Projects</SelectItem>
              {projects.map((p: KanbanProjectOption) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={urlAssignee} onValueChange={(v) => updateUrlFilter("assignee", v)}>
            <SelectTrigger className={cn("h-9 min-w-[130px] max-w-[160px] text-xs transition-colors", urlAssignee !== "ALL" && "border-primary/50 bg-primary/5 text-foreground font-medium")}>
              <div className="flex items-center gap-1.5 truncate">
                <Filter className={cn("h-3.5 w-3.5 shrink-0", urlAssignee !== "ALL" ? "text-primary" : "text-muted-foreground")} />
                <SelectValue placeholder="All Assignees" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Assignees</SelectItem>
              <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
              {allEmployees.map((e: KanbanEmployeeOption) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1 border border-dashed border-border/60 hover:border-border hover:bg-muted/40"
            >
              <X className="h-3 w-3" />
              <span>Reset</span>
            </Button>
          )}
        </div>
      </div>

      {filteredTasks.length === 0 ? (
        <EmptyState 
          icon={ClipboardList}
          title={hasActiveFilters ? "No tasks match your filters" : "No tasks found"}
          description={hasActiveFilters ? "Try adjusting your search or filters to see more tasks." : "There are no tasks assigned to you or in your active projects yet."}
          {...(!hasActiveFilters ? { actionLabel: "Create New Task", actionHref: "/tasks/new" } : {
            actionLabel: "Clear Filters",
            onAction: clearAllFilters
          })}
          className="mt-6 h-[380px]"
        />
      ) : (
        <Tabs defaultValue="board" className="flex-1 flex flex-col min-w-0">
          <TabsList className="shrink-0 w-fit">
            <TabsTrigger value="board" className="text-xs">Board</TabsTrigger>
            <TabsTrigger value="list" className="text-xs">List</TabsTrigger>
          </TabsList>

          <TabsContent value="board" className="mt-0 pt-4 flex-1 focus-visible:outline-none">
            <div className="flex overflow-x-auto pb-4 gap-4 snap-x [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {activeColumns.map(col => {
                const colTasks = tasksByColumn[col.id] || [];
                const isDoneCol = col.systemKey === "DONE";
                const visibleTasks = (isDoneCol && !showAllDone) ? colTasks.slice(0, 8) : colTasks;
                const isColumnActive = dragOverInfo?.columnId === col.id;

                return (
                  <div 
                    key={col.id} 
                    className={cn(
                      "flex flex-col rounded-lg p-2.5 border transition-colors min-h-[120px] min-w-[280px] max-w-[280px] snap-center shrink-0",
                      isColumnActive ? "border-primary/40 bg-muted/20" : "bg-muted/10 border-border/40"
                    )}
                    onDragOver={(e) => handleColumnDragOver(e, col.id)}
                    onDrop={(e) => handleDrop(e, col.id)}
                  >
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant="outline" 
                          className="text-[10px] font-medium flex items-center gap-1.5 px-2 py-0.5"
                          style={{
                            backgroundColor: `${col.color}15`,
                            borderColor: `${col.color}35`,
                            color: col.color,
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                          <span>{col.name}</span>
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-medium">{colTasks.length}</span>
                      </div>
                    </div>

                    <div className="space-y-2 flex-1 pr-1 pb-2 max-h-[calc(100vh-250px)] overflow-y-auto custom-scrollbar min-h-[80px]">
                      {visibleTasks.map((task, idx) => {
                        const assignee = task.assignees && task.assignees.length > 0 ? task.assignees[0] : null;
                        const isDraggingCurrent = draggedTaskId === task.id;
                        const showInsertionBarBefore = isColumnActive && dragOverInfo.index === idx;

                        return (
                          <div key={task.id} className="flex flex-col">
                            {/* Snapping insertion indicator bar before this card */}
                            {showInsertionBarBefore && (
                              <div className="py-1 flex items-center justify-center pointer-events-none transition-all duration-150">
                                <div className="h-1 w-full rounded-full bg-primary ring-2 ring-primary/30 shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                              </div>
                            )}

                            <Card 
                              draggable
                              onDragStart={(e) => handleDragStart(e, task.id)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => handleCardDragOver(e, col.id, idx)}
                              onClick={() => router.push(`/tasks/${task.id}`)}
                              className={cn(
                                "border-border/40 shadow-none hover:border-border transition-all hover:bg-muted/20 cursor-grab active:cursor-grabbing rounded-md select-none",
                                isDraggingCurrent && "opacity-35 border-dashed scale-[0.98]"
                              )}
                            >
                              <CardContent className="p-2.5 flex flex-col gap-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex flex-col gap-0.5 min-w-0">
                                    {task.project?.name && (
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                                        {task.project.team?.name ? `${task.project.team.name} › ` : ""}{task.project.name}
                                      </span>
                                    )}
                                    <p className="text-xs font-semibold leading-tight text-foreground">{task.title}</p>
                                  </div>
                                  <Avatar className="h-5 w-5 shrink-0 ring-1 ring-border/50">
                                    {assignee ? (
                                      <>
                                        <AvatarImage src={assignee.avatarUrl || undefined} />
                                        <AvatarFallback className="text-[8px] bg-primary/10">{assignee.firstName?.charAt(0)}</AvatarFallback>
                                      </>
                                    ) : (
                                      <AvatarFallback className="text-[8px] bg-muted text-muted-foreground border-dashed">?</AvatarFallback>
                                    )}
                                  </Avatar>
                                </div>

                                <div className="flex items-center justify-between mt-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", priorityDots[task.priority] || "bg-muted")} title={`Priority: ${task.priority}`} />
                                    {task.dueDate && (() => {
                                      const date = new Date(task.dueDate);
                                      const isOverdue = !isDoneCol && !isToday(date) && isPast(endOfDay(date));
                                      return (
                                        <span className={cn("text-[9px] font-medium flex items-center gap-1", isOverdue ? "text-red-500/90 font-medium" : "text-muted-foreground")}>
                                          <Clock className={cn("h-2.5 w-2.5", isOverdue && "text-red-500")} />
                                          <span>Target: {format(date, "MMM d")}</span>
                                          {isOverdue && (
                                            <span className="text-[8px] text-red-600 dark:text-red-400 font-semibold uppercase tracking-wider ml-0.5">
                                              (Overdue)
                                            </span>
                                          )}
                                        </span>
                                      );
                                    })()}

                                    {/* Checklist item indicator (Ticket 1) */}
                                    {task.checklistItems && task.checklistItems.length > 0 && (() => {
                                      const total = task.checklistItems.length;
                                      const completed = task.checklistItems.filter(i => i.isCompleted).length;
                                      return (
                                        <span className="text-[9px] font-medium text-muted-foreground flex items-center gap-1" title={`${completed}/${total} checklist items completed`}>
                                          <CheckSquare className="h-2.5 w-2.5 text-muted-foreground" />
                                          <span>{completed}/{total}</span>
                                        </span>
                                      );
                                    })()}

                                    {/* Attachment count indicator (Ticket 2) */}
                                    {(task._count?.attachments ?? 0) > 0 && (
                                      <span className="text-[9px] font-medium text-muted-foreground flex items-center gap-1" title={`${task._count?.attachments} attachment(s)`}>
                                        <Paperclip className="h-2.5 w-2.5 text-muted-foreground" />
                                        <span>{task._count?.attachments}</span>
                                      </span>
                                    )}

                                    {/* Subtask count indicator */}
                                    {task.subtasks && task.subtasks.length > 0 && (
                                      <span className="text-[9px] font-medium text-muted-foreground flex items-center gap-1" title={`${task.subtasks.length} subtask(s)`}>
                                        <ListTree className="h-2.5 w-2.5 text-muted-foreground" />
                                        <span>{task.subtasks.length}</span>
                                      </span>
                                    )}
                                  </div>
                                  
                                  {task.labels && task.labels.length > 0 && (
                                    <div className="flex gap-1 shrink-0">
                                      {task.labels.slice(0, 1).map((l: string) => (
                                        <span key={l} className="rounded text-[8px] font-medium bg-accent text-muted-foreground px-1 py-0.5 max-w-[60px] truncate">{l}</span>
                                      ))}
                                      {task.labels.length > 1 && <span className="rounded text-[8px] font-medium bg-accent text-muted-foreground px-1 py-0.5">+{task.labels.length - 1}</span>}
                                    </div>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          </div>
                        );
                      })}

                      {/* Snapping insertion indicator bar at the bottom of the column */}
                      {isColumnActive && dragOverInfo.index >= visibleTasks.length && (
                        <div className="py-1 flex items-center justify-center pointer-events-none transition-all duration-150">
                          <div className="h-1 w-full rounded-full bg-primary ring-2 ring-primary/30 shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                        </div>
                      )}

                      {isDoneCol && colTasks.length > 8 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-[11px] h-7 text-muted-foreground hover:text-foreground mt-1 border border-dashed border-border/50 bg-background/50 hover:bg-background"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowAllDone(prev => !prev);
                          }}
                        >
                          {showAllDone ? "Show recent only" : `Show all completed (+${colTasks.length - 8})`}
                        </Button>
                      )}

                      {visibleTasks.length === 0 && (
                        <div className={cn(
                          "rounded-lg border border-dashed p-4 text-center transition-colors",
                          isColumnActive ? "border-primary/60 bg-primary/5 text-primary" : "border-border/50 text-muted-foreground"
                        )}>
                          <p className="text-[11px] font-medium">{isColumnActive ? "Drop here" : "No tasks"}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="list" className="mt-0 pt-4 flex-1 overflow-y-auto focus-visible:outline-none">
            <div className="border border-border/40 rounded-lg overflow-x-auto bg-background">
              <Table className="min-w-[1000px]">
                <TableHeader className="bg-muted/20">
                  <TableRow>
                    <TableHead className="min-w-[250px] font-medium text-[11px] uppercase tracking-wider">Task</TableHead>
                    <TableHead className="min-w-[120px] font-medium text-[11px] uppercase tracking-wider">Column</TableHead>
                    <TableHead className="min-w-[120px] font-medium text-[11px] uppercase tracking-wider">Priority</TableHead>
                    <TableHead className="min-w-[150px] font-medium text-[11px] uppercase tracking-wider">Assignee</TableHead>
                    <TableHead className="min-w-[120px] font-medium text-[11px] uppercase tracking-wider">Due Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listTasks.map(task => {
                    const assignee = task.assignees && task.assignees.length > 0 ? task.assignees[0] : null;
                    const colId = getEffectiveColumnId(task);
                    const col = activeColumns.find(c => c.id === colId);
                    const isDone = col?.systemKey === "DONE";

                    return (
                      <TableRow 
                        key={task.id} 
                        onClick={() => router.push(`/tasks/${task.id}`)}
                        className="cursor-pointer hover:bg-muted/30"
                      >
                        <TableCell>
                          <div className="min-w-0">
                            {task.project?.name && (
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider truncate block">
                                {task.project.team?.name ? `${task.project.team.name} › ` : ""}{task.project.name}
                              </span>
                            )}
                            <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {col ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] shadow-none flex items-center gap-1.5 w-fit px-2 py-0.5"
                              style={{
                                backgroundColor: `${col.color}15`,
                                borderColor: `${col.color}35`,
                                color: col.color,
                              }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                              <span>{col.name}</span>
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] shadow-none">
                              {task.column?.name || "Backlog"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[10px] shadow-none", priorityColors[task.priority])}>
                            <div className={cn("w-1.5 h-1.5 rounded-full mr-1.5", priorityDots[task.priority])} />
                            {task.priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {assignee ? (
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={assignee.avatarUrl || undefined} />
                                <AvatarFallback className="text-[10px] bg-primary/10">{assignee.firstName?.charAt(0)}</AvatarFallback>
                              </Avatar>
                              <span className="text-xs font-medium truncate">{assignee.firstName} {assignee.lastName}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {task.dueDate ? (() => {
                            const date = new Date(task.dueDate);
                            const isOverdue = !isDone && !isToday(date) && isPast(endOfDay(date));
                            return (
                              <div className="flex items-center gap-1.5 text-xs flex-wrap">
                                <Clock className={cn("h-3.5 w-3.5", isOverdue ? "text-red-500" : "text-muted-foreground")} />
                                <span className={isOverdue ? "text-red-500/90 font-medium" : "text-muted-foreground"}>
                                  Target: {format(date, "MMM d, yyyy")}
                                </span>
                                {isOverdue && (
                                  <Badge variant="outline" className="border-red-500/20 bg-red-500/10 text-[9px] text-red-600 dark:text-red-400 py-0 px-1 font-medium">
                                    Overdue
                                  </Badge>
                                )}
                              </div>
                            );
                          })() : <span className="text-xs text-muted-foreground">-</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
