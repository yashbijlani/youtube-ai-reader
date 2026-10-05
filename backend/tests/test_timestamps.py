"""Timestamp helper tests."""

from __future__ import annotations

import pytest

from app.utils.timestamps import format_timestamp, parse_timestamp


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [
        (0, "0:00"),
        (5, "0:05"),
        (65, "1:05"),
        (1052, "17:32"),
        (3600, "1:00:00"),
        (3725, "1:02:05"),
        (None, ""),
        (-4, "0:00"),
    ],
)
def test_format_timestamp(seconds, expected) -> None:
    assert format_timestamp(seconds) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("17:32", 1052.0),
        ("1:02:05", 3725.0),
        ("[17:32]", 1052.0),
        ("1052", 1052.0),
        ("0:07.5", 7.5),
        ("", None),
        ("not a time", None),
        (None, None),
    ],
)
def test_parse_timestamp(value, expected) -> None:
    assert parse_timestamp(value) == expected
