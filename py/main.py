"""Entrypoint for the Python side.

Node spawns this via pythonHandler.js:

    python -m uvicorn main:app --host 127.0.0.1 --port 8000   (cwd = py/)

`main:app` is a module:object reference — uvicorn imports THIS module (which
is why `from config.db import ...` works: the cwd `py/` is on sys.path when
running with -m) and looks up `app`, so the module-level `app = FastAPI()`
below is the whole contract.

Importing `routes.analysis` (which imports config.db) at startup builds the
engine + Tables once — the Sequelize singleton pattern: model/dbConfig.js
does the same thing when main.js requires it.
"""
from fastapi import FastAPI
from sqlalchemy import text

from config.db import engine
from config.settings import DB_PATH
from routes.analysis import router as analysis_router

app = FastAPI(title="BBS Analysis")

# include_router ~ requiring a module of ipcMain handlers in main.js — it
# mounts every route in routes/analysis.py under its "/analysis" prefix.
app.include_router(analysis_router)


@app.get("/")
async def hello_world():
    return {"message": "Hello World"}


@app.get("/health")
def health():
    """Liveness + DB reachability in one ping.

    engine.connect() checks a connection out of the pool (creating one if
    needed), select(1) proves the read path works end-to-end.
    """
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok", "db": str(DB_PATH)}

if __name__ == "__main__":
    import ml.main
    ml.main.main()
