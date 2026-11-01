"""Overview getters: what's IN the database (census + sizes)."""
from sqlalchemy import func, select, text
from sqlalchemy.engine import Connection

from config.db import TABLES
from config.settings import DB_PATH


def get_overview(conn: Connection) -> dict:
    """Counts for every static table + a census of the dynamic tables.

    Static tables are queried through their Core Table objects (typed,
    composable). The dynamic census uses raw SQL via `text()` — SQLAlchemy's
    escape hatch, the equivalent of sequelize.query("SELECT ..."). It's the
    right tool here because the dynamic tables have no schema.json entry; we
    classify them by name convention instead:

      * "{uuid}Ledger"        -> per-supplier/customer ledger
      * "{uuid}_{billNo}_{date}" -> per-bill item table (see getters/base.py
                                    reflect_table for how those get read)
    """
    # select(func.count()).select_from(table) is the Core spelling of
    # Model.count(); .scalar() pulls the single value out of the result.
    static = [
        {"table": name, "rows": conn.execute(select(func.count()).select_from(table)).scalar()}
        for name, table in TABLES.items()
    ]

    rows = conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    )
    all_names = [row[0] for row in rows]

    ledger_tables = sum(1 for name in all_names if name.endswith("Ledger"))
    # Everything that isn't static and isn't a ledger is a bill-item table.
    bill_item_tables = len(all_names) - len(TABLES) - ledger_tables

    return {
        "db_path": str(DB_PATH),
        "db_size_bytes": DB_PATH.stat().st_size,
        "static_tables": static,
        "ledger_tables": ledger_tables,
        "bill_item_tables": bill_item_tables,
    }
