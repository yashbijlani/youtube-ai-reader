"""Subtitle parsing and normalisation tests."""

from __future__ import annotations

import json

from app.services.subtitles import (
    normalize_segments,
    parse_json3,
    parse_subtitle_content,
    parse_ttml,
    parse_vtt,
)

ROLLING_VTT = """WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.000
hello world

00:00:02.000 --> 00:00:04.000
hello world how are you

00:00:04.000 --> 00:00:06.000
how are you today
"""


def test_parse_vtt_basic() -> None:
    segments = parse_vtt(ROLLING_VTT)
    assert len(segments) == 3
    assert segments[0].start == 0.0
    assert segments[0].end == 2.0
    assert segments[2].text == "how are you today"


def test_normalize_removes_rolling_duplicates() -> None:
    normalized = normalize_segments(parse_vtt(ROLLING_VTT))
    texts = [s.text for s in normalized]
    assert texts == ["hello world how are you", "how are you today"]
    assert normalized[0].start == 0.0
    assert normalized[0].end == 4.0


def test_normalize_strips_sound_tags_and_keeps_content() -> None:
    segments = normalize_segments(
        [
            type(parse_vtt(ROLLING_VTT)[0])(start=0, end=1, text="[Music]"),
            type(parse_vtt(ROLLING_VTT)[0])(start=1, end=3, text=" real content here "),
        ]
    )
    assert [s.text for s in segments] == ["real content here"]


def test_normalize_handles_bad_timing() -> None:
    segments = normalize_segments(
        [
            type(parse_vtt(ROLLING_VTT)[0])(start=5, end=2, text="bad timing"),
            type(parse_vtt(ROLLING_VTT)[0])(start=3, end=4, text="earlier"),
        ]
    )
    assert [s.text for s in segments] == ["earlier", "bad timing"]
    assert segments[1].end > segments[1].start


def test_parse_json3_cue_level() -> None:
    data = {
        "events": [
            {"tStartMs": 0, "dDurationMs": 1500, "segs": [{"utf8": "First line"}]},
            {"tStartMs": 1500, "dDurationMs": 2000, "segs": [{"utf8": "Second line"}]},
        ]
    }
    segments = parse_json3(json.dumps(data))
    assert [s.text for s in segments] == ["First line", "Second line"]
    assert segments[1].start == 1.5


def test_parse_json3_word_level_groups_into_phrases() -> None:
    events = []
    for i, word in enumerate(
        "this is a longer auto caption that should be grouped into phrases for the reader".split()
    ):
        events.append(
            {
                "tStartMs": i * 300,
                "dDurationMs": 280,
                "segs": [{"utf8": word + " "}],
            }
        )
    segments = parse_json3(json.dumps({"events": events}))
    assert len(segments) < 19
    assert all(len(s.text.split()) <= 11 for s in segments)
    assert segments[0].text.startswith("this")


def test_parse_subtitle_content_sniffs_xml() -> None:
    ttml = """<?xml version="1.0"?>
<tt><body><div>
<p begin="00:00:01.000" end="00:00:03.000">Hello <span>there</span></p>
<p begin="00:00:03.000" d="2.5">General Kenobi</p>
</div></body></tt>"""
    segments = parse_subtitle_content(ttml, ".ttml")
    assert [s.text for s in segments] == ["Hello there", "General Kenobi"]
    assert segments[0].start == 1.0 and segments[0].end == 3.0
    assert segments[1].end == 5.5


def test_parse_ttml_srv3() -> None:
    srv3 = '<transcript><text start="1.5" dur="2.0">Hello there</text></transcript>'
    segments = parse_ttml(srv3)
    assert segments[0].start == 1.5
    assert segments[0].end == 3.5


def test_parse_vtt_with_html_entities_and_tags() -> None:
    vtt = """WEBVTT

00:00:01.000 --> 00:00:02.000
<c.colorE5E5E5>It&apos;s &amp; that&apos;s</c>
"""
    normalized = normalize_segments(parse_vtt(vtt))
    assert normalized[0].text == "It's & that's"
