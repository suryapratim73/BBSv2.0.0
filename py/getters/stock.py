"""Stock getters — including the dynamic bill-table aggregation.

get_top_products is the "heavy lifting" showpiece: it can't be one SQL query
because item rows live in ~5,000 per-bill tables, not one table. The two
phases are the pattern for most future ML/analysis work against this DB:
narrow with a cheap SQL query, then pull the needed detail from the dynamic
tables and aggregate in Python (or pandas, later).
"""
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.engine import Connection

from config.db import TABLES
from getters.base import reflect_table, to_number

stocks = TABLES["stocks"]
sales = TABLES["sales"]


def get_low_stock(conn: Connection, threshold: float) -> list[dict]:
    """Stock items at or below `threshold`, scarcest first.

    Straight Core select with a where + order_by — findAll({ where }) sorted.
    """
    stmt = (
        select(
            stocks.c.id,
            stocks.c.name,
            stocks.c.quantity,
            stocks.c.unit,
        )
        .where(stocks.c.quantity <= threshold)
        .order_by(stocks.c.quantity)
    )
    return [dict(row) for row in conn.execute(stmt).mappings()]


def get_top_products(conn: Connection, start: str, end: str, limit: int) -> list[dict]:
    """Top products by revenue in the range, aggregated across bill tables.

    Phase 1 (cheap): the `sales` row knows the NAME of the bill table holding
    its items (`billItemTable` = "{customerId}_{billNo}_{billDate}").
    Phase 2 (expensive): reflect each of those tables (cached in
    getters/base.py after first use) and sum quantity * rate per product.

    Cost: one reflection + one SELECT per bill table in the range — seconds
    on a few thousand tables. That's the price of the JS side's
    table-per-bill design; for ML work you'd cache the aggregated result.
    """
    names = conn.execute(
        select(sales.c.billItemTable).where(
            sales.c.billDate >= f"{start} 00:00:00" if len(start) == 10 else start,
            sales.c.billDate <= f"{end} 23:59:59" if len(end) == 10 else end,
        )
    ).scalars()

    # defaultdict(int) ~ a Map that returns 0 for missing keys: the Python
    # idiom for `acc[key] = (acc[key] || 0) + value`.
    revenue = defaultdict(float)
    units = defaultdict(float)

    for table_name in names:
        bill_table = reflect_table(table_name)
        if bill_table is None:
            continue  # the sales row outlived its bill table — skip, don't crash

        item_rows = conn.execute(
            select(bill_table).where(bill_table.c.itemReturned == 0)
        ).mappings()
        for item in item_rows:
            name = item["name"]
            qty = to_number(item["quantity"])
            revenue[name] += qty * to_number(item["rate"])
            units[name] += qty

    # Order in Python: cross-table aggregation means there is no single SQL
    # ORDER BY to lean on.
    ranked = sorted(revenue, key=revenue.get, reverse=True)[:limit]
    return [
        {
            "name": name,
            "revenue": round(revenue[name], 2),
            "units": round(units[name], 3),
        }
        for name in ranked
    ]
