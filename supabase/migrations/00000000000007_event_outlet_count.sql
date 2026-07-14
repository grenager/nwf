-- Denormalize outlet breadth on events for fast guest inbox scans,
-- and add the composite stories index used by analysis + curated lookups.

alter table public.events
    add column if not exists outlet_count integer not null default 1;

-- Backfill from current membership.
update public.events e
set outlet_count = coalesce(sub.n, 1)
from (
    select se.event_id,
           greatest(count(distinct s.source_id), 1)::int as n
    from public.story_events se
    join public.stories s on s.id = se.story_id
    where s.source_id is not null
    group by se.event_id
) sub
where e.id = sub.event_id;

create index if not exists events_inbox_idx
    on public.events (first_seen_at desc, outlet_count desc);

create index if not exists stories_kind_source_created_idx
    on public.stories (kind, source_id, created_at desc);
