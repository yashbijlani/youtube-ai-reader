"""Text helpers: tokenization and transcript cleanup."""

from __future__ import annotations

import html
import re
import unicodedata

_WHITESPACE_RE = re.compile(r"\s+")
_TAG_RE = re.compile(r"<[^>]+>")
_SOUND_TAG_RE = re.compile(r"^[\[(](?:music|applause|laughter|silence|inaudible|foreign|sound|cheering|no audio)[^\])]*[\])]$", re.I)
_WORD_RE = re.compile(r"[a-z0-9']+")

_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "then", "than", "so", "because",
    "of", "to", "in", "on", "at", "by", "for", "with", "about", "against", "between",
    "into", "through", "during", "before", "after", "above", "below", "from", "up",
    "down", "out", "off", "over", "under", "again", "further", "once", "here",
    "there", "when", "where", "why", "how", "all", "any", "both", "each", "few",
    "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own",
    "same", "too", "very", "can", "will", "just", "should", "now", "is", "are",
    "was", "were", "be", "been", "being", "have", "has", "had", "having", "do",
    "does", "did", "doing", "would", "could", "ought", "i", "you", "he", "she",
    "it", "we", "they", "them", "his", "her", "its", "our", "their", "this",
    "that", "these", "those", "what", "which", "who", "whom", "me", "my", "your",
    "as", "am", "s", "t", "don", "didn", "doesn", "isn", "aren", "wasn", "weren",
    "won", "wouldn", "couldn", "shouldn", "ve", "ll", "re", "m", "d",
}

_ABBREV_RE = re.compile(r"\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e)\.", re.I)


def clean_text(raw: str) -> str:
    """Normalise a subtitle line into plain readable text."""
    if not raw:
        return ""
    text = html.unescape(raw)
    text = _TAG_RE.sub(" ", text)
    text = text.replace("\u200b", "").replace("\ufeff", "")
    text = unicodedata.normalize("NFKC", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return text


def strip_sound_tags(text: str) -> str:
    return _SOUND_TAG_RE.sub("", text).strip()


def sentence_split(text: str) -> list[str]:
    """Cheap sentence splitter that survives common abbreviations."""
    protected = _ABBREV_RE.sub(lambda m: m.group(0).replace(".", "\u2024"), text)
    parts = re.split(r"(?<=[.!?])\s+", protected)
    return [p.replace("\u2024", ".").strip() for p in parts if p.strip()]


def tokenize(text: str, *, keep_stopwords: bool = False) -> list[str]:
    tokens = _WORD_RE.findall(text.lower())
    if keep_stopwords:
        return tokens
    return [t for t in tokens if t not in _STOPWORDS and len(t) > 1]


def truncate(text: str, max_chars: int, suffix: str = " …") -> str:
    if len(text) <= max_chars:
        return text
    cut = text[: max_chars + 1]
    if " " in cut:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip() + suffix


def approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)
