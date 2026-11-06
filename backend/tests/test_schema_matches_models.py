"""Every table and column declared in backend/models.py must exist in the real
schema. Catches a model change without its cpc-db migration (or a typo)."""
from sqlalchemy import inspect

from backend import models

# Known mismatches that already exist. Remove an entry once it's fixed.
KNOWN_DRIFT = {
    # The model says (type, warehouse_id, logical_location_id, item_type, item_id,
    # remarks); the real table is (user_id, receiver_name, purpose, piece_count,
    # transaction_type, reference_id). Unused by the frontend, 0 rows on dev.
    "wms.single_transactions",
}


def test_models_match_database(database):
    insp = inspect(database)
    missing = []
    for table in models.Base.metadata.sorted_tables:
        name = f"{table.schema}.{table.name}"
        if name in KNOWN_DRIFT:
            continue
        if not insp.has_table(table.name, schema=table.schema):
            missing.append(f"{name} (whole table)")
            continue
        columns = {c["name"] for c in insp.get_columns(table.name, schema=table.schema)}
        missing += [f"{name}.{c.name}" for c in table.columns if c.name not in columns]
    assert not missing, "In models.py but not in the database: " + ", ".join(missing)
