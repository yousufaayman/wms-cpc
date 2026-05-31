# Live `core` schema notes (read-only)

Introspection was run against the configured PostgreSQL database (see `backend/.env` → `POSTGRES_DATABASE`). **This application does not migrate or alter `core` objects.**

## Why `column "id" referenced in foreign key constraint does not exist` occurred

`wms.shades` / `wms.fabric_rolls` DDL referenced `REFERENCES core.clients(id)` and similar. In **CPC_INTEGRATED_SYSTEM**, primary keys are named **`client_id`**, **`color_id`**, **`material_id`**, etc.—there is no column named `id` on those tables.

## Primary keys (actual)

| Table | Primary key column |
|-------|-------------------|
| `core.clients` | `client_id` |
| `core.colors` | `color_id` |
| `core.materials` | `material_id` |
| `core.models` | `model_id` |
| `core.sizes` | `size_id` |
| `core.job_orders` | `job_order_id` |
| `core.job_order_items` | `item_id` |

## Re-run introspection locally

```bash
set PYTHONPATH=%CD%
python scripts/inspect_core_schema.py
```

Update [`docs/database-schema.md`](database-schema.md) when the shared `core` schema changes outside this repo.
