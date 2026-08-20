-- Retire article discovery and the followed-sources ecosystem.
--
-- The product is a friends feed: posts, comments, and reactions over symmetric
-- friend connections. Two subsystems built for an earlier "social news reader"
-- shape are now unreachable from any endpoint and are dropped here:
--
--   1. Followed sources ("follow the sources you trust") — user_sources plus
--      the /me/sources, /stories/recommended, /stories/by-source and
--      /stories/updates endpoints that read it.
--   2. Cold-start article discovery — /stories/discover, the RSS scraper that
--      filled it, full-text story search, and the pgvector story/event
--      clustering experiment that never shipped.
--
-- Stories and sources themselves survive: every post is about an article, and
-- sources still supply publisher names and logos for post attribution.

-- ---------------------------------------------------------------------------
-- 1. Followed sources
-- ---------------------------------------------------------------------------
drop table if exists public.user_sources;

-- ---------------------------------------------------------------------------
-- 2. Story/event clustering (pgvector) — orphaned; no application code ever
--    read these tables.
-- ---------------------------------------------------------------------------
drop table if exists public.story_events;
drop table if exists public.events;

-- ---------------------------------------------------------------------------
-- 3. Scraper bookkeeping on sources
-- ---------------------------------------------------------------------------
drop index if exists public.sources_last_scraped_at_idx;
drop index if exists public.sources_prominence_idx;

alter table public.sources
    drop column if exists rss_url,
    drop column if exists include_selector,
    drop column if exists exclude_selector,
    drop column if exists last_scraped_at,
    drop column if exists prominence;

-- ---------------------------------------------------------------------------
-- 4. Story columns that only the scraper and FTS used
-- ---------------------------------------------------------------------------
drop index if exists public.stories_embedding_idx;
drop index if exists public.stories_search_tsv_idx;

alter table public.stories
    drop column if exists embedding,
    drop column if exists search_tsv,
    drop column if exists last_scraped_at;
