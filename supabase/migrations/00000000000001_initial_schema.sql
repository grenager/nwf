-- NewsWithFriends initial schema.
-- Source of truth for the Postgres schema. Maps from the legacy Mongoose models.
-- Auth is owned by Supabase (auth.users); we extend it with a public.profiles row.

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.connection_status as enum ('pending', 'accepted', 'blocked');

-- ---------------------------------------------------------------------------
-- profiles: extends auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    first       text,
    last        text,
    phone       text,
    image_url   text,
    is_admin    boolean not null default false,
    dense_mode  boolean not null default false,
    dark_mode   boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------
create table public.sources (
    id                uuid primary key default gen_random_uuid(),
    name              text not null,
    homepage_url      text not null unique,
    rss_url           text,
    include_selector  text,
    exclude_selector  text,
    bias_score        numeric,
    last_scraped_at   timestamptz,
    tags              text[] not null default '{}',
    image_url         text,
    has_paywall       boolean not null default false,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index sources_last_scraped_at_idx on public.sources (last_scraped_at nulls first);
create index sources_tags_idx on public.sources using gin (tags);

-- ---------------------------------------------------------------------------
-- user_sources: junction (replaces sourceIds[] on the user)
-- ---------------------------------------------------------------------------
create table public.user_sources (
    user_id    uuid not null references public.profiles (id) on delete cascade,
    source_id  uuid not null references public.sources (id) on delete cascade,
    position   integer not null default 0,
    created_at timestamptz not null default now(),
    primary key (user_id, source_id)
);

create index user_sources_user_id_idx on public.user_sources (user_id, position);

-- ---------------------------------------------------------------------------
-- stories
-- ---------------------------------------------------------------------------
create table public.stories (
    id               uuid primary key default gen_random_uuid(),
    article_url      text not null unique,
    source_id        uuid references public.sources (id) on delete set null,
    full_headline    text not null,
    summary          text,
    full_text        text,
    section          text,
    type             text,
    image_url        text,
    author_names     text[] not null default '{}',
    archived         boolean not null default false,
    last_scraped_at  timestamptz,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    -- Generated full-text search vector (replaces the Mongo text index).
    search_tsv tsvector generated always as (
        setweight(to_tsvector('english', coalesce(full_headline, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(full_text, '')), 'C')
    ) stored
);

create index stories_source_id_idx on public.stories (source_id);
create index stories_created_at_idx on public.stories (created_at desc);
create index stories_search_tsv_idx on public.stories using gin (search_tsv);

-- ---------------------------------------------------------------------------
-- story_statuses: per-user read/star state (junction)
-- ---------------------------------------------------------------------------
create table public.story_statuses (
    user_id    uuid not null references public.profiles (id) on delete cascade,
    story_id   uuid not null references public.stories (id) on delete cascade,
    read       boolean not null default false,
    starred    boolean not null default false,
    comment    text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, story_id)
);

create index story_statuses_user_starred_idx on public.story_statuses (user_id) where starred;
create index story_statuses_story_id_idx on public.story_statuses (story_id);

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create table public.comments (
    id         uuid primary key default gen_random_uuid(),
    story_id   uuid not null references public.stories (id) on delete cascade,
    user_id    uuid not null references public.profiles (id) on delete cascade,
    text       text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index comments_story_id_idx on public.comments (story_id, created_at desc);
create index comments_user_id_idx on public.comments (user_id);

-- ---------------------------------------------------------------------------
-- connections: friend graph
-- ---------------------------------------------------------------------------
create table public.connections (
    id         uuid primary key default gen_random_uuid(),
    first_id   uuid not null references public.profiles (id) on delete cascade,
    second_id  uuid not null references public.profiles (id) on delete cascade,
    status     public.connection_status not null default 'pending',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (first_id, second_id),
    check (first_id <> second_id)
);

create index connections_first_status_idx on public.connections (first_id, status);
create index connections_second_status_idx on public.connections (second_id, status);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
    for each row execute function public.set_updated_at();
create trigger sources_set_updated_at before update on public.sources
    for each row execute function public.set_updated_at();
create trigger stories_set_updated_at before update on public.stories
    for each row execute function public.set_updated_at();
create trigger story_statuses_set_updated_at before update on public.story_statuses
    for each row execute function public.set_updated_at();
create trigger comments_set_updated_at before update on public.comments
    for each row execute function public.set_updated_at();
create trigger connections_set_updated_at before update on public.connections
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user signs up.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, first, last)
    values (
        new.id,
        new.raw_user_meta_data ->> 'first',
        new.raw_user_meta_data ->> 'last'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
