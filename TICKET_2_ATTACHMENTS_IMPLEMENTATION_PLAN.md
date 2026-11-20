# PANTHAR TEAMS — TICKET 2: TASK ATTACHMENTS
## PRODUCTION-GRADE IMPLEMENTATION PLAN (CLOUDFLARE R2)

**Target Branch:** `feature/task-attachments`  
**Base Repository:** `~/codes/panthar-dahsboard/Management-Dashboard`  
**Specification Source:** `Tickets for the Dashboard.pdf` (Ticket 2, Pages 15–16)  
**Status:** AWAITING USER APPROVAL  

---

## 1. Executive Summary & Objective

Implement **Ticket 2 — Task Attachments** for Panthar Teams exactly according to the product specifications and approved decisions.

The feature enables users with task-creation or update permissions to attach multiple files (up to 50 MB each) to top-level tasks. Files are stored privately in Cloudflare R2 using browser-to-R2 direct uploads via server-generated presigned URLs, avoiding Next.js/Vercel body size limits (1 MB / 4.5 MB). PostgreSQL stores only attachment metadata. Any authenticated user authorized to view the task can securely download its attachments with their original filenames.

---

## 2. Pre-Implementation Verification Summary

The mandatory pre-implementation checks have been performed:

| Check | Requirement | Status | Verification Detail |
|---|---|---|---|
| **Git Branch** | Feature branch `feature/task-attachments` | ✅ Verified | Initialized git repository, committed Ticket 1 baseline, created and checked out `feature/task-attachments`. Working tree is clean. |
| **Database** | Development Neon Postgres branch | ✅ Verified | Host confirmed as `ep-tiny-cell-bddk18sl-pooler.c-8.us-east-2.aws.neon.tech` (Neon dev branch). `prisma migrate status` verified schema is current (5 migrations). |
| **AWS SDK** | `@aws-sdk/client-s3` & `@aws-sdk/s3-request-presigner` | ✅ Verified | Installed official packages (`^3.1173.0`). No unnecessary SDKs added. |
| **R2 Credentials** | 5 R2 environment variables configured | ✅ Verified | Configured in `.env.local` and template in `.env.example` without logging secret values. |
| **R2 Connectivity** | Real-time S3 API smoke test | ✅ Verified | Tested live via Node.js script: Bucket `management-dashboard` responded HTTP 200, presigned PUT uploaded test file, `HeadObject` verified byte length, and `DeleteObject` cleaned up successfully. |
| **Shared Guard** | `assertCanViewTask()` | ✅ Verified | Located in `lib/queries/task.queries.ts`. Used by `getTaskById()` and will be reused by download actions. |
| **Design Rules** | `vercel-design.md` & `AGENTS.md` | ✅ Verified | Reviewed. Dark mode support, Geist design language, minimal clean layout, no unnecessary dependencies. |

---

## 3. Approved Product Decisions & Boundaries

To preserve architectural integrity and avoid regressions:

1. **Upload Entry Points:** File attachments can **ONLY** be uploaded via:
   - The **Create Task** form (`components/tasks/new-task-form.tsx` on `/tasks/new`).
   - The **Edit Task** form (`components/tasks/new-task-form.tsx` on `/tasks/[id]/edit`).
2. **Task Detail Page (`/tasks/[id]`):**
   - Displays existing attachments in a dedicated **Attachments** section positioned **immediately below the Task Checklist** and **immediately above the Blocked By section**.
   - Includes a **Download** button for anyone authorized to view the task.
   - Includes an authorized **Delete** button (with confirmation dialog) only for users with `task:create` or `task:update`.
   - **NO direct upload controls** will be added to the task detail page.
3. **Subtask Exclusion:**
   - Subtasks (`parentId !== null`) never have attachments.
   - The attachment UI is completely hidden on subtasks.
   - Server Actions explicitly reject uploads for subtasks.
4. **Deferred Cleanup:**
   - Automatic background cleanup of unconfirmed/orphaned uploads (e.g. user selected file, uploaded to R2, but closed tab before server confirmation) is deferred as an approved product decision and documented as a known follow-up.
5. **No Scope Expansion:**
   - Ticket 1 (Task Checklist) behavior is completely preserved.
   - Ticket 3 (Configurable Board Columns) is untouched.

---

## 4. Cloudflare R2 Architecture & Security

