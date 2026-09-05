-- Material request fulfillments: allow linking supplier and external receipts
-- in addition to internal receipts, so a material request can be fulfilled by
-- any receipt type. At most one receipt reference may be set per fulfillment;
-- rows with no receipt reference are manual entries.

BEGIN;

ALTER TABLE core.material_request_fulfillments
    ADD COLUMN IF NOT EXISTS supplier_receipt_id integer
        REFERENCES wms.supplier_receipts(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS external_receipt_id integer
        REFERENCES wms.external_receipts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_core_material_request_fulfillments_supplier_receipt_id
    ON core.material_request_fulfillments (supplier_receipt_id);
CREATE INDEX IF NOT EXISTS ix_core_material_request_fulfillments_external_receipt_id
    ON core.material_request_fulfillments (external_receipt_id);

ALTER TABLE core.material_request_fulfillments
    DROP CONSTRAINT IF EXISTS ck_mrf_at_most_one_receipt;
ALTER TABLE core.material_request_fulfillments
    ADD CONSTRAINT ck_mrf_at_most_one_receipt CHECK (
        (CASE WHEN internal_receipt_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN supplier_receipt_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN external_receipt_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
    );

-- Update the unit-sync trigger to recompute receipt-based fulfillments from
-- whichever receipt type the row is linked to (previously internal only).
CREATE OR REPLACE FUNCTION core.fn_sync_fulfillment_units()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    _old_kg BOOLEAN;
    _new_kg BOOLEAN;
BEGIN
    -- Fast-exit: nothing changed
    IF OLD.measurement_scale IS NOT DISTINCT FROM NEW.measurement_scale THEN
        RETURN NEW;
    END IF;

    _old_kg := upper(OLD.measurement_scale) = ANY(ARRAY['KG','KGS','KILOGRAM','KILOGRAMS']);
    _new_kg := upper(NEW.measurement_scale) = ANY(ARRAY['KG','KGS','KILOGRAM','KILOGRAMS']);

    IF _old_kg = _new_kg THEN
        -- Same unit family (e.g. kg → kgs): sync the label only, quantities stay valid
        UPDATE core.material_request_fulfillments
           SET measurement_scale = NEW.measurement_scale
         WHERE material_request_id = NEW.id;
    ELSE
        -- Unit family flipped (weight ↔ length): recompute receipt-based rows from
        -- actual rolls; null out manual entries (no roll data to derive from).
        UPDATE core.material_request_fulfillments f
           SET measurement_scale = NEW.measurement_scale,
               quantity_issued   = CASE
                   WHEN f.internal_receipt_id IS NOT NULL
                     OR f.supplier_receipt_id IS NOT NULL
                     OR f.external_receipt_id IS NOT NULL THEN (
                       SELECT COALESCE(SUM(
                           CASE
                               WHEN fri.dyed_roll_id   IS NOT NULL THEN
                                   CASE WHEN _new_kg THEN COALESCE(d.weight, 0)
                                                     ELSE COALESCE(d.length, 0) END
                               WHEN fri.undyed_roll_id IS NOT NULL THEN
                                   CASE WHEN _new_kg THEN COALESCE(u.weight, 0)
                                                     ELSE COALESCE(u.length, 0) END
                               ELSE 0
                           END
                       ), 0)
                       FROM wms.fabric_receipt_items fri
                       LEFT JOIN wms.dyed_fabric_rolls  d ON d.id = fri.dyed_roll_id
                       LEFT JOIN wms.undyed_fabric_rolls u ON u.id = fri.undyed_roll_id
                      WHERE (f.internal_receipt_id IS NOT NULL AND fri.internal_receipt_id = f.internal_receipt_id)
                         OR (f.supplier_receipt_id IS NOT NULL AND fri.supplier_receipt_id = f.supplier_receipt_id)
                         OR (f.external_receipt_id IS NOT NULL AND fri.external_receipt_id = f.external_receipt_id)
                   )
                   ELSE NULL
               END
         WHERE f.material_request_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$function$;

COMMIT;
