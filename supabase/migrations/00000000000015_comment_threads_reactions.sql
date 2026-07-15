-- One-level comment threading + emoji reactions on posts and comments.
-- Reactions use a fixed set: like, love, laugh, insightful, sad.

-- ---------------------------------------------------------------------------
-- comments: nullable self-FK for reply-to-comment (max depth 1)
-- ---------------------------------------------------------------------------
alter table public.comments
    add column if not exists parent_comment_id uuid
        references public.comments (id) on delete cascade;

create index if not exists comments_parent_idx
    on public.comments (parent_comment_id, created_at asc);

-- One-level integrity: a CHECK can't inspect sibling rows, so use a trigger.
create or replace function public.enforce_comment_one_level()
returns trigger
language plpgsql
as $$
begin
    if new.parent_comment_id is not null then
        if exists (
            select 1
            from public.comments c
            where c.id = new.parent_comment_id
              and c.parent_comment_id is not null
        ) then
            raise exception 'comments may only nest one level deep';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists comments_one_level on public.comments;
create trigger comments_one_level
    before insert or update on public.comments
    for each row execute function public.enforce_comment_one_level();

-- ---------------------------------------------------------------------------
-- comment_reactions
-- ---------------------------------------------------------------------------
create table public.comment_reactions (
    user_id    uuid not null references public.profiles (id) on delete cascade,
    comment_id uuid not null references public.comments (id) on delete cascade,
    reaction   text not null check (
        reaction in ('like', 'love', 'laugh', 'insightful', 'sad')
    ),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, comment_id)
);

create index comment_reactions_comment_idx
    on public.comment_reactions (comment_id);

alter table public.comment_reactions enable row level security;

create policy comment_reactions_select on public.comment_reactions
    for select using (
        user_id = auth.uid()
        or exists (
            select 1
            from public.comments c
            where c.id = comment_id
              and c.post_id is not null
              and public.can_see_post(c.post_id)
        )
    );
create policy comment_reactions_write on public.comment_reactions
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- post_reactions
-- ---------------------------------------------------------------------------
create table public.post_reactions (
    user_id    uuid not null references public.profiles (id) on delete cascade,
    post_id    uuid not null references public.posts (id) on delete cascade,
    reaction   text not null check (
        reaction in ('like', 'love', 'laugh', 'insightful', 'sad')
    ),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, post_id)
);

create index post_reactions_post_idx
    on public.post_reactions (post_id);

alter table public.post_reactions enable row level security;

create policy post_reactions_select on public.post_reactions
    for select using (
        user_id = auth.uid()
        or public.can_see_post(post_id)
    );
create policy post_reactions_write on public.post_reactions
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
