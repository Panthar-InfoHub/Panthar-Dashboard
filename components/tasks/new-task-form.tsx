"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Check, Calendar as CalendarIcon, ChevronsUpDown, X, Paperclip, Loader2 } from "lucide-react";
import Link from "next/link";
import { createTaskAction, updateTaskAction } from "@/lib/actions/task.actions";
import { createAttachmentUploadAction, confirmAttachmentUploadAction } from "@/lib/actions/attachment.actions";
import { formatBytes, getFileIcon } from "@/components/tasks/task-attachments";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type TaskPriorityLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface TaskFormInitialData {
  id: string;
  title?: string;
  description?: string | null;
  priority?: TaskPriorityLevel;
  assignees?: { id: string }[];
  projectId?: string;
  startDate?: Date | string | null;
  dueDate?: Date | string | null;
  blockers?: string | null;
}

export function NewTaskForm({ 
  projects, 
  employees,
  initialData,
  canAssign,
  canManageAttachments = false
}: { 
  projects: { id: string; name: string }[];
  employees: { id: string; firstName: string; lastName: string }[];
  initialData?: TaskFormInitialData;
  canAssign?: boolean;
  canManageAttachments?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openAssignee, setOpenAssignee] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; id: string }[]>([]);
  const [fileStatuses, setFileStatuses] = useState<Record<string, "pending" | "uploading" | "success" | "failed">>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isUploading, setIsUploading] = useState(false);
  
  const [newTask, setNewTask] = useState<{
    title: string;
    description: string;
    priority: TaskPriorityLevel;
    assigneeIds: string[];
    project: string;
    startDate: Date | undefined;
    dueDate: Date | undefined;
    blockers: string;
  }>(() => {
    const start = initialData?.startDate ? new Date(initialData.startDate) : new Date();
    let due: Date | undefined;
    if (initialData?.dueDate) {
      due = new Date(initialData.dueDate);
    } else {
      due = new Date(start.getTime() + 7 * 86400000);
      due.setHours(23, 59, 59, 999);
    }
    return {
      title: initialData?.title || "", 
      description: initialData?.description || "",
      priority: (initialData?.priority as TaskPriorityLevel) || "MEDIUM", 
      assigneeIds: initialData?.assignees?.map((a: { id: string }) => a.id) || [],
      project: initialData?.projectId || projects[0]?.id || "",
      startDate: start,
      dueDate: due,
      blockers: initialData?.blockers || "",
    };
  });

  const toggleAssignee = (id: string) => {
    setNewTask(prev => {
      const current = prev.assigneeIds;
      if (current.includes(id)) {
        return { ...prev, assigneeIds: current.filter(a => a !== id) };
      }
      return { ...prev, assigneeIds: [...current, id] };
    });
  };

  const removeAssignee = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    toggleAssignee(id);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    const validFiles: { file: File; id: string }[] = [];
    let hasOversized = false;

    for (const file of files) {
      if (file.size > 52_428_800) {
        hasOversized = true;
      } else {
        const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.random()}`;
        validFiles.push({ file, id });
      }
    }

    if (hasOversized) {
      toast.error("Upload failed. The file is over 50 MB.");
    }

    if (validFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...validFiles]);
      setFileStatuses((prev) => {
        const next = { ...prev };
        validFiles.forEach((f) => {
          next[f.id] = "pending";
        });
        return next;
      });
    }

    e.target.value = "";
  };

  const removePendingFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
    setFileStatuses((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const uploadSingleFile = async (
    taskId: string,
    fileItem: { file: File; id: string },
    onProgress: (percent: number) => void
  ) => {
    const { file } = fileItem;

    // Step A: Request presigned PUT URL
    const { uploadUrl, key } = await createAttachmentUploadAction(taskId, {
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    });

    // Step B: Direct PUT upload to Cloudflare R2 via XHR to monitor upload progress
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const percent = Math.round((evt.loaded / evt.total) * 100);
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else if (xhr.status === 403) {
          reject(
            new Error("Storage access forbidden (403). Presigned URL expired or signature was rejected.")
          );
        } else if (xhr.status === 400) {
          reject(new Error("Storage rejected request (400 Bad Request)."));
        } else {
          reject(
            new Error(
              `Storage rejected upload with status ${xhr.status}${xhr.statusText ? ` (${xhr.statusText})` : ""}.`
            )
          );
        }
      };

      xhr.onerror = () => {
        if (xhr.status === 0) {
          reject(
            new Error(
              "Network error (CORS preflight failure). Ensure Cloudflare R2 bucket CORS allows PUT from this origin."
            )
          );
        } else {
          reject(new Error(`Network error during file upload (status ${xhr.status}).`));
        }
      };

      xhr.ontimeout = () => {
        reject(new Error("Upload timed out. Please check your network connection and try again."));
      };

      xhr.timeout = 120_000;
      xhr.send(file);
    });

    // Step C: Confirm upload with server to record metadata
    await confirmAttachmentUploadAction(taskId, {
      key,
      fileName: file.name,
    });
  };

  const handleCreateTask = () => {
    if (!newTask.title) {
      toast.error("Task title is required");
      return;
    }
    if (!newTask.project) {
      toast.error("Please select a project");
      return;
    }

    startTransition(async () => {
      let activeTaskId = initialData?.id || createdTaskId;

      try {
        if (initialData) {
          // Edit existing task
          await updateTaskAction(initialData.id, {
            title: newTask.title,
            description: newTask.description,
            projectId: newTask.project,
            assigneeIds: newTask.assigneeIds,
            priority: newTask.priority,
            startDate: newTask.startDate,
            dueDate: newTask.dueDate,
            blockers: newTask.blockers,
          });
          activeTaskId = initialData.id;
        } else if (createdTaskId) {
          // Task was already created on a prior attempt; update any task changes without recreating
          await updateTaskAction(createdTaskId, {
            title: newTask.title,
            description: newTask.description,
            projectId: newTask.project,
            assigneeIds: newTask.assigneeIds,
            priority: newTask.priority,
            startDate: newTask.startDate,
            dueDate: newTask.dueDate,
            blockers: newTask.blockers,
          });
          activeTaskId = createdTaskId;
        } else {
          // Create new task
          const res = await createTaskAction({
            title: newTask.title,
            description: newTask.description,
            projectId: newTask.project,
            assigneeIds: newTask.assigneeIds,
            priority: newTask.priority,
            startDate: newTask.startDate,
            dueDate: newTask.dueDate,
            blockers: newTask.blockers,
          });
          activeTaskId = res.taskId;
          setCreatedTaskId(res.taskId);
        }

        // Identify files that still need to be uploaded (excluding those that already succeeded)
        const filesToUpload = pendingFiles.filter((item) => fileStatuses[item.id] !== "success");

        if (filesToUpload.length === 0) {
          toast.success(initialData ? "Task updated successfully!" : "Task created successfully!");
          router.refresh();
          router.push(initialData ? `/tasks/${activeTaskId}` : "/tasks");
          return;
        }

        setIsUploading(true);
        const failedFiles: string[] = [];

        for (const item of filesToUpload) {
          setFileStatuses((prev) => ({ ...prev, [item.id]: "uploading" }));
          try {
            await uploadSingleFile(activeTaskId, item, (percent) => {
              setUploadProgress((prev) => ({ ...prev, [item.id]: percent }));
            });
            setFileStatuses((prev) => ({ ...prev, [item.id]: "success" }));
            setUploadProgress((prev) => ({ ...prev, [item.id]: 100 }));
            setFileErrors((prev) => {
              const next = { ...prev };
              delete next[item.id];
              return next;
            });
          } catch (err: unknown) {
            console.error("Upload failed for:", item.file.name, err);
            const errMsg = err instanceof Error ? err.message : "Upload failed.";
            setFileStatuses((prev) => ({ ...prev, [item.id]: "failed" }));
            setFileErrors((prev) => ({ ...prev, [item.id]: errMsg }));
            failedFiles.push(item.file.name);
          }
        }

        setIsUploading(false);

        if (failedFiles.length > 0) {
          toast.error(
            `Task saved, but ${failedFiles.length} file${failedFiles.length > 1 ? "s" : ""} failed to upload: ${failedFiles.join(", ")}. You can retry or view the task.`
          );
        } else {
          toast.success(initialData ? "Task updated and files attached!" : "Task created and files attached!");
          router.refresh();
          router.push(`/tasks/${activeTaskId}`);
        }
      } catch (err: unknown) {
        setIsUploading(false);
        toast.error(err instanceof Error ? err.message : "Failed to save task");
      }
    });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Top Bar */}
      <div className="px-6 py-4 border-b border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="flex items-center gap-4 min-w-0">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8 shrink-0" disabled={isPending || isUploading}>
            <Link href="/tasks">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold flex items-center gap-2 truncate">
              <span className="bg-primary/10 text-primary p-1.5 rounded-md shrink-0"><Plus className="h-4 w-4" /></span>
              <span className="truncate">
                {initialData ? "Edit Task" : createdTaskId ? "Task Created (Pending Uploads)" : "Create New Task"}
              </span>
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap sm:flex-nowrap w-full sm:w-auto gap-3">
          {createdTaskId ? (
            <Button variant="outline" asChild disabled={isPending || isUploading} className="flex-1 sm:flex-initial">
              <Link href={`/tasks/${createdTaskId}`}>View Task</Link>
            </Button>
          ) : (
            <Button variant="outline" asChild disabled={isPending || isUploading} className="flex-1 sm:flex-initial">
              <Link href="/tasks">Cancel</Link>
            </Button>
          )}
          <Button onClick={handleCreateTask} className="flex-1 sm:flex-initial sm:px-8" disabled={isPending || isUploading}>
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading files...
              </>
            ) : isPending ? (
              "Saving..."
            ) : initialData ? (
              "Save Changes"
            ) : createdTaskId ? (
              "Retry Failed Uploads"
            ) : (
              "Create Task"
            )}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-muted/10">
        <div className="max-w-5xl mx-auto grid md:grid-cols-[1fr_320px] gap-6 items-start">
          
          {/* Left Column */}
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task Title</label>
                <Input 
                  value={newTask.title} 
                  onChange={e => setNewTask({ ...newTask, title: e.target.value })} 
                  placeholder="E.g. Update user profile schema" 
                  className="text-lg font-medium"
                  autoFocus
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</label>
                <Textarea 
                  value={newTask.description} 
                  onChange={e => setNewTask({ ...newTask, description: e.target.value })} 
                  placeholder="Add more details to this task..." 
                  className="min-h-[200px] resize-none"
                />
              </div>

              <div className="space-y-2 pt-4 border-t border-border/50">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Blockers & Dependencies</label>
                <Textarea 
                  value={newTask.blockers} 
                  onChange={e => setNewTask({ ...newTask, blockers: e.target.value })} 
                  placeholder="Is this task blocked by anything?" 
                  className="min-h-[100px] resize-none"
                />
              </div>

              {/* Attachments Section */}
              {canManageAttachments && (
                <div className="space-y-3 pt-4 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Paperclip className="h-3.5 w-3.5" /> Attach Files
                    </label>
                    <span className="text-[11px] text-muted-foreground">Up to 50 MB per file</span>
                  </div>

                  <input
                    type="file"
                    id="task-file-upload"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                    disabled={isPending || isUploading}
                  />

                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-center border-dashed gap-2 h-9 text-xs"
                      onClick={() => document.getElementById("task-file-upload")?.click()}
                      disabled={isPending || isUploading}
                    >
                      <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Choose files to attach</span>
                    </Button>

                    {pendingFiles.length > 0 && (
                      <div className="space-y-1.5 mt-2">
                        {pendingFiles.map(({ file, id }) => {
                          const progress = uploadProgress[id];
                          const status = fileStatuses[id] || "pending";
                          const error = fileErrors[id];

                          return (
                            <div
                              key={id}
                              className={cn(
                                "flex flex-col gap-1 px-3 py-2 rounded-md border text-xs transition-colors",
                                status === "failed"
                                  ? "border-destructive/40 bg-destructive/5"
                                  : status === "success"
                                  ? "border-emerald-500/30 bg-emerald-500/5"
                                  : "border-border/50 bg-background"
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  {getFileIcon(file.name, file.type)}
                                  <span className="font-medium truncate text-foreground" title={file.name}>
                                    {file.name}
                                  </span>
                                  <span className="text-muted-foreground text-[11px] shrink-0">
                                    ({formatBytes(file.size)})
                                  </span>
                                  {status === "uploading" && progress !== undefined && (
                                    <span className="text-primary text-[10px] font-mono shrink-0 flex items-center gap-1">
                                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> {progress}%
                                    </span>
                                  )}
                                  {status === "success" && (
                                    <span className="text-emerald-600 dark:text-emerald-400 text-[10px] font-medium flex items-center gap-0.5 shrink-0">
                                      <Check className="h-3 w-3" /> Uploaded
                                    </span>
                                  )}
                                  {status === "failed" && (
                                    <Badge variant="destructive" className="text-[9px] py-0 px-1.5 h-4 shrink-0">
                                      Upload failed
                                    </Badge>
                                  )}
                                </div>
                                {status !== "uploading" && status !== "success" && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                                    onClick={() => removePendingFile(id)}
                                    disabled={isPending || isUploading}
                                  >
                                    <X className="h-3 w-3" />
                                    <span className="sr-only">Remove {file.name}</span>
                                  </Button>
                                )}
                              </div>
                              {status === "failed" && error && (
                                <p className="text-[11px] text-destructive leading-tight pl-6 font-normal">
                                  {error}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right Column - Sidebar */}
          <Card className="border-border/50 shadow-sm bg-muted/20">
            <CardContent className="p-6 space-y-5">
              <div className="space-y-1.5 flex flex-col">
                <label className="text-xs font-semibold text-muted-foreground">Project</label>
                <Select value={newTask.project} onValueChange={v => setNewTask({ ...newTask, project: v })}>
                  <SelectTrigger className="bg-background"><SelectValue placeholder="Select project" /></SelectTrigger>
                  <SelectContent>
                    {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    {projects.length === 0 && <SelectItem value="none" disabled>No active projects</SelectItem>}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 flex flex-col">
                <label className="text-xs font-semibold text-muted-foreground">Assignees</label>
                <Popover open={openAssignee} onOpenChange={setOpenAssignee}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={openAssignee}
                      className={cn("w-full justify-between bg-background font-normal h-auto min-h-[40px] px-3 py-2 text-left flex items-start", canAssign === false && "opacity-70 cursor-not-allowed")}
                      disabled={isPending || canAssign === false}
                    >
                      <div className="flex flex-wrap gap-1">
                        {newTask.assigneeIds.length > 0 ? (
                          newTask.assigneeIds.map(id => {
                            const emp = employees.find(e => e.id === id);
                            return emp ? (
                              <Badge variant="secondary" key={id} className="text-[10px] rounded-sm pr-1">
                                {emp.firstName} {emp.lastName}
                                <span 
                                  className={cn("ml-1 p-0.5 rounded-full", canAssign === false ? "opacity-50 cursor-not-allowed" : "hover:bg-muted cursor-pointer")} 
                                  onClick={(e) => {
                                    if (canAssign !== false) {
                                      removeAssignee(e, id);
                                    }
                                  }}
                                >
                                  <X className="h-2 w-2" />
                                </span>
                              </Badge>
                            ) : null;
                          })
                        ) : (
                          <span className="text-muted-foreground mt-0.5">Select assignees...</span>
                        )}
                      </div>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50 mt-1" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search team members..." />
                      <CommandList>
                        <CommandEmpty>No employee found.</CommandEmpty>
                        <CommandGroup>
                          {employees.map((employee) => (
                            <CommandItem
                              key={employee.id}
                              value={`${employee.firstName} ${employee.lastName}`}
                              onSelect={() => toggleAssignee(employee.id)}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  newTask.assigneeIds.includes(employee.id) ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {employee.firstName} {employee.lastName}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              
              <div className="h-px w-full bg-border/50 my-2" />
              
              <div className="space-y-1.5 flex flex-col">
                <label className="text-xs font-semibold text-muted-foreground">Priority</label>
                <Select value={newTask.priority} onValueChange={(v: TaskPriorityLevel) => setNewTask({ ...newTask, priority: v })}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="h-px w-full bg-border/50 my-2" />

              <div className="space-y-1.5 flex flex-col">
                <label className="text-xs font-semibold text-muted-foreground">Start Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal bg-background",
                        !newTask.startDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {newTask.startDate ? format(newTask.startDate, "PPP") : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={newTask.startDate}
                      onSelect={(d: Date | undefined) => setNewTask({ ...newTask, startDate: d })}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              
              <div className="space-y-1.5 flex flex-col">
                <label className="text-xs font-semibold text-muted-foreground">Deadline</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal bg-background",
                        !newTask.dueDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {newTask.dueDate ? format(newTask.dueDate, "PPP") : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={newTask.dueDate}
                      onSelect={(d: Date | undefined) => {
                        if (d) {
                          const end = new Date(d);
                          end.setHours(23, 59, 59, 999);
                          setNewTask({ ...newTask, dueDate: end });
                        } else {
                          setNewTask({ ...newTask, dueDate: undefined });
                        }
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
