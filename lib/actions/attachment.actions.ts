"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentEmployee, checkPermission } from "@/lib/auth";
import { assertCanViewTask } from "@/lib/queries/task.queries";
import {
  getUploadUrl,
  getDownloadUrl,
  headObject,
  deleteObject,
} from "@/lib/r2";

const MAX_FILE_SIZE_BYTES = 52_428_800; // 50 MB (50 * 1024 * 1024)

/**
 * Generates a cuid-like random identifier for file keys.
 */
function generateKeyId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString("hex");
  return `c${timestamp}${random}`;
}

/**
 * Sanitizes original filename to safe characters for object storage key.
 */
function sanitizeFileName(fileName: string): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(-100) || "attachment";
}

/**
 * Step 1: Initiates a direct browser-to-R2 upload by issuing a 5-minute presigned PUT URL.
 * Requires task:create OR task:update permission.
 * Rejects subtasks and files over 50 MB.
 */
export async function createAttachmentUploadAction(
  taskId: string,
  input: {
    fileName: string;
    contentType?: string;
    size: number;
  }
) {
  await getCurrentEmployee();
  const canCreate = await checkPermission("task:create");
  const canUpdate = await checkPermission("task:update");
  if (!canCreate && !canUpdate) {
    throw new Error("FORBIDDEN: Requires task:create or task:update permission.");
  }

  if (!taskId || typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("Task ID is required.");
  }
  if (!input || !input.fileName || typeof input.fileName !== "string" || !input.fileName.trim()) {
    throw new Error("File name is required.");
  }
  if (typeof input.size !== "number" || input.size <= 0) {
    throw new Error("Invalid file size.");
  }
  if (input.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("File size exceeds 50 MB limit.");
  }

  const cleanTaskId = taskId.trim();
  const task = await db.task.findUnique({
    where: { id: cleanTaskId },
    select: { id: true, parentId: true },
  });

  if (!task) {
    throw new Error("Task not found.");
  }
  if (task.parentId !== null) {
    throw new Error("Attachments are not supported on subtasks.");
  }

  const contentType = (input.contentType && typeof input.contentType === "string" && input.contentType.trim())
    ? input.contentType.trim().slice(0, 100)
    : "application/octet-stream";

  const keyId = generateKeyId();
  const sanitizedName = sanitizeFileName(input.fileName.trim());
  const objectKey = `tasks/${task.id}/${keyId}-${sanitizedName}`;

  const uploadUrl = await getUploadUrl(objectKey, contentType, input.size);

  return {
    uploadUrl,
    key: objectKey,
  };
}

/**
 * Step 2: Confirms an upload after the browser has directly transferred the file to R2.
 * Uses HeadObject in R2 to verify existence and actual byte length before creating PostgreSQL record.
 * Idempotent against repeated submissions.
 */
