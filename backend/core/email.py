"""Transactional email via Resend (invite + digest emails)."""

from __future__ import annotations

import html
import uuid
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


# --- Daily digest ---------------------------------------------------------


@dataclass(frozen=True)
class DigestLineInput:
    """Builder-facing line before absolute URLs are attached."""

    text: str
    post_id: uuid.UUID | None
    headline: str | None = None
    story_image_url: str | None = None
    source_label: str | None = None
    actor_image_urls: tuple[str, ...] = ()


@dataclass(frozen=True)
class DigestLineContent:
    """One activity tile in a digest email."""

    text: str
    href: str
    headline: str | None = None
    story_image_url: str | None = None
    source_label: str | None = None
    actor_image_urls: tuple[str, ...] = ()


@dataclass(frozen=True)
class DigestEmailContent:
    """Payload for a daily activity digest email."""

    to_email: str
    recipient_first: str | None
    lines: list[DigestLineContent]
    feed_url: str
    unsubscribe_url: str


def _digest_subject(content: DigestEmailContent) -> str:
    if content.lines:
        return content.lines[0].text[:120]
    return "New activity from your friends"


def _digest_plain_text(content: DigestEmailContent) -> str:
    greeting: str = (
        f"Hi {content.recipient_first},"
        if content.recipient_first and content.recipient_first.strip()
        else "Hi,"
    )
    lines: list[str] = [
        greeting,
        "",
        "Here's what's new from your friends on NewsWithFriends:",
        "",
    ]
    for line in content.lines:
        lines.append(f"• {line.text}")
        if line.headline:
            lines.append(f"  {line.headline}")
        lines.append(f"  {line.href}")
        lines.append("")
    lines.append(f"Open your feed: {content.feed_url}")
    lines.append("")
    lines.append(f"Unsubscribe: {content.unsubscribe_url}")
    return "\n".join(lines)


def _lead_avatar_html(urls: tuple[str, ...]) -> str:
    """Single 40px lead avatar (the primary actor), product-style."""
    if urls:
        src: str = html.escape(urls[0], quote=True)
        inner: str = (
            f'<img src="{src}" alt="" width="40" height="40" '
            f'style="width:40px;height:40px;border-radius:999px;object-fit:cover;'
            f'display:block;background:#e4e4e7;" />'
        )
    else:
        inner = (
            '<div style="width:40px;height:40px;border-radius:999px;'
            'background:#e4e4e7;"></div>'
        )
    return inner


def _extra_avatars_html(urls: tuple[str, ...]) -> str:
    """Small overlapping chips for additional actors beyond the lead."""
    extras = urls[1:3]
    if not extras:
        return ""
    chips: list[str] = []
    for url in extras:
        src: str = html.escape(url, quote=True)
        chips.append(
            f'<img src="{src}" alt="" width="22" height="22" '
            f'style="width:22px;height:22px;border-radius:999px;object-fit:cover;'
            f'border:2px solid #fff;display:inline-block;vertical-align:middle;'
            f'margin-left:-8px;background:#e4e4e7;" />'
        )
    return f'<span style="margin-left:8px;line-height:0;">{"".join(chips)}</span>'


def _article_card_html(line: DigestLineContent) -> str:
    """Indented article tile: image on top, source label + headline below."""
    if not (line.headline or line.story_image_url):
        return ""
    image_block: str = ""
    if line.story_image_url:
        img: str = html.escape(line.story_image_url, quote=True)
        image_block = (
            f'<img src="{img}" alt="" width="100%" '
            f'style="width:100%;max-height:180px;object-fit:cover;display:block;'
            f'background:#f4f4f5;" />'
        )
    source_block: str = ""
    if line.source_label:
        source: str = html.escape(line.source_label)
        source_block = (
            f'<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
            f'sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;'
            f'color:#a1a1aa;margin:0 0 4px;">{source}</div>'
        )
    headline_block: str = ""
    if line.headline:
        headline: str = html.escape(line.headline)
        headline_block = (
            f'<div style="font-family:Georgia,serif;font-size:16px;font-weight:600;'
            f'color:#18181b;line-height:1.3;">{headline}</div>'
        )
    return (
        f'<div style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;'
        f'background:#fff;margin:10px 0 0;">'
        f"{image_block}"
        f'<div style="padding:12px 14px;">{source_block}{headline_block}</div>'
        f"</div>"
    )


