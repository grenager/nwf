"""Build (and optionally send) a digest for one user.

Usage:
  python -m scripts.send_test_digest <user_uuid>
  python -m scripts.send_test_digest <user_uuid> --send
  python -m scripts.send_test_digest <user_uuid> --hours 48
"""

from __future__ import annotations

import argparse
import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from core.config import get_settings
from core.db import dispose_engine, get_sessionmaker
from core.email import DigestLineInput, digest_email_from_user_digest, send_digest_email
from core.models import Profile
from digest.builder import build_user_digest


async def _main() -> None:
    parser = argparse.ArgumentParser(description="Preview or send a test digest")
    parser.add_argument("user_id", type=uuid.UUID)
    parser.add_argument(
        "--send",
        action="store_true",
        help="Actually send via Resend (requires RESEND_API_KEY)",
    )
    parser.add_argument(
        "--hours",
        type=int,
        default=24,
        help="Lookback window in hours (default 24)",
    )
    args = parser.parse_args()

    settings = get_settings()
    factory = get_sessionmaker()
    since = datetime.now(UTC) - timedelta(hours=args.hours)

    async with factory() as session:
        profile: Profile | None = await session.get(Profile, args.user_id)
        if profile is None:
            raise SystemExit(f"profile not found: {args.user_id}")

        email: str | None = None
        try:
            row = (
                await session.execute(
                    text("select email from auth.users where id = :id"),
                    {"id": args.user_id},
                )
            ).first()
            if row is not None:
                email = row[0]
        except SQLAlchemyError as exc:
            raise SystemExit(f"could not read auth.users email: {exc}") from exc
        if not email:
            raise SystemExit("no email for user")

        digest = await build_user_digest(session, profile, email, since)
        if digest is None:
            print(f"No activity for {email} since {since.isoformat()}")
            return

        content = digest_email_from_user_digest(
            to_email=email,
            recipient_first=profile.first,
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
            unsubscribe_token=profile.unsubscribe_token,
            settings=settings,
        )
        print(f"To: {content.to_email}")
        print(f"Subject: {content.lines[0].text if content.lines else '(empty)'}")
        print(f"Feed: {content.feed_url}")
        print(f"Unsubscribe: {content.unsubscribe_url}")
        print("---")
        for line in content.lines:
            print(f"• {line.text}")
            print(f"  {line.href}")
            if line.headline:
                print(f"  ({line.headline})")
            if line.story_image_url:
                print(f"  story: {line.story_image_url}")
            if line.actor_image_urls:
                print(f"  avatars: {len(line.actor_image_urls)}")

        if args.send:
            sent = await send_digest_email(content, settings=settings)
            print(f"\nSent: {sent}")
        else:
            print("\n(Dry run — pass --send to deliver via Resend)")

    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(_main())
