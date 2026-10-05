"""Logging configuration tests."""

from __future__ import annotations

import logging

from app.logging_conf import configure_logging


def test_uvicorn_access_log_is_quieted() -> None:
    configure_logging("INFO")
    assert logging.getLogger("uvicorn.access").level >= logging.WARNING
    assert logging.getLogger("httpx").level >= logging.WARNING
