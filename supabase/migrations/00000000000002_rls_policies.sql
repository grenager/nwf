-- Row Level Security policies.
-- Notes:
--   * The FastAPI server connects with the service-role / owner role which
--     BYPASSES RLS; authorization is enforced in application code. These
--     policies are a secondary line of defense (e.g. if PostgREST or a client
--     ever connects directly with a user JWT).
--   * Fixes the legacy global `GET /api/comments` leak: comments are visible
--     only to the author and accepted connections.

-- Helper: is the current auth user an accepted connection of `other`?
create or replace function public.is_connected(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.connections c
        where c.status = 'accepted'
          and (
              (c.first_id = auth.uid() and c.second_id = other)
              or
              (c.second_id = auth.uid() and c.first_id = other)
          )
    );
$$;

-- Helper: is the current auth user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select p.is_admin from public.profiles p where p.id = auth.uid()),
        false
    );
$$;

-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.sources enable row level security;
alter table public.user_sources enable row level security;
alter table public.stories enable row level security;
alter table public.story_statuses enable row level security;
alter table public.comments enable row level security;
alter table public.connections enable row level security;

-- profiles: readable by self + connected friends; writable by self only.
create policy profiles_select on public.profiles
    for select using (
        id = auth.uid()
        or public.is_connected(id)
        or public.is_admin()
    );
create policy profiles_update on public.profiles
    for update using (id = auth.uid()) with check (id = auth.uid());

-- sources: readable by any authenticated user; writable by admin only.
create policy sources_select on public.sources
    for select to authenticated using (true);
create policy sources_admin_write on public.sources
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- user_sources: users manage only their own.
create policy user_sources_all on public.user_sources
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- stories: readable by any authenticated user; writable by admin only.
create policy stories_select on public.stories
    for select to authenticated using (true);
create policy stories_admin_write on public.stories
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- story_statuses: users manage only their own; visible to self + friends.
create policy story_statuses_select on public.story_statuses
    for select using (
        user_id = auth.uid()
        or public.is_connected(user_id)
    );
create policy story_statuses_write on public.story_statuses
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- comments: visible to author + accepted connections; author-only writes.
create policy comments_select on public.comments
    for select using (
        user_id = auth.uid()
        or public.is_connected(user_id)
    );
create policy comments_insert on public.comments
    for insert with check (user_id = auth.uid());
create policy comments_update on public.comments
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy comments_delete on public.comments
    for delete using (user_id = auth.uid());

-- connections: visible to either party; either party may create/modify.
create policy connections_select on public.connections
    for select using (
        first_id = auth.uid() or second_id = auth.uid()
    );
create policy connections_insert on public.connections
    for insert with check (first_id = auth.uid());
create policy connections_update on public.connections
    for update using (
        first_id = auth.uid() or second_id = auth.uid()
    ) with check (
        first_id = auth.uid() or second_id = auth.uid()
    );
create policy connections_delete on public.connections
    for delete using (
        first_id = auth.uid() or second_id = auth.uid()
    );
