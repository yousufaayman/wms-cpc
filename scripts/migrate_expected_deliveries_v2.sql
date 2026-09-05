-- ============================================================
-- Migration: Expected Deliveries v2
--   Task 1: drop lot_reference from wms.expected_delivery_items
--   Task 2: add client_id to wms.expected_delivery_items (undyed
--           lines must carry their client) + tightened CHECKs
--   Task 3: replace the free-text supplier column on
--           wms.expected_deliveries with a polymorphic reference
--           (client_supplier_id + supplier_type) and backfill it
--           by exact name match against core.clients /
--           wms.logical_locations
--   Task 4: add expected_delivery_item_id to both roll tables
--           for auto-fulfillment
--
-- Run once against an existing database. Fresh databases get the
-- final shape from SQLAlchemy create_all and do not need this.
-- ============================================================

BEGIN;

-- ── Task 1: remove LOT reference from delivery items ─────────
ALTER TABLE wms.expected_delivery_items
    DROP COLUMN IF EXISTS lot_reference;

-- ── Task 2: client on undyed delivery items ──────────────────
ALTER TABLE wms.expected_delivery_items
    ADD COLUMN IF NOT EXISTS client_id INTEGER
        REFERENCES core.clients (client_id)
        ON UPDATE CASCADE ON DELETE RESTRICT;

-- Dyed rows need no backfill (their fabric code already carries the client);
-- undyed rows have no recorded client and cannot be backfilled automatically.
-- The new constraint is added NOT VALID so legacy undyed rows without a
-- client survive, while all new/updated rows are checked.
ALTER TABLE wms.expected_delivery_items
    DROP CONSTRAINT IF EXISTS ck_expected_delivery_items_undyed_client;
ALTER TABLE wms.expected_delivery_items
    ADD CONSTRAINT ck_expected_delivery_items_undyed_client
        CHECK (material_id IS NULL OR client_id IS NOT NULL) NOT VALID;

-- List legacy undyed rows that still need a client assigned manually.
-- Once this returns zero rows, run:
--   ALTER TABLE wms.expected_delivery_items
--       VALIDATE CONSTRAINT ck_expected_delivery_items_undyed_client;
SELECT id, delivery_id, material_id
FROM wms.expected_delivery_items
WHERE material_id IS NOT NULL AND client_id IS NULL;

-- ── Task 3: polymorphic supplier reference on deliveries ─────
ALTER TABLE wms.expected_deliveries
    ADD COLUMN IF NOT EXISTS client_supplier_id INTEGER,
    ADD COLUMN IF NOT EXISTS supplier_type VARCHAR(20);

-- Backfill by exact (trimmed) name match. A supplier string matching BOTH a
-- client and a logical location is ambiguous and intentionally left NULL.
UPDATE wms.expected_deliveries d
SET client_supplier_id = c.client_id,
    supplier_type      = 'client'
FROM core.clients c
WHERE d.client_supplier_id IS NULL
  AND TRIM(d.supplier) = c.client_name
  AND NOT EXISTS (
      SELECT 1 FROM wms.logical_locations ll WHERE ll.name = TRIM(d.supplier)
  );

UPDATE wms.expected_deliveries d
SET client_supplier_id = ll.id,
    supplier_type      = 'logical_location'
FROM wms.logical_locations ll
WHERE d.client_supplier_id IS NULL
  AND TRIM(d.supplier) = ll.name
  AND NOT EXISTS (
      SELECT 1 FROM core.clients c WHERE c.client_name = TRIM(d.supplier)
  );

-- Rows whose supplier string did not resolve unambiguously — fix by hand
-- (set client_supplier_id + supplier_type), then drop the old column below.
SELECT id, supplier, status, created_at
FROM wms.expected_deliveries
WHERE client_supplier_id IS NULL;

ALTER TABLE wms.expected_deliveries
    DROP CONSTRAINT IF EXISTS ck_expected_deliveries_supplier_type;
ALTER TABLE wms.expected_deliveries
    ADD CONSTRAINT ck_expected_deliveries_supplier_type
        CHECK (supplier_type IS NULL OR supplier_type IN ('client', 'logical_location'));

ALTER TABLE wms.expected_deliveries
    DROP CONSTRAINT IF EXISTS ck_expected_deliveries_supplier_pair;
ALTER TABLE wms.expected_deliveries
    ADD CONSTRAINT ck_expected_deliveries_supplier_pair
        CHECK ((client_supplier_id IS NULL) = (supplier_type IS NULL));

-- The application no longer writes the old column; lift NOT NULL now so
-- inserts keep working, and drop it once the backfill above is verified:
ALTER TABLE wms.expected_deliveries
    ALTER COLUMN supplier DROP NOT NULL;
-- After verifying the SELECT above returns no rows (or the leftovers were
-- fixed manually), remove the legacy column:
--   ALTER TABLE wms.expected_deliveries DROP COLUMN supplier;

-- ── Task 4: roll → expected-delivery-item link ───────────────
ALTER TABLE wms.dyed_fabric_rolls
    ADD COLUMN IF NOT EXISTS expected_delivery_item_id INTEGER
        REFERENCES wms.expected_delivery_items (id)
        ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE wms.undyed_fabric_rolls
    ADD COLUMN IF NOT EXISTS expected_delivery_item_id INTEGER
        REFERENCES wms.expected_delivery_items (id)
        ON UPDATE CASCADE ON DELETE SET NULL;

COMMIT;
