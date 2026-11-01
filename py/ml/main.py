from getters.sales import get_sales
from config.db import engine
# import numpy as np


def main():
    """Standalone dev harness — runs get_sales against the live bbs.db.

    `with engine.connect() as conn:` IS the checkout/return scope: the
    connection is open for exactly this block, no generator needed. (The old
    generator pattern closed the connection before use — see getters/base.py
    for the full getter contract.)

    claude --resume 840b5d41-8922-45a9-8dcd-7d276675518b
    """
    with engine.connect() as conn:
        _sales = get_sales(conn, "2025-04-01", "2026-03-31")
        print(f"{len(_sales)} rows; first 3:")
        print(_sales[:3])