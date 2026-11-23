-- ============================================================================
-- Stage 2: Contract Migration (Executed Post-App Deployment)
-- Run ONLY after 100% of instances use columnId and pre-Contract gate is passed.
-- Safety: Staged constraint validation, lock_timeout = '2s', clean enum drop without CASCADE.
-- ============================================================================

BEGIN;

-- Enforce strict lock and statement timeouts to avoid queue starvation
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- Step 1: Pre-assertion that all tasks have a non-null, valid columnId pointing to BoardColumn
DO $$
DECLARE
    v_invalid_count INT;
BEGIN
    SELECT COUNT(*) INTO v_invalid_count
    FROM public."Task" t
    WHERE t."columnId" IS NULL 
       OR NOT EXISTS (SELECT 1 FROM public."BoardColumn" bc WHERE bc.id = t."columnId");

    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION 'Contract migration safety abort: % task(s) have NULL or unmapped columnId', v_invalid_count;
    END IF;
END $$;

-- Step 2: Safe staged foreign key constraint creation (NOT VALID + separate validation)
-- 2a: Add foreign key constraint NOT VALID (instant metadata addition, brief lock < 5ms)
ALTER TABLE public."Task" ADD CONSTRAINT "Task_columnId_fkey" 
    FOREIGN KEY ("columnId") REFERENCES public."BoardColumn"("id") 
    ON DELETE RESTRICT ON UPDATE CASCADE 
    NOT VALID;

-- 2b: Validate foreign key constraint (scans table under SHARE UPDATE EXCLUSIVE, reads & writes unblocked)
ALTER TABLE public."Task" VALIDATE CONSTRAINT "Task_columnId_fkey";

-- Step 3: Safe staged NOT NULL enforcement on Task.columnId
-- 3a: Add check constraint NOT VALID (instant metadata addition, brief lock < 5ms)
ALTER TABLE public."Task" ADD CONSTRAINT "Task_columnId_not_null_check" 
    CHECK ("columnId" IS NOT NULL) 
    NOT VALID;

-- 3b: Validate check constraint (scans table under SHARE UPDATE EXCLUSIVE, reads & writes unblocked)
ALTER TABLE public."Task" VALIDATE CONSTRAINT "Task_columnId_not_null_check";

-- 3c: Promote columnId to NOT NULL (instantaneous in PG 12+ because validated check proves absence of NULLs)
ALTER TABLE public."Task" ALTER COLUMN "columnId" SET NOT NULL;

-- 3d: Drop redundant temporary check constraint
ALTER TABLE public."Task" DROP CONSTRAINT "Task_columnId_not_null_check";

-- Step 4: Comprehensive PostgreSQL catalog verification of 4 replacement columnId indexes
-- Asserts that replacement indexes pre-created in Stage 1B exist, are valid, match ownership,
-- contain no included attributes (indnatts = indnkeyatts), have ascending sort order, and match exact operator classes.
DO $$
DECLARE
    v_expected_replacement CONSTANT text[] := ARRAY[
        'Task_columnId_idx',
        'Task_columnId_projectId_idx',
        'Task_columnId_order_idx',
        'Task_columnId_dueDate_idx'
    ];
    v_idx_name text;
    v_found_count int := 0;
    v_cols text[];
    v_opclasses text[];
    v_sort_dirs text[];
    v_is_valid boolean;
    v_table_name text;
    v_schema_name text;
    v_am_name text;
    v_is_unique boolean;
    v_indpred text;
    v_natts smallint;
    v_nkeyatts smallint;
    v_index_owner oid;
    v_table_owner oid;
