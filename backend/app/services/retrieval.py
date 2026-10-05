"""Lexical retrieval over transcript chunks (BM25).

Deliberately dependency-free and swappable: the ``ChunkIndex`` interface is the
seam where a vector store / embedding retriever can be added later without
touching the chat pipeline.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.models.schemas import TranscriptChunk
from app.utils.text import tokenize


@dataclass
class ScoredChunk:
    chunk: TranscriptChunk
    score: float


class ChunkIndex:
    """In-memory BM25 index built once per processed video."""

    def __init__(self, chunks: list[TranscriptChunk], k1: float = 1.5, b: float = 0.75) -> None:
        self.chunks = chunks
        self.k1 = k1
        self.b = b
        self._doc_tokens: list[list[str]] = [tokenize(c.text) for c in chunks]
        self._df: dict[str, int] = {}
        for tokens in self._doc_tokens:
            for token in set(tokens):
                self._df[token] = self._df.get(token, 0) + 1
        self._avgdl = (
            sum(len(t) for t in self._doc_tokens) / len(self._doc_tokens)
            if self._doc_tokens
            else 0.0
        )

    def search(self, query: str, top_k: int = 6) -> list[ScoredChunk]:
        query_tokens = tokenize(query)
        if not query_tokens or not self.chunks:
            return []

        n = len(self.chunks)
        scores: list[tuple[int, float]] = []
        q_counts: dict[str, int] = {}
        for token in query_tokens:
            q_counts[token] = q_counts.get(token, 0) + 1

        for idx, tokens in enumerate(self._doc_tokens):
            if not tokens:
                continue
            tf: dict[str, int] = {}
            for token in tokens:
                tf[token] = tf.get(token, 0) + 1
            score = 0.0
            for token, qtf in q_counts.items():
                freq = tf.get(token)
                if not freq:
                    continue
                df = self._df.get(token, 0)
                idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
                denom = freq + self.k1 * (1 - self.b + self.b * len(tokens) / (self._avgdl or 1))
                score += idf * (freq * (self.k1 + 1)) / denom * (1 + 0.1 * (qtf - 1))
            if score > 0:
                scores.append((idx, score))

        scores.sort(key=lambda item: item[1], reverse=True)
        return [ScoredChunk(chunk=self.chunks[i], score=s) for i, s in scores[:top_k]]

    def retrieve_context(
        self,
        query: str,
        *,
        top_k: int = 6,
        max_chars: int = 12_000,
        current_time: float | None = None,
        neighbor_expansion: bool = True,
    ) -> tuple[str, list[TranscriptChunk]]:
        """Return prompt-ready context text plus the chunks that were used.

        Only relevant chunks are sent to the model. When a query has no useful
        lexical overlap (e.g. "what is this about?"), fall back to chunks near
        the current playback position or a spread across the video.
        """
        hits = self.search(query, top_k=top_k)
        selected: list[TranscriptChunk] = []
        seen: set[int] = set()

        def add(chunk: TranscriptChunk) -> None:
            if chunk.index not in seen:
                seen.add(chunk.index)
                selected.append(chunk)

        if hits:
            for hit in hits:
                add(hit.chunk)
                if neighbor_expansion:
                    for offset in (1, -1):
                        neighbor = hit.chunk.index + offset
                        if 0 <= neighbor < len(self.chunks):
                            add(self.chunks[neighbor])
        else:
            for chunk in self._fallback_chunks(current_time, top_k):
                add(chunk)

        selected.sort(key=lambda c: c.index)
        trimmed: list[TranscriptChunk] = []
        used = 0
        for chunk in selected:
            cost = len(chunk.text) + 16
            if trimmed and used + cost > max_chars:
                continue
            trimmed.append(chunk)
            used += cost
            if used >= max_chars:
                break

        lines = [f"[{_cluster_stamp(c)}] {c.text}" for c in trimmed]
        return "\n\n".join(lines), trimmed

    def _fallback_chunks(self, current_time: float | None, top_k: int) -> list[TranscriptChunk]:
        if not self.chunks:
            return []
        if current_time is not None:
            nearest = min(
                self.chunks, key=lambda c: abs(c.start - current_time)  # type: ignore[arg-type]
            )
            start = max(0, nearest.index - top_k // 2)
            return self.chunks[start : start + top_k]
        if len(self.chunks) <= top_k:
            return list(self.chunks)
        step = max(1, len(self.chunks) // top_k)
        return [self.chunks[min(i * step, len(self.chunks) - 1)] for i in range(top_k)]


def _cluster_stamp(chunk: TranscriptChunk) -> str:
    from app.utils.timestamps import format_timestamp

    return format_timestamp(chunk.start)
