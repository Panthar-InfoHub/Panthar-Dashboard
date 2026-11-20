"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Paperclip,
  Download,
  Trash2,
  FileText,
  FileImage,
  FileArchive,
  FileSpreadsheet,
  FileCode,
  File,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getAttachmentDownloadUrlAction, deleteAttachmentAction } from "@/lib/actions/attachment.actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface TaskAttachmentItemData {
  id: string;
  taskId: string;
  fileName: string;
  fileKey: string;
  contentType: string;
  size: number;
  uploadedById: string;
  createdAt: Date | string;
  uploadedBy?: {
    id: string;
    firstName: string;
    lastName?: string | null;
    avatarUrl?: string | null;
  } | null;
}

interface TaskAttachmentsProps {
  taskId?: string;
  isSubtask?: boolean;
  attachments?: TaskAttachmentItemData[];
  canManage?: boolean;
}

import { formatBytes } from "@/lib/validations/attachment";
export { formatBytes };

export function getFileIcon(fileName: string, contentType?: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const mime = contentType?.toLowerCase() || "";

  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext) || mime.startsWith("image/")) {
    return <FileImage className="h-4 w-4 text-sky-500 shrink-0" />;
  }
  if (["pdf", "doc", "docx", "txt", "rtf", "odt"].includes(ext) || mime.includes("pdf") || mime.includes("word")) {
    return <FileText className="h-4 w-4 text-rose-500 shrink-0" />;
  }
  if (["xls", "xlsx", "csv", "tsv", "ods"].includes(ext) || mime.includes("spreadsheet") || mime.includes("csv") || mime.includes("excel")) {
    return <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />;
  }
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext) || mime.includes("zip") || mime.includes("compressed") || mime.includes("archive")) {
    return <FileArchive className="h-4 w-4 text-amber-500 shrink-0" />;
  }
  if (["js", "ts", "jsx", "tsx", "json", "html", "css", "py", "sh", "sql"].includes(ext)) {
    return <FileCode className="h-4 w-4 text-indigo-500 shrink-0" />;
  }
  return <File className="h-4 w-4 text-muted-foreground shrink-0" />;
}

export function TaskAttachments({
  isSubtask = false,
  attachments = [],
  canManage = false,
}: TaskAttachmentsProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Subtasks never support attachments per spec requirement
  if (isSubtask) {
    return null;
  }

  const handleDownload = async (attachment: TaskAttachmentItemData) => {
    try {
      setDownloadingId(attachment.id);
      const res = await getAttachmentDownloadUrlAction(attachment.id);

      // Trigger download via anchor element
      const link = document.createElement("a");
      link.href = res.downloadUrl;
      link.download = res.fileName || attachment.fileName;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to retrieve download link. Please try again."
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = (attachmentId: string) => {
    setDeletingId(attachmentId);
    startTransition(async () => {
      try {
        await deleteAttachmentAction(attachmentId);
        toast.success("File deleted");
      } catch (err: unknown) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete attachment."
        );
      } finally {
        setDeletingId(null);
      }
    });
  };

  return (
    <div className="pt-6 border-t border-border/40 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2 text-foreground">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <span>Attachments</span>
          {attachments.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground font-mono">
              {attachments.length}
            </span>
          )}
        </h3>
      </div>

      {attachments.length === 0 ? (
        <div className="py-4 px-3 rounded-lg border border-dashed border-border/50 text-center">
          <p className="text-xs text-muted-foreground">No files attached yet.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {attachments.map((attachment) => {
            const isDeleting = deletingId === attachment.id;
            const isDownloading = downloadingId === attachment.id;
            const createdDate = new Date(attachment.createdAt);

            return (
              <div
                key={attachment.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border/40 bg-card/50 hover:bg-muted/40 transition-colors text-sm",
                  isDeleting && "opacity-50 pointer-events-none"
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {getFileIcon(attachment.fileName, attachment.contentType)}
                  <div className="min-w-0 flex-1">
                    <p
                      className="font-medium text-xs text-foreground truncate"
                      title={attachment.fileName}
                    >
                      {attachment.fileName}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                      <span>{formatBytes(attachment.size)}</span>
                      <span>•</span>
                      {attachment.uploadedBy && (
                        <div className="flex items-center gap-1 truncate">
                          <Avatar className="h-3.5 w-3.5">
                            <AvatarImage src={attachment.uploadedBy.avatarUrl || undefined} />
                            <AvatarFallback className="text-[9px]">
                              {attachment.uploadedBy.firstName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate">{attachment.uploadedBy.firstName}</span>
                          <span>•</span>
                        </div>
                      )}
                      <span>
                        {formatDistanceToNow(createdDate, { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => handleDownload(attachment)}
                    disabled={isDownloading || isDeleting}
                    title="Download file"
                  >
                    {isDownloading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    <span className="sr-only">Download {attachment.fileName}</span>
                  </Button>

                  {canManage && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          disabled={isDeleting || isPending}
                          title="Delete attachment"
                        >
                          {isDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          <span className="sr-only">Delete {attachment.fileName}</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete attachment?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete{" "}
                            <span className="font-semibold text-foreground">
                              {attachment.fileName}
                            </span>
                            ? This file will be permanently removed from storage.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(attachment.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
