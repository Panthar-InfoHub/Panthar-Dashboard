/**
 * Server and client validation helpers for Task Attachment operations.
 */

export const MAX_ATTACHMENT_SIZE_BYTES = 52_428_800; // 50 MB (50 * 1024 * 1024)

/**
 * Validates that file size is positive and does not exceed 50 MB.
 */
export function validateAttachmentSize(bytes: unknown): number {
  if (typeof bytes !== "number" || isNaN(bytes)) {
    throw new Error("File size must be a valid number.");
  }
  if (bytes <= 0) {
    throw new Error("File cannot be empty (0 bytes).");
  }
  if (bytes > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error("File size exceeds 50 MB limit.");
  }
  return bytes;
}

/**
 * Validates and trims original file name.
 */
export function validateAttachmentFileName(name: unknown): string {
  if (typeof name !== "string") {
    throw new Error("File name must be a string.");
  }
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("File name is required and cannot be empty.");
  }
  return trimmed;
}

/**
 * Sanitizes original filename to safe alphanumeric/dash/underscore characters for object storage key.
 */
export function sanitizeAttachmentFileName(fileName: string): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(-100) || "attachment";
}

/**
 * Constructs hierarchical object key: tasks/<taskId>/<keyId>-<sanitized>
 */
export function buildAttachmentObjectKey(taskId: string, keyId: string, fileName: string): string {
  const sanitized = sanitizeAttachmentFileName(fileName);
  return `tasks/${taskId}/${keyId}-${sanitized}`;
}

/**
 * Strictly verifies that an object key belongs to the given task hierarchy.
 */
export function validateAttachmentKeyPrefix(key: string, taskId: string): boolean {
  if (typeof key !== "string" || !key) return false;
  const expectedPrefix = `tasks/${taskId}/`;
  return key.startsWith(expectedPrefix);
}

/**
 * Builds RFC 5987 compliant Content-Disposition header forcing download.
 */
export function buildContentDispositionHeader(originalFileName: string): string {
  const encoded = encodeURIComponent(originalFileName);
  const asciiFallback = originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
  return `attachment; filename="${asciiFallback}"; filename*=UTF8''${encoded}`;
}

/**
 * Formats bytes into human-readable unit string (e.g. "2.4 MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

