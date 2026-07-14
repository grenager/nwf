-- Denormalized source attribution derived from a page's OpenGraph metadata
-- (and Substack's preload blob), e.g. "Derek Thompson on Substack". Used when a
-- story is not backed by a curated source we scrape directly, or when the
-- linked source is an aggregator (Hacker News) that links out to the real one.

alter table public.stories add column if not exists publisher text;
