"""Transactional email via Resend (invite emails)."""

from __future__ import annotations

import html
from dataclasses import dataclass

import httpx

from core.config import Settings, get_settings
from core.logging import get_logger

log = get_logger("email")


@dataclass(frozen=True)
class InviteEmailContent:
    """Payload for a branded invitation email."""

    to_email: str
    inviter_name: str
    invite_url: str
    message: str | None = None
    headline: str | None = None
    article_url: str | None = None
    image_url: str | None = None
    publisher: str | None = None
    take: str | None = None


def _plain_text(content: InviteEmailContent) -> str:
    lines: list[str] = [
        f"{content.inviter_name} invited you to a private conversation on NewsWithFriends.",
        "",
    ]
    if content.headline:
        lines.append(content.headline)
        if content.publisher:
            lines.append(f"via {content.publisher}")
        if content.article_url:
            lines.append(content.article_url)
        lines.append("")
    if content.take:
        lines.append(f'{content.inviter_name} said: "{content.take}"')
        lines.append("")
    if content.message:
        lines.append(content.message)
        lines.append("")
    lines.append(f"Join the conversation: {content.invite_url}")
    return "\n".join(lines)


def _html_body(content: InviteEmailContent) -> str:
    inviter: str = html.escape(content.inviter_name)
    url: str = html.escape(content.invite_url, quote=True)
    parts: list[str] = [
        f"<p style=\"font-family:Georgia,serif;font-size:18px;line-height:1.5;"
        f"color:#18181b;margin:0 0 16px;\">"
        f"<strong>{inviter}</strong> invited you to join a private conversation "
        f"on NewsWithFriends.</p>",
    ]
    if content.headline:
        headline: str = html.escape(content.headline)
        publisher: str = html.escape(content.publisher or "")
        article: str = html.escape(content.article_url or content.invite_url, quote=True)
        image_block: str = ""
        if content.image_url:
            img: str = html.escape(content.image_url, quote=True)
            image_block = (
                f'<a href="{article}" style="display:block;margin:0 0 12px;">'
                f'<img src="{img}" alt="" '
                f'style="width:100%;max-height:240px;object-fit:cover;'
                f'border-radius:4px;display:block;" /></a>'
            )
        publisher_block: str = ""
        if publisher:
            publisher_block = (
                f'<p style="margin:0 0 4px;font-size:12px;letter-spacing:0.08em;'
                f'color:#71717a;text-transform:uppercase;">{publisher}</p>'
            )
        parts.append(
            f'<div style="border:1px solid #e4e4e7;border-radius:6px;'
            f'overflow:hidden;margin:0 0 20px;background:#fff;">'
            f"{image_block}"
            f'<div style="padding:14px 16px;">'
            f"{publisher_block}"
            f'<a href="{article}" style="font-family:Georgia,serif;font-size:20px;'
            f'font-weight:600;color:#18181b;text-decoration:none;line-height:1.3;">'
            f"{headline}</a>"
            f"</div></div>"
        )
    if content.take:
        take: str = html.escape(content.take)
        parts.append(
            f'<p style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;'
            f'font-size:15px;line-height:1.5;color:#3f3f46;margin:0 0 12px;'
            f'padding:12px 14px;background:#fafafa;border-left:3px solid #18181b;">'
            f'<strong>{inviter}</strong>: “{take}”</p>'
        )
    if content.message:
        msg: str = html.escape(content.message)
        parts.append(
            f'<p style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;'
            f'font-size:15px;line-height:1.5;color:#3f3f46;margin:0 0 20px;'
            f'white-space:pre-wrap;">{msg}</p>'
        )
    parts.append(
        f'<p style="margin:24px 0 8px;">'
        f'<a href="{url}" style="display:inline-block;background:#18181b;color:#fafafa;'
        f'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;'
        f'font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;'
        f'text-decoration:none;padding:12px 20px;border-radius:4px;">'
        f"Join the conversation</a></p>"
        f'<p style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;'
        f'font-size:12px;color:#a1a1aa;margin:16px 0 0;">'
        f'Or open this link: <a href="{url}" style="color:#71717a;">{url}</a></p>'
    )
    return (
        '<div style="max-width:520px;margin:0 auto;padding:24px 16px;">'
        + "".join(parts)
        + "</div>"
    )


async def send_invite_email(
    content: InviteEmailContent,
    *,
    settings: Settings | None = None,
) -> bool:
    """Send a branded invite email via Resend. Returns True on success.

    No-ops (returns False) when ``resend_api_key`` is unset so local
    development can rely on the copyable invite link instead.
    """
    cfg: Settings = settings or get_settings()
    if not cfg.resend_api_key:
        log.info("email.invite.skip", reason="no_resend_api_key", to=content.to_email)
        return False

    subject_bits: list[str] = [f"{content.inviter_name} invited you"]
    if content.headline:
        subject_bits.append(f" — {content.headline[:80]}")
    subject: str = "".join(subject_bits)

    payload: dict[str, object] = {
        "from": cfg.email_from,
        "to": [content.to_email],
        "subject": subject,
        "html": _html_body(content),
        "text": _plain_text(content),
    }
    headers: dict[str, str] = {
        "Authorization": f"Bearer {cfg.resend_api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning(
            "email.invite.failed",
            error=str(exc),
            to=content.to_email,
        )
        return False

    log.info("email.invite.sent", to=content.to_email)
    return True
