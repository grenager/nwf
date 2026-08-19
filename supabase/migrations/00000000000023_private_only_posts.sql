-- All posts are private-only; migrate existing public rows and drop the
-- partial index that only covered public posts. The enum value and RLS
-- can_see_post public branch are kept so this is reversible.
update public.posts
set visibility = 'private'
where visibility = 'public';

drop index if exists public.posts_visibility_idx;
