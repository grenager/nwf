"""Transactional email via Resend (invite + digest + activity emails)."""

from __future__ import annotations

import html
import uuid
from dataclasses import dataclass

import httpx

from core.config import Settings, get_settings
from core.logging import get_logger

log = get_logger("email")

_FOOTER_TEXT_STYLE = (
    "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;"
    "font-size:12px;color:#a1a1aa;"
)


def _footer_html(
    *,
    action_url: str | None,
    unsubscribe_url: str,
    unsubscribe_label: str = "Unsubscribe",
) -> str:
    """Shared footer: optional plain-link fallback plus an unsubscribe link."""
    parts: list[str] = []
    if action_url:
        url: str = html.escape(action_url, quote=True)
        parts.append(
            f'<p style="{_FOOTER_TEXT_STYLE}margin:16px 0 0;">'
            f'Or open this link: <a href="{url}" style="color:#71717a;">{url}</a></p>'
        )
    unsub: str = html.escape(unsubscribe_url, quote=True)
    parts.append(
        f'<p style="{_FOOTER_TEXT_STYLE}margin:20px 0 0;">'
        f'<a href="{unsub}" style="color:#71717a;">'
        f"{html.escape(unsubscribe_label)}</a></p>"
    )
    return "".join(parts)


def _footer_text(
    *,
    unsubscribe_url: str,
    unsubscribe_label: str = "Unsubscribe",
) -> str:
    """Plain-text counterpart of :func:`_footer_html`."""
    return f"{unsubscribe_label}: {unsubscribe_url}"


