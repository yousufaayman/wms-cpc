-- Add location_type to wms.logical_locations (Client / Dyehouse / Internal).
-- Receipt type on new receipts is derived from this column via the target logical location.
-- PostgreSQL 11+.

DO $$ BEGIN
  CREATE TYPE wms.logical_location_type AS ENUM ('client', 'dyehouse', 'internal');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE wms.logical_locations
  ADD COLUMN IF NOT EXISTS location_type wms.logical_location_type NOT NULL DEFAULT 'internal';

COMMENT ON COLUMN wms.logical_locations.location_type IS
  'client → shipping receipt; dyehouse → dyehouse; internal → internal';
