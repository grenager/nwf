-- full_text is unused (scraper deprecated). It is referenced by the generated
-- search_tsv column, so drop the generated column, drop full_text, then recreate
-- search_tsv over headline + summary only.
alter table public.stories drop column if exists search_tsv;
alter table public.stories drop column if exists full_text;

alter table public.stories
    add column search_tsv tsvector generated always as (
        setweight(to_tsvector('english', coalesce(full_headline, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'B')
    ) stored;

create index stories_search_tsv_idx on public.stories using gin (search_tsv);
