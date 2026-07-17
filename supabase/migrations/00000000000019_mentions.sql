-- @mentions of friends inside post takes and comment bodies.
-- Text columns keep the react-mentions markup `@[Display Name](user-uuid)`;
-- these tables record the resolved user ids for access grants and the digest.

-- ---------------------------------------------------------------------------
-- post_mentions
-- ---------------------------------------------------------------------------
create table public.post_mentions (
    id                uuid primary key default gen_random_uuid(),
    post_id           uuid not null references public.posts (id) on delete cascade,
    mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
    created_at        timestamptz not null default now(),
    unique (post_id, mentioned_user_id)
);

create index post_mentions_post_idx on public.post_mentions (post_id);
create index post_mentions_user_idx
    on public.post_mentions (mentioned_user_id, created_at desc);

alter table public.post_mentions enable row level security;

create policy post_mentions_select on public.post_mentions
    for select using (
        mentioned_user_id = auth.uid()
        or public.can_see_post(post_id)
    );

-- ---------------------------------------------------------------------------
-- comment_mentions
-- ---------------------------------------------------------------------------
create table public.comment_mentions (
    id                uuid primary key default gen_random_uuid(),
    comment_id        uuid not null references public.comments (id) on delete cascade,
    mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
    created_at        timestamptz not null default now(),
    unique (comment_id, mentioned_user_id)
);

create index comment_mentions_comment_idx
    on public.comment_mentions (comment_id);
create index comment_mentions_user_idx
    on public.comment_mentions (mentioned_user_id, created_at desc);

alter table public.comment_mentions enable row level security;

create policy comment_mentions_select on public.comment_mentions
    for select using (
        mentioned_user_id = auth.uid()
        or exists (
            select 1
            from public.comments c
            where c.id = comment_id
              and c.post_id is not null
              and public.can_see_post(c.post_id)
        )
    );
