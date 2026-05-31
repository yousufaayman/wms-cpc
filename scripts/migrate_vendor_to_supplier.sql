-- ============================================================
-- Migration: vendor → supplier
-- Run once against an existing database.
-- Safe to run on a fresh DB (all steps are idempotent where
-- possible, but some PostgreSQL constraints prevent full
-- idempotency — wrap in a transaction and verify first).
-- ============================================================

BEGIN;

-- ── 1. Rename table ──────────────────────────────────────────
ALTER TABLE wms.vendor_receipts RENAME TO supplier_receipts;

-- ── 2. Rename FK columns in receipt-item tables ──────────────
ALTER TABLE wms.fabric_receipt_items
    RENAME COLUMN vendor_receipt_id TO supplier_receipt_id;

ALTER TABLE wms.box_receipt_items
    RENAME COLUMN vendor_receipt_id TO supplier_receipt_id;

ALTER TABLE wms.accessory_receipt_items
    RENAME COLUMN vendor_receipt_id TO supplier_receipt_id;

-- ── 3. Update CHECK constraint names (optional cosmetic) ─────
-- PostgreSQL doesn't let you rename constraints directly;
-- drop and recreate if the name matters.
ALTER TABLE wms.fabric_receipt_items
    DROP CONSTRAINT IF EXISTS ck_fabric_receipt_items_one_receipt;
ALTER TABLE wms.fabric_receipt_items
    ADD CONSTRAINT ck_fabric_receipt_items_one_receipt CHECK (
        CASE WHEN supplier_receipt_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN internal_receipt_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN external_receipt_id IS NOT NULL THEN 1 ELSE 0 END = 1
    );

ALTER TABLE wms.box_receipt_items
    DROP CONSTRAINT IF EXISTS ck_box_receipt_items_one_receipt;
ALTER TABLE wms.box_receipt_items
    ADD CONSTRAINT ck_box_receipt_items_one_receipt CHECK (
        CASE WHEN supplier_receipt_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN internal_receipt_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN external_receipt_id IS NOT NULL THEN 1 ELSE 0 END = 1
    );

ALTER TABLE wms.accessory_receipt_items
    DROP CONSTRAINT IF EXISTS ck_accessory_receipt_items_one_receipt;
ALTER TABLE wms.accessory_receipt_items
    ADD CONSTRAINT ck_accessory_receipt_items_one_receipt CHECK (
        CASE WHEN supplier_receipt_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN internal_receipt_id IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN external_receipt_id IS NOT NULL THEN 1 ELSE 0 END = 1
    );

-- ── 4. Migrate logical_location_type enum ───────────────────
-- PostgreSQL cannot remove enum values; recreate the type.

-- 4a. Remove the column default (it holds a reference to the enum type,
--     which would block DROP TYPE even after the column is cast to text).
ALTER TABLE wms.logical_locations
    ALTER COLUMN location_type DROP DEFAULT;

-- 4b. Convert the column to plain text so the enum type has no dependents.
ALTER TABLE wms.logical_locations
    ALTER COLUMN location_type TYPE text;

-- 4c. Map old values → new values while the column is plain text.
UPDATE wms.logical_locations SET location_type = 'supplier' WHERE location_type = 'dyehouse';
UPDATE wms.logical_locations SET location_type = 'internal' WHERE location_type = 'client';

-- 4d. Rebuild the enum with only the two new values.
DROP TYPE wms.logical_location_type;
CREATE TYPE wms.logical_location_type AS ENUM ('supplier', 'internal');

-- 4e. Re-apply the enum type and restore the default.
ALTER TABLE wms.logical_locations
    ALTER COLUMN location_type TYPE wms.logical_location_type
    USING location_type::wms.logical_location_type;

ALTER TABLE wms.logical_locations
    ALTER COLUMN location_type SET DEFAULT 'internal'::wms.logical_location_type;

-- ── 5. Add supplier_type column to logical_locations ─────────
ALTER TABLE wms.logical_locations
    ADD COLUMN IF NOT EXISTS supplier_type VARCHAR(100);

-- ── 6. CREATE TABLE for fresh installs ───────────────────────
-- Run this block on a new database that never had vendor_receipts.
-- On existing databases steps 1-5 above already handle it.
CREATE TABLE IF NOT EXISTS wms.supplier_receipts (
    id                          SERIAL          PRIMARY KEY,
    source_warehouse_id         INTEGER         NOT NULL
        REFERENCES wms.warehouses(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    target_logical_location_id  INTEGER         NOT NULL
        REFERENCES wms.logical_locations(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    closed                      BOOLEAN         NOT NULL DEFAULT FALSE,
    status                      VARCHAR(20)     NOT NULL DEFAULT 'issued',
    issued_by                   INTEGER
        REFERENCES core.users(id),
    closed_by                   INTEGER
        REFERENCES core.users(id),
    issued_at                   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at                   TIMESTAMP,
    remarks                     TEXT
);

CREATE INDEX IF NOT EXISTS ix_supplier_receipts_id
    ON wms.supplier_receipts (id);

COMMIT;
