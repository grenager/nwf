-- Replace star ratings with a fixed like/love/sad/angry reaction set on
-- posts and comments. story_ratings (and the read-only "friend rating"
-- concept it fed) is gone entirely; reactions are now the sole per-post/
-- per-comment engagement signal.

-- Remap existing reaction rows outside the new set before tightening the
-- CHECK constraint (dev/staging data only; laugh/insightful have no exact
-- successor so fold them into the nearest kept value).
update public.post_reactions set reaction = 'love' where reaction = 'laugh';
update public.post_reactions set reaction = 'like' where reaction = 'insightful';
update public.comment_reactions set reaction = 'love' where reaction = 'laugh';
update public.comment_reactions set reaction = 'like' where reaction = 'insightful';

alter table public.post_reactions
    drop constraint if exists post_reactions_reaction_check;
alter table public.post_reactions
    add constraint post_reactions_reaction_check
    check (reaction in ('like', 'love', 'sad', 'angry'));

alter table public.comment_reactions
    drop constraint if exists comment_reactions_reaction_check;
alter table public.comment_reactions
    add constraint comment_reactions_reaction_check
    check (reaction in ('like', 'love', 'sad', 'angry'));

drop policy if exists story_ratings_select on public.story_ratings;
drop policy if exists story_ratings_write on public.story_ratings;
drop table if exists public.story_ratings;
