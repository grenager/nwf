-- Move story ratings from whole 1-5 stars to Letterboxd-style half-stars
-- (0.5 – 5.0 in 0.5 increments). Existing integer ratings widen cleanly.

alter table public.story_ratings
    drop constraint if exists story_ratings_rating_check;

alter table public.story_ratings
    alter column rating type numeric(2, 1) using rating::numeric(2, 1);

alter table public.story_ratings
    add constraint story_ratings_rating_check
    check (rating >= 0.5 and rating <= 5.0 and (rating * 2) = floor(rating * 2));