BEGIN
    FOREACH v_idx_name IN ARRAY v_expected_replacement LOOP
        SELECT 
            n.nspname,
            t.relname,
            am.amname,
            i.indisunique,
            i.indisvalid,
            pg_get_expr(i.indpred, i.indrelid),
            i.indnatts,
            i.indnkeyatts,
            c.relowner,
            t.relowner,
            ARRAY(
                SELECT a.attname::text
                FROM generate_series(1, i.indnkeyatts) AS k(ord)
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[k.ord - 1]
            ),
            ARRAY(
                SELECT opc.opcname::text
                FROM generate_series(1, i.indnkeyatts) AS k(ord)
                JOIN pg_opclass opc ON opc.oid = i.indclass[k.ord - 1]
            ),
            ARRAY(
                SELECT CASE WHEN (i.indoption[k.ord - 1] & 1) = 0 THEN 'ASC' ELSE 'DESC' END
                FROM generate_series(1, i.indnkeyatts) AS k(ord)
            )
        INTO v_schema_name, v_table_name, v_am_name, v_is_unique, v_is_valid, v_indpred, v_natts, v_nkeyatts, v_index_owner, v_table_owner, v_cols, v_opclasses, v_sort_dirs
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_am am ON am.oid = c.relam
        WHERE c.relname = v_idx_name;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Contract migration safety abort: Replacement index % not found in pg_catalog', v_idx_name;
        END IF;

        IF v_schema_name != 'public' OR v_table_name != 'Task' THEN
            RAISE EXCEPTION 'Contract migration safety abort: Replacement index % belongs to unexpected schema/table (%.%), expected public."Task"', 
                v_idx_name, v_schema_name, v_table_name;
        END IF;

        IF v_index_owner != v_table_owner THEN
            RAISE EXCEPTION 'Contract migration safety abort: Replacement index % owner (%) does not match table "Task" owner (%)', 
                v_idx_name, v_index_owner, v_table_owner;
        END IF;

        IF v_am_name != 'btree' THEN
            RAISE EXCEPTION 'Contract migration safety abort: Replacement index % has access method %, expected btree', v_idx_name, v_am_name;
        END IF;

        IF NOT v_is_valid THEN
            RAISE EXCEPTION 'Contract migration safety abort: Replacement index % is marked INVALID in pg_index (concurrent build failed or was interrupted)', v_idx_name;
        END IF;

        IF v_is_unique THEN
            RAISE EXCEPTION 'Contract migration safety abort: Replacement index % is unexpectedly marked UNIQUE', v_idx_name;
        END IF;

        IF v_indpred IS NOT NULL THEN
            RAISE EXCEPTION 'Contract migration safety abort: Replacement index % has unexpected partial predicate: %', v_idx_name, v_indpred;
        END IF;

        IF v_natts != v_nkeyatts THEN
            RAISE EXCEPTION 'Contract migration safety abort: Replacement index % contains unexpected included attributes (natts=%, nkeyatts=%)', v_idx_name, v_natts, v_nkeyatts;
        END IF;

        -- Verify exact key-column arrays, operator classes, and standard ascending sort direction
        IF v_idx_name = 'Task_columnId_idx' THEN
            IF v_nkeyatts != 1 OR v_cols != ARRAY['columnId'] OR v_opclasses != ARRAY['text_ops'] OR v_sort_dirs != ARRAY['ASC'] THEN
                RAISE EXCEPTION 'Contract migration safety abort: Replacement index % definition mismatch (cols=%, opclasses=%, dirs=%)', v_idx_name, v_cols, v_opclasses, v_sort_dirs;
            END IF;
        ELSIF v_idx_name = 'Task_columnId_projectId_idx' THEN
            IF v_nkeyatts != 2 OR v_cols != ARRAY['columnId', 'projectId'] OR v_opclasses != ARRAY['text_ops', 'text_ops'] OR v_sort_dirs != ARRAY['ASC', 'ASC'] THEN
                RAISE EXCEPTION 'Contract migration safety abort: Replacement index % definition mismatch (cols=%, opclasses=%, dirs=%)', v_idx_name, v_cols, v_opclasses, v_sort_dirs;
            END IF;
        ELSIF v_idx_name = 'Task_columnId_order_idx' THEN
            IF v_nkeyatts != 2 OR v_cols != ARRAY['columnId', 'order'] OR v_opclasses != ARRAY['text_ops', 'float8_ops'] OR v_sort_dirs != ARRAY['ASC', 'ASC'] THEN
                RAISE EXCEPTION 'Contract migration safety abort: Replacement index % definition mismatch (cols=%, opclasses=%, dirs=%)', v_idx_name, v_cols, v_opclasses, v_sort_dirs;
            END IF;
        ELSIF v_idx_name = 'Task_columnId_dueDate_idx' THEN
            IF v_nkeyatts != 2 OR v_cols != ARRAY['columnId', 'dueDate'] OR v_opclasses NOT IN (ARRAY['text_ops', 'timestamp_ops'], ARRAY['text_ops', 'timestamptz_ops']) OR v_sort_dirs != ARRAY['ASC', 'ASC'] THEN
                RAISE EXCEPTION 'Contract migration safety abort: Replacement index % definition mismatch (cols=%, opclasses=%, dirs=%)', v_idx_name, v_cols, v_opclasses, v_sort_dirs;
            END IF;
        END IF;

        v_found_count := v_found_count + 1;
    END LOOP;

    IF v_found_count != 4 THEN
        RAISE EXCEPTION 'Contract migration safety abort: Expected 4 verified replacement columnId indexes, verified %', v_found_count;
    END IF;