### 4.1 Server-Only R2 Module (`lib/r2.ts`)
- Implements `import "server-only";` at top to strictly guarantee that no R2 credentials, S3 client code, or secret keys can ever leak into client-side JavaScript bundles.
- Configures `S3Client` with:
  - `endpoint`: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  - `region`: `"auto"`
  - `credentials`: `{ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }`
- Exports reusable helper functions:
  1. `getUploadUrl(key: string, contentType: string, contentLength: number): Promise<string>`
     - Uses `PutObjectCommand` and `getSignedUrl` from `@aws-sdk/s3-request-presigner`.
     - Expiration: exactly **300 seconds (5 minutes)**.
     - Signs `ContentType`.
  2. `getDownloadUrl(key: string, originalFileName: string): Promise<string>`
     - Uses `GetObjectCommand` and `getSignedUrl`.
     - Expiration: exactly **300 seconds (5 minutes)**.
     - **Forced Download Disposition:** Sets `ResponseContentDisposition: \`attachment; filename*=UTF8''\${encodeURIComponent(originalFileName)}\``.
     - **Security Note:** Files never open inline in the browser. This eliminates XSS risks from untrusted file types (e.g., SVG or HTML files uploaded by team members).
  3. `headObject(key: string): Promise<{ contentLength: number; contentType?: string }>`
     - Uses `HeadObjectCommand` to authoritatively verify that the file exists in R2 and reads its real size before creating database metadata.
  4. `deleteObject(key: string): Promise<void>`
     - Uses `DeleteObjectCommand` to remove a single object.
  5. `deleteObjects(keys: string[]): Promise<void>`
     - Uses `DeleteObjectsCommand` to batch delete up to 1,000 keys at once.

### 4.2 Object Key Naming Scheme
- Object keys are structured as:  
  `tasks/<taskId>/<cuid>-<sanitized-filename>`
- Filename sanitization preserves alphanumeric characters, periods, hyphens, and underscores, while truncating long basenames to 100 characters to prevent filesystem/S3 key issues:
  ```ts
  function sanitizeFileName(fileName: string): string {
    const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return cleaned.slice(-100) || "attachment";
  }
  ```
- Original filenames (including spaces, unicode, international characters) are preserved separately in the PostgreSQL database `TaskAttachment.fileName` field and served during download.

---

## 5. Database Schema & Migration

### 5.1 Prisma Schema (`prisma/schema.prisma`)
Add the `TaskAttachment` model and link it to `Task` and `Employee`:

```prisma
model TaskAttachment {
  id           String   @id @default(cuid())
  taskId       String
  task         Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  fileName     String   // original file name for display and download
  fileKey      String   @unique // unique R2 object key
  contentType  String   // MIME type
  size         Int      // authoritative size in bytes
  uploadedById String
  uploadedBy   Employee @relation(fields: [uploadedById], references: [id])
  createdAt    DateTime @default(now())

  @@index([taskId])
}
```

On `Task`:
```prisma
model Task {
  ...
  attachments TaskAttachment[]
}
```

On `Employee`:
```prisma
model Employee {
  ...
  uploadedAttachments TaskAttachment[]
}
```

### 5.2 Database Migration Plan
- Generate migration using standard Prisma CLI:
  `npx prisma migrate dev --name add_task_attachments --create-only`
- Inspect the generated SQL migration file:
  - Verifies creation of `TaskAttachment` table.
  - Verifies foreign keys with `ON DELETE CASCADE` for `taskId` and standard relation for `uploadedById`.
  - Verifies unique constraint on `fileKey` and index on `taskId`.
- Apply migration safely to development database:
  `npx prisma migrate deploy`
- Regenerate Prisma client:
  `npx prisma generate`
- **Strict Rule:** Never run `prisma migrate reset` or `db push`.

---

## 6. Secure Server Actions (`lib/actions/attachment.actions.ts`)

Create `lib/actions/attachment.actions.ts` with `"use server";` and the four required actions:

### 1. `createAttachmentUploadAction`
- **Signature:** `(taskId: string, input: { fileName: string; contentType: string; size: number })`
- **Authorization:** `getCurrentEmployee()`, followed by permission check:
  `const canManage = await checkPermission("task:create") || await checkPermission("task:update");`
  Throws `FORBIDDEN` if neither is granted.
- **Validation:**
  - Verify task exists.
  - Reject subtasks: `if (task.parentId !== null) throw new Error("Attachments are not supported on subtasks.");`
  - Filename validation: non-empty, string, trimmed length > 0.
  - Size validation: `if (input.size > 52428800) throw new Error("File size exceeds 50 MB limit.");`
  - Content type validation: non-empty bounded string.