def _unsubscribe_headers(unsubscribe_url: str) -> dict[str, str]:
    """One-click unsubscribe headers honored by Gmail/Apple Mail."""
    return {
        "List-Unsubscribe": f"<{unsubscribe_url}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }


@dataclass(frozen=True)
class InviteEmailContent:
    """Payload for a branded invitation email."""

    to_email: str
    inviter_name: str
    invite_url: str
    unsubscribe_url: str
    message: str | None = None
    headline: str | None = None
    article_url: str | None = None
    image_url: str | None = None
    publisher: str | None = None
    take: str | None = None
    # Display name parsed from a "Name <email>" entry, used to greet by name.
    recipient_name: str | None = None


def _greeting_name(content: InviteEmailContent) -> str | None:
    """First name of the recipient, when the sender supplied one."""
    full: str = (content.recipient_name or "").strip()
    if not full:
        return None
    return full.split()[0]


def _plain_text(content: InviteEmailContent) -> str:
    lines: list[str] = []
    greeting: str | None = _greeting_name(content)
    if greeting is not None:
        lines.extend([f"Hi {greeting},", ""])
    lines.extend(
        [
            f"{content.inviter_name} invited you to a private conversation "
            f"on NewsWithFriends.",
            "",
        ]
    )
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
    lines.append(f"Accept invitation: {content.invite_url}")
    lines.append("")
    lines.append(
        _footer_text(
            unsubscribe_url=content.unsubscribe_url,
            unsubscribe_label="Unsubscribe from these emails",
        )
    )
    return "\n".join(lines)


def _html_body(content: InviteEmailContent) -> str:
    inviter: str = html.escape(content.inviter_name)
    url: str = html.escape(content.invite_url, quote=True)
    parts: list[str] = []
    greeting: str | None = _greeting_name(content)
    if greeting is not None:
        parts.append(
            f'<p style="font-family:Georgia,serif;font-size:18px;line-height:1.5;'
            f'color:#18181b;margin:0 0 8px;">Hi {html.escape(greeting)},</p>'
        )
    parts.append(
        f"<p style=\"font-family:Georgia,serif;font-size:18px;line-height:1.5;"
        f"color:#18181b;margin:0 0 16px;\">"
        f"<strong>{inviter}</strong> invited you to join a private conversation "
        f"on NewsWithFriends.</p>"
    )
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
        f"Accept invitation</a></p>"
    )
    parts.append(
        _footer_html(
            action_url=content.invite_url,
            unsubscribe_url=content.unsubscribe_url,
            unsubscribe_label="Unsubscribe from these emails",
        )
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
        "headers": _unsubscribe_headers(content.unsubscribe_url),
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
    lines.append(
        _footer_text(
            unsubscribe_url=content.unsubscribe_url,
            unsubscribe_label="Unsubscribe from daily digests",
        )
    )
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
    )
    parts.append(
        _footer_html(
            action_url=None,
            unsubscribe_url=content.unsubscribe_url,
            unsubscribe_label="Unsubscribe from daily digests",
        )
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
        # Digest-scoped: this link must not silence instant activity emails.
        unsubscribe_url=settings.app_url(
            f"/unsubscribe/{unsubscribe_token}?scope=digest"
        ),
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
        "headers": _unsubscribe_headers(content.unsubscribe_url),
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
    unsubscribe_url: str
    kind: str  # "request" | "accepted" | "connected"


def _friend_notice_subject(content: FriendNoticeEmailContent) -> str:
    if content.kind == "accepted":
        return f"{content.actor_name} accepted your friend request"
    if content.kind == "connected":
        return f"You're now friends with {content.actor_name}"
    return f"{content.actor_name} sent you a friend request"


def _friend_notice_plain(content: FriendNoticeEmailContent) -> str:
    if content.kind == "accepted":
        lead = f"{content.actor_name} accepted your friend request on NewsWithFriends."
        cta = "See your friends"
    elif content.kind == "connected":
        lead = f"You're now friends with {content.actor_name} on NewsWithFriends."
        cta = "See your friends"
    else:
        lead = f"{content.actor_name} sent you a friend request on NewsWithFriends."
        cta = "Review friend requests"
    footer: str = _footer_text(unsubscribe_url=content.unsubscribe_url)
    return f"{lead}\n\n{cta}: {content.action_url}\n\n{footer}\n"


def _friend_notice_html(content: FriendNoticeEmailContent) -> str:
    actor: str = html.escape(content.actor_name)
    url: str = html.escape(content.action_url, quote=True)
    if content.kind == "accepted":
        lead = (
            f"<strong>{actor}</strong> accepted your friend request on NewsWithFriends."
        )
        button = "See your friends"
    elif content.kind == "connected":
        lead = f"You're now friends with <strong>{actor}</strong> on NewsWithFriends."
        button = "See your friends"
    else:
        lead = f"<strong>{actor}</strong> sent you a friend request on NewsWithFriends."
        button = "Review friend requests"

    avatar_block: str = ""
    if content.actor_image_url:
        img: str = html.escape(content.actor_image_url, quote=True)
        avatar_block = (
            f'<img src="{img}" alt="" width="56" height="56" border="0" '
            f'style="width:56px;height:56px;border-radius:999px;object-fit:cover;'
            f'display:block;margin:0 0 16px;background:#e4e4e7;border:0;'
            f'outline:none;text-decoration:none;" />'
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
        + _footer_html(
            action_url=content.action_url,
            unsubscribe_url=content.unsubscribe_url,
        )
        + "</div>"
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
        "headers": _unsubscribe_headers(content.unsubscribe_url),
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


# --- Instant activity (new post / comment / reply) ------------------------


@dataclass(frozen=True)
class ActivityEmailContent:
    """Immediate email for a friend post, comment, or reply."""

    to_email: str
    recipient_first: str | None
    actor_name: str
    actor_image_url: str | None
    kind: str  # "new_post" | "comment" | "reply" | "conversation"
    headline: str | None
    source_label: str | None
    story_image_url: str | None
    excerpt: str | None
    action_url: str
    unsubscribe_url: str
    # Set for recipients who were invited but have not accepted yet, explaining
    # why the conversation is not open to them yet.
    pending_note: str | None = None
    # Overrides the CTA label when the button leads somewhere other than the
    # article itself (an invite landing page or the friend requests screen).
    cta_label: str | None = None


def _activity_subject(content: ActivityEmailContent) -> str:
    if content.kind == "comment":
        return f"{content.actor_name} commented on your article"
    if content.kind == "reply":
        return f"{content.actor_name} responded to your comment"
    if content.kind == "conversation":
        return (
            f"{content.actor_name} replied in a conversation you were invited to"
        )
    return f"{content.actor_name} posted a new article"


def _activity_lead(content: ActivityEmailContent) -> tuple[str, str]:
    """Return (plain lead sentence, CTA button label)."""
    if content.kind == "comment":
        lead, cta = (
            f"{content.actor_name} commented on your article on NewsWithFriends.",
            "View conversation",
        )
    elif content.kind == "reply":
        lead, cta = (
            f"{content.actor_name} responded to your comment on NewsWithFriends.",
            "View conversation",
        )
    elif content.kind == "conversation":
        lead, cta = (
            f"{content.actor_name} replied in a conversation you were invited "
            f"to on NewsWithFriends.",
            "View conversation",
        )
    else:
        lead, cta = (
            f"{content.actor_name} posted a new article on NewsWithFriends.",
            "View article",
        )
    return lead, content.cta_label or cta


def _activity_plain(content: ActivityEmailContent) -> str:
    lead, cta = _activity_lead(content)
    lines: list[str] = [lead, ""]
    if content.headline:
        lines.append(content.headline)
        if content.source_label:
            lines.append(f"via {content.source_label}")
        lines.append("")
    if content.excerpt:
        lines.append(f'{content.actor_name}: "{content.excerpt}"')
        lines.append("")
    if content.pending_note:
        lines.append(content.pending_note)
        lines.append("")
    lines.append(f"{cta}: {content.action_url}")
    lines.append("")
    lines.append(_footer_text(unsubscribe_url=content.unsubscribe_url))
    return "\n".join(lines)


def _activity_article_card_html(content: ActivityEmailContent) -> str:
    """Article tile matching digest styling, wrapped as one clickable block."""
    if not (content.headline or content.story_image_url):
        return ""
    href: str = html.escape(content.action_url, quote=True)
    image_block: str = ""
    if content.story_image_url:
        img: str = html.escape(content.story_image_url, quote=True)
        image_block = (
            f'<img src="{img}" alt="" width="100%" border="0" '
            f'style="width:100%;max-height:180px;object-fit:cover;display:block;'
            f'background:#f4f4f5;border:0;outline:none;text-decoration:none;" />'
        )
    source_block: str = ""
    if content.source_label:
        source: str = html.escape(content.source_label)
        source_block = (
            f'<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
            f'sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;'
            f'color:#a1a1aa;margin:0 0 4px;">{source}</div>'
        )
    headline_block: str = ""
    if content.headline:
        headline: str = html.escape(content.headline)
        headline_block = (
            f'<div style="font-family:Georgia,serif;font-size:16px;font-weight:600;'
            f'color:#18181b;line-height:1.3;">{headline}</div>'
        )
    return (
        f'<a href="{href}" style="display:block;text-decoration:none;'
        f'color:inherit;border:1px solid #e4e4e7;border-radius:8px;'
        f'overflow:hidden;background:#fff;margin:0 0 16px;">'
        f"{image_block}"
        f'<div style="padding:12px 14px;">{source_block}{headline_block}</div>'
        f"</a>"
    )


def _activity_html(content: ActivityEmailContent) -> str:
    actor: str = html.escape(content.actor_name)
    url: str = html.escape(content.action_url, quote=True)
    _, button = _activity_lead(content)
    if content.kind == "comment":
        lead = (
            f"<strong>{actor}</strong> commented on your article on NewsWithFriends."
        )
    elif content.kind == "reply":
        lead = (
            f"<strong>{actor}</strong> responded to your comment on NewsWithFriends."
        )
    elif content.kind == "conversation":
        lead = (
            f"<strong>{actor}</strong> replied in a conversation you were "
            f"invited to on NewsWithFriends."
        )
    else:
        lead = f"<strong>{actor}</strong> posted a new article on NewsWithFriends."

    avatar_block: str = ""
    if content.actor_image_url:
        img: str = html.escape(content.actor_image_url, quote=True)
        avatar_block = (
            f'<img src="{img}" alt="" width="56" height="56" border="0" '
            f'style="width:56px;height:56px;border-radius:999px;object-fit:cover;'
            f'display:block;margin:0 0 16px;background:#e4e4e7;border:0;'
            f'outline:none;text-decoration:none;" />'
        )

    excerpt_block: str = ""
    if content.excerpt:
        excerpt: str = html.escape(content.excerpt)
        excerpt_block = (
            f'<a href="{url}" style="display:block;text-decoration:none;'
            f'color:inherit;">'
            f'<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
            f'sans-serif;font-size:15px;line-height:1.5;color:#3f3f46;margin:0 0 16px;'
            f'padding:12px 14px;background:#fafafa;border-left:3px solid #18181b;">'
            f'<strong>{actor}</strong>: “{excerpt}”</div></a>'
        )

    pending_block: str = ""
    if content.pending_note:
        note: str = html.escape(content.pending_note)
        pending_block = (
            f'<p style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
            f'sans-serif;font-size:14px;line-height:1.5;color:#71717a;'
            f'margin:0 0 16px;">{note}</p>'
        )

    return (
        '<div style="max-width:520px;margin:0 auto;padding:24px 16px;">'
        f'<a href="{url}" style="display:block;text-decoration:none;'
        f'color:inherit;">'
        f"{avatar_block}"
        f'<div style="font-family:Georgia,serif;font-size:18px;line-height:1.5;'
        f'color:#18181b;margin:0 0 16px;">{lead}</div>'
        f"</a>"
        f"{_activity_article_card_html(content)}"
        f"{excerpt_block}"
        f"{pending_block}"
        f'<p style="margin:24px 0 8px;">'
        f'<a href="{url}" style="display:inline-block;background:#18181b;'
        f'color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
        f'sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;'
        f'text-transform:uppercase;text-decoration:none;padding:12px 20px;'
        f'border-radius:4px;">{html.escape(button)}</a></p>'
        + _footer_html(
            action_url=content.action_url,
            unsubscribe_url=content.unsubscribe_url,
        )
        + "</div>"
    )


async def send_activity_email(
    content: ActivityEmailContent,
    *,
    settings: Settings | None = None,
) -> bool:
    """Send an instant activity email via Resend. Returns True on success.

    No-ops (returns False) when ``resend_api_key`` is unset.
    """
    cfg: Settings = settings or get_settings()
    if not cfg.resend_api_key:
        log.info(
            "email.activity.skip",
            reason="no_resend_api_key",
            kind=content.kind,
            to=content.to_email,
        )
        return False

    payload: dict[str, object] = {
        "from": cfg.email_from,
        "to": [content.to_email],
        "subject": _activity_subject(content),
        "html": _activity_html(content),
        "text": _activity_plain(content),
        "headers": _unsubscribe_headers(content.unsubscribe_url),
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
            "email.activity.failed",
            error=str(exc),
            kind=content.kind,
            to=content.to_email,
        )
        return False

    log.info(
        "email.activity.sent",
        kind=content.kind,
        to=content.to_email,
    )
    return True


# --- Content reports (moderation) ----------------------------------------


@dataclass(frozen=True)
class ContentReportEmailContent:
    """A reader flagged a post; everything a moderator needs to act on it."""

    to_emails: tuple[str, ...]
    reporter_name: str
    reporter_email: str | None
    author_name: str
    author_email: str | None
    reason: str | None
    headline: str | None
    article_url: str | None
    take: str | None
    shared_text: str | None
    post_url: str


def _report_subject(content: ContentReportEmailContent) -> str:
    subject: str = f"Content report: post by {content.author_name}"
    if content.headline:
        return f"{subject} — {content.headline[:80]}"
    return subject


def _report_fields(content: ContentReportEmailContent) -> list[tuple[str, str]]:
    """Label/value pairs shared by the HTML and plain-text bodies."""
    reporter: str = content.reporter_name
    if content.reporter_email:
        reporter = f"{reporter} <{content.reporter_email}>"
    author: str = content.author_name
    if content.author_email:
        author = f"{author} <{content.author_email}>"
    fields: list[tuple[str, str]] = [
        ("Reported by", reporter),
        ("Post author", author),
        ("Reason", content.reason or "(none given)"),
    ]
    if content.headline:
        fields.append(("Article", content.headline))
    if content.article_url:
        fields.append(("Article URL", content.article_url))
    if content.take:
        fields.append(("Their take", content.take))
    if content.shared_text:
        fields.append(("Shared text", content.shared_text))
    return fields


def _report_plain(content: ContentReportEmailContent) -> str:
    lines: list[str] = ["A post was reported for a content violation.", ""]
    for label, value in _report_fields(content):
        lines.append(f"{label}: {value}")
    lines.extend(["", f"Open the post: {content.post_url}"])
    return "\n".join(lines)


def _report_html(content: ContentReportEmailContent) -> str:
    body_style: str = (
        "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;"
        "font-size:14px;line-height:1.5;color:#18181b;"
    )
    rows: list[str] = []
    for label, value in _report_fields(content):
        rows.append(
            f'<p style="{body_style}margin:0 0 10px;">'
            f'<strong style="color:#71717a;">{html.escape(label)}:</strong> '
            f"{html.escape(value)}</p>"
        )
    url: str = html.escape(content.post_url, quote=True)
    rows.append(
        f'<p style="margin:24px 0 8px;">'
        f'<a href="{url}" style="display:inline-block;background:#18181b;'
        f"color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,"
        f"sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;"
        f'text-transform:uppercase;text-decoration:none;padding:12px 20px;'
        f'border-radius:4px;">Open the post</a></p>'
        f'<p style="{_FOOTER_TEXT_STYLE}margin:16px 0 0;">'
        f'Or open this link: <a href="{url}" style="color:#71717a;">{url}</a></p>'
    )
    return (
        '<div style="max-width:520px;margin:0 auto;padding:24px 16px;">'
        f'<p style="{body_style}margin:0 0 16px;font-weight:600;">'
        "A post was reported for a content violation.</p>"
        + "".join(rows)
        + "</div>"
    )


async def send_content_report_email(
    content: ContentReportEmailContent,
    *,
    settings: Settings | None = None,
) -> bool:
    """Email moderators about a reported post. Returns True on success.

    No-ops (returns False) with no recipients or no ``resend_api_key``. These
    are operational mails to admins rather than subscriptions, so they carry
    no unsubscribe footer.
    """
    cfg: Settings = settings or get_settings()
    if not content.to_emails:
        log.warning("email.content_report.skip", reason="no_recipients")
        return False
    if not cfg.resend_api_key:
        log.info("email.content_report.skip", reason="no_resend_api_key")
        return False

    payload: dict[str, object] = {
        "from": cfg.email_from,
        "to": list(content.to_emails),
        "subject": _report_subject(content),
        "html": _report_html(content),
        "text": _report_plain(content),
    }
    if content.reporter_email:
        payload["reply_to"] = content.reporter_email
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
        log.warning("email.content_report.failed", error=str(exc))
        return False

    log.info("email.content_report.sent", recipients=len(content.to_emails))
    return True


# --- Invite reach (your link was opened, nobody joined) -------------------


@dataclass(frozen=True)
class InviteReachEmailContent:
    """Told to the inviter when a share link reached someone who didn't join."""

    to_email: str
    recipient_first: str | None
    #: Opens, not people. One person opening a link three times counts three
    #: times, so the copy must never say "people".
    open_count: int
    link_count: int
    headline: str | None
    action_url: str
    unsubscribe_url: str
    #: Matches where ``action_url`` actually goes — a standalone invite has no
    #: conversation to send anyone back to.
    cta_label: str = "See the conversation"


def _reach_times(open_count: int) -> str:
    """" 3 times", or nothing at all for a single open."""
    return "" if open_count <= 1 else f" {open_count} times"


def _reach_subject(content: InviteReachEmailContent) -> str:
    subject: str = (
        "Your invite links were" if content.link_count > 1 else "Your invite link was"
    )
    return f"{subject} opened{_reach_times(content.open_count)} — nobody joined yet"


def _reach_lead(content: InviteReachEmailContent) -> str:
    """One sentence stating exactly what was observed, and nothing more.

    The link is the subject of the sentence, never a person: the counter
    records opens, so one person clicking twice is indistinguishable from two
    people, and "someone" would be a claim the data cannot support.
    """
    times: str = _reach_times(content.open_count)
    if content.link_count > 1:
        return (
            f"Your {content.link_count} invite links were opened{times} between "
            f"them, but nobody has joined yet."
        )
    what: str = (
        f"Your link to “{content.headline}”"
        if content.headline
        else "Your invite link"
    )
    return f"{what} was opened{times}, but nobody has joined yet."


_REACH_NUDGE = (
    "Links get lost in a thread. A quick follow-up where you sent it tends "
    "to work better than another invite."
)


def _reach_plain(content: InviteReachEmailContent) -> str:
    greeting: str = f"Hi {content.recipient_first},\n\n" if content.recipient_first else ""
    footer: str = _footer_text(unsubscribe_url=content.unsubscribe_url)
    return (
        f"{greeting}{_reach_lead(content)}\n\n{_REACH_NUDGE}\n\n"
        f"{content.cta_label}: {content.action_url}\n\n{footer}\n"
    )


def _reach_html(content: InviteReachEmailContent) -> str:
    url: str = html.escape(content.action_url, quote=True)
    greeting: str = ""
    if content.recipient_first:
        greeting = (
            f'<p style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
            f'sans-serif;font-size:14px;color:#52525b;margin:0 0 12px;">'
            f"Hi {html.escape(content.recipient_first)},</p>"
        )
    return (
        '<div style="max-width:520px;margin:0 auto;padding:24px 16px;">'
        f"{greeting}"
        f'<p style="font-family:Georgia,serif;font-size:18px;line-height:1.5;'
        f'color:#18181b;margin:0 0 12px;">{html.escape(_reach_lead(content))}</p>'
        f'<p style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
        f'sans-serif;font-size:14px;line-height:1.6;color:#52525b;'
        f'margin:0 0 20px;">{html.escape(_REACH_NUDGE)}</p>'
        f'<p style="margin:24px 0 8px;">'
        f'<a href="{url}" style="display:inline-block;background:#18181b;'
        f'color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
        f'sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;'
        f'text-transform:uppercase;text-decoration:none;padding:12px 20px;'
        f'border-radius:4px;">{html.escape(content.cta_label)}</a></p>'
        + _footer_html(
            action_url=content.action_url,
            unsubscribe_url=content.unsubscribe_url,
        )
        + "</div>"
    )


async def send_invite_reach_email(
    content: InviteReachEmailContent,
    *,
    settings: Settings | None = None,
) -> bool:
    """Tell an inviter their share link was opened but converted nobody."""
    cfg: Settings = settings or get_settings()
    if not cfg.resend_api_key:
        log.info(
            "email.invite_reach.skip",
            reason="no_resend_api_key",
            to=content.to_email,
        )
        return False

    payload: dict[str, object] = {
        "from": cfg.email_from,
        "to": [content.to_email],
        "subject": _reach_subject(content),
        "html": _reach_html(content),
        "text": _reach_plain(content),
        "headers": _unsubscribe_headers(content.unsubscribe_url),
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
            "email.invite_reach.failed", error=str(exc), to=content.to_email
        )
        return False

    log.info(
        "email.invite_reach.sent",
        to=content.to_email,
        opens=content.open_count,
        links=content.link_count,
    )
    return True
