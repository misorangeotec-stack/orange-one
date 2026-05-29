"""Reusable Supabase access layer for WAT tools.

One place for every workflow/tool to talk to Supabase, instead of re-writing
connection code each time. Two access paths are provided:

  1. REST API (supabase-py)  -> get_client() / get_table()
     Best for quick reads/writes. Uses the service-role key by default
     (bypasses RLS — backend only, never ship to a browser).

  2. Direct SQL (psycopg2)   -> run_sql()
     Best for joins, aggregates, migrations, bulk work. Connects through the
     IPv4 session pooler (the direct db.<ref>.supabase.co host is IPv6-only
     and unreachable on IPv4-only networks).

Credentials come from `.env` via config.py — nothing is hard-coded here.

Usage (import):
    from supabase_client import get_client, get_table, run_sql, list_tables

    sb = get_client()                       # service-role REST client
    rows = get_table("tasks").select("*").limit(5).execute().data
    cols = run_sql("select count(*) from public.tasks")
    print(list_tables())

Usage (CLI — quick connection check):
    python tools/supabase_client.py            # ping + list public tables
    python tools/supabase_client.py --sql "select count(*) from public.tasks"
"""

from __future__ import annotations

import argparse
import sys
from functools import lru_cache
from typing import Any

from config import get_env

try:
    import psycopg2
    import psycopg2.extras
except ImportError as exc:  # pragma: no cover
    raise ImportError("psycopg2 is not installed. Run: pip install -r requirements.txt") from exc

try:
    from supabase import Client, create_client
except ImportError as exc:  # pragma: no cover
    raise ImportError("supabase is not installed. Run: pip install -r requirements.txt") from exc


# ---------------------------------------------------------------------------
# REST API (supabase-py)
# ---------------------------------------------------------------------------
@lru_cache(maxsize=2)
def get_client(*, service_role: bool = True) -> Client:
    """Return a cached Supabase REST client.

    service_role=True  -> full access, bypasses Row Level Security (backend).
    service_role=False -> anon key, subject to RLS (safe for public contexts).
    """
    url = get_env("SUPABASE_URL", required=True)
    key_name = "SUPABASE_SERVICE_ROLE_KEY" if service_role else "SUPABASE_ANON_KEY"
    key = get_env(key_name, required=True)
    return create_client(url, key)


def get_table(name: str, *, service_role: bool = True):
    """Shortcut to a table query builder: get_table('tasks').select('*').execute()."""
    return get_client(service_role=service_role).table(name)


# ---------------------------------------------------------------------------
# Direct SQL (psycopg2 via the IPv4 pooler)
# ---------------------------------------------------------------------------
def get_connection():
    """Open a new psycopg2 connection through the Supabase session pooler.

    Caller owns the connection — close it (or use `with get_connection() as conn`).
    """
    dsn = get_env("SUPABASE_DB_URL", required=True)
    return psycopg2.connect(dsn, connect_timeout=15)


def run_sql(query: str, params: tuple | None = None) -> list[dict[str, Any]]:
    """Run a SQL statement and return rows as a list of dicts.

    For SELECTs you get the rows back; for writes you get [] and the change is
    committed. Raises loudly on error so the agent can recover.
    """
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params)
            if cur.description:  # query returned rows
                rows = [dict(r) for r in cur.fetchall()]
            else:
                rows = []
            conn.commit()
            return rows
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def list_tables(schema: str = "public") -> list[str]:
    """Return the table names in a schema (defaults to your app tables)."""
    rows = run_sql(
        "select table_name from information_schema.tables "
        "where table_schema = %s order by table_name",
        (schema,),
    )
    return [r["table_name"] for r in rows]


# ---------------------------------------------------------------------------
# CLI — quick connection check / ad-hoc query
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Supabase connection helper / quick check.")
    parser.add_argument("--sql", help="Run a SQL query and print the rows.")
    parser.add_argument("--schema", default="public", help="Schema for table listing (default: public).")
    args = parser.parse_args(argv)

    if args.sql:
        for row in run_sql(args.sql):
            print(row)
        return 0

    tables = list_tables(args.schema)
    print(f"Connected to Supabase. {len(tables)} table(s) in '{args.schema}':")
    for t in tables:
        print(f"  - {t}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
