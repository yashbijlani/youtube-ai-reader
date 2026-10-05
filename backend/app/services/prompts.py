"""Dedicated prompt builders — one per task, never one giant prompt."""

from __future__ import annotations

from app.models.schemas import VideoMeta

BASE_SYSTEM = (
    "You are YouTube AI Reader, an expert reading companion for video content. "
    "You turn spoken transcripts into clear, faithful, readable explanations. "
    "You only use the transcript context provided to you. "
    "Never invent facts, quotes, or timestamps that are not in the context. "
    "When you reference a moment, cite its transcript timestamp exactly as shown "
    "in the context, e.g. [17:32]. If the transcript does not contain an answer, "
    "say so plainly instead of guessing. Preserve nuance and intellectual depth: "
    "do not flatten complex talks into generic summaries."
)


def _video_header(meta: VideoMeta | None) -> str:
    if not meta:
        return ""
    bits = [f'Title: "{meta.title}"']
    if meta.channel:
        bits.append(f"Channel: {meta.channel}")
    if meta.duration:
        minutes = int(meta.duration // 60)
        bits.append(f"Duration: {minutes} minutes")
    return "\n".join(bits)


def overview_prompt(meta: VideoMeta | None, context: str, key_point_count: int = 7) -> list[dict[str, str]]:
    system = (
        BASE_SYSTEM
        + " You produce a structured reading guide as strict JSON. "
        "Respond with JSON only — no markdown fences, no commentary. "
        'Schema: {"overview": string, "key_points": [{"title": string, '
        '"explanation": string, "start_seconds": number}]}. '
        "overview is one dense paragraph (4-7 sentences) describing what the video "
        "is fundamentally about and why it matters. "
        f"key_points contains {key_point_count} (or fewer for short videos) of the most "
        "important ideas, each with a short title, a 1-3 sentence explanation that "
        "captures the actual reasoning and specifics, and start_seconds copied from a "
        "timestamp in the context (numbers only, no parentheses)."
    )
    user = (
        f"{_video_header(meta)}\n\n"
        f"<context>\n{context}\n</context>\n\n"
        "Produce the overview and key points JSON now."
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def chapters_prompt(
    meta: VideoMeta | None,
    context: str,
    duration: float | None,
    min_chapters: int = 4,
    max_chapters: int = 12,
) -> list[dict[str, str]]:
    duration_hint = ""
    if duration:
        duration_hint = (
            f"The video is about {int(duration // 60)} minutes long. "
            f"Produce between {min_chapters} and {max_chapters} chapters that cover the whole video."
        )
    system = (
        BASE_SYSTEM
        + " You segment a video transcript into meaningful chapters as strict JSON. "
        "Respond with JSON only — no markdown fences. "
        'Schema: {"chapters": [{"title": string, "description": string, '
        '"start_seconds": number, "end_seconds": number}]}. '
        "Chapters must be ordered, non-overlapping, and use timestamps that appear in "
        "the context. Titles are short and specific (never 'Introduction' unless it "
        "truly is). Descriptions are one sentence about what actually happens."
    )
    user = (
        f"{_video_header(meta)}\n{duration_hint}\n\n"
        f"<context>\n{context}\n</context>\n\n"
        "Produce the chapters JSON now."
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def reading_prompt(
    meta: VideoMeta | None,
    context: str,
    section_label: str | None = None,
    target_words: int = 900,
    outline: str | None = None,
) -> list[dict[str, str]]:
    system = (
        BASE_SYSTEM
        + " You rewrite the spoken content into a coherent, article-like reading "
        "experience in markdown. Write flowing prose with short section headings "
        "where the topic shifts. Weave in timestamps in square brackets, e.g. [17:32], "
        "at moments the reader may want to jump to — but only timestamps that appear "
        "in the context. Explain arguments in the speaker's own terms, include concrete "
        "examples, names, and numbers, and keep the speaker's attitude and nuance. "
        "Do not use bullet-point spam, do not write a meta-summary, and do not address "
        "the reader as 'you'. Begin directly with the content."
    )
    section_hint = f" This is section: {section_label}." if section_label else ""
    outline_block = ""
    if outline:
        outline_block = (
            "\n\n<whole_video_outline>\n"
            f"{outline}\n"
            "</whole_video_outline>\n"
            "Use this outline only to keep the section connected to the whole video; "
            "do not repeat it or summarize it."
        )
    user = (
        f"{_video_header(meta)}\n{section_hint}{outline_block}\n\n"
        f"<transcript>\n{context}\n</transcript>\n\n"
        f"Write roughly {target_words} words of readable article prose now."
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def summary_prompt(meta: VideoMeta | None, transcript_context: str) -> list[dict[str, str]]:
    """Fast, streamable summary used by the chat-first 'Summarize this video' action."""
    system = (
        BASE_SYSTEM
        + " The viewer asked for a summary before the full reading guide finished. "
        "Write a compact, high-signal summary in markdown: two or three sentences on "
        "what the video is about, then 4-7 bullet points covering the main ideas, "
        "each ending with an inline [mm:ss] timestamp copied from the context. "
        "Keep it under 350 words, be concrete, and never invent timestamps."
    )
    user = (
        f"{_video_header(meta)}\n\n"
        f"<transcript>\n{transcript_context}\n</transcript>\n\n"
        "Summarize the video now."
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def chat_prompt(
    meta: VideoMeta | None,
    summary_context: str,
    transcript_context: str,
    current_time: float | None,
    streaming: bool,
) -> list[dict[str, str]]:
    from app.utils.timestamps import format_timestamp

    current_hint = ""
    if current_time is not None:
        current_hint = (
            f"\nThe viewer's current playback position is {format_timestamp(current_time)}. "
            "If their question refers to 'this part', use that position."
        )
    if streaming:
        output_rules = (
            "Answer in markdown. Cite moments inline as [mm:ss] or [h:mm:ss] using only "
            "timestamps present in the context. Ground every claim in the transcript. "
            "If the transcript does not answer the question, say so."
        )
    else:
        output_rules = (
            "Respond with strict JSON only — no markdown fences. "
            'Schema: {"answer": string, "citations": [{"start_seconds": number, "quote": string}]}. '
            "The answer is markdown with inline [mm:ss] timestamp citations copied from the "
            "context. citations lists the 1-4 passages the answer relies on, with the exact "
            "timestamp and a short verbatim quote (max 20 words). If the transcript does not "
            "answer the question, set answer accordingly and leave citations empty."
        )
    system = (
        BASE_SYSTEM
        + " You answer viewer questions about this specific video."
        + current_hint
        + "\n\n"
        + output_rules
    )
    user = (
        f"{_video_header(meta)}\n\n"
        f"<video_summary>\n{summary_context}\n</video_summary>\n\n"
        f"<relevant_transcript>\n{transcript_context}\n</relevant_transcript>"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
