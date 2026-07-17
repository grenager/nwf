"""Human-readable phrasing for digest email lines."""

from __future__ import annotations


def first_name(first: str | None, *, fallback: str = "Someone") -> str:
    """Prefer first name for digest copy; fall back when missing."""
    trimmed: str = (first or "").strip()
    return trimmed if trimmed else fallback


def name_list(names: list[str], *, max_named: int = 2) -> str:
    """Format actor names: 'Teg', 'Teg and Jim', or 'Teg, Jim, and 4 others'."""
    cleaned: list[str] = [n.strip() for n in names if n.strip()]
    if not cleaned:
        return "Someone"
    unique: list[str] = list(dict.fromkeys(cleaned))
    if len(unique) == 1:
        return unique[0]
    if len(unique) == 2:
        return f"{unique[0]} and {unique[1]}"
    if len(unique) <= max_named:
        return f"{', '.join(unique[:-1])}, and {unique[-1]}"
    named: list[str] = unique[:max_named]
    others: int = len(unique) - max_named
    return f"{', '.join(named)}, and {others} other{'s' if others != 1 else ''}"


def phrase_friend_post(
    author: str,
    *,
    friend_comment_count: int = 0,
    friend_reaction_count: int = 0,
) -> str:
    """e.g. 'Teg posted an article and 2 friends commented'."""
    bits: list[str] = [f"{author} posted an article"]
    extras: list[str] = []
    if friend_comment_count > 0:
        extras.append(
            f"{friend_comment_count} friend{'s' if friend_comment_count != 1 else ''} "
            f"commented"
        )
    if friend_reaction_count > 0:
        extras.append(
            f"{friend_reaction_count} friend{'s' if friend_reaction_count != 1 else ''} "
            f"reacted"
        )
    if extras:
        return f"{bits[0]} and {' and '.join(extras)}"
    return bits[0]


def phrase_comments_on_your_post(names: list[str]) -> str:
    """e.g. 'Teg, Jim, and 4 others commented on your post'."""
    subject: str = name_list(names)
    return f"{subject} commented on your post"


def phrase_reply_to_comment(names: list[str]) -> str:
    """e.g. 'Shalom responded to your comment'."""
    subject: str = name_list(names)
    if len(set(names)) == 1:
        return f"{subject} responded to your comment"
    return f"{subject} responded to your comments"


def phrase_reactions_on_your_post(count: int, *, names: list[str] | None = None) -> str:
    """e.g. '5 friends reacted to your post' or 'Teg reacted to your post'."""
    if names:
        unique: list[str] = list(dict.fromkeys(n for n in names if n.strip()))
        if 1 <= len(unique) <= 2:
            return f"{name_list(unique)} reacted to your post"
    if count == 1:
        return "1 friend reacted to your post"
    return f"{count} friends reacted to your post"
