-- Unified feed: drop event clusters; introduce posts, post_participants,
-- attachments; comments become replies under posts; story_statuses gain take.

-- ---------------------------------------------------------------------------
-- Drop event cluster model
-- ---------------------------------------------------------------------------
drop policy if exists event_statuses_select on public.event_statuses;
drop policy if exists event_statuses_write on public.event_statuses;
drop policy if exists events_select on public.events;
drop policy if exists story_events_select on public.story_events;

drop table if exists public.event_statuses;
drop table if exists public.story_events;
drop table if exists public.events;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.post_visibility as enum ('private', 'public');

-- ---------------------------------------------------------------------------
-- posts: a user sharing an article with an optional take
-- ---------------------------------------------------------------------------
create table public.posts (
    id                  uuid primary key default gen_random_uuid(),
    story_id            uuid not null references public.stories (id) on delete cascade,
    author_id           uuid not null references public.profiles (id) on delete cascade,
    take                text,
    visibility          public.post_visibility not null default 'private',
    last_activity_at    timestamptz not null default now(),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index posts_story_id_idx on public.posts (story_id);
create index posts_author_id_idx on public.posts (author_id);
create index posts_last_activity_at_idx on public.posts (last_activity_at desc);
create index posts_visibility_idx on public.posts (visibility)
    where visibility = 'public';

create trigger posts_set_updated_at before update on public.posts
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- post_participants: maintained so FoF visibility is a fast union
-- ---------------------------------------------------------------------------
create table public.post_participants (
    post_id     uuid not null references public.posts (id) on delete cascade,
    user_id     uuid not null references public.profiles (id) on delete cascade,
    joined_at   timestamptz not null default now(),
    primary key (post_id, user_id)
);

create index post_participants_user_id_idx on public.post_participants (user_id);

-- ---------------------------------------------------------------------------
-- attachments: related links attached to a post (optionally a reply)
-- ---------------------------------------------------------------------------
create table public.attachments (
    id              uuid primary key default gen_random_uuid(),
    post_id         uuid not null references public.posts (id) on delete cascade,
    comment_id      uuid references public.comments (id) on delete set null,
    article_url     text not null,
    story_id        uuid references public.stories (id) on delete set null,
    attached_by     uuid not null references public.profiles (id) on delete cascade,
    created_at      timestamptz not null default now()
);

create index attachments_post_id_idx on public.attachments (post_id);

-- ---------------------------------------------------------------------------
-- comments become replies under a post
-- ---------------------------------------------------------------------------
alter table public.comments
    add column if not exists post_id uuid references public.posts (id) on delete cascade;

create index if not exists comments_post_id_idx
    on public.comments (post_id, created_at asc);

-- ---------------------------------------------------------------------------
-- story_statuses: Log entry (read / star / one-line take)
-- ---------------------------------------------------------------------------
alter table public.story_statuses
    add column if not exists take text;

-- ---------------------------------------------------------------------------
-- Visibility helper: is the current user able to see this private post?
-- ---------------------------------------------------------------------------
create or replace function public.can_see_post(target_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.posts p
        where p.id = target_post_id
          and (
              p.visibility = 'public'
              or p.author_id = auth.uid()
              or exists (
                  select 1
                  from public.post_participants pp
                  where pp.post_id = p.id
                    and (
                        pp.user_id = auth.uid()
                        or public.is_connected(pp.user_id)
                    )
              )
          )
    );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.posts enable row level security;
alter table public.post_participants enable row level security;
alter table public.attachments enable row level security;

create policy posts_select on public.posts
    for select using (public.can_see_post(id));
create policy posts_insert on public.posts
    for insert with check (author_id = auth.uid());
create policy posts_update on public.posts
    for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy posts_delete on public.posts
    for delete using (author_id = auth.uid());

create policy post_participants_select on public.post_participants
    for select using (public.can_see_post(post_id));
create policy post_participants_insert on public.post_participants
    for insert with check (user_id = auth.uid());

create policy attachments_select on public.attachments
    for select using (public.can_see_post(post_id));
create policy attachments_insert on public.attachments
    for insert with check (attached_by = auth.uid());
create policy attachments_delete on public.attachments
    for delete using (attached_by = auth.uid());

-- Replace comments select: author, or can see the parent post.
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
    for select using (
        user_id = auth.uid()
        or (
            post_id is not null
            and public.can_see_post(post_id)
        )
        or public.is_connected(user_id)
    );
