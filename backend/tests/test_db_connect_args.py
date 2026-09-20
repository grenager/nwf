"""Engine wiring for Supabase's pooler modes.

Session mode (port 5432) pins each client to one backend and caps the whole
project at a handful of connections; transaction mode (port 6543) multiplexes,
but consecutive statements can land on different backends, so asyncpg's
prepared-statement cache must be off. These tests pin which URL gets which
driver settings, because getting it wrong looks like random production 500s
(`prepared statement ... does not exist`, or EMAXCONNSESSION) - not a tidy
test failure.
"""

from __future__ import annotations

from core.db import transaction_pool_connect_args


def test_transaction_pool_port_disables_statement_cache() -> None:
    url = (
        "postgresql+asyncpg://postgres.xwv@aws-0-us-east-1.pooler"
        ".supabase.com:6543/postgres"
    )
    assert transaction_pool_connect_args(url) == {"statement_cache_size": 0}


def test_session_pool_port_keeps_default_args() -> None:
    url = (
        "postgresql+asyncpg://postgres.xwv@aws-0-us-east-1.pooler"
        ".supabase.com:5432/postgres"
    )
    assert transaction_pool_connect_args(url) == {}


def test_local_dev_url_keeps_default_args() -> None:
    url = "postgresql+asyncpg://postgres:postgres@localhost:54322/postgres"
    assert transaction_pool_connect_args(url) == {}


def test_portless_url_keeps_default_args() -> None:
    assert transaction_pool_connect_args("postgresql+asyncpg:///postgres") == {}