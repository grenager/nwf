"""Source CRUD + search + admin-triggered scrape."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select

from api.deps import AdminUser, CurrentUser, SessionDep
from api.schemas import SourceCreate, SourceOut, SourceStatus, SourceUpdate
from core.models import Source, Story

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("", response_model=list[SourceOut])
async def list_sources(
    session: SessionDep,
    _user: CurrentUser,
    limit: int = Query(default=200, le=500, ge=1),
    offset: int = Query(default=0, ge=0),
) -> list[Source]:
    result = await session.scalars(
        select(Source).order_by(Source.name).limit(limit).offset(offset)
    )
    return list(result.all())


@router.get("/search", response_model=list[SourceOut])
async def search_sources(
    session: SessionDep,
    _user: CurrentUser,
    q: str = Query(min_length=1),
    limit: int = Query(default=50, le=200, ge=1),
) -> list[Source]:
    pattern = f"%{q}%"
    result = await session.scalars(
        select(Source)
        .where(or_(Source.name.ilike(pattern), Source.homepage_url.ilike(pattern)))
        .order_by(Source.name)
        .limit(limit)
    )
    return list(result.all())


@router.get("/status", response_model=list[SourceStatus])
async def sources_status(session: SessionDep, _admin: AdminUser) -> list[SourceStatus]:
    """Admin: per-source scraper progress (last scrape, story counts)."""
    stmt = (
        select(
            Source.id,
            Source.name,
            Source.rss_url,
            Source.last_scraped_at,
            func.count(Story.id).label("story_count"),
            func.max(Story.created_at).label("newest_story_at"),
        )
        .outerjoin(Story, Story.source_id == Source.id)
        .group_by(Source.id)
        .order_by(Source.last_scraped_at.desc().nulls_last())
    )
    rows = (await session.execute(stmt)).all()
    return [
        SourceStatus(
            id=row.id,
            name=row.name,
            rss_url=row.rss_url,
            has_rss=row.rss_url is not None,
            last_scraped_at=row.last_scraped_at,
            story_count=int(row.story_count),
            newest_story_at=row.newest_story_at,
        )
        for row in rows
    ]


@router.get("/{source_id}", response_model=SourceOut)
async def get_source(
    source_id: uuid.UUID, session: SessionDep, _user: CurrentUser
) -> Source:
    source = await session.get(Source, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    return source


@router.post("", response_model=SourceOut, status_code=status.HTTP_201_CREATED)
async def create_source(
    payload: SourceCreate, session: SessionDep, _admin: AdminUser
) -> Source:
    data: dict[str, object] = payload.model_dump()
    rss_url: str | None = (payload.rss_url or "").strip() or None
    name: str | None = (payload.name or "").strip() or None
    homepage_url: str | None = (payload.homepage_url or "").strip() or None
    image_url: str | None = (payload.image_url or "").strip() or None

    if rss_url and not (name and homepage_url and image_url):
        # Lazy import keeps the API free of a hard scraper dependency at load.
        from scraper.ingest import _hostname_label, _origin, fetch_feed_metadata

        try:
            meta = await fetch_feed_metadata(rss_url)
        except Exception as exc:  # network / parse failure — fall back to URL
            if not (name and homepage_url):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"could not read RSS feed to infer source details: {exc}",
                ) from exc
            meta = None

        homepage_url = (
            homepage_url or (meta.homepage_url if meta else None) or _origin(rss_url)
        )
        name = (
            name
            or (meta.title if meta else None)
            or _hostname_label(homepage_url or rss_url)
        )
        image_url = image_url or (meta.image_url if meta else None)

    if not name or not homepage_url:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "provide an rss_url, or both name and homepage_url",
        )

    data["rss_url"] = rss_url
    data["name"] = name
    data["homepage_url"] = homepage_url
    data["image_url"] = image_url

    source = Source(**data)
    session.add(source)
    await session.flush()
    await session.refresh(source)
    return source


@router.put("/{source_id}", response_model=SourceOut)
async def update_source(
    source_id: uuid.UUID,
    payload: SourceUpdate,
    session: SessionDep,
    _admin: AdminUser,
) -> Source:
    source = await session.get(Source, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(source, key, value)
    await session.flush()
    await session.refresh(source)
    return source


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: uuid.UUID, session: SessionDep, _admin: AdminUser
) -> None:
    source = await session.get(Source, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    await session.delete(source)


@router.post("/{source_id}/scrape", status_code=status.HTTP_202_ACCEPTED)
async def trigger_scrape(
    source_id: uuid.UUID, session: SessionDep, _admin: AdminUser
) -> dict[str, str]:
    """Admin: enqueue a scrape of a single source.

    The scraper worker owns the actual fetch loop; this endpoint performs an
    inline ingest for the requested source so admins get immediate feedback.
    """
    source = await session.get(Source, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    if not source.rss_url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "source has no rss_url")

    # Imported lazily to avoid a hard API->scraper import at module load.
    from scraper.ingest import ingest_source

    count = await ingest_source(session, source)
    return {"status": "ok", "ingested": str(count)}
