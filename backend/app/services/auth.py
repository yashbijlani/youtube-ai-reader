"""Supabase Auth JWT verification.

The backend is the only place that verifies identity. A client-supplied
``X-Install-Id`` is a device label, never a security boundary.

Supported token verification:
* HS256 with ``SUPABASE_JWT_SECRET`` (legacy shared secret), or
* asymmetric RS256/ES256 via the project JWKS endpoint.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

from app.config import Settings
from app.errors import Unauthorized

logger = logging.getLogger("youtube_ai_reader.auth")

_SUPPORTED_ALGS = ("HS256", "RS256", "ES256")


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str | None = None
    role: str = "authenticated"


class SupabaseAuth:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._jwks_client: PyJWKClient | None = None

    @property
    def configured(self) -> bool:
        return bool(self.settings.supabase_jwt_secret or self.settings.supabase_url)

    def _jwks(self) -> PyJWKClient:
        if self._jwks_client is None:
            url = self.settings.supabase_jwks_url or (
                f"{self.settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
            )
            self._jwks_client = PyJWKClient(url, cache_keys=True, lifespan=300)
        return self._jwks_client

    def _decode_sync(self, token: str) -> dict:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg")
        if alg not in _SUPPORTED_ALGS:
            raise Unauthorized("Unsupported token algorithm.")
        options = {"verify_aud": True, "audience": "authenticated"}
        if alg == "HS256":
            secret = self.settings.supabase_jwt_secret
            if not secret:
                raise Unauthorized("Token signing secret is not configured.")
            return jwt.decode(token, secret, algorithms=["HS256"], **options)
        signing_key = self._jwks().get_signing_key_from_jwt(token)
        return jwt.decode(token, signing_key.key, algorithms=[alg], **options)

    async def verify(self, token: str) -> AuthUser:
        if not token:
            raise Unauthorized("Missing bearer token.")
        try:
            claims = await asyncio.to_thread(self._decode_sync, token)
        except Unauthorized:
            raise
        except jwt.ExpiredSignatureError as exc:
            raise Unauthorized("Your session has expired. Please sign in again.") from exc
        except jwt.InvalidTokenError as exc:
            logger.warning("[auth] invalid token: %s", type(exc).__name__)
            raise Unauthorized("Invalid authentication token.") from exc
        except Exception as exc:  # noqa: BLE001 - JWKS/network failures
            logger.warning("[auth] token verification failed: %s", type(exc).__name__)
            raise Unauthorized("Could not verify authentication token.") from exc
        subject = claims.get("sub")
        if not subject:
            raise Unauthorized("Token is missing a subject.")
        return AuthUser(
            id=str(subject),
            email=claims.get("email"),
            role=claims.get("role") or "authenticated",
        )