- **Operation:**
  - Generate key: `tasks/${taskId}/${createId()}-${sanitized}`.
  - Call `getUploadUrl(key, input.contentType, input.size)`.
- **Return:** `{ uploadUrl, key }`.

### 2. `confirmAttachmentUploadAction`
- **Signature:** `(taskId: string, input: { key: string; fileName: string })`
- **Authorization:** Same as above (`task:create` or `task:update`).
- **Validation:**
  - Verify key belongs to task: `if (!input.key.startsWith(\`tasks/\${taskId}/\`)) throw new Error("Invalid object key for this task.");`
  - Verify task exists and is top-level.
- **Authoritative Verification via R2:**
  - Call `headObject(input.key)` in R2.
  - Verify file exists and read actual `contentLength`.
  - If actual `contentLength > 52428800`:
    - Immediately delete object: `await deleteObject(input.key);`
    - Throw error: `"Uploaded file exceeds the 50 MB limit."`
- **Database Write:**
  - Create `TaskAttachment` record in PostgreSQL with actual `contentLength` and sanitized/original metadata.
- **Cache Revalidation:**
  - `revalidatePath(\`/tasks/\${taskId}\`)`.
- **Return:** `{ success: true, attachment: { id, fileName, size, createdAt } }`.

### 3. `getAttachmentDownloadUrlAction`
- **Signature:** `(attachmentId: string)`
- **Authorization:**
  - Authenticate caller via `getCurrentEmployee()`.
  - Fetch attachment: `db.taskAttachment.findUnique({ where: { id: attachmentId }, select: { id: true, taskId: true, fileName: true, fileKey: true } })`.
  - Throws `NOT_FOUND` if record does not exist.
  - Verify task visibility using the existing shared authorization guard:
    `await assertCanViewTask(attachment.taskId, employee);`
    If user cannot view the task, `assertCanViewTask` throws `FORBIDDEN`.
- **Operation:**
  - Call `getDownloadUrl(attachment.fileKey, attachment.fileName)`.
- **Return:** `{ downloadUrl, fileName: attachment.fileName }`.

### 4. `deleteAttachmentAction`
- **Signature:** `(attachmentId: string)`
- **Authorization:**
  - Requires `task:create` OR `task:update`.
  - Throws `FORBIDDEN` if unauthorized.
- **Operation:**
  - Fetch attachment record to obtain `fileKey` and `taskId`.
  - Delete object from Cloudflare R2: `await deleteObject(attachment.fileKey)`.
  - Delete row from PostgreSQL: `await db.taskAttachment.delete({ where: { id: attachmentId } })`.
- **Cache Revalidation:**
  - `revalidatePath(\`/tasks/\${attachment.taskId}\`)`.
- **Return:** `{ success: true }`.

---

## 7. Cascade Deletion & R2 Object Cleanup

When a task or project is deleted, PostgreSQL cascading foreign keys remove the `TaskAttachment` rows, but R2 objects must also be pruned:

### 7.1 `deleteTaskAction` (`lib/actions/task.actions.ts`)
1. Before deleting the task, query its attachments:
   ```ts
   const attachments = await db.taskAttachment.findMany({
     where: { taskId },
     select: { fileKey: true },
   });
   ```
2. Delete task from database (deletes task and cascades metadata rows).
3. Delete R2 objects:
   ```ts
   if (attachments.length > 0) {
     try {
       await deleteObjects(attachments.map(a => a.fileKey));
     } catch (err) {
       console.error("[R2 Cleanup Error] Failed to delete objects for task", taskId, err);
     }
   }
   ```
4. If R2 deletion fails, log the error clearly, but do not fail the request or block the user.

### 7.2 `deleteProjectAction` (`lib/actions/project.actions.ts`)
1. Before deleting the project, collect all attachment keys across all tasks in the project:
   ```ts
   const attachments = await db.taskAttachment.findMany({
     where: { task: { projectId } },
     select: { fileKey: true },
   });
   ```
2. Delete project from database.
3. Batch delete R2 objects using `deleteObjects(attachments.map(a => a.fileKey))` wrapped in a try/catch error-logging block.

---

## 8. Query & Detail Layer Integration

### 8.1 `lib/queries/task.queries.ts`
Update `assertCanViewTask` and `getTaskById` to include attachments with uploader info:
```prisma
attachments: {
  orderBy: { createdAt: "asc" },
  include: {
    uploadedBy: {
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    },
  },
}
```