def _digest_tile_html(line: DigestLineContent) -> str:
    text: str = html.escape(line.text)
    href: str = html.escape(line.href, quote=True)
    lead_avatar: str = _lead_avatar_html(line.actor_image_urls)
    extra_avatars: str = _extra_avatars_html(line.actor_image_urls)
    article_card: str = _article_card_html(line)
    return (
        f'<a href="{href}" style="display:block;text-decoration:none;color:inherit;'
        f'margin:0 0 16px;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'width="100%">'
        f"<tr>"
        f'<td width="52" valign="top" style="width:52px;padding:0 12px 0 0;">'
        f"{lead_avatar}</td>"
        f'<td valign="top">'
        f'<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
        f'sans-serif;font-size:15px;line-height:1.4;color:#18181b;'
        f'font-weight:600;">{text}{extra_avatars}</div>'
        f"{article_card}"
        f"</td>"
        f"</tr></table></a>"
    )


def _digest_html_body(content: DigestEmailContent) -> str:
    greeting_name: str = html.escape((content.recipient_first or "").strip())
    greeting: str = f"Hi {greeting_name}," if greeting_name else "Hi,"
    feed: str = html.escape(content.feed_url, quote=True)
    unsub: str = html.escape(content.unsubscribe_url, quote=True)
    parts: list[str] = [
        f'<p style="font-family:Georgia,serif;font-size:18px;line-height:1.5;'
        f'color:#18181b;margin:0 0 8px;">{greeting}</p>',
        '<p style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;'
        'font-size:15px;line-height:1.5;color:#3f3f46;margin:0 0 20px;">'
        "Here's what's new from your friends on NewsWithFriends:</p>",
    ]
    for line in content.lines:
        parts.append(_digest_tile_html(line))
    parts.append(
        f'<p style="margin:24px 0 8px;">'
        f'<a href="{feed}" style="display:inline-block;background:#18181b;'
        f'color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
        f'sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;'
        f'text-transform:uppercase;text-decoration:none;padding:12px 20px;'
        f'border-radius:4px;">Open NewsWithFriends</a></p>'
        f'<p style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
        f'sans-serif;font-size:12px;color:#a1a1aa;margin:20px 0 0;">'
        f'<a href="{unsub}" style="color:#71717a;">Unsubscribe from daily digests</a>'
        f"</p>"
    )
    return (
        '<div style="max-width:520px;margin:0 auto;padding:24px 16px;">'
        + "".join(parts)
        + "</div>"
    )


def digest_email_from_user_digest(
    *,
    to_email: str,
    recipient_first: str | None,
    lines: list[DigestLineInput],
    unsubscribe_token: uuid.UUID,
    settings: Settings,
) -> DigestEmailContent:
    """Map builder output into email content with absolute app URLs."""
    feed_url: str = settings.app_url("/")
    line_contents: list[DigestLineContent] = []
    for line in lines:
        href: str = (
            settings.app_url(f"/post/{line.post_id}")
            if line.post_id is not None
            else feed_url
        )
        line_contents.append(
            DigestLineContent(
                text=line.text,
                href=href,
                headline=line.headline,
                story_image_url=line.story_image_url,
                source_label=line.source_label,
                actor_image_urls=line.actor_image_urls,
            )
        )
    return DigestEmailContent(
        to_email=to_email,
        recipient_first=recipient_first,
        lines=line_contents,
        feed_url=feed_url,
        unsubscribe_url=settings.app_url(f"/unsubscribe/{unsubscribe_token}"),
    )


