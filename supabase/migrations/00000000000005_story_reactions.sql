-- Multi-type reactions on stories (heart, laugh, angry, sad, wow, thumbsup).
-- One reaction per (user, story); replaces the single "heart"/star like.

create table public.story_reactions (
    user_id uuid not null references public.profiles (id) on delete cascade,
    story_id uuid not null references public.stories (id) on delete cascade,
    reaction text not null check (
        reaction in ('thumbsup', 'heart', 'laugh', 'wow', 'sad', 'angry')
    ),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, story_id)
);

create index story_reactions_story_idx on public.story_reactions (story_id);

alter table public.story_reactions enable row level security;

-- Visible to self + accepted connections; users manage only their own.
create policy story_reactions_select on public.story_reactions
    for select using (
        user_id = auth.uid()
        or public.is_connected(user_id)
    );
create policy story_reactions_write on public.story_reactions
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Backfill: existing "hearts" (starred stories) become heart reactions.
insert into public.story_reactions (user_id, story_id, reaction)
select user_id, story_id, 'heart'
from public.story_statuses
where starred = true
on conflict (user_id, story_id) do nothing;
