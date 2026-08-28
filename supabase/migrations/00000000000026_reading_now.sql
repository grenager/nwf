-- "Reading now" live indicator: a timestamp refreshed on every article open
-- (not just the first-ever read, unlike read_at), plus enabling Realtime so
-- friends see it update live.

alter table public.story_statuses
    add column if not exists last_read_at timestamptz;

create index if not exists story_statuses_last_read_at_idx
    on public.story_statuses (story_id, last_read_at desc)
    where last_read_at is not null;

-- story_statuses_select (self + is_connected) already scopes exactly to the
-- audience this feature needs, so Realtime delivery is correctly scoped per
-- subscriber with no new RLS policy.
--
-- ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS form, so guard it
-- explicitly to keep this migration safe to run more than once.
do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'story_statuses'
    ) then
        alter publication supabase_realtime add table public.story_statuses;
    end if;
end
$$;
