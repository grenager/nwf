-- Widen the reaction set to match Facebook's full set: adds care/haha/wow
-- alongside the existing like/love/sad/angry. Purely additive — nothing
-- existing is dropped or narrowed, so this is safe to apply ahead of the
-- corresponding code deploy (old code keeps working against the old four;
-- new code can start writing the new three once deployed).

alter table public.post_reactions
    drop constraint if exists post_reactions_reaction_check;
alter table public.post_reactions
    add constraint post_reactions_reaction_check
    check (reaction in ('like', 'love', 'care', 'haha', 'wow', 'sad', 'angry'));

alter table public.comment_reactions
    drop constraint if exists comment_reactions_reaction_check;
alter table public.comment_reactions
    add constraint comment_reactions_reaction_check
    check (reaction in ('like', 'love', 'care', 'haha', 'wow', 'sad', 'angry'));
