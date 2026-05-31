-- Migration: Replace generic receipts/receipt_items with typed receipt tables
-- Run this ONCE against the database BEFORE restarting the application.
-- The application's create_all will then create the new tables automatically.

-- 1. Drop old receipt_items first (FK child of receipts)
DROP TABLE IF EXISTS wms.receipt_items CASCADE;

-- 2. Drop old receipts table
DROP TABLE IF EXISTS wms.receipts CASCADE;

-- 3. Drop old single_transactions table (schema has changed incompatibly)
DROP TABLE IF EXISTS wms.single_transactions CASCADE;

-- 4. Drop old ENUM types that no longer exist in the models
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'receipt_type' AND n.nspname = 'wms'
    ) THEN
        DROP TYPE wms.receipt_type CASCADE;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'receipt_status' AND n.nspname = 'wms'
    ) THEN
        DROP TYPE wms.receipt_status CASCADE;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'transaction_type' AND n.nspname = 'wms'
    ) THEN
        DROP TYPE wms.transaction_type CASCADE;
    END IF;
END $$;

-- After running this script, restart the application.
-- SQLAlchemy create_all will create:
--   wms.vendor_receipts
--   wms.internal_receipts
--   wms.external_receipts
--   wms.single_transactions  (new schema)
