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
    # Service-role key for admin Auth APIs (generateLink). Optional in local
    # dev — invite emails degrade to copy-link when unset.
    supabase_service_role_key: str | None = Field(default=None)

    # --- App / email ------------------------------------------------------
    # Public origin of the Next.js app (invite landing + auth callback +
    # digest deep links). Production: https://www.newswithfriends.org
    app_base_url: str = Field(default="http://localhost:3000")
    # Resend API key for transactional invite emails. Optional in local
    # dev — emails are skipped (use copy-link / Inbucket instead).
    resend_api_key: str | None = Field(default=None)
    email_from: str = Field(
        default="NewsWithFriends <noreply@newswithfriends.org>"
    )

    # --- Daily digest -----------------------------------------------------
    digest_enabled: bool = Field(default=True)
    # Hour of day in America/Los_Angeles to send digests (0-23).
    digest_send_hour_pt: int = Field(default=4)
    # Max age of activity considered when building a digest.
    digest_lookback_days: int = Field(default=2)
    digest_concurrency: int = Field(default=5)
    digest_max_lines: int = Field(default=6)

    def app_url(self, path: str) -> str:
        """Absolute URL on the public web app (e.g. /post/{id})."""
        base: str = self.app_base_url.rstrip("/")
        normalized: str = path if path.startswith("/") else f"/{path}"
        return f"{base}{normalized}"

    # --- API --------------------------------------------------------------
    cors_origins: list[str] = Field(default=["http://localhost:3000"])
    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8000)
    api_reload: bool = Field(
        default=True,
        description="Auto-reload uvicorn on source changes. Set false in prod.",
    )

    # Shared secret guarding internal/admin scrape endpoints.
    admin_api_secret: str | None = Field(default=None)

    # --- Scraper ----------------------------------------------------------
    scrape_interval_seconds: int = Field(default=300)
    scrape_batch_size: int = Field(default=5)
    scrape_concurrency: int = Field(default=3)
    scrape_http_timeout_seconds: float = Field(default=20.0)

    # ScrapingBee: proxy/JS-render fallback for link-preview enrichment when a
    # direct fetch is blocked (e.g. Economist 403, X/Twitter). Optional — when
    # unset, enrichment only does a direct fetch.
    scrapingbee_api_key: str | None = Field(default=None)
    scrapingbee_timeout_seconds: float = Field(default=40.0)

    # --- Embeddings (OpenAI) ----------------------------------------------
    embeddings_api_key: str | None = Field(default=None)
    embeddings_model: str = Field(default="text-embedding-3-small")

    # --- Feed -------------------------------------------------------------
    inbox_candidate_days: int = Field(
        default=14,
        description="How far back to look for feed candidates",
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
