"""Funnel rows must never imply a denominator they weren't measured against."""

from __future__ import annotations

from api.routers.admin import _stage


def test_first_stage_has_no_rate() -> None:
    """Nothing converts into the top of a funnel."""
    stage = _stage("created", "Links created", 25, None)

    assert stage.rate is None
    assert stage.rate_of is None


def test_rate_names_the_stage_it_is_measured_against() -> None:
    """The base is passed explicitly, not assumed to be the row above.

    "Posted or commented" and "came back" are both shares of the accounts
    created rather than of each other, so a report that labels every rate
    "from above" states the wrong denominator.
    """
    stage = _stage("active", "Posted or commented", 4, ("accounts created", 5))

    assert stage.rate == 0.8
    assert stage.rate_of == "accounts created"


def test_zero_base_yields_no_rate_rather_than_a_division_error() -> None:
    stage = _stage("joined", "Created an account", 5, ("link opens", 0))

    assert stage.rate is None
    assert stage.rate_of is None


def test_rate_and_its_label_are_always_set_together() -> None:
    """A percentage with no stated base is exactly the bug this guards."""
    for base in (None, ("link opens", 0), ("link opens", 4)):
        stage = _stage("joined", "Created an account", 2, base)
        assert (stage.rate is None) == (stage.rate_of is None)
