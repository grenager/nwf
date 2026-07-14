-- Emoji reactions are fully retired in favor of the 1-5 star rating
-- (see 00000000000009_story_ratings.sql). Drop the reactions table and its
-- policies; nothing references it anymore.

drop table if exists public.story_reactions cascade;
