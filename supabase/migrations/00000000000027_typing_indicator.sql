-- "Typing now" indicator for a post's comment composer: a timestamp upserted
-- on every debounced keystroke, with no "stopped typing" write - a row just
-- ages out of the window a reader queries for. Same ping-and-expire
-- mechanism as story_statuses.last_read_at, reused rather than Presence
-- channels, so it needs no new realtime primitive.

create table public.post_typing (
    post_id    uuid not null references public.posts (id) on delete cascade,
    user_id    uuid not null references public.profiles (id) on delete cascade,
    updated_at timestamptz not null default now(),
    primary key (post_id, user_id)
);

alter table public.post_typing enable row level security;

-- Visible to whoever can already see the post (its audience), not just the
-- typer - unlike post_reads' self-only cursor, other people are the whole
-- point here. Also gates Realtime delivery: an UPDATE is only pushed to a
-- subscriber whose session satisfies this policy for that row.
create policy post_typing_select on public.post_typing
    for select using (public.can_see_post(post_id));

create policy post_typing_insert on public.post_typing
    for insert with check (user_id = auth.uid() and public.can_see_post(post_id));

create policy post_typing_update on public.post_typing
    for update using (user_id = auth.uid());

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'post_typing'
    ) then
        alter publication supabase_realtime add table public.post_typing;
    end if;
end
$$;
