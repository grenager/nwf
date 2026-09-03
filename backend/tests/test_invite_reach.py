"""Copy and guardrails for the "your link was opened, nobody joined" note.

The query itself is exercised against a real Postgres (it turns on SQL
semantics -- a NOT EXISTS correlated subquery, NULL handling on
``invitee_email`` -- that mocks would only pretend to reproduce). What is
guarded here is the arithmetic and the wording, which is where this email can
quietly start telling the inviter something untrue.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from core.email import (
    InviteReachEmailContent,
    _reach_lead,
    _reach_subject,
)
from core.invite_reach import mark_reach_notified


def _content(**kwargs: object) -> InviteReachEmailContent:
    base: dict[str, object] = {
        "to_email": "inviter@example.com",
        "recipient_first": "Ada",
        "open_count": 1,
        "link_count": 1,
        "headline": None,
        "action_url": "https://nwf.example/friends",
        "unsubscribe_url": "https://nwf.example/unsubscribe/u",
    }
    base.update(kwargs)
    return InviteReachEmailContent(**base)  # type: ignore[arg-type]


def test_one_open_is_not_counted_out_loud() -> None:
    """"opened 1 times" and "opened once" both read badly; say neither."""
    content = _content(open_count=1)
    assert _reach_subject(content) == (
        "Your invite link was opened — nobody joined yet"
    )
    assert _reach_lead(content) == (
        "Your invite link was opened, but nobody has joined yet."
    )


def test_repeat_opens_are_counted() -> None:
    content = _content(open_count=3)
    assert "opened 3 times" in _reach_subject(content)
    assert "was opened 3 times, but nobody has joined yet." in _reach_lead(content)


def test_headline_names_the_article() -> None:
    content = _content(headline="Quiet week in AI", open_count=2)
    assert _reach_lead(content).startswith("Your link to “Quiet week in AI”")


def test_several_links_are_summarised_together() -> None:
    content = _content(link_count=3, open_count=7)
    assert _reach_subject(content).startswith("Your invite links were opened 7 times")
    assert _reach_lead(content) == (
        "Your 3 invite links were opened 7 times between them, but nobody has "
        "joined yet."
    )


@pytest.mark.parametrize(
    "kwargs",
    [
        {"open_count": 1, "link_count": 1},
        {"open_count": 5, "link_count": 1, "headline": "Quiet week in AI"},
        {"open_count": 9, "link_count": 4},
    ],
)
def test_the_copy_never_claims_to_know_how_many_people(
    kwargs: dict[str, object],
) -> None:
    """The counter records opens, not visitors.

    One person opening a link three times is indistinguishable from three
    people, so any wording that implies a headcount -- "3 people", or even
    "someone", which asserts exactly one -- would be a claim the data cannot
    support.
    """
    text: str = f"{_reach_subject(_content(**kwargs))} {_reach_lead(_content(**kwargs))}"
    lowered: str = text.lower()
    for forbidden in ("people", "person", "someone", "somebody", "reader"):
        assert forbidden not in lowered, f"{forbidden!r} in {text!r}"


def test_the_cta_matches_where_the_link_goes() -> None:
    """A standalone invite has no conversation to send anyone back to."""
    from core.email import _reach_plain

    standalone = _content(
        action_url="https://nwf.example/friends", cta_label="See your friends"
    )
    assert "See your friends: https://nwf.example/friends" in _reach_plain(standalone)


@pytest.mark.asyncio
async def test_marking_nothing_touches_nothing() -> None:
    """An empty send must not issue a blanket UPDATE."""
    session = AsyncMock()
    await mark_reach_notified(session, [])
    session.execute.assert_not_called()


@pytest.mark.asyncio
async def test_marking_stamps_the_links_that_were_reported() -> None:
    session = AsyncMock()
    ids = [uuid.uuid4(), uuid.uuid4()]
    await mark_reach_notified(session, ids)
    session.execute.assert_awaited_once()
