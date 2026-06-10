from sqlalchemy import text

from ..database import create_database_if_not_exists, engine


def create_enum_types() -> None:
    """Create PostgreSQL ENUM types in wms schema if they do not exist."""
    enum_types = [
        ("warehouse_type", ["Fabric", "RMG", "Accessory"]),
        ("logical_location_type", ["supplier", "internal"]),
    ]

    with engine.connect() as conn:
        for enum_name, enum_values in enum_types:
            result = conn.execute(
                text(
                    "SELECT 1 FROM pg_type WHERE typname = :enum_name "
                    "AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'wms')"
                ),
                {"enum_name": enum_name},
            )

            if not result.fetchone():
                values_str = "', '".join(enum_values)
                conn.execute(text(f"CREATE TYPE wms.{enum_name} AS ENUM ('{values_str}')"))

        conn.commit()


_FULFILLMENT_UNIT_SYNC_FN = """
CREATE OR REPLACE FUNCTION core.fn_sync_fulfillment_units()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
                   WHEN f.internal_receipt_id IS NOT NULL THEN (
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
                      WHERE fri.internal_receipt_id = f.internal_receipt_id
                   )
                   ELSE NULL
               END
         WHERE f.material_request_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$
"""

_FULFILLMENT_UNIT_SYNC_TRIGGER = """
CREATE TRIGGER trg_mr_scale_change
    AFTER UPDATE OF measurement_scale ON core.job_order_material_requests
    FOR EACH ROW EXECUTE FUNCTION core.fn_sync_fulfillment_units()
"""


def apply_schema_migrations() -> None:
    """Idempotent DDL additions that create_all cannot handle on existing tables."""
    with engine.connect() as conn:
        # Column additions
        conn.execute(text(
            "ALTER TABLE core.material_request_fulfillments "
            "ADD COLUMN IF NOT EXISTS measurement_scale VARCHAR(50)"
        ))
        conn.execute(text(
            "ALTER TABLE wms.supplier_receipts "
            "ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        conn.execute(text(
            "ALTER TABLE wms.supplier_receipts "
            "ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES core.users(id)"
        ))
        conn.execute(text(
            "ALTER TABLE wms.external_receipts "
            "ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        conn.execute(text(
            "ALTER TABLE wms.external_receipts "
            "ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES core.users(id)"
        ))
        conn.execute(text(
            "ALTER TABLE wms.expected_delivery_items "
            "ADD COLUMN IF NOT EXISTS fabric_code_planned BOOLEAN DEFAULT TRUE"
        ))

        # Trigger function — always replaced so logic changes take effect on restart
        conn.execute(text(_FULFILLMENT_UNIT_SYNC_FN))

        # Trigger — drop-and-recreate is idempotent and picks up any column filter changes
        conn.execute(text(
            "DROP TRIGGER IF EXISTS trg_mr_scale_change ON core.job_order_material_requests"
        ))
        conn.execute(text(_FULFILLMENT_UNIT_SYNC_TRIGGER))

        conn.commit()


def initialize_application() -> None:
    create_database_if_not_exists()
    create_enum_types()
    apply_schema_migrations()
