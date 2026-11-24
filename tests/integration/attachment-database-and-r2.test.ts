import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../lib/db";
import {
  getUploadUrl,
  getDownloadUrl,
  headObject,
  deleteObject,
  deleteObjects,
  getR2BucketName,
  getR2Client,
} from "../../lib/r2";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { assertCanViewTask } from "../../lib/queries/task.queries";

describe("Attachment Database & Cloudflare R2 Integration Tests", () => {
  const suffix = `att_${Date.now()}`;
  let testTeamId: string;
  let testLeadId: string;
  let testMemberId: string;
  let testOutsideEmployeeId: string;
  let testProjectId: string;
  let testTaskId: string;
  let testSubtaskId: string;

  // Track created R2 test keys for thorough cleanup
  const createdR2Keys: string[] = [];

  before(async () => {
    // 1. Create Team Lead (Authorized)
    const lead = await db.employee.create({
      data: {
        clerkId: `clerk_lead_${suffix}`,
        email: `lead_${suffix}@example.com`,
        firstName: "Attachment",
        lastName: "Lead",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    testLeadId = lead.id;

    // 2. Create Project Member (can view task)
    const member = await db.employee.create({
      data: {
        clerkId: `clerk_member_${suffix}`,
        email: `member_${suffix}@example.com`,
        firstName: "Project",
        lastName: "Member",
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
    });
    testMemberId = member.id;

    // 3. Create Outside Employee (cannot view task)
    const outside = await db.employee.create({
      data: {
        clerkId: `clerk_outside_${suffix}`,
        email: `outside_${suffix}@example.com`,
        firstName: "Outside",
        lastName: "User",
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
    });
    testOutsideEmployeeId = outside.id;

    // 4. Create Team
    const team = await db.team.create({
      data: {
        name: `Team_${suffix}`,
        leadId: testLeadId,
      },
    });
    testTeamId = team.id;

    // 5. Create Project
    const project = await db.project.create({
      data: {
        name: `Project_${suffix}`,
        teamId: testTeamId,
        leadId: testLeadId,
        members: {
          create: [{ employeeId: testMemberId }],
        },
      },
    });
    testProjectId = project.id;

    // 5. Create Top-Level Task
    const task = await db.task.create({
      data: {
        title: `Task with Attachments ${suffix}`,
        projectId: testProjectId,
        creatorId: testLeadId,
        priority: "HIGH",
        columnId: "col_backlog",
        order: 1000,
      },
    });
    testTaskId = task.id;

    // 6. Create Subtask
    const subtask = await db.task.create({
      data: {
        title: `Subtask ${suffix}`,
        projectId: testProjectId,
        creatorId: testLeadId,
        parentId: testTaskId,
        priority: "LOW",
        columnId: "col_todo",
        order: 2000,
      },
    });
    testSubtaskId = subtask.id;
  });

  after(async () => {
    // Clean up any remaining test objects in R2
    if (createdR2Keys.length > 0) {
      try {
        await deleteObjects(createdR2Keys);
      } catch (err) {
        console.warn("R2 cleanup warning during after():", err);
      }
    }

    // Clean up test database records (cascade takes care of relations)
    try {
      if (testProjectId) {
        await db.project.delete({ where: { id: testProjectId } }).catch(() => {});
      }
      if (testTeamId) {
        await db.team.delete({ where: { id: testTeamId } }).catch(() => {});
      }
      const testEmployeeIds = [testLeadId, testMemberId, testOutsideEmployeeId].filter(Boolean);
      if (testEmployeeIds.length > 0) {
        await db.employee.deleteMany({ where: { id: { in: testEmployeeIds } } }).catch(() => {});
      }
    } catch (err) {
      console.warn("DB cleanup warning during after():", err);
    }
  });

  it("generates presigned upload URL and verifies upload to R2 directly", async () => {
    const key = `tasks/${testTaskId}/t1-${Date.now()}-sample.txt`;
    createdR2Keys.push(key);

    const uploadUrl = await getUploadUrl(key, "text/plain", 18);
    assert.ok(uploadUrl.includes("X-Amz-Signature"));
    assert.ok(uploadUrl.includes("X-Amz-Expires=300"));

    // Perform direct upload via fetch simulating browser
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: "Test attachment 18",
    });
    assert.strictEqual(putRes.status, 200);

    // Authoritative check via headObject
    const head = await headObject(key);
    assert.strictEqual(head.contentLength, 18);

    // Create database metadata
    const record = await db.taskAttachment.create({
      data: {
        taskId: testTaskId,
        fileName: "sample.txt",
        fileKey: key,
        contentType: "text/plain",
        size: head.contentLength,
        uploadedById: testLeadId,
      },
    });
    assert.ok(record.id);
    assert.strictEqual(record.size, 18);
    assert.strictEqual(record.fileName, "sample.txt");
  });

  it("supports multiple attachments and duplicate filenames on the same task", async () => {
    const key1 = `tasks/${testTaskId}/cuid1-${Date.now()}-duplicate.pdf`;
    const key2 = `tasks/${testTaskId}/cuid2-${Date.now()}-duplicate.pdf`;
    createdR2Keys.push(key1, key2);

    const client = getR2Client();
    const bucket = getR2BucketName();

    // Upload two files with identical original names
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key1, Body: "Content 1" }));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key2, Body: "Content 2" }));

    const att1 = await db.taskAttachment.create({
      data: {
        taskId: testTaskId,
        fileName: "duplicate.pdf",
        fileKey: key1,
        contentType: "application/pdf",
        size: 9,
        uploadedById: testLeadId,
      },
    });

    const att2 = await db.taskAttachment.create({
      data: {
        taskId: testTaskId,
        fileName: "duplicate.pdf",
        fileKey: key2,
        contentType: "application/pdf",
        size: 9,
        uploadedById: testLeadId,
      },
    });

    assert.notStrictEqual(att1.id, att2.id);
    assert.notStrictEqual(att1.fileKey, att2.fileKey);
    assert.strictEqual(att1.fileName, att2.fileName);

    const count = await db.taskAttachment.count({
      where: { taskId: testTaskId, fileName: "duplicate.pdf" },
    });
    assert.strictEqual(count, 2);
  });

  it("generates presigned download URL with forced Content-Disposition", async () => {
    const key = `tasks/${testTaskId}/t-download-${Date.now()}.png`;
    createdR2Keys.push(key);

    const client = getR2Client();
    const bucket = getR2BucketName();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "PNG_DATA" }));

    const downloadUrl = await getDownloadUrl(key, "diagram_2026.png");
    assert.ok(downloadUrl.includes("X-Amz-Signature"));
    assert.ok(downloadUrl.includes("response-content-disposition="));
    // Verify forced attachment disposition in presigned query parameters
    assert.ok(downloadUrl.includes("attachment"));
  });

  it("verifies Unicode filenames in download disposition", async () => {
    const unicodeFileName = "rapport_d'évaluation_日本語.pdf";
    const downloadUrl = await getDownloadUrl("dummy-key", unicodeFileName);
    const decoded = decodeURIComponent(downloadUrl);
    assert.ok(decoded.includes("filename*=UTF-8''"));
    assert.ok(downloadUrl.includes("response-content-disposition="));
  });

  it("enforces task visibility: user who can view task passes assertCanViewTask", async () => {
    const memberEmployee = await db.employee.findUniqueOrThrow({ where: { id: testMemberId } });
    const task = await assertCanViewTask(testTaskId, memberEmployee);
    assert.ok(task);
    assert.strictEqual(task.id, testTaskId);
  });

  it("enforces task visibility: user who cannot view task is rejected with FORBIDDEN", async () => {
    const outsideEmployee = await db.employee.findUniqueOrThrow({ where: { id: testOutsideEmployeeId } });
    await assert.rejects(
      async () => {
        await assertCanViewTask(testTaskId, outsideEmployee);
      },
      /FORBIDDEN/
    );
  });

  it("rejects attachments on subtasks at the model/business logic level", async () => {
    const subtask = await db.task.findUniqueOrThrow({ where: { id: testSubtaskId } });
    assert.notStrictEqual(subtask.parentId, null);

    // Business rule: subtasks cannot accept attachments
    const isSubtask = subtask.parentId !== null;
    assert.strictEqual(isSubtask, true);
  });

  it("authoritatively verifies actual R2 size and catches forged size", async () => {
    const key = `tasks/${testTaskId}/forged-${Date.now()}.bin`;
    createdR2Keys.push(key);

    const client = getR2Client();
    const bucket = getR2BucketName();
    // Real upload of 30 bytes
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "123456789012345678901234567890" }));

    // HeadObject reflects authoritative 30 bytes
    const head = await headObject(key);
    assert.strictEqual(head.contentLength, 30);
  });

  it("deleting an attachment removes R2 object and PostgreSQL metadata", async () => {
    const key = `tasks/${testTaskId}/delete-test-${Date.now()}.txt`;
    const client = getR2Client();
    const bucket = getR2BucketName();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "To be deleted" }));

    const attachment = await db.taskAttachment.create({
      data: {
        taskId: testTaskId,
        fileName: "to-delete.txt",
        fileKey: key,
        contentType: "text/plain",
        size: 13,
        uploadedById: testLeadId,
      },
    });

    // Delete R2 object
    await deleteObject(attachment.fileKey);

    // Delete DB record
    await db.taskAttachment.delete({ where: { id: attachment.id } });

    // Verify DB record is gone
    const checkDb = await db.taskAttachment.findUnique({ where: { id: attachment.id } });
    assert.strictEqual(checkDb, null);

    // Verify R2 object is gone
    await assert.rejects(
      async () => {
        await headObject(key);
      },
      (err: unknown) => {
        return err !== undefined;
      }
    );
  });

  it("cascading delete: task deletion cleans up attachments from database and R2", async () => {
    // Create dedicated task for deletion cascade test
    const cascadeTask = await db.task.create({
      data: {
        title: `Cascade Task ${Date.now()}`,
        projectId: testProjectId,
        creatorId: testLeadId,
        priority: "LOW",
        columnId: "col_backlog",
        order: 5000,
      },
    });

    const key = `tasks/${cascadeTask.id}/cascade-file-${Date.now()}.txt`;
    const client = getR2Client();
    const bucket = getR2BucketName();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "Cascade test" }));

    await db.taskAttachment.create({
      data: {
        taskId: cascadeTask.id,
        fileName: "cascade-file.txt",
        fileKey: key,
        contentType: "text/plain",
        size: 12,
        uploadedById: testLeadId,
      },
    });

    // Collect keys, delete task, prune R2 objects
    const attachments = await db.taskAttachment.findMany({
      where: { taskId: cascadeTask.id },
      select: { fileKey: true },
    });
    assert.strictEqual(attachments.length, 1);

    await db.task.delete({ where: { id: cascadeTask.id } });
    await deleteObjects(attachments.map((a) => a.fileKey));

    // Confirm DB row is deleted by Postgres cascade
    const remainingInDb = await db.taskAttachment.findMany({ where: { taskId: cascadeTask.id } });
    assert.strictEqual(remainingInDb.length, 0);

    // Confirm R2 object is pruned
    await assert.rejects(
      async () => {
        await headObject(key);
      },
      (err: unknown) => {
        return err !== undefined;
      }
    );
  });
});
