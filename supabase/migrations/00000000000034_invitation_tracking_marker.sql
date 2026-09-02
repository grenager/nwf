-- Distinguish "no data" from "zero" on the invite reach counters.
--
-- 00000000000033 added open_count / preview_fetch_count / share_outcome with
-- a zero default, which silently backfilled every pre-existing invitation as
-- "never opened, never shared". That is indistinguishable from a link minted
-- today and ignored -- and it is wrong: links from before the counters
-- existed were opened, they just weren't being counted. The funnel report
-- read that as fact and claimed links were never opened while also showing
-- that they had brought people in.
--
-- `instrumented` marks the rows whose counters actually mean something.
-- Existing rows take the false default; the default then flips so every
-- invitation minted from here on is true. Rates are computed over the
-- instrumented set only, and the rest are reported as predating tracking
-- rather than as failures.

alter table public.invitations
    add column if not exists instrumented boolean not null default false;

alter table public.invitations
    alter column instrumented set default true;

create index if not exists invitations_instrumented_created_idx
    on public.invitations (instrumented, created_at);
