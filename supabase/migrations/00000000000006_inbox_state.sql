-- Inbox UX: per-user dismiss/read timestamps on stories and a parallel
-- event_statuses table, plus profiles.last_opened_at for "new since last visit".

-- ---------------------------------------------------------------------------
-- story_statuses: dismiss + read_at
-- ---------------------------------------------------------------------------
alter table public.story_statuses
    add column if not exists dismissed boolean not null default false,
    add column if not exists dismissed_at timestamptz,
    add column if not exists read_at timestamptz;

create index if not exists story_statuses_user_dismissed_idx
    on public.story_statuses (user_id)
    where dismissed = true;

-- ---------------------------------------------------------------------------
-- event_statuses: per-user read/dismiss for news event clusters
-- ---------------------------------------------------------------------------
create table if not exists public.event_statuses (
    user_id uuid not null references public.profiles (id) on delete cascade,
    event_id uuid not null references public.events (id) on delete cascade,
    read boolean not null default false,
    read_at timestamptz,
    dismissed boolean not null default false,
    dismissed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, event_id)
);

create index if not exists event_statuses_user_idx
    on public.event_statuses (user_id);

create index if not exists event_statuses_user_dismissed_idx
    on public.event_statuses (user_id)
    where dismissed = true;

alter table public.event_statuses enable row level security;

-- Visible to self + accepted connections; users manage only their own.
create policy event_statuses_select on public.event_statuses
    for select using (
        user_id = auth.uid()
        or public.is_connected(user_id)
    );
create policy event_statuses_write on public.event_statuses
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- profiles: last time the user opened Today (for "new since" divider)
-- ---------------------------------------------------------------------------
alter table public.profiles
    add column if not exists last_opened_at timestamptz;
