"""Application configuration, loaded from the environment."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration shared by the API and scraper."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Database ---------------------------------------------------------
    # Async SQLAlchemy URL, e.g.
    # postgresql+asyncpg://postgres:postgres@localhost:54322/postgres
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:54322/postgres"
    )
    db_pool_size: int = Field(default=10)
    db_max_overflow: int = Field(default=20)
    db_echo: bool = Field(default=False)

    # --- Supabase auth (JWT verification) --------------------------------
    # Base project URL, e.g. https://<ref>.supabase.co
    supabase_url: str = Field(default="http://localhost:54321")
    # HS256 secret (legacy) OR leave blank to use JWKS (asymmetric) verification.
    supabase_jwt_secret: str | None = Field(default=None)
    supabase_jwt_audience: str = Field(default="authenticated")

    # --- API --------------------------------------------------------------
    cors_origins: list[str] = Field(default=["http://localhost:3000"])
    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8000)

    # Shared secret guarding internal/admin scrape endpoints.
    admin_api_secret: str | None = Field(default=None)

    # --- Scraper ----------------------------------------------------------
    scrape_interval_seconds: int = Field(default=300)
    scrape_batch_size: int = Field(default=5)
    scrape_concurrency: int = Field(default=3)
    scrape_http_timeout_seconds: float = Field(default=20.0)

    # --- Embeddings (OpenAI) ----------------------------------------------
    embeddings_api_key: str | None = Field(default=None)
    embeddings_model: str = Field(default="text-embedding-3-small")
    event_cluster_threshold: float = Field(
        default=0.72,
        description="Cosine similarity threshold for joining an existing event",
    )
    event_active_hours: int = Field(
        default=48,
        description="Only match stories against events seen within this window",
    )

    # --- Inbox ------------------------------------------------------------
    inbox_candidate_days: int = Field(
        default=7,
        description="How far back to look for inbox candidates (events + analysis)",
    )
    event_min_outlets: int = Field(
        default=3,
        description="Minimum distinct outlets for an event to enter the news inbox",
    )

    # --- Logging ----------------------------------------------------------
    log_level: str = Field(default="INFO")
    log_json: bool = Field(default=False)

    @property
    def jwks_url(self) -> str:
        """Endpoint serving the project's JSON Web Key Set."""
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()
