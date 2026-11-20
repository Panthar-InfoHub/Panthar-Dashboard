# TICKET 1 — TASK CHECKLIST DIAGNOSTIC REPORT
**Project:** Panthar Teams (`~/codes/panthar-dahsboard/Management-Dashboard`)  
**Audit Date:** November 19, 2026  
**Status:** Completed Diagnostic — Awaiting User Approval  

---

## 1. Files Inspected

During this diagnostic audit, the following files and components were inspected:

1. `prisma/schema.prisma` (Models: `Task`, `Employee`, `TaskChecklistItem`)
2. `prisma/migrations/20261119171000_add_task_checklist/migration.sql` (Migration SQL)
3. `lib/db.ts` (Prisma client & Neon serverless adapter connection)
4. `lib/auth.ts` (`getCurrentEmployee`, `requireAuth`, permission resolution)
5. `lib/validations/checklist.ts` (Title, Task ID, and Reorder validators)
6. `lib/actions/checklist.actions.ts` (Server actions: create, update, toggle, delete, reorder)
7. `lib/queries/task.queries.ts` (`assertCanViewTask`, `getTaskById`, `getKanbanTasks`)
8. `app/(dashboard)/tasks/[id]/page.tsx` (Task detail server page)
9. `components/tasks/task-detail-client.tsx` (Task detail client layout & component tree)
10. `components/tasks/task-checklist.tsx` (Checklist UI implementation)
11. `components/ui/checkbox.tsx` (Radix UI checkbox primitive)
12. `components/tasks/kanban-board.tsx` (Kanban board & card rendering)

---

## 2. Implementation Status of Every Requirement

| Item | Requirement | Status | Current Code State |
| :--- | :--- | :---: | :--- |
| **1** | `TaskChecklistItem` model in `prisma/schema.prisma` | **EXISTS** | Defined with `id`, `taskId`, `title`, `isCompleted`, `order`, `completedAt`, `completedById`, `completedBy`, `createdAt`, `updatedAt`, and indexes on `[taskId]` and `[taskId, order]`. |
| **2** | `checklistItems` relation in `Task` model | **EXISTS** | Line 215 of `prisma/schema.prisma`: `checklistItems TaskChecklistItem[]` with cascade delete. |
| **3** | Migration named `add_task_checklist` | **EXISTS & APPLIED** | `prisma/migrations/20261119171000_add_task_checklist/migration.sql` is deployed to Neon PostgreSQL. |
| **4** | `lib/actions/checklist.actions.ts` | **EXISTS** | Implements `createChecklistItemAction`, `updateChecklistItemAction`, `toggleChecklistItemAction`, `deleteChecklistItemAction`, and `reorderChecklistItemsAction`. |
| **5** | `components/tasks/task-checklist.tsx` | **EXISTS (OVER-ENGINEERED)** | Component exists, but currently contains progress bars, completion percentage counters, and drag-and-drop handles which must be removed per user specification. |
| **6** | `components/ui/checkbox.tsx` | **EXISTS** | Radix UI `Checkbox.Root` and `Checkbox.Indicator` component exists. |
| **7** | `assertCanViewTask()` integration in task queries | **EXISTS (MINOR DEFECT)** | Includes `checklistItems`, but ordered by `{ order: "asc" }` only; missing required secondary sort `{ createdAt: "asc" }`. |
| **8** | Checklist data included in `getTaskById()` | **EXISTS** | `getTaskById()` calls `assertCanViewTask()`, returning checklist data within the task payload. |
| **9** | `TaskChecklist` rendered inside `task-detail-client.tsx` | **EXISTS (MISPLACED)** | Component is imported and mounted, but rendered **below Blocked By** instead of **directly below description and above Blocked By**. |

---

## 3. Exact Reason the Checklist is Not Visible

The checklist is not visible to the user due to two distinct factors:

### Factor A: Page Scope vs. Dashboard Expectation
The user stated: *"I cannot see the Task Checklist in the dashboard."*
- **Design Specification:** The checklist is strictly an **individual task detail feature** (`/tasks/[id]`). It is not intended to be a global dashboard widget or appear on the main dashboard (`/` or `/tasks`).
- If a user opens the dashboard (`/` or `/tasks`) looking for a checklist component or panel, it is intentionally absent from those views.

