-- Two-lane UX: news events vs analysis, pgvector embeddings, event clustering.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.source_kind as enum ('outlet', 'author');
create type public.story_kind as enum ('news', 'analysis');

-- ---------------------------------------------------------------------------
-- sources.kind
-- ---------------------------------------------------------------------------
alter table public.sources
    add column kind public.source_kind not null default 'outlet';

create index sources_kind_idx on public.sources (kind);

-- ---------------------------------------------------------------------------
-- stories.kind + embedding
-- ---------------------------------------------------------------------------
alter table public.stories
    add column kind public.story_kind not null default 'news';

alter table public.stories
    add column embedding extensions.vector(1536);

create index stories_kind_idx on public.stories (kind);
create index stories_embedding_idx on public.stories
    using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- events (news clusters)
-- ---------------------------------------------------------------------------
create table public.events (
    id               uuid primary key default gen_random_uuid(),
    title            text not null,
    centroid         extensions.vector(1536),
    origin_story_id  uuid references public.stories (id) on delete set null,
    first_seen_at    timestamptz not null default now(),
    saga_id          uuid,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index events_first_seen_at_idx on public.events (first_seen_at desc);
create index events_centroid_idx on public.events
    using hnsw (centroid extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- story_events junction
-- ---------------------------------------------------------------------------
create table public.story_events (
    story_id  uuid not null references public.stories (id) on delete cascade,
    event_id  uuid not null references public.events (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (story_id, event_id)
);

create index story_events_event_id_idx on public.story_events (event_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger for events
-- ---------------------------------------------------------------------------
create trigger events_set_updated_at before update on public.events
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: events readable by authenticated users
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.story_events enable row level security;

create policy events_select on public.events
    for select to authenticated using (true);

create policy story_events_select on public.story_events
    for select to authenticated using (true);