### 8.2 Page Permission Resolution
- In `app/(dashboard)/tasks/new/page.tsx`:
  - Compute `canManageAttachments = await checkPermission("task:create") || await checkPermission("task:update");`
  - Pass `canManageAttachments` to `<NewTaskForm />`.
- In `app/(dashboard)/tasks/[id]/edit/page.tsx`:
  - Compute `canManageAttachments = await checkPermission("task:create") || await checkPermission("task:update");`
  - Note: If a user is only the creator of the task without `task:create` / `task:update`, `canManageAttachments` evaluates to `false`, correctly hiding upload controls.
  - Pass `canManageAttachments` to `<NewTaskForm />`.
- In `app/(dashboard)/tasks/[id]/page.tsx`:
  - Compute `canManageAttachments = await checkPermission("task:create") || await checkPermission("task:update");`
  - Pass `canManageAttachments` to `<TaskDetailClient />`.

---

## 9. UI Implementation

### 9.1 Create & Edit Form (`components/tasks/new-task-form.tsx`)
- When `canManageAttachments` is true and `!initialData?.parentId`:
  - Render an **Attach Files** file input section with multi-file selection support.
  - **Immediate Browser Validation:**
    - Checks `file.size <= 52428800`.
    - If any file exceeds 50 MB, reject immediately, show `toast.error("Upload failed. The file is over 50 MB.")`, and do not add to pending list.
  - **Selected Files List:**
    - Displays list of pending files with file icon, name, formatted size (`formatBytes`), and a remove button before form submission.
  - **Submission Workflow:**
    - On submit, submit task creation or update first.
    - If new task: `createTaskAction` returns the created task with `task.id`.
    - For each pending file:
      1. Request upload URL: `createAttachmentUploadAction(taskId, { fileName, contentType, size })`.
      2. Upload file directly to R2 via `XMLHttpRequest` (or `fetch`) to track per-file upload percentage.
      3. Confirm upload: `confirmAttachmentUploadAction(taskId, { key, fileName })`.
    - Button displays `"Uploading files..."` state.
    - **Error Handling:** If any file fails to upload or confirm, the created task is preserved, the user is notified via toast of the specific failure, and they are redirected to the task page.

### 9.2 Task Detail Component (`components/tasks/task-attachments.tsx`)
Create a new dedicated component `components/tasks/task-attachments.tsx` rendered in `components/tasks/task-detail-client.tsx`:
- **Placement:** Placed directly below `<TaskChecklist />` and immediately above the `Blocked By` section.
- **Subtask Handling:** If `task.parentId !== null`, render `null` (entire section hidden).
- **Header:** "Attachments" with count badge.
- **Attachment Rows:**
  - File-type icon dynamically chosen by extension/MIME (`FileText`, `FileImage`, `FileArchive`, `FileSpreadsheet`, `FileCode`, `File`).
  - Original filename (truncated gracefully with full name in tooltip / title).
  - Formatted file size (e.g. `2.4 MB`, `850 KB`).
  - Uploader information (`uploadedBy.firstName` and relative timestamp e.g. `formatDistanceToNow`).
  - **Download Button:** Available to everyone who can see the task. On click:
    - Calls `getAttachmentDownloadUrlAction(attachment.id)`.
    - Triggers native browser download via invisible `<a download>` anchor or direct window location.
  - **Delete Button:** Rendered **only** when `canManageAttachments` is true:
    - Triggers a shadcn `AlertDialog` ("Are you sure you want to delete this attachment? This file will be permanently removed.").
    - On confirm, calls `deleteAttachmentAction(attachment.id)`.
    - Shows `toast.success("File deleted")`.
- **Empty State:** If no attachments exist, displays: `"No files attached yet."` with subtle muted styling matching `vercel-design.md`.

---

## 10. Comprehensive Test Plan

A test suite will be added under `tests/unit/` and `tests/integration/` covering all 18 cases specified in the prompt:

