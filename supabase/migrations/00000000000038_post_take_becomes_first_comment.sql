-- A post no longer has text of its own: the sharer's opinion is simply the
-- first comment on it.
--
-- Before, a post carried a "take" rendered above the article and the next
-- person's reply was a comment, so the same act of speaking was stored two
-- different ways depending on who went first. Now every contribution is a
-- comment, and the post is just the shared article.
--
-- Additive per the expand/contract rule: this only inserts comment rows.
-- `posts.take` is deliberately left in place, because a migration can land
-- ahead of the code that stops reading it. Dropping the column is a separate
-- cleanup migration, to be applied once this code is deployed everywhere.
--
-- Idempotent: re-running inserts nothing, since each post is skipped once an
-- identical comment from its author exists.

insert into public.comments (story_id, post_id, user_id, text, created_at, updated_at)
select
    p.story_id,
    p.id,
    p.author_id,
    btrim(p.take),
    -- Stamped at the post's own creation time so it sorts ahead of every
    -- reply, including replies written before this migration ran.
    p.created_at,
    p.created_at
from public.posts p
where p.take is not null
  and btrim(p.take) <> ''
  and not exists (
      select 1
      from public.comments c
      where c.post_id = p.id
        and c.user_id = p.author_id
        and c.text = btrim(p.take)
  );

-- The author is already a participant of their own post (posts create that
-- row), so no participant backfill is needed.
