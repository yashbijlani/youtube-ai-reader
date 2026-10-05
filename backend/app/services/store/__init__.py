"""Storage factory.

Production: Supabase/Postgres when configured (``SUPABASE_URL`` +
``SUPABASE_SERVICE_ROLE_KEY``). Development/tests: in-memory store.
"""

from app.config import Settings
from app.services.store.base import Store
from app.services.store.memory_store import MemoryStore
from app.services.store.supabase_client import SupabaseClient, SupabaseError
from app.services.store.supabase_store import SupabaseStore


def create_store(settings: Settings) -> Store:
    if settings.use_supabase_storage:
        return SupabaseStore(
            SupabaseClient(settings.supabase_url, settings.supabase_service_role_key)
        )
    return MemoryStore()


__all__ = [
    "MemoryStore",
    "Store",
    "SupabaseClient",
    "SupabaseError",
    "SupabaseStore",
    "create_store",
]
