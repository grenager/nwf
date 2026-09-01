"""Application configuration, loaded from the environment."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration shared by the API and digest worker."""

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
    # Connection budget. Supabase's pooler in session mode caps the whole
    # project at a fixed number of clients (15 by default) and rejects the
    # rest outright with EMAXCONNSESSION -- which surfaces as 500s, not as
    # backpressure. Every process sharing DATABASE_URL draws on that one
    # budget, so these ceilings are deliberately well under it:
    #
    #     nwf-api     pool_size 5 + overflow 4  =  9
    #     nwf-digest  digest_concurrency + 1    =  6  (only while a cycle runs)
    #                                             ---
    #                                              15
    #
    # Raising either value means checking that sum against the pooler's limit
    # first. More headroom really wants the pooler's transaction mode, which
    # allows far more clients than session mode does.
    db_pool_size: int = Field(default=5)
    db_max_overflow: int = Field(default=4)
    # Wait this long for a free connection before giving up. Without it a
    # burst past the ceiling fails instantly; with it, requests queue through
    # the spike and only error if it is sustained.
    db_pool_timeout: float = Field(default=10.0)
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

    # --- Friend graph -----------------------------------------------------
    max_friends: int = Field(
        default=50,
        ge=1,
        description=(
            "Friend slots per account, counting accepted friends plus the "
            "requests and invitations they have outstanding. Keeps anyone from "
            "using invitations to send bulk email."
        ),
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

    # How long a reader stays shown as "reading now" after opening a story,
    # before settling into the plain "read" state.
    reading_now_window_minutes: int = Field(default=12, ge=1)

    # How long a "typing" ping keeps someone shown as actively typing on a
    # post's comments, absent a newer ping.
    typing_indicator_window_seconds: int = Field(default=90, ge=10)

    # --- Scraper ----------------------------------------------------------

    # ScrapingBee: proxy/JS-render fallback for link-preview enrichment when a
    # direct fetch is blocked (e.g. Economist 403, X/Twitter). Optional — when
    # unset, enrichment only does a direct fetch.
    scrapingbee_api_key: str | None = Field(default=None)
    scrapingbee_timeout_seconds: float = Field(default=40.0)
    # Timeout for the direct OpenGraph fetch when a user posts a URL.
    url_fetch_timeout_seconds: float = Field(default=20.0)

    # --- Embeddings (OpenAI) ----------------------------------------------

    # --- Feed -------------------------------------------------------------
    inbox_candidate_days: int = Field(
        default=14,
        description="How far back to look for feed candidates",
    )
    feed_min_items: int = Field(
        default=20,
        ge=0,
        description=(
            "Posts the feed tries to show before it stops widening the lookback"
        ),
    )
    feed_max_lookback_days: int | None = Field(
        default=365,
        description=(
            "Widest lookback used to reach feed_min_items; None for no cutoff"
        ),
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