### Factor B: DOM Misplacement on `/tasks/[id]`
When navigating to an individual task detail page (`/tasks/[id]`), the checklist is currently rendered in the wrong position:
- **Current Position in `task-detail-client.tsx`:**
  1. Title & Status Badges (lines 250–302)
  2. Description (lines 304–310)
  3. **`Blocked By` Section (lines 313–362)**
  4. **`TaskChecklist` (lines 364–370)**
  5. `Subtasks` Section (lines 372–575)
- **Required Position:** Directly below the description and **above** the `Blocked By` section.
- Because it was placed below `Blocked By`, users viewing tasks without scrolling past the blocker section do not see the checklist in the expected position.

---

## 4. Missing Implementation & Remediation Work

1. **Reposition Component in `task-detail-client.tsx`:**
   - Move `<TaskChecklist ... />` from below the `Blocked By` section to **between** the description container (`</div>`) and the `Blocked By` section (`{/* Blockers & Dependencies */}`).

2. **Simplify `task-checklist.tsx` (Remove Prohibited Features):**
   - The user specification strictly mandates:
     > *"Do not introduce progress bars, completion counters or drag-and-drop ordering."*
   - Current implementation includes:
     - `<Progress ... />` component (must be removed).
     - Completion percentage & counter text `X of Y completed (Z%) • N remaining` (must be removed).
     - Drag-and-drop handlers (`onDragStart`, `onDragOver`, `onDragEnd`, `GripVertical` icon) (must be removed).
   - Retain pure checklist functionality:
     - Clean checklist header.
     - Add checklist item form (input + submit).
     - Item list with interactive checkboxes (toggle complete/incomplete).
     - Strikethrough completed styling.
     - Inline title editing.
     - Delete action.
     - Completed attribution (avatar/name).

3. **Align Query Sorting in `lib/queries/task.queries.ts`:**
   - Update `checklistItems` ordering in `assertCanViewTask`:
     ```ts
     checklistItems: {
       orderBy: [{ order: "asc" }, { createdAt: "asc" }],
       include: {
         completedBy: {
           select: { id: true, firstName: true, lastName: true, avatarUrl: true },
         },
       },
     }
     ```

4. **Clean up Extraneous Checklist UI from Kanban:**
   - The user specified: *"The checklist must appear only on an individual task detail page (`/tasks/[id]`)"*.
   - Remove the checklist badges previously added to `kanban-board.tsx` (card view and table view) to strictly conform to the scope boundary.

---

## 5. Database Migration Status

- **Status:** **FULLY DEPLOYED & HEALTHY**
- **Migration Directory:** `prisma/migrations/20261119171000_add_task_checklist`
- **Verification:** Verified via `prisma migrate status` and live probe.
- **Table:** `public.TaskChecklistItem` exists with correct columns, primary key, foreign keys, and indexes.
- **No database migrations are missing or pending.**

---

## 6. Recommended Fix Plan

Once approved, the remediation will execute in the following controlled steps:

1. **`components/tasks/task-detail-client.tsx`**:
   - Cut `<TaskChecklist ... />` from lines 364–370.
   - Paste directly beneath the task description (line 311) and above the `{/* Blockers & Dependencies */}` section (line 313).
2. **`components/tasks/task-checklist.tsx`**:
   - Remove the `Progress` bar.
   - Remove completion counters and percentages.
   - Remove drag-and-drop handles and event handlers.
   - Ensure clean, minimalist checklist presentation matching Panthar Teams design system.
3. **`lib/queries/task.queries.ts`**:
   - Update `orderBy` for `checklistItems` to `[{ order: "asc" }, { createdAt: "asc" }]`.
4. **`components/tasks/kanban-board.tsx`**:
   - Remove checklist pill from Kanban cards and list table so the checklist is exclusively contained within `/tasks/[id]`.
5. **Quality Assurance**:
   - Run `npx tsc --noEmit` (target: 0 errors).
   - Run `npm run lint` (target: 0 errors, 0 warnings).
   - Run unit and integration tests.
   - Run `npm run build` to confirm production readiness.

---

*Note: Per instruction, no code modifications have been made. Awaiting user approval to proceed with the recommended fixes.*

