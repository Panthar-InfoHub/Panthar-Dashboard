# Staged Contract Migrations (Release 2)

This directory isolates the Stage 2 Contract migration from the active `prisma/migrations/` directory.

## Reason for Isolation
Ticket 3 (Configurable Board Columns) follows a strict Expand/Contract zero-downtime release sequence:

1. **Release 1 (Expansion & Safe Transition):**
   - Active Prisma migrations: `0_init` through `20261121110000_create_replacement_indexes_concurrently` (Stage 1B).
   - Database state: Both `Task.status` (NOT NULL, enum) and `Task.columnId` exist and are kept synchronized via `sync_task_status_and_column_trigger`.
   - Application version: Version C (reads `columnId` / `BoardColumn.systemKey`, does not write or read `Task.status`).
   - Deployment: Release 1 application is deployed to production while the database maintains transitional compatibility.

2. **Release 2 (Contract & Cleanup):**
   - Once Release 1 application has been deployed, verified stable in production, and all legacy status dependencies are confirmed obsolete:
   - Migration `20261121200000_contract_board_columns` will be moved back into `prisma/migrations/`.
   - Executing `prisma migrate deploy` will then drop `Task.status`, drop `enum TaskStatus`, drop `sync_task_status_and_column_trigger`, and validate `Task.columnId` as NOT NULL.

## Preserved Migration Details
- **Migration Directory:** `20261121200000_contract_board_columns`
- **File:** `migration.sql`
- **SHA-256 Checksum:** `ac587ec2d3bd7d12eced15d14d7529e1f63258835ec1e1ee1bc648768f669bf8`

