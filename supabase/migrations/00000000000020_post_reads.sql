-- Per-thread read cursor: when the viewer last looked at a post's replies.
-- Unread replies = comments with created_at > last_seen_at (excluding own).

create table public.post_reads (
    user_id      uuid not null references public.profiles (id) on delete cascade,
    post_id      uuid not null references public.posts (id) on delete cascade,
    last_seen_at timestamptz not null default now(),
    primary key (user_id, post_id)
);

create index post_reads_user_idx on public.post_reads (user_id);

alter table public.post_reads enable row level security;

create policy post_reads_select on public.post_reads
    for select using (user_id = auth.uid());

create policy post_reads_insert on public.post_reads
    for insert with check (user_id = auth.uid());

create policy post_reads_update on public.post_reads
    for update using (user_id = auth.uid());
