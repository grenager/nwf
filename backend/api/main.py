"""FastAPI application factory and entrypoint."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import (
    attachments,
    comments,
    connections,
    feed,
    health,
    me,
    posts,
    profiles,
    sources,
    stories,
)
from core.config import get_settings
from core.db import dispose_engine
from core.logging import get_logger

log = get_logger("api")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info("api.startup")
    yield
    await dispose_engine()
    log.info("api.shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="NewsWithFriends API",
        version="0.2.0",
        summary="Sources, stories, posts, replies, friends, unified feed.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(sources.router)
    app.include_router(stories.router)
    app.include_router(posts.router)
    app.include_router(feed.router)
    app.include_router(attachments.router)
    app.include_router(me.router)
    app.include_router(comments.router)
    app.include_router(connections.router)
    app.include_router(profiles.router)
    return app


app = create_app()


def run() -> None:
    """Console-script entrypoint (`nwf-api`)."""
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_reload,
        reload_dirs=["api", "core", "scraper"] if settings.api_reload else None,
    )


if __name__ == "__main__":
    run()
