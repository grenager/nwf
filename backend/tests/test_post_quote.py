"""The optional pull-quote a post can carry in place of the og:description."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from api.schemas import QUOTE_MAX_LENGTH, PostCreate, PostOut, PostUpdate
from core.models import Post, PostVisibility


def test_quote_is_optional_on_create() -> None:
    payload = PostCreate(url="https://example.com/a", take="worth reading")
    assert payload.quote is None


def test_create_accepts_a_quote_at_the_limit() -> None:
    quote = "q" * QUOTE_MAX_LENGTH
    payload = PostCreate(url="https://example.com/a", quote=quote)
    assert payload.quote == quote


def test_create_rejects_an_over_long_quote() -> None:
    with pytest.raises(ValidationError):
        PostCreate(url="https://example.com/a", quote="q" * (QUOTE_MAX_LENGTH + 1))


def test_update_rejects_an_over_long_quote() -> None:
    with pytest.raises(ValidationError):
        PostUpdate(quote="q" * (QUOTE_MAX_LENGTH + 1))


def test_update_omitting_quote_leaves_it_untouched() -> None:
    """``update_post`` only writes fields present in ``model_fields_set``."""
    payload = PostUpdate(take="new take")
    assert "quote" not in payload.model_fields_set


def test_update_with_explicit_null_clears_the_quote() -> None:
    payload = PostUpdate.model_validate({"quote": None})
    assert "quote" in payload.model_fields_set
    assert payload.quote is None


def test_post_model_carries_a_quote() -> None:
    now = datetime.now(UTC)
    post = Post(
        id=uuid.uuid4(),
        story_id=uuid.uuid4(),
        author_id=uuid.uuid4(),
        take="hello",
        shared_text=None,
        quote="the line that made me share it",
        visibility=PostVisibility.private,
        last_activity_at=now,
        created_at=now,
        updated_at=now,
    )
    assert post.quote == "the line that made me share it"


def test_post_out_defaults_quote_to_none() -> None:
    """Existing posts (and the feed's teaser build) omit it without breaking."""
    out = PostOut(
        id=uuid.uuid4(),
        story_id=uuid.uuid4(),
        author_id=uuid.uuid4(),
        visibility=PostVisibility.private,
        last_activity_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    assert out.quote is None
