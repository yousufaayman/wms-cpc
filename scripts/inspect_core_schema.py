"""Read-only introspection of live PostgreSQL core schema. Run: python scripts/inspect_core_schema.py"""
from sqlalchemy import text
from backend.database import engine


def main() -> None:
    with engine.connect() as conn:
        print("=== core.tables ===")
        r = conn.execute(
            text(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'core' AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            )
        )
        for row in r:
            print(" ", row[0])

        print("\n=== core PRIMARY KEY columns ===")
        r = conn.execute(
            text(
                """
                SELECT tc.table_name, kcu.column_name, c.data_type
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                JOIN information_schema.columns c
                  ON c.table_schema = kcu.table_schema
                 AND c.table_name = kcu.table_name
                 AND c.column_name = kcu.column_name
                WHERE tc.table_schema = 'core' AND tc.constraint_type = 'PRIMARY KEY'
                ORDER BY tc.table_name, kcu.ordinal_position
                """
            )
        )
        for row in r:
            print(f"  {row[0]}.{row[1]}  ({row[2]})")

        for tbl in ("clients", "colors", "materials"):
            print(f"\n=== core.{tbl} columns ===")
            r = conn.execute(
                text(
                    """
                    SELECT column_name, data_type, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = 'core' AND table_name = :t
                    ORDER BY ordinal_position
                    """
                ),
                {"t": tbl},
            )
            rows = list(r)
            if not rows:
                print("  (table missing)")
            else:
                for row in rows:
                    print(f"  {row[0]:30} {row[1]:20} null={row[2]}")

        print("\n=== wms.shades exists? ===")
        r = conn.execute(
            text(
                """
                SELECT EXISTS (
                  SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'wms' AND table_name = 'shades'
                )
                """
            )
        )
        print(" ", r.scalar())

        for tbl in ("job_orders", "job_order_items", "sizes", "models"):
            print(f"\n=== core.{tbl} columns ===")
            r = conn.execute(
                text(
                    """
                    SELECT column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema = 'core' AND table_name = :t
                    ORDER BY ordinal_position
                    """
                ),
                {"t": tbl},
            )
            for row in r:
                print(f"  {row[0]:30} {row[1]}")

        print("\n=== wms.boxes columns ===")
        r = conn.execute(
            text(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'wms' AND table_name = 'boxes'
                ORDER BY ordinal_position
                """
            )
        )
        for row in r:
            print(f"  {row[0]:30} {row[1]}")

        print("\n=== wms.box_contents columns ===")
        r = conn.execute(
            text(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'wms' AND table_name = 'box_contents'
                ORDER BY ordinal_position
                """
            )
        )
        for row in r:
            print(f"  {row[0]:30} {row[1]}")


if __name__ == "__main__":
    main()