| # | Scenario | Test Type | Assertion |
|---|---|---|---|
| 1 | Authorized employee uploads multiple files | Integration | `createAttachmentUploadAction` + `confirmAttachmentUploadAction` creates rows with proper metadata. |
| 2 | Unauthorized employee cannot upload | Integration | Calling `createAttachmentUploadAction` without `task:create`/`task:update` throws `FORBIDDEN`. |
| 3 | Unauthorized employee cannot delete | Integration | Calling `deleteAttachmentAction` without permissions throws `FORBIDDEN`. |
| 4 | User without upload permission can download if they can view task | Integration | User with task view access gets presigned download URL with forced content disposition. |
| 5 | User who cannot view task cannot download | Integration | Calling `getAttachmentDownloadUrlAction` for hidden task throws `FORBIDDEN`. |
| 6 | Subtask upload is rejected | Integration / Unit | Calling `createAttachmentUploadAction` on a subtask (`parentId !== null`) throws error. |
| 7 | 50 MB file is accepted | Unit | File size `52,428,800` passes size validation. |
| 8 | 51 MB file is rejected | Unit | File size `53,477,376` is rejected on client and server actions. |
| 9 | Forged client file size caught by HeadObject | Integration / Unit | If client reports 10 MB but R2 HeadObject reports 55 MB, file is deleted from R2 and action throws. |
| 10 | Invalid object key is rejected | Unit | Key not matching `tasks/<taskId>/...` is rejected during confirmation. |
| 11 | Duplicate filenames work | Integration | Uploading two files named `report.pdf` creates distinct cuid keys and both records exist. |
| 12 | Unicode filenames download correctly | Unit | File named `résumé_日本語_2026.pdf` is properly URL-encoded in `filename*=UTF8''`. |
| 13 | Expired presigned URL handled | Unit | Presigned URLs have 300-second expiration. Client error handlers display retry message. |
| 14 | Failed confirmation leaves no false DB record | Integration | If upload fails before confirm, no row is written to `TaskAttachment`. |
| 15 | R2 deletion removes object and metadata | Integration | Deleting attachment calls `DeleteObject` and removes Postgres row. |
| 16 | Task deletion cleans up attachment objects | Integration | `deleteTaskAction` prunes all associated R2 keys. |
| 17 | Project deletion cleans up all attachments | Integration | `deleteProjectAction` prunes all associated R2 keys across project tasks. |
| 18 | Mobile layout & keyboard accessibility | UI / Verification | Attachment list wraps cleanly on small screens, download/delete triggers accessible via keyboard. |

---

## 11. Files to be Created & Modified

### New Files:
1. `lib/r2.ts` (S3Client, server-only, presigned URL generators, HeadObject, DeleteObject helpers)
2. `lib/actions/attachment.actions.ts` (4 server actions with strict authorization and validation)
3. `components/tasks/task-attachments.tsx` (Attachments UI list, download handler, delete alert dialog)
4. `prisma/migrations/<timestamp>_add_task_attachments/migration.sql` (Database migration)
5. `tests/unit/attachment-validation-and-urls.test.ts` (Unit test suite)
6. `tests/integration/attachment-database-and-r2.test.ts` (Integration test suite)

### Modified Files:
1. `prisma/schema.prisma` (Add `TaskAttachment` model and relations)
2. `lib/env.ts` (Include R2 environment variables in server schema)
3. `lib/queries/task.queries.ts` (Include attachments in `assertCanViewTask` and `getTaskById`)
4. `lib/actions/task.actions.ts` (Integrate R2 object cleanup into `deleteTaskAction`)
5. `lib/actions/project.actions.ts` (Integrate R2 object cleanup into `deleteProjectAction`)
6. `app/(dashboard)/tasks/new/page.tsx` (Pass `canManageAttachments`)
7. `app/(dashboard)/tasks/[id]/edit/page.tsx` (Pass `canManageAttachments`)
8. `app/(dashboard)/tasks/[id]/page.tsx` (Pass `canManageAttachments`)
9. `components/tasks/new-task-form.tsx` (Add file attachments picker, 50MB check, XHR progress upload, confirm flow)
10. `components/tasks/task-detail-client.tsx` (Integrate `<TaskAttachments />` below Checklist and above Blocked By)
11. `package.json` (Record `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`)
12. `.env.example` & `.env.local` (Updated with R2 credentials without exposing secrets)

---

## 12. Quality Verification Gates

Before final reporting:
1. `npx prisma validate`
2. `npx prisma generate`
3. `npx tsc --noEmit` (0 errors)
4. `npm run lint` (0 errors, 0 warnings)
5. `npm run test:all` (all unit and integration tests passing)
6. `npm run build` (Clean production Next.js 16 build)
7. Visual verification: Capture desktop and mobile screenshots of attachments UI and confirm layout.
8. Deliver final `TICKET_2_ATTACHMENTS_IMPLEMENTATION_REPORT.md`.

---

## 13. User Approval Request

Please review this implementation plan. Upon your approval, we will proceed immediately with Step 1 (Database Schema & Migration), followed by the R2 actions, UI integration, and testing.

