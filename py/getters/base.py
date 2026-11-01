"""Shared helpers for the getters (the query layer).

Getter convention: `def get_x(conn: Connection, ...) -> ...`. The caller
passes the Connection in — like threading a Sequelize transaction through
helpers — and the FastAPI dependency (routes/analysis.py get_conn) owns its
lifecycle. Getters never touch FastAPI, so they stay testable and reusable
from plain scripts (ML notebooks, cron jobs, ...).
"""
import json

from sqlalchemy import Date, DateTime, Integer, MetaData, Numeric, String, Table, inspect

from config.db import TolerantFloat, TolerantInt, engine

# --------------------------------------------------------------------------
# Dynamic table reflection
# --------------------------------------------------------------------------

# Reflection cache. Reflecting a table means asking SQLite (PRAGMA table_info)
# for its columns and building a Table object on the fly — the equivalent of
# queryInterface.describeTable + sequelize.define("name", dynamicSchema).
# Static tables come from model/schema.json, but ledgers ({uuid}Ledger) and
# bill-item tables ({uuid}_{billNo}_{date}) are created by the JS side at
# runtime (common.js getLedgerModel/getBillModel), so they can only be
# discovered from the DB itself. There are ~5,700 of them — cache.
_cache: dict[str, Table] = {}


def reflect_table(name: str) -> Table | None:
    """Build (and cache) a Core Table for a dynamically-named table.

    Returns None when the table doesn't exist — sales rows can reference bill
    tables that were deleted; callers must tolerate that.

    Reflected columns get the same tolerant treatment as static ones: SQLite's
    dynamic typing means old rows can store strings inside "numeric" columns
    (e.g. a legacy bill table with tax="18" as TEXT), and SQLAlchemy's
    reflection maps those columns to strict Numeric/Integer types that crash
    on the first bad row. Swapping in TolerantFloat/TolerantInt (and String
    for dates) makes reflection behave like our schema.json types.
    """
    if name in _cache:
        return _cache[name]
    if not inspect(engine).has_table(name):
        return None
    # autoload_with tells SQLAlchemy "ask the DB for the columns" — no schema
    # file involved. Each Table gets its own lightweight MetaData.
    table = Table(name, MetaData(), autoload_with=engine)
    for col in table.columns:
        # Numeric covers NUMERIC/DECIMAL/FLOAT/REAL; Integer covers
        # INTEGER/TINYINT/...; Date/DateTime cover reflected DATETIME columns
        # whose strict parser would choke on "+00:00" timezone suffixes.
        if isinstance(col.type, Numeric):
            col.type = TolerantFloat()
        elif isinstance(col.type, Integer):
            col.type = TolerantInt()
        elif isinstance(col.type, (Date, DateTime)):
            col.type = String()
    _cache[name] = table
    return table


# --------------------------------------------------------------------------
# Value helpers
# --------------------------------------------------------------------------

def json_loads(value):
    """json.loads with a raw-string fallback — JSON columns aren't always JSON."""
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value


def seq_date(value) -> str | None:
    """Sequelize DATETIME ("2023-09-25 00:00:00.000 +00:00") -> "2023-09-25".

    For response payloads, not for WHERE clauses — filters compare the full
    string directly, since the fixed format sorts chronologically.
    """
    return str(value)[:10] if value else None


def to_number(value, default=0.0) -> float:
    """float() with a default for the rare garbage string in a numeric column.

    The tolerant column types already return numbers for anything numeric;
    this is the last line of defense for aggregation code that must multiply.
    """
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