export async function confirmAttachmentUploadAction(
  taskId: string,
  input: {
    key: string;
    fileName: string;
  }
) {
  const employee = await getCurrentEmployee();
  const canCreate = await checkPermission("task:create");
  const canUpdate = await checkPermission("task:update");
  if (!canCreate && !canUpdate) {
    throw new Error("FORBIDDEN: Requires task:create or task:update permission.");
  }

  if (!taskId || typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("Task ID is required.");
  }
  if (!input || !input.key || typeof input.key !== "string" || !input.key.trim()) {
    throw new Error("Object key is required.");
  }
  if (!input.fileName || typeof input.fileName !== "string" || !input.fileName.trim()) {
    throw new Error("File name is required.");
  }

  const cleanTaskId = taskId.trim();
  const cleanKey = input.key.trim();
  const cleanFileName = input.fileName.trim();

  // Enforce task isolation: key must strictly start with tasks/<taskId>/
  const expectedPrefix = `tasks/${cleanTaskId}/`;
  if (!cleanKey.startsWith(expectedPrefix)) {
    throw new Error("Invalid object key for this task.");
  }

  const task = await db.task.findUnique({
    where: { id: cleanTaskId },
    select: { id: true, parentId: true },
  });

  if (!task) {
    throw new Error("Task not found.");
  }
  if (task.parentId !== null) {
    throw new Error("Attachments are not supported on subtasks.");
  }

  // Idempotency: If this object key was already confirmed, return existing record
  const existing = await db.taskAttachment.findUnique({
    where: { fileKey: cleanKey },
    include: {
      uploadedBy: {
        select: { id: true, firstName: true, lastName: true, avatarUrl: true },
      },
    },
  });
  if (existing) {
    return { success: true, attachment: existing };
  }

  // Authoritative check via R2 HeadObject
  let head: { contentLength: number; contentType?: string };
  try {
    head = await headObject(cleanKey);
  } catch (err: unknown) {
    console.error(`[Attachment Confirmation] HeadObject failed for key ${cleanKey}:`, err instanceof Error ? err.message : err);
    throw new Error("Attachment file not found in storage. Upload may have failed.");
  }

  // Authoritative size boundary check
  if (head.contentLength > MAX_FILE_SIZE_BYTES) {
    try {
      await deleteObject(cleanKey);
    } catch (cleanupErr) {
      console.warn(`[Attachment Cleanup] Failed to delete oversized file ${cleanKey}:`, cleanupErr);
    }
    throw new Error("File size exceeds 50 MB limit.");
  }

  // Save metadata to PostgreSQL
  const attachment = await db.taskAttachment.create({
    data: {
      taskId: task.id,
      fileName: cleanFileName,
      fileKey: cleanKey,
      contentType: head.contentType || "application/octet-stream",
      size: head.contentLength,
      uploadedById: employee.id,
    },
    include: {
      uploadedBy: {
        select: { id: true, firstName: true, lastName: true, avatarUrl: true },
      },
    },
  });

  revalidatePath(`/tasks/${task.id}`);
  return { success: true, attachment };
}

/**
 * Issues a 5-minute presigned GET URL for downloading an attachment.
 * Accessible to any authenticated user who can view the task.
 * Enforces forced attachment content-disposition to eliminate browser inline execution.
 */
export async function getAttachmentDownloadUrlAction(attachmentId: string) {
  const employee = await getCurrentEmployee();

  if (!attachmentId || typeof attachmentId !== "string" || !attachmentId.trim()) {
    throw new Error("Attachment ID is required.");
  }

  const cleanAttachmentId = attachmentId.trim();
  const attachment = await db.taskAttachment.findUnique({
    where: { id: cleanAttachmentId },
    select: { id: true, taskId: true, fileName: true, fileKey: true },
  });

  if (!attachment) {
    throw new Error("Attachment not found.");
  }

  // Authorize via shared task visibility check
  await assertCanViewTask(attachment.taskId, employee);

  const downloadUrl = await getDownloadUrl(attachment.fileKey, attachment.fileName);

  return {
    downloadUrl,
    fileName: attachment.fileName,
  };
}

/**
 * Deletes an attachment: removes R2 storage object and PostgreSQL row.
 * Requires task:create OR task:update permission.
 */
export async function deleteAttachmentAction(attachmentId: string) {
  await getCurrentEmployee();
  const canCreate = await checkPermission("task:create");
  const canUpdate = await checkPermission("task:update");
  if (!canCreate && !canUpdate) {
    throw new Error("FORBIDDEN: Requires task:create or task:update permission.");
  }

  if (!attachmentId || typeof attachmentId !== "string" || !attachmentId.trim()) {
    throw new Error("Attachment ID is required.");
  }

  const cleanAttachmentId = attachmentId.trim();
  const attachment = await db.taskAttachment.findUnique({
    where: { id: cleanAttachmentId },
    select: { id: true, taskId: true, fileKey: true },
  });

  if (!attachment) {
    throw new Error("Attachment not found.");
  }

  // Attempt R2 deletion; log error if failed but do not block DB deletion
  try {
    await deleteObject(attachment.fileKey);
  } catch (err: unknown) {
    console.warn(`[Attachment Cleanup] Failed to delete R2 object for ${attachment.fileKey}:`, err instanceof Error ? err.message : err);
  }

  await db.taskAttachment.delete({
    where: { id: cleanAttachmentId },
  });

  revalidatePath(`/tasks/${attachment.taskId}`);
  return { success: true };
}
