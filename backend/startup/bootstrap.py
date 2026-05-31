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


def initialize_application() -> None:
    create_database_if_not_exists()
    create_enum_types()