END $$;

-- Step 5: Comprehensive PostgreSQL catalog verification of 4 legacy status indexes
-- Asserts that legacy status indexes exist, are valid, have no included attributes, and match expected definitions before dropping.
DO $$
DECLARE
    v_expected_indexes CONSTANT text[] := ARRAY[
        'Task_status_projectId_idx',
        'Task_status_order_idx',
        'Task_status_idx',
        'Task_status_dueDate_idx'
    ];
    v_idx_name text;
    v_found_count int := 0;
    v_cols text[];
    v_opclasses text[];
    v_sort_dirs text[];
    v_is_valid boolean;
    v_table_name text;
    v_schema_name text;
    v_am_name text;
    v_is_unique boolean;
    v_indpred text;
    v_natts smallint;
    v_nkeyatts smallint;
BEGIN
    FOREACH v_idx_name IN ARRAY v_expected_indexes LOOP
        SELECT 
            n.nspname,
            t.relname,
            am.amname,
            i.indisunique,
            i.indisvalid,
            pg_get_expr(i.indpred, i.indrelid),
            i.indnatts,
            i.indnkeyatts,
            ARRAY(
                SELECT a.attname::text
                FROM generate_series(1, i.indnkeyatts) AS k(ord)
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[k.ord - 1]
            ),
            ARRAY(
                SELECT opc.opcname::text
                FROM generate_series(1, i.indnkeyatts) AS k(ord)
                JOIN pg_opclass opc ON opc.oid = i.indclass[k.ord - 1]
            ),
            ARRAY(
                SELECT CASE WHEN (i.indoption[k.ord - 1] & 1) = 0 THEN 'ASC' ELSE 'DESC' END
                FROM generate_series(1, i.indnkeyatts) AS k(ord)
            )
        INTO v_schema_name, v_table_name, v_am_name, v_is_unique, v_is_valid, v_indpred, v_natts, v_nkeyatts, v_cols, v_opclasses, v_sort_dirs
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_am am ON am.oid = c.relam
        WHERE c.relname = v_idx_name;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Contract migration safety abort: Expected index % not found in pg_catalog', v_idx_name;
        END IF;

        IF v_schema_name != 'public' OR v_table_name != 'Task' THEN
            RAISE EXCEPTION 'Contract migration safety abort: Index % belongs to unexpected schema/table (%.%), expected public."Task"', 
                v_idx_name, v_schema_name, v_table_name;
        END IF;

        IF v_am_name != 'btree' THEN
            RAISE EXCEPTION 'Contract migration safety abort: Index % has access method %, expected btree', v_idx_name, v_am_name;
        END IF;

        IF NOT v_is_valid THEN
            RAISE EXCEPTION 'Contract migration safety abort: Index % is marked INVALID in pg_index', v_idx_name;
        END IF;

        IF v_is_unique THEN
            RAISE EXCEPTION 'Contract migration safety abort: Index % is unexpectedly marked UNIQUE', v_idx_name;
        END IF;

        IF v_indpred IS NOT NULL THEN
            RAISE EXCEPTION 'Contract migration safety abort: Index % has unexpected partial predicate: %', v_idx_name, v_indpred;
        END IF;

        IF v_natts != v_nkeyatts THEN
            RAISE EXCEPTION 'Contract migration safety abort: Legacy index % contains unexpected included attributes (natts=%, nkeyatts=%)', v_idx_name, v_natts, v_nkeyatts;
        END IF;

        -- Verify exact key-column arrays, operator classes, and standard ascending sort direction
        IF v_idx_name = 'Task_status_projectId_idx' THEN
            IF v_nkeyatts != 2 OR v_cols != ARRAY['status', 'projectId'] OR v_opclasses != ARRAY['enum_ops', 'text_ops'] OR v_sort_dirs != ARRAY['ASC', 'ASC'] THEN
                RAISE EXCEPTION 'Contract migration safety abort: Legacy index % definition mismatch (cols=%, opclasses=%, dirs=%)', v_idx_name, v_cols, v_opclasses, v_sort_dirs;
            END IF;
        ELSIF v_idx_name = 'Task_status_order_idx' THEN
            IF v_nkeyatts != 2 OR v_cols != ARRAY['status', 'order'] OR v_opclasses != ARRAY['enum_ops', 'float8_ops'] OR v_sort_dirs != ARRAY['ASC', 'ASC'] THEN
                RAISE EXCEPTION 'Contract migration safety abort: Legacy index % definition mismatch (cols=%, opclasses=%, dirs=%)', v_idx_name, v_cols, v_opclasses, v_sort_dirs;
            END IF;
        ELSIF v_idx_name = 'Task_status_idx' THEN
            IF v_nkeyatts != 1 OR v_cols != ARRAY['status'] OR v_opclasses != ARRAY['enum_ops'] OR v_sort_dirs != ARRAY['ASC'] THEN
                RAISE EXCEPTION 'Contract migration safety abort: Legacy index % definition mismatch (cols=%, opclasses=%, dirs=%)', v_idx_name, v_cols, v_opclasses, v_sort_dirs;
            END IF;
        ELSIF v_idx_name = 'Task_status_dueDate_idx' THEN
            IF v_nkeyatts != 2 OR v_cols != ARRAY['status', 'dueDate'] OR v_opclasses NOT IN (ARRAY['enum_ops', 'timestamp_ops'], ARRAY['enum_ops', 'timestamptz_ops']) OR v_sort_dirs != ARRAY['ASC', 'ASC'] THEN
                RAISE EXCEPTION 'Contract migration safety abort: Legacy index % definition mismatch (cols=%, opclasses=%, dirs=%)', v_idx_name, v_cols, v_opclasses, v_sort_dirs;
            END IF;
        END IF;

        v_found_count := v_found_count + 1;
    END LOOP;

    IF v_found_count != 4 THEN
        RAISE EXCEPTION 'Contract migration safety abort: Expected 4 verified status indexes, verified %', v_found_count;
    END IF;
