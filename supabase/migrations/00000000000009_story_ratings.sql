-- Per-user 1-5 star rating on a story; the single feed engagement signal.
-- Shown on the card as a friend-average. Replaces star/emoji reactions.

create table public.story_ratings (
    user_id uuid not null references public.profiles (id) on delete cascade,
    story_id uuid not null references public.stories (id) on delete cascade,
    rating smallint not null check (rating between 1 and 5),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, story_id)
);

create index story_ratings_story_idx on public.story_ratings (story_id);

alter table public.story_ratings enable row level security;

-- Visible to self + accepted connections; users manage only their own.
create policy story_ratings_select on public.story_ratings
    for select using (
        user_id = auth.uid()
        or public.is_connected(user_id)
    );
create policy story_ratings_write on public.story_ratings
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
