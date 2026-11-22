-- ============================================================================
-- Stage 1A: Expand Schema & Triggers (Atomic Transactional Migration)
-- Execution Latency: < 10 ms (Instantaneous metadata DDL & triggers)
-- Locking: ALTER TABLE acquires ACCESS EXCLUSIVE on "Task".
-- Safety: SET LOCAL lock_timeout = '2s' prevents lock queue starvation.
-- Note: NO data backfill runs inside this transaction.
-- ============================================================================

BEGIN;

-- Enforce strict lock and statement timeouts to prevent lock queue starvation
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- Step 1: Pre-check that TaskStatus is not referenced outside Task.status
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE udt_name = 'TaskStatus' AND (table_name != 'Task' OR column_name != 'status')
    ) THEN
        RAISE EXCEPTION 'Expand migration safety abort: TaskStatus enum is referenced outside Task.status';
    END IF;
END $$;

-- Step 2: Create BoardColumn table
CREATE TABLE "BoardColumn" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "systemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardColumn_pkey" PRIMARY KEY ("id")
);

-- Step 3: Create constraints and indexes on BoardColumn
CREATE UNIQUE INDEX "BoardColumn_systemKey_key" ON "BoardColumn"("systemKey");
CREATE INDEX "BoardColumn_position_idx" ON "BoardColumn"("position");
ALTER TABLE "BoardColumn" ADD CONSTRAINT "BoardColumn_systemKey_check" 
    CHECK ("systemKey" IS NULL OR "systemKey" IN ('BACKLOG', 'DONE'));

