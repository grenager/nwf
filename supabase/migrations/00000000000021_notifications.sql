-- Scoped directed alerts: mentions, reactions, friend requests.
-- Conversation replies surface via the Convos tab (post_reads), not here.

create type public.notification_kind as enum (
    'mention',
    'post_reaction',
    'comment_reaction',
    'friend_request',
    'friend_accepted'
);

create table public.notifications (
    id            uuid primary key default gen_random_uuid(),
    recipient_id  uuid not null references public.profiles (id) on delete cascade,
    actor_id      uuid not null references public.profiles (id) on delete cascade,
    kind          public.notification_kind not null,
    post_id       uuid references public.posts (id) on delete cascade,
    comment_id    uuid references public.comments (id) on delete cascade,
    story_id      uuid references public.stories (id) on delete cascade,
    read_at       timestamptz,
    created_at    timestamptz not null default now()
);

create index notifications_recipient_created_idx
    on public.notifications (recipient_id, created_at desc);

create index notifications_recipient_unread_idx
    on public.notifications (recipient_id)
    where read_at is null;

-- Re-reacting / re-requesting upserts one row instead of spamming.
create unique index notifications_post_reaction_dedup_idx
    on public.notifications (recipient_id, actor_id, post_id)
    where kind = 'post_reaction' and post_id is not null;

create unique index notifications_comment_reaction_dedup_idx
    on public.notifications (recipient_id, actor_id, comment_id)
    where kind = 'comment_reaction' and comment_id is not null;

create unique index notifications_friend_dedup_idx
    on public.notifications (recipient_id, actor_id, kind)
    where kind in ('friend_request', 'friend_accepted');

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications
    for select using (recipient_id = auth.uid());
