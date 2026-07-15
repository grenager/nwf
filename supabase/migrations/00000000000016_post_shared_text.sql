-- Reader text: let a post carry article text the author pasted from a page they
-- are authenticated to read. Shown as a short teaser in the feed, with the full
-- text available in a reader view. The author chooses to share their own copy;
-- we always link back to the publisher.

alter table public.posts
    add column if not exists shared_text text;