END $$;

-- Step 6: Drop verified legacy status indexes ONLY AFTER replacement indexes are verified
DROP INDEX "Task_status_projectId_idx";
DROP INDEX "Task_status_order_idx";
DROP INDEX "Task_status_idx";
DROP INDEX "Task_status_dueDate_idx";

-- Step 7: Drop compatibility trigger and verify function dependencies before dropping function
DROP TRIGGER IF EXISTS "sync_task_status_and_column_trigger" ON "Task";

DO $$
DECLARE
    v_func_oid oid;
    v_dep_count int;
    v_dep_details text;
BEGIN
    SELECT oid INTO v_func_oid FROM pg_proc WHERE proname = 'sync_task_status_and_column';
    IF FOUND THEN
        SELECT COUNT(*), string_agg(tgname::text, ', ')
        INTO v_dep_count, v_dep_details
        FROM pg_trigger
        WHERE tgfoid = v_func_oid;

        IF v_dep_count > 0 THEN
            RAISE EXCEPTION 'Contract migration safety abort: Function sync_task_status_and_column is still referenced by trigger(s): %', v_dep_details;
        END IF;
    END IF;
END $$;

DROP FUNCTION IF EXISTS "sync_task_status_and_column"();

-- Step 8: Drop legacy status column
ALTER TABLE "Task" DROP COLUMN "status";

-- Step 9: Deep catalog enum dependency inspection before dropping TaskStatus
DO $$
DECLARE
    v_enum_oid oid;
    v_dep_count int;
    v_dep_details text;
BEGIN
    SELECT oid INTO v_enum_oid FROM pg_type WHERE typname = 'TaskStatus';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contract migration safety abort: enum type TaskStatus not found in pg_type';
    END IF;

    -- Assert no remaining column dependencies across any table
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE udt_name = 'TaskStatus'
    ) THEN
        SELECT string_agg(table_schema || '.' || table_name || '.' || column_name, ', ')
        INTO v_dep_details
        FROM information_schema.columns 
        WHERE udt_name = 'TaskStatus';

        RAISE EXCEPTION 'Contract migration safety abort: TaskStatus enum is still referenced by active column(s): %', v_dep_details;
    END IF;

    -- Assert no dependent views, functions, stored procedures, or defaults via pg_depend
    SELECT COUNT(*), string_agg(COALESCE(c.relname::text, p.proname::text, d.objid::text) || ' (' || d.deptype::text || ')', ', ')
    INTO v_dep_count, v_dep_details
    FROM pg_depend d
    LEFT JOIN pg_class c ON d.objid = c.oid
    LEFT JOIN pg_proc p ON d.objid = p.oid
    WHERE d.refobjid = v_enum_oid
      AND d.deptype::text != 'i'; -- Exclude internal array type dependency (_TaskStatus)

    IF v_dep_count > 0 THEN
        RAISE EXCEPTION 'Contract migration safety abort: TaskStatus enum has % active dependent object(s) in pg_depend: %', v_dep_count, v_dep_details;
    END IF;
END $$;

-- Step 10: Drop TaskStatus enum cleanly WITHOUT CASCADE
DROP TYPE "TaskStatus";

COMMIT;
