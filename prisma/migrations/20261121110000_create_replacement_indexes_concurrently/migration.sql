-- @prisma-no-run-in-transaction
-- ============================================================================
-- Stage 1B: Non-Transactional Concurrent Replacement Indexes
-- Directive: -- @prisma-no-run-in-transaction ensures execution without BEGIN/COMMIT
-- Lock Mode: SHARE UPDATE EXCLUSIVE on public."Task" (reads & writes unblocked)
-- Target Table: public."Task"
-- ============================================================================

-- Step 1: Pre-creation inspection of target indexes on public."Task"
-- Verifies no invalid remnants exist and existing valid indexes match expected definitions
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT 
            c.relname::text AS index_name,
            i.indisvalid AS is_valid,
            i.indisready AS is_ready,
            pg_get_indexdef(c.oid)::text AS index_def
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
        JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' 
          AND t.relname = 'Task'
          AND c.relname IN (
            'Task_columnId_idx',
            'Task_columnId_projectId_idx',
            'Task_columnId_order_idx',
            'Task_columnId_dueDate_idx'
          )
    LOOP
        -- If an interrupted attempt left an INVALID index remnant, abort with clear instruction
        IF NOT r.is_valid THEN
            RAISE EXCEPTION 'Stage 1B Pre-check abort: Index % on public."Task" is INVALID (indisvalid = false). Operator must drop it using: DROP INDEX CONCURRENTLY IF EXISTS public."%";', r.index_name, r.index_name;
        END IF;

        -- If index exists and is valid, verify it has the expected column definition
        IF r.index_name = 'Task_columnId_idx' AND r.index_def NOT LIKE '%("columnId")%' THEN
            RAISE EXCEPTION 'Stage 1B Pre-check abort: Existing index Task_columnId_idx has unexpected definition: %', r.index_def;
        ELSIF r.index_name = 'Task_columnId_projectId_idx' AND r.index_def NOT LIKE '%("columnId", "projectId")%' THEN
            RAISE EXCEPTION 'Stage 1B Pre-check abort: Existing index Task_columnId_projectId_idx has unexpected definition: %', r.index_def;
        ELSIF r.index_name = 'Task_columnId_order_idx' AND r.index_def NOT LIKE '%("columnId", "order")%' THEN
            RAISE EXCEPTION 'Stage 1B Pre-check abort: Existing index Task_columnId_order_idx has unexpected definition: %', r.index_def;
        ELSIF r.index_name = 'Task_columnId_dueDate_idx' AND r.index_def NOT LIKE '%("columnId", "dueDate")%' THEN
            RAISE EXCEPTION 'Stage 1B Pre-check abort: Existing index Task_columnId_dueDate_idx has unexpected definition: %', r.index_def;
        END IF;
    END LOOP;
END $$;

-- Step 2: Concurrently create replacement indexes IF NOT EXISTS using schema-qualified names
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_columnId_idx" 
    ON public."Task"("columnId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_columnId_projectId_idx" 
    ON public."Task"("columnId", "projectId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_columnId_order_idx" 
    ON public."Task"("columnId", "order");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_columnId_dueDate_idx" 
    ON public."Task"("columnId", "dueDate");

-- Step 3: Post-creation verification of all four replacement indexes
-- Asserts that all four exist on public."Task", are valid, are ready, and match exact definitions
DO $$
DECLARE
    v_missing_count INT;
    r RECORD;
BEGIN
    -- Verify presence of all four target indexes
    SELECT COUNT(*) INTO v_missing_count
    FROM (
        VALUES 
            ('Task_columnId_idx'),
            ('Task_columnId_projectId_idx'),
            ('Task_columnId_order_idx'),
            ('Task_columnId_dueDate_idx')
    ) AS expected(name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
        JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'Task'
          AND c.relname = expected.name
    );

    IF v_missing_count > 0 THEN
        RAISE EXCEPTION 'Stage 1B Post-verification abort: % expected replacement index(es) are missing from public."Task"', v_missing_count;
    END IF;

    -- Verify validity, readiness, and exact column structure for each index
    FOR r IN
        SELECT 
            c.relname::text AS index_name,
            i.indisvalid AS is_valid,
            i.indisready AS is_ready,
            pg_get_indexdef(c.oid)::text AS index_def
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
        JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' 
          AND t.relname = 'Task'
          AND c.relname IN (
            'Task_columnId_idx',
            'Task_columnId_projectId_idx',
            'Task_columnId_order_idx',
            'Task_columnId_dueDate_idx'
          )
    LOOP
        IF NOT r.is_valid THEN
            RAISE EXCEPTION 'Stage 1B Post-verification abort: Index % on public."Task" is INVALID (indisvalid = false)', r.index_name;
        END IF;
        IF NOT r.is_ready THEN
            RAISE EXCEPTION 'Stage 1B Post-verification abort: Index % on public."Task" is NOT READY (indisready = false)', r.index_name;
        END IF;

        IF r.index_name = 'Task_columnId_idx' AND r.index_def NOT LIKE '%("columnId")%' THEN
            RAISE EXCEPTION 'Stage 1B Post-verification abort: Index Task_columnId_idx definition mismatch: %', r.index_def;
        ELSIF r.index_name = 'Task_columnId_projectId_idx' AND r.index_def NOT LIKE '%("columnId", "projectId")%' THEN
            RAISE EXCEPTION 'Stage 1B Post-verification abort: Index Task_columnId_projectId_idx definition mismatch: %', r.index_def;
        ELSIF r.index_name = 'Task_columnId_order_idx' AND r.index_def NOT LIKE '%("columnId", "order")%' THEN
            RAISE EXCEPTION 'Stage 1B Post-verification abort: Index Task_columnId_order_idx definition mismatch: %', r.index_def;
        ELSIF r.index_name = 'Task_columnId_dueDate_idx' AND r.index_def NOT LIKE '%("columnId", "dueDate")%' THEN
            RAISE EXCEPTION 'Stage 1B Post-verification abort: Index Task_columnId_dueDate_idx definition mismatch: %', r.index_def;
        END IF;
    END LOOP;
END $$;
