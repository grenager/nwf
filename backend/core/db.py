"""Async SQLAlchemy engine and session management."""

from __future__ import annotations

from collections.abc import AsyncIterator
from urllib.parse import urlsplit

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from core.config import get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None

#: Supabase's transaction-mode pooler port. Session mode lives on 5432; both
#: are served by the same pooler hostname in the connection URL.
TRANSACTION_POOLER_PORT: int = 6543


def transaction_pool_connect_args(database_url: str) -> dict[str, int]:
    """Driver settings the URL's pooler mode requires.

    Behind Supabase's transaction-mode pooler (port 6543) successive
    statements on one client connection can land on different Postgres
    backends, so asyncpg's per-connection prepared-statement cache breaks
    ("prepared statement ... does not exist"). Turning the cache off makes
    every statement self-contained; through session mode it would only cost
    a little parse time, but it stays on there so local dev keeps the fast
    path.
    """
    try:
        port: int | None = urlsplit(database_url).port
    except ValueError:
        # No port at all (e.g. a socket URL) - assume session mode.
        return {}
    if port == TRANSACTION_POOLER_PORT:
        return {"statement_cache_size": 0}
    return {}


def get_engine() -> AsyncEngine:
    """Return the process-wide async engine, creating it on first use."""
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            echo=settings.db_echo,
            connect_args=transaction_pool_connect_args(settings.database_url),
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_timeout=settings.db_pool_timeout,
            pool_pre_ping=True,
        )
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Return the process-wide session factory."""
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
            autoflush=False,
        )
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: yield a session and commit/rollback around the request."""
    factory = get_sessionmaker()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    """Dispose the engine (call on shutdown)."""
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None