async def send_digest_email(
    content: DigestEmailContent,
    *,
    settings: Settings | None = None,
) -> bool:
    """Send a daily digest via Resend. Returns True on success.

    No-ops (returns False) when ``resend_api_key`` is unset.
    """
    cfg: Settings = settings or get_settings()
    if not cfg.resend_api_key:
        log.info("email.digest.skip", reason="no_resend_api_key", to=content.to_email)
        return False

    subject: str = _digest_subject(content)
    payload: dict[str, object] = {
        "from": cfg.email_from,
        "to": [content.to_email],
        "subject": subject,
        "html": _digest_html_body(content),
        "text": _digest_plain_text(content),
        "headers": {
            "List-Unsubscribe": f"<{content.unsubscribe_url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
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
            "email.digest.failed",
            error=str(exc),
            to=content.to_email,
        )
        return False

    log.info("email.digest.sent", to=content.to_email, lines=len(content.lines))
    return True


# --- Friend request / accepted --------------------------------------------


@dataclass(frozen=True)
class FriendNoticeEmailContent:
    """Immediate email for a friend request or acceptance."""

    to_email: str
    actor_name: str
    actor_image_url: str | None
    action_url: str
    kind: str  # "request" | "accepted"


def _friend_notice_subject(content: FriendNoticeEmailContent) -> str:
    if content.kind == "accepted":
        return f"{content.actor_name} accepted your friend request"
    return f"{content.actor_name} sent you a friend request"


def _friend_notice_plain(content: FriendNoticeEmailContent) -> str:
    if content.kind == "accepted":
        lead = f"{content.actor_name} accepted your friend request on NewsWithFriends."
        cta = "See your friends"
    else:
        lead = f"{content.actor_name} sent you a friend request on NewsWithFriends."
        cta = "Review friend requests"
    return f"{lead}\n\n{cta}: {content.action_url}\n"


def _friend_notice_html(content: FriendNoticeEmailContent) -> str:
    actor: str = html.escape(content.actor_name)
    url: str = html.escape(content.action_url, quote=True)
    if content.kind == "accepted":
        lead = (
            f"<strong>{actor}</strong> accepted your friend request on NewsWithFriends."
        )
        button = "See your friends"
    else:
        lead = f"<strong>{actor}</strong> sent you a friend request on NewsWithFriends."
        button = "Review friend requests"

    avatar_block: str = ""
    if content.actor_image_url:
        img: str = html.escape(content.actor_image_url, quote=True)
        avatar_block = (
            f'<img src="{img}" alt="" width="56" height="56" '
            f'style="width:56px;height:56px;border-radius:999px;object-fit:cover;'
            f'display:block;margin:0 0 16px;background:#e4e4e7;" />'
        )

    return (
        '<div style="max-width:520px;margin:0 auto;padding:24px 16px;">'
        f"{avatar_block}"
        f'<p style="font-family:Georgia,serif;font-size:18px;line-height:1.5;'
        f'color:#18181b;margin:0 0 20px;">{lead}</p>'
        f'<p style="margin:24px 0 8px;">'
        f'<a href="{url}" style="display:inline-block;background:#18181b;'
        f'color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
        f'sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;'
        f'text-transform:uppercase;text-decoration:none;padding:12px 20px;'
        f'border-radius:4px;">{button}</a></p>'
        f'<p style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
        f'sans-serif;font-size:12px;color:#a1a1aa;margin:16px 0 0;">'
        f'Or open this link: <a href="{url}" style="color:#71717a;">{url}</a></p>'
        "</div>"
    )


async def send_friend_notice_email(
    content: FriendNoticeEmailContent,
    *,
    settings: Settings | None = None,
) -> bool:
    """Send a friend-request or friend-accepted email via Resend."""
    cfg: Settings = settings or get_settings()
    if not cfg.resend_api_key:
        log.info(
            "email.friend_notice.skip",
            reason="no_resend_api_key",
            kind=content.kind,
            to=content.to_email,
        )
        return False

    payload: dict[str, object] = {
        "from": cfg.email_from,
        "to": [content.to_email],
        "subject": _friend_notice_subject(content),
        "html": _friend_notice_html(content),
        "text": _friend_notice_plain(content),
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
            "email.friend_notice.failed",
            error=str(exc),
            kind=content.kind,
            to=content.to_email,
        )
        return False

    log.info(
        "email.friend_notice.sent",
        kind=content.kind,
        to=content.to_email,
    )
    return True
