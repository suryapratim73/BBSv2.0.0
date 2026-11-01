"""Analysis endpoints.

=== FastAPI in 60 seconds (for a Sequelize/IPC dev) ===

  * APIRouter         ~ a module of ipcMain.handle registrations. You build a
                      router here and `app.include_router(...)` it in main.py
                      — same idea as `require("./routes/analysis")` in main.js.
  * @router.get(path) ~ ipcMain.handle("channel", handler), with URL path +
                      query params instead of an IPC channel + payload.
  * pydantic BaseModel ~ a TypeScript response interface, except it ALSO
                      validates and serializes at runtime. `response_model=`
                      tells FastAPI to shape the dicts the getters return.
  * Depends(get_conn)  ~ Express middleware: FastAPI calls get_conn() before
                      the handler, injects what it yields, and runs the code
                      after `yield` when the request finishes.
  * sync `def` (NOT `async def`) ~ FastAPI runs the handler in its threadpool
                      (Node's worker-pool equivalent), so our sync SQLAlchemy
                      calls never block the event loop. The simpler contract
                      for a first SQLAlchemy project.
  * @cached("endpoint") ~ a read-through cache decorator (config/cache.py):
                      stores each response as JSON in the Python-side
                      db/agent.db, keyed by endpoint + query params, serves
                      hits for DEFAULT_TTL seconds. Sits below @router.get.

Query params are plain `str` here: since billDate compares lexicographically,
any string is "safe" to filter with. `date`-typed params + 422 validation are
polish for later.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from config.cache import cached
from config.db import engine
from getters import overview as overview_getters
from getters import sales as sales_getters
from getters import stock as stock_getters


def get_conn():
    """Per-request Connection dependency.

    `with engine.connect()` checks a connection out of the pool and
    guarantees it returns at the end of the request (even on error) — the
    equivalent of Express middleware's next()/finally. Read-only is enforced
    at the connection level (config/db.py), so handlers can't write even by
    accident.
    """
    with engine.connect() as conn:
        yield conn


router = APIRouter(prefix="/analysis")


# ---------------------------------------------------------------- models

class TableCount(BaseModel):
    table: str
    rows: int


class Overview(BaseModel):
    db_path: str
    db_size_bytes: int
    static_tables: list[TableCount]
    ledger_tables: int
    bill_item_tables: int


class SalesSummary(BaseModel):
    # Money columns are `float`, not `int`: billAmt is declared INTEGER but
    # SQLite is dynamically typed, so real rows store fractional amounts and
    # SUM() returns floats. pydantic refused to truncate them — correctly.
    bills: int | None
    revenue: float | None
    tax: float | None
    avg_bill: float | None


class DailyPoint(BaseModel):
    date: str
    revenue: float | None
    bills: int


class TopCustomer(BaseModel):
    customer_id: str
    name: str | None
    revenue: float | None
    bills: int


class LowStockItem(BaseModel):
    id: str
    name: str | None
    quantity: float | None
    unit: str | None


class TopProduct(BaseModel):
    name: str | None
    revenue: float
    units: float


# ---------------------------------------------------------------- endpoints

@router.get("/overview", response_model=Overview)
@cached("overview")
def overview(conn: Connection = Depends(get_conn)):
    return overview_getters.get_overview(conn)


@router.get("/sales/summary", response_model=SalesSummary)
@cached("sales/summary")
def sales_summary(
    start: str = "1970-01-01",
    end: str = "2999-12-31",
    conn: Connection = Depends(get_conn),
):
    return sales_getters.get_sales_summary(conn, start, end)


@router.get("/sales/daily", response_model=list[DailyPoint])
@cached("sales/daily")
def sales_daily(
    start: str = "1970-01-01",
    end: str = "2999-12-31",
    conn: Connection = Depends(get_conn),
):
    return sales_getters.get_sales_daily(conn, start, end)


@router.get("/sales/top-customers", response_model=list[TopCustomer])
@cached("sales/top-customers")
def top_customers(
    start: str = "1970-01-01",
    end: str = "2999-12-31",
    limit: int = Query(10, ge=1, le=500),
    conn: Connection = Depends(get_conn),
):
    return sales_getters.get_top_customers(conn, start, end, limit)


@router.get("/stock/low-stock", response_model=list[LowStockItem])
@cached("stock/low-stock")
def low_stock(
    threshold: float = 0,
    conn: Connection = Depends(get_conn),
):
    return stock_getters.get_low_stock(conn, threshold)


@router.get("/products/top", response_model=list[TopProduct])
@cached("products/top")
def top_products(
    start: str = "1970-01-01",
    end: str = "2999-12-31",
    limit: int = Query(10, ge=1, le=100),
    conn: Connection = Depends(get_conn),
):
    return stock_getters.get_top_products(conn, start, end, limit)
