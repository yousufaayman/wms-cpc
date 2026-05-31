-- Run this if GET /api/v1/receipts fails with:
--   column receipts.source_warehouse_id does not exist
--
-- Adds split FK columns (warehouse OR logical per side). Does not touch core schema.
-- After backfilling from legacy columns, you may DROP source_location_id / target_location_id.

ALTER TABLE wms.receipts
  ADD COLUMN IF NOT EXISTS source_warehouse_id INTEGER REFERENCES wms.warehouses(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_logical_location_id INTEGER REFERENCES wms.logical_locations(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_warehouse_id INTEGER REFERENCES wms.warehouses(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_logical_location_id INTEGER REFERENCES wms.logical_locations(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE wms.receipts DROP CONSTRAINT IF EXISTS ck_receipts_source_one_location_type;
ALTER TABLE wms.receipts DROP CONSTRAINT IF EXISTS ck_receipts_target_one_location_type;

ALTER TABLE wms.receipts
  ADD CONSTRAINT ck_receipts_source_one_location_type
    CHECK (NOT (source_warehouse_id IS NOT NULL AND source_logical_location_id IS NOT NULL)),
  ADD CONSTRAINT ck_receipts_target_one_location_type
    CHECK (NOT (target_warehouse_id IS NOT NULL AND target_logical_location_id IS NOT NULL));

-- Optional: copy legacy data if columns still exist (adjust logic to your rules):
-- UPDATE wms.receipts SET source_warehouse_id = source_location_id WHERE source_location_id IS NOT NULL;
-- UPDATE wms.receipts SET target_warehouse_id = target_location_id WHERE target_location_id IS NOT NULL;
-- Then: ALTER TABLE wms.receipts DROP COLUMN IF EXISTS source_location_id, DROP COLUMN IF EXISTS target_location_id;
