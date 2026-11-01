"""Sales getters.

Date filtering lesson: `billDate` is TEXT holding Sequelize's fixed DATETIME
format ("2023-09-25 00:00:00.000 +00:00"). Because the format never varies,
string comparison IS date comparison — so WHERE clauses compare strings and
never parse datetimes. `start`/`end` arrive as "YYYY-MM-DD"; we pad them to
the same format so the comparison stays lexicographic.
"""
from sqlalchemy import func, select
from sqlalchemy.engine import Connection

from config.db import TABLES

sales = TABLES["sales"]  # the Core Table — `sales.c.billAmt` is a Column object


def _pad(date_str: str, tail: str) -> str:
    """"2023-09-25" -> "2023-09-25 00:00:00" / "2023-09-25 23:59:59"."""
    return f"{date_str} {tail}" if len(date_str) == 10 else date_str


def get_sales_summary(conn: Connection, start: str, end: str) -> dict:
    """Totals for the range: bill count, revenue, tax, average bill.

    select(...) is the findAll({ where, attributes }) equivalent: you pick
    columns (func.count/sum/avg are SQL aggregates), filter with .where(),
    then conn.execute(). `.mappings()` makes rows behave like dicts.
    """
    stmt = (
        select(
            func.count().label("bills"),
            func.sum(sales.c.billAmt).label("revenue"),
            func.sum(sales.c.tax).label("tax"),
            func.avg(sales.c.billAmt).label("avg_bill"),
        )
        .where(
            sales.c.billDate >= _pad(start, "00:00:00"),
            sales.c.billDate <= _pad(end, "23:59:59"),
        )
    )
    row = conn.execute(stmt).mappings().one()
    return dict(row)


def get_sales_daily(conn: Connection, start: str, end: str) -> list[dict]:
    """One row per calendar day: revenue + bill count.

    group_by(func.substr(billDate, 1, 10)) slices the date prefix directly in
    SQL — robust against the "+00:00" timezone suffix and any value that
    isn't exactly our padded format.
    """
    stmt = (
        select(
            func.substr(sales.c.billDate, 1, 10).label("date"),
            func.sum(sales.c.billAmt).label("revenue"),
            func.count().label("bills"),
        )
        .where(
            sales.c.billDate >= _pad(start, "00:00:00"),
            sales.c.billDate <= _pad(end, "23:59:59"),
        )
        .group_by(func.substr(sales.c.billDate, 1, 10))
        .order_by(func.substr(sales.c.billDate, 1, 10))
    )
    return [dict(row) for row in conn.execute(stmt).mappings()]


def get_top_customers(conn: Connection, start: str, end: str, limit: int) -> list[dict]:
    """Customers by revenue, descending — GROUP BY + ORDER BY + LIMIT.

    Grouping by (customerId, name) is the SQL spelling of a JS reduce() over
    a findAll() result, except the aggregation happens inside SQLite.
    """
    stmt = (
        select(
            sales.c.customerId.label("customer_id"),
            sales.c.name.label("name"),
            func.sum(sales.c.billAmt).label("revenue"),
            func.count().label("bills"),
        )
        .where(
            sales.c.billDate >= _pad(start, "00:00:00"),
            sales.c.billDate <= _pad(end, "23:59:59"),
        )
        .group_by(sales.c.customerId, sales.c.name)
        .order_by(func.sum(sales.c.billAmt).desc())
        .limit(limit)
    )
    return [dict(row) for row in conn.execute(stmt).mappings()]

def get_sales(conn: Connection, start: str, end:str):
    query = select(sales).where(
        sales.c.billDate >= _pad(start, "00:00:00"),
        sales.c.billDate <= _pad(end, "23:59:59"),
    )
    return [dict(row) for row in conn.execute(query).mappings()]