-- Step 4: Insert 6 baseline columns with deterministic IDs and grid positions
INSERT INTO "BoardColumn" ("id", "name", "color", "position", "systemKey", "createdAt", "updatedAt")
VALUES
    ('col_backlog', 'Backlog', '#6b7280', 1000.0, 'BACKLOG', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('col_todo', 'Todo', '#64748b', 2000.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('col_in_progress', 'In Progress', '#3b82f6', 3000.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('col_review', 'Review', '#a855f7', 4000.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('col_testing', 'Testing', '#f59e0b', 5000.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('col_done', 'Done', '#10b981', 6000.0, 'DONE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Step 5: Add columnId as nullable to Task (instant metadata DDL, ACCESS EXCLUSIVE held < 5ms)
ALTER TABLE "Task" ADD COLUMN "columnId" TEXT;

-- Step 6: Install database-level protection trigger on BoardColumn
CREATE OR REPLACE FUNCTION "protect_system_board_columns"()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Prevent unauthorized insertion of system columns
        IF NEW."systemKey" IS NOT NULL THEN
            IF NOT (
                (NEW."id" = 'col_backlog' AND NEW."systemKey" = 'BACKLOG') OR
                (NEW."id" = 'col_done' AND NEW."systemKey" = 'DONE')
            ) THEN
                RAISE EXCEPTION 'Database safety abort: Unauthorized insertion of system board column % (systemKey: %)', NEW.id, NEW."systemKey";
            END IF;
        END IF;

        -- Enforce Backlog fixed position invariant (permanently anchored at 1000.0)
        IF NEW."systemKey" = 'BACKLOG' AND NEW."position" != 1000.0 THEN
            RAISE EXCEPTION 'Database safety abort: Backlog column position must be permanently anchored at 1000.0 (received %)', NEW."position";
        END IF;

        -- Enforce Custom column position lower bound (must be strictly greater than Backlog)
        IF NEW."systemKey" IS NULL AND NEW."position" <= 1000.0 THEN
            RAISE EXCEPTION 'Database safety abort: Custom column position must be strictly greater than 1000.0 (received %)', NEW."position";
        END IF;

        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Prevent deletion of system columns under all circumstances
        IF OLD."systemKey" IS NOT NULL THEN
            RAISE EXCEPTION 'Database safety abort: Cannot delete system board column % (systemKey: %)', OLD.id, OLD."systemKey";
        END IF;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Prevent modifying systemKey of an existing system column
        IF OLD."systemKey" IS NOT NULL AND NEW."systemKey" IS DISTINCT FROM OLD."systemKey" THEN
            RAISE EXCEPTION 'Database safety abort: Cannot alter systemKey of system column %', OLD.id;
        END IF;

        -- Prevent altering primary key ID of an existing system column
        IF OLD."systemKey" IS NOT NULL AND NEW.id IS DISTINCT FROM OLD.id THEN
            RAISE EXCEPTION 'Database safety abort: Cannot alter primary key of system column %', OLD.id;
        END IF;

        -- Prevent promoting a custom column to a system column
        IF OLD."systemKey" IS NULL AND NEW."systemKey" IS NOT NULL THEN
            RAISE EXCEPTION 'Database safety abort: Cannot promote custom column % to a system column', OLD.id;
        END IF;

        -- Enforce Backlog fixed position invariant on update
        IF NEW."systemKey" = 'BACKLOG' AND NEW."position" != 1000.0 THEN
            RAISE EXCEPTION 'Database safety abort: Backlog column position cannot be modified away from 1000.0 (received %)', NEW."position";
        END IF;

        -- Enforce Custom column position lower bound on update
        IF NEW."systemKey" IS NULL AND NEW."position" <= 1000.0 THEN
            RAISE EXCEPTION 'Database safety abort: Custom column position must be strictly greater than 1000.0 (received %)', NEW."position";
        END IF;

        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "protect_system_board_columns_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "BoardColumn"
FOR EACH ROW
EXECUTE FUNCTION "protect_system_board_columns"();

-- Step 7: Install bidirectional compatibility trigger on Task
CREATE OR REPLACE FUNCTION "sync_task_status_and_column"()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."columnId" IS NOT NULL THEN
            -- Explicit columnId write: validate columnId exists in BoardColumn
            IF NOT EXISTS (SELECT 1 FROM "BoardColumn" WHERE "id" = NEW."columnId") THEN
                RAISE EXCEPTION 'Trigger safety abort: Invalid columnId % does not exist in BoardColumn', NEW."columnId";
            END IF;
            -- Map legacy status to satisfy NOT NULL constraint during coexistence
            NEW."status" := CASE NEW."columnId"
                WHEN 'col_backlog' THEN 'BACKLOG'::"TaskStatus"
                WHEN 'col_todo' THEN 'TODO'::"TaskStatus"
                WHEN 'col_in_progress' THEN 'IN_PROGRESS'::"TaskStatus"
                WHEN 'col_review' THEN 'REVIEW'::"TaskStatus"
                WHEN 'col_testing' THEN 'TESTING'::"TaskStatus"
                WHEN 'col_done' THEN 'DONE'::"TaskStatus"
                ELSE 'BACKLOG'::"TaskStatus" -- Custom column: fallback valid enum representation
            END;
        ELSE
            -- Compatibility fallback heuristic: NEW.columnId IS NULL.
            -- Treat as legacy write ONLY IF status is a valid legacy enum value.
            IF NEW."status" IS NULL THEN
                RAISE EXCEPTION 'Trigger safety abort: Neither columnId nor status provided on INSERT';
            END IF;
            NEW."columnId" := CASE NEW."status"
                WHEN 'BACKLOG' THEN 'col_backlog'
                WHEN 'TODO' THEN 'col_todo'
                WHEN 'IN_PROGRESS' THEN 'col_in_progress'
                WHEN 'REVIEW' THEN 'col_review'
                WHEN 'TESTING' THEN 'col_testing'
                WHEN 'DONE' THEN 'col_done'
                ELSE NULL
            END;
            IF NEW."columnId" IS NULL THEN
                RAISE EXCEPTION 'Trigger safety abort: Ambiguous INSERT with NULL columnId and invalid or unmapped legacy status: %', NEW."status";
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF (NEW."columnId" IS DISTINCT FROM OLD."columnId") AND (NEW."status" IS NOT DISTINCT FROM OLD."status") THEN
            -- Column-driven update
            IF NOT EXISTS (SELECT 1 FROM "BoardColumn" WHERE "id" = NEW."columnId") THEN
                RAISE EXCEPTION 'Trigger safety abort: Invalid columnId % does not exist in BoardColumn', NEW."columnId";
            END IF;
            NEW."status" := CASE NEW."columnId"
                WHEN 'col_backlog' THEN 'BACKLOG'::"TaskStatus"
                WHEN 'col_todo' THEN 'TODO'::"TaskStatus"
                WHEN 'col_in_progress' THEN 'IN_PROGRESS'::"TaskStatus"
                WHEN 'col_review' THEN 'REVIEW'::"TaskStatus"
                WHEN 'col_testing' THEN 'TESTING'::"TaskStatus"
                WHEN 'col_done' THEN 'DONE'::"TaskStatus"
                ELSE OLD."status" -- Retain previous valid enum representation for custom columns
            END;
        ELSIF (NEW."status" IS DISTINCT FROM OLD."status") AND (NEW."columnId" IS NOT DISTINCT FROM OLD."columnId") THEN
            -- Legacy status update
            NEW."columnId" := CASE NEW."status"
                WHEN 'BACKLOG' THEN 'col_backlog'
                WHEN 'TODO' THEN 'col_todo'
                WHEN 'IN_PROGRESS' THEN 'col_in_progress'
                WHEN 'REVIEW' THEN 'col_review'
                WHEN 'TESTING' THEN 'col_testing'
                WHEN 'DONE' THEN 'col_done'
                ELSE NULL
            END;
            IF NEW."columnId" IS NULL THEN
                RAISE EXCEPTION 'Trigger safety abort: Unexpected legacy status % on UPDATE', NEW."status";
            END IF;
        ELSIF (NEW."columnId" IS DISTINCT FROM OLD."columnId") AND (NEW."status" IS DISTINCT FROM OLD."status") THEN
            -- Same-statement dual write: columnId is canonical
            IF NOT EXISTS (SELECT 1 FROM "BoardColumn" WHERE "id" = NEW."columnId") THEN
                RAISE EXCEPTION 'Trigger safety abort: Invalid columnId % does not exist in BoardColumn', NEW."columnId";
            END IF;
            NEW."status" := CASE NEW."columnId"
                WHEN 'col_backlog' THEN 'BACKLOG'::"TaskStatus"
                WHEN 'col_todo' THEN 'TODO'::"TaskStatus"
                WHEN 'col_in_progress' THEN 'IN_PROGRESS'::"TaskStatus"
                WHEN 'col_review' THEN 'REVIEW'::"TaskStatus"
                WHEN 'col_testing' THEN 'TESTING'::"TaskStatus"
                WHEN 'col_done' THEN 'DONE'::"TaskStatus"
                ELSE OLD."status"
            END;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sync_task_status_and_column_trigger"
BEFORE INSERT OR UPDATE ON "Task"
FOR EACH ROW
EXECUTE FUNCTION "sync_task_status_and_column"();

-- Step 8: Commit promptly (Holds ACCESS EXCLUSIVE lock for < 10ms total)
COMMIT;
