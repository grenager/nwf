-- Editorial posting account + indexes for the platform-wide Discover ranking.
--
-- Additive only: adds one column and several indexes. Nothing is dropped,
-- narrowed or renamed, so this is safe to apply ahead of the code deploy.
--
-- ``profiles.is_editorial`` marks an account whose posts exist to seed the
-- Discover tab. Editorial posts are ranked into Discover but deliberately
-- excluded from every friend/friend-of-friend surface (feed, digest, activity
-- email), so a curated link never lands in anyone's Conversations tab.

alter table public.profiles
    add column if not exists is_editorial boolean not null default false;

comment on column public.profiles.is_editorial is
    'Account whose posts seed the Discover tab; excluded from friend feeds, digests and activity emails.';

-- Tiny partial index: "which accounts are editorial" is a one-row lookup that
-- the visibility clauses run on every feed query.
create index if not exists profiles_is_editorial_idx
    on public.profiles (id)
    where is_editorial;

-- Discover aggregates over a trailing time window (24h, widening to 72h then
-- 7d when the platform is quiet), so every input table needs a descending
-- index on the timestamp it is windowed by.
create index if not exists posts_created_at_idx
    on public.posts (created_at desc);

create index if not exists comments_created_at_idx
    on public.comments (created_at desc);

create index if not exists post_reactions_updated_at_idx
    on public.post_reactions (updated_at desc);

create index if not exists comment_reactions_updated_at_idx
    on public.comment_reactions (updated_at desc);

-- Reads are windowed on coalesce(last_read_at, read_at); the partial index
-- covers the common case where a story has actually been opened.
create index if not exists story_statuses_last_read_at_idx
    on public.story_statuses (last_read_at desc)
    where last_read_at is not null;

create index if not exists story_statuses_read_at_idx
    on public.story_statuses (read_at desc)
    where read_at is not null;
