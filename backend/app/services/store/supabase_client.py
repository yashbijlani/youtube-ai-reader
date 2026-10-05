"""Thin Supabase / PostgREST client.

Uses the service-role key server-side only. Deliberately dependency-light
(httpx) so the backend stays small and testable with ``MockTransport``.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger("youtube_ai_reader.supabase")

FilterOp = tuple[str, str, Any]  # (column, operator, value)


class SupabaseError(RuntimeError):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"Supabase HTTP {status}: {detail[:240]}")
        self.status = status
        self.detail = detail


class SupabaseClient:
    def __init__(
        self,
        url: str,
        service_key: str,
        client: httpx.AsyncClient | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.service_key = service_key
        self._client = client
        self._owns_client = client is None
        self._timeout = timeout

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout)
            self._owns_client = True
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    def _headers(self, *, returning: bool, upsert: bool) -> dict[str, str]:
        prefer = ["return=representation" if returning else "return=minimal"]
        if upsert:
            prefer.append("resolution=merge-duplicates")
        return {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
            "Prefer": ",".join(prefer),
        }

    @staticmethod
    def _query(
        filters: list[FilterOp] | None,
        params: dict[str, str] | None,
    ) -> list[tuple[str, str]]:
        query: list[tuple[str, str]] = []
        for column, operator, value in filters or []:
            if operator == "in" and isinstance(value, (list, tuple, set)):
                rendered = ",".join(str(v) for v in value)
                query.append((column, f"in.({rendered})"))
            elif value is None:
                query.append((column, f"{operator}.null"))
            else:
                query.append((column, f"{operator}.{value}"))
        for key, value in (params or {}).items():
            query.append((key, value))
        return query

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        client = await self._ensure_client()
        response = await client.request(method, f"{self.base}{path}", **kwargs)
        if response.status_code >= 400:
            raise SupabaseError(response.status_code, response.text)
        return response

    async def select(
        self,
        table: str,
        *,
        columns: str = "*",
        filters: list[FilterOp] | None = None,
        params: dict[str, str] | None = None,
        single: bool = False,
    ) -> Any:
        query = self._query(filters, {"select": columns, **(params or {})})
        headers = self._headers(returning=True, upsert=False)
        if single:
            headers["Accept"] = "application/vnd.pgrst.object+json"
        response = await self._request("GET", f"/{table}", params=query, headers=headers)
        return response.json()

    async def insert(
        self,
        table: str,
        rows: dict | list[dict],
        *,
        upsert: bool = False,
        on_conflict: str | None = None,
        returning: bool = True,
    ) -> Any:
        params = {"on_conflict": on_conflict} if on_conflict else None
        payload = rows if isinstance(rows, list) else [rows]
        response = await self._request(
            "POST",
            f"/{table}",
            params=params,
            headers=self._headers(returning=returning, upsert=upsert),
            json=payload,
        )
        return response.json() if returning else None

    async def update(
        self,
        table: str,
        values: dict,
        *,
        filters: list[FilterOp] | None = None,
        returning: bool = True,
    ) -> Any:
        response = await self._request(
            "PATCH",
            f"/{table}",
            params=self._query(filters, None),
            headers=self._headers(returning=returning, upsert=False),
            json=values,
        )
        return response.json() if returning else None

    async def delete(self, table: str, *, filters: list[FilterOp]) -> None:
        await self._request(
            "DELETE",
            f"/{table}",
            params=self._query(filters, None),
            headers=self._headers(returning=False, upsert=False),
        )

    async def rpc(self, function: str, params: dict[str, Any]) -> Any:
        response = await self._request(
            "POST",
            f"/rpc/{function}",
            headers={
                "apikey": self.service_key,
                "Authorization": f"Bearer {self.service_key}",
                "Content-Type": "application/json",
            },
            json=params,
        )
        return response.json()
