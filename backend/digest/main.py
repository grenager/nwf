"""Long-lived daily digest worker.

Runs an APScheduler cron job at ``digest_send_hour_pt`` in America/Los_Angeles
that emails each opted-in user a summary of new friend activity.
"""

from __future__ import annotations

import asyncio
import signal
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings, get_settings
from core.db import dispose_engine, get_sessionmaker
from core.email import DigestLineInput, digest_email_from_user_digest, send_digest_email
from core.logging import get_logger
from core.models import Profile
from digest.builder import UserDigest, build_user_digest

log = get_logger("digest")

PT: ZoneInfo = ZoneInfo("America/Los_Angeles")


async def _load_emails(session: AsyncSession) -> dict[uuid.UUID, str]:
    """Map auth user id -> email from auth.users."""
    emails: dict[uuid.UUID, str] = {}
    try:
        rows = (await session.execute(text("select id, email from auth.users"))).all()
        for row in rows:
            user_id: uuid.UUID = row[0]
            email_val: str | None = row[1]
            if email_val:
                emails[user_id] = email_val.strip().lower()
    except SQLAlchemyError as exc:
        log.warning("digest.emails_unavailable", error=str(exc))
    return emails


async def _process_user(
    profile: Profile,
    email: str,
    settings: Settings,
) -> str:
    """Build + send one digest. Returns a status label."""
    factory = get_sessionmaker()
    async with factory() as session:
        merged: Profile | None = await session.get(Profile, profile.id)
        if merged is None or merged.digest_opt_out:
            return "skipped_opt_out"

        now: datetime = datetime.now(UTC)
        since: datetime = merged.last_digest_sent_at or (
            now - timedelta(hours=24)
        )
        lookback_floor: datetime = now - timedelta(days=settings.digest_lookback_days)
        if since < lookback_floor:
            since = lookback_floor

        digest: UserDigest | None = await build_user_digest(
            session,
            merged,
            email,
            since,
            max_lines=settings.digest_max_lines,
        )
        if digest is None:
            # Still advance watermark so quiet days don't accumulate forever.
            merged.last_digest_sent_at = now
            await session.commit()
            return "skipped_empty"

        content = digest_email_from_user_digest(
            to_email=email,
            recipient_first=merged.first,
            lines=[
                DigestLineInput(
                    text=line.text,
                    post_id=line.post_id,
                    headline=line.headline,
                    story_image_url=line.image_url,
                    source_label=line.source_label,
                    actor_image_urls=line.actor_image_urls,
                )
                for line in digest.lines
            ],
            unsubscribe_token=merged.unsubscribe_token,
            settings=settings,
        )
        sent: bool = await send_digest_email(content, settings=settings)
        if sent or not settings.resend_api_key:
            # Advance watermark on success, or when emails are disabled (local
            # dry-run) so the cycle is still idempotent.
            merged.last_digest_sent_at = now
            await session.commit()
            return "sent" if sent else "dry_run"
        await session.rollback()
        return "send_failed"


async def run_digest_cycle() -> None:
    """Send digests to every eligible user with bounded concurrency."""
    settings = get_settings()
    if not settings.digest_enabled:
        log.info("digest.cycle_disabled")
        return

    factory = get_sessionmaker()
    async with factory() as session:
        profiles: list[Profile] = list(
            (
                await session.scalars(
                    select(Profile).where(Profile.digest_opt_out.is_(False))
                )
            ).all()
        )
        emails: dict[uuid.UUID, str] = await _load_emails(session)

    if not profiles:
        log.info("digest.cycle_empty", reason="no_profiles")
        return

    semaphore = asyncio.Semaphore(settings.digest_concurrency)

    async def _run_one(profile: Profile) -> str:
        email: str | None = emails.get(profile.id)
        if not email:
            return "skipped_no_email"
        async with semaphore:
            try:
                return await _process_user(profile, email, settings)
            except Exception as exc:
                log.error(
                    "digest.user_failed",
                    user_id=str(profile.id),
                    error=str(exc),
                )
                return "error"

    log.info("digest.cycle_start", users=len(profiles))
    results: list[str] = await asyncio.gather(*(_run_one(p) for p in profiles))
    counts: dict[str, int] = {}
    for status in results:
        counts[status] = counts.get(status, 0) + 1
    log.info("digest.cycle_done", **counts)


async def _main() -> None:
    settings = get_settings()
    hour: int = max(0, min(23, settings.digest_send_hour_pt))
    log.info(
        "digest.boot",
        hour_pt=hour,
        enabled=settings.digest_enabled,
        app_base_url=settings.app_base_url,
        concurrency=settings.digest_concurrency,
    )

    scheduler = AsyncIOScheduler(timezone=PT)
    scheduler.add_job(
        run_digest_cycle,
        CronTrigger(hour=hour, minute=0, timezone=PT),
        max_instances=1,
        coalesce=True,
        id="daily_digest",
    )
    scheduler.start()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # pragma: no cover - Windows
            pass

    await stop.wait()
    log.info("digest.stopping")
    scheduler.shutdown(wait=False)
    await dispose_engine()


def run() -> None:
    """Console-script entrypoint (`nwf-digest`)."""
    asyncio.run(_main())


if __name__ == "__main__":
    run()
