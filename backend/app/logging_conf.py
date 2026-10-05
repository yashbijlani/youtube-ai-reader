"""Logging setup with compact, greppable tags."""

from __future__ import annotations

import logging
import sys


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if root.handlers:
        for h in list(root.handlers):
            root.removeHandler(h)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)-7s %(name)s %(message)s",
            datefmt="%H:%M:%S",
        )
    )
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    # The app logs its own access lines (and hides state polls at DEBUG), so
    # uvicorn's duplicate per-request access log is turned down.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def tag_logger(tag: str) -> logging.LoggerAdapter:
    return logging.LoggerAdapter(logging.getLogger("youtube_ai_reader"), {"tag": tag})


def log(logger: logging.LoggerAdapter, message: str, *args: object) -> None:
    logger.info(f"[{logger.extra['tag']}] {message}", *args)
