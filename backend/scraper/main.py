"""Long-lived scraper worker.

Runs an APScheduler interval job that selects the sources with the oldest
``last_scraped_at`` and ingests their RSS feeds concurrently.
"""

from __future__ import annotations

import asyncio
import signal

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from core.config import get_settings
from core.db import dispose_engine, get_sessionmaker
from core.logging import get_logger
from core.models import Source
from scraper.ingest import ingest_source

log = get_logger("scraper")


async def run_cycle() -> None:
    """Ingest the batch of stalest sources with bounded concurrency."""
    settings = get_settings()
    factory = get_sessionmaker()

    async with factory() as session:
        result = await session.scalars(
            select(Source)
            .where(Source.rss_url.is_not(None))
            .order_by(Source.last_scraped_at.asc().nulls_first())
            .limit(settings.scrape_batch_size)
        )
        sources = list(result.all())

    if not sources:
        log.info("scraper.cycle_empty")
        return

    semaphore = asyncio.Semaphore(settings.scrape_concurrency)

    async def _run_one(source: Source) -> None:
        async with semaphore, factory() as session:
            try:
                # Re-attach into this session.
                merged = await session.merge(source)
                await ingest_source(session, merged)
                await session.commit()
            except Exception as exc:  # log and continue
                await session.rollback()
                log.error(
                    "scraper.source_failed",
                    source_id=str(source.id),
                    name=source.name,
                    error=str(exc),
                )

    log.info("scraper.cycle_start", sources=len(sources))
    await asyncio.gather(*(_run_one(s) for s in sources))
    log.info("scraper.cycle_done", sources=len(sources))


async def _main() -> None:
    settings = get_settings()
    log.info(
        "scraper.boot",
        interval_seconds=settings.scrape_interval_seconds,
        batch_size=settings.scrape_batch_size,
        concurrency=settings.scrape_concurrency,
    )

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        run_cycle,
        "interval",
        seconds=settings.scrape_interval_seconds,
        max_instances=1,
        coalesce=True,
        next_run_time=None,
    )
    scheduler.start()

    # Kick off an immediate first cycle.
    await run_cycle()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # pragma: no cover - Windows
            pass

    await stop.wait()
    log.info("scraper.stopping")
    scheduler.shutdown(wait=False)
    await dispose_engine()


def run() -> None:
    """Console-script entrypoint (`nwf-scraper`)."""
    asyncio.run(_main())


if __name__ == "__main__":
    run()
