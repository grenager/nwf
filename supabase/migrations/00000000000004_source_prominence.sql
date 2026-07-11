-- Source prominence: editorial readership/reach ranking used to order
-- cross-outlet coverage (higher = more prominent).

alter table public.sources
    add column prominence smallint not null default 0;

create index sources_prominence_idx on public.sources (prominence desc);
