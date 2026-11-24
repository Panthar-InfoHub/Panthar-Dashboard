import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  validateAttachmentSize,
  validateAttachmentFileName,
  sanitizeAttachmentFileName,
  buildAttachmentObjectKey,
  validateAttachmentKeyPrefix,
  buildContentDispositionHeader,
  formatBytes,
} from "../../lib/validations/attachment";

describe("Attachment Size Boundary Validation Unit Tests", () => {
  it("accepts file size of exactly 1 byte", () => {
    assert.strictEqual(validateAttachmentSize(1), 1);
  });

  it("accepts file size of exactly 50 MB (52,428,800 bytes)", () => {
    assert.strictEqual(validateAttachmentSize(MAX_ATTACHMENT_SIZE_BYTES), MAX_ATTACHMENT_SIZE_BYTES);
  });

  it("rejects file size of 50 MB + 1 byte (52,428,801 bytes)", () => {
    assert.throws(() => validateAttachmentSize(52_428_801), /exceeds 50 MB limit/);
  });

  it("rejects file size of 51 MB (53,477,376 bytes)", () => {
    assert.throws(() => validateAttachmentSize(53_477_376), /exceeds 50 MB limit/);
  });

  it("rejects 0-byte or negative sizes", () => {
    assert.throws(() => validateAttachmentSize(0), /cannot be empty/);
    assert.throws(() => validateAttachmentSize(-100), /cannot be empty/);
  });

  it("rejects non-numeric inputs", () => {
    assert.throws(() => validateAttachmentSize("50MB"), /valid number/);
    assert.throws(() => validateAttachmentSize(null), /valid number/);
    assert.throws(() => validateAttachmentSize(undefined), /valid number/);
  });
});

describe("Attachment Filename Validation & Sanitization Unit Tests", () => {
  it("accepts valid filenames and trims whitespace", () => {
    assert.strictEqual(validateAttachmentFileName("  document.pdf  "), "document.pdf");
  });

  it("rejects empty or whitespace-only filenames", () => {
    assert.throws(() => validateAttachmentFileName(""), /required and cannot be empty/);
    assert.throws(() => validateAttachmentFileName("   "), /required and cannot be empty/);
  });

  it("rejects non-string filenames", () => {
    assert.throws(() => validateAttachmentFileName(123), /must be a string/);
    assert.throws(() => validateAttachmentFileName(null), /must be a string/);
  });

  it("sanitizes filenames containing spaces and special characters", () => {
    const raw = "my document (draft) #1 [final]!.pdf";
    const sanitized = sanitizeAttachmentFileName(raw);
    assert.strictEqual(sanitized, "my_document__draft___1__final__.pdf");
  });

  it("prevents directory traversal attempts", () => {
    const traversal = "../../../etc/passwd.txt";
    const sanitized = sanitizeAttachmentFileName(traversal);
    assert.strictEqual(sanitized.includes("/"), false);
    assert.strictEqual(sanitized.includes("\\"), false);
  });

  it("truncates extremely long filenames to safe max length (100 characters)", () => {
    const longName = "a".repeat(200) + ".pdf";
    const sanitized = sanitizeAttachmentFileName(longName);
    assert.ok(sanitized.length <= 100);
  });

  it("constructs correct hierarchical object key", () => {
    const key = buildAttachmentObjectKey("task_123", "c12345", "Quarterly Report.xlsx");
    assert.strictEqual(key, "tasks/task_123/c12345-Quarterly_Report.xlsx");
  });

  it("validates key isolation by task prefix", () => {
    const validKey = "tasks/task_abc/key123-doc.pdf";
    const wrongTaskKey = "tasks/task_xyz/key123-doc.pdf";
    const arbitraryKey = "arbitrary/path/file.pdf";

    assert.strictEqual(validateAttachmentKeyPrefix(validKey, "task_abc"), true);
    assert.strictEqual(validateAttachmentKeyPrefix(wrongTaskKey, "task_abc"), false);
    assert.strictEqual(validateAttachmentKeyPrefix(arbitraryKey, "task_abc"), false);
  });
});

describe("Content Disposition & Unicode Filename Encoding Unit Tests", () => {
  it("encodes standard ASCII filenames properly with forced attachment disposition", () => {
    const header = buildContentDispositionHeader("report_2026.pdf");
    assert.strictEqual(header, `attachment; filename="report_2026.pdf"; filename*=UTF-8''report_2026.pdf`);
    assert.ok(header.startsWith("attachment;"));
  });

  it("encodes Unicode and international characters using RFC 5987", () => {
    const unicodeName = "résumé_日本語_2026.pdf";
    const header = buildContentDispositionHeader(unicodeName);
    assert.ok(header.includes("filename*=UTF-8''r%C3%A9sum%C3%A9_%E6%97%A5%E6%9C%AC%E8%AA%9E_2026.pdf"));
    assert.ok(header.startsWith("attachment;"));
  });

  it("provides safe ASCII fallback for clients that do not parse filename*", () => {
    const unicodeName = "файл.docx";
    const header = buildContentDispositionHeader(unicodeName);
    assert.ok(header.includes('filename="____.docx"'));
  });
});

describe("Format Bytes Formatting Utility Unit Tests", () => {
  it("formats 0 bytes", () => {
    assert.strictEqual(formatBytes(0), "0 B");
  });

  it("formats negative bytes safely as 0 B", () => {
    assert.strictEqual(formatBytes(-10), "0 B");
  });

  it("formats bytes under 1 KB", () => {
    assert.strictEqual(formatBytes(512), "512 B");
  });

  it("formats KB values", () => {
    assert.strictEqual(formatBytes(1024), "1.0 KB");
    assert.strictEqual(formatBytes(500 * 1024), "500.0 KB");
  });

  it("formats MB values", () => {
    assert.strictEqual(formatBytes(2.4 * 1024 * 1024), "2.4 MB");
    assert.strictEqual(formatBytes(50 * 1024 * 1024), "50.0 MB");
  });
});
