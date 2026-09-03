-- Pull-quote: let a post carry a short excerpt the author picked from the
-- article (max 300 characters, enforced in the API). When set it replaces the
-- og:description under the link preview, so the poster controls the line that
-- represents the piece. Optional — posts without one look exactly as before.
--
-- Purely additive: nothing existing is dropped or narrowed, so this is safe to
-- apply ahead of the corresponding code deploy.

alter table public.posts
    add column if not exists quote text;
