-- Measure what happens to an invite link after it is minted.
--
-- A share-tray link tells us nothing about who it went to, how many people,
-- or through which app -- the OS hands it off and the page never hears back.
-- These columns capture the three things we *can* observe, so a link that
-- was never sent stops being indistinguishable from one that was sent and
-- ignored.
--
--   share_outcome  what the inviter did at the moment of minting: completed
--                  the OS share sheet, fell back to the clipboard, or backed
--                  out. Null for email invites (nothing is handed off) and
--                  for links minted before this column existed.
--   preview_fetch_count
--                  server-rendered previews of the landing page. Messaging
--                  apps fetch it to build a link unfurl, so a link with
--                  previews but no opens was probably pasted somewhere and
--                  ignored. Deliberately NOT a funnel stage: it also counts
--                  ordinary visits (every real visit server-renders first),
--                  it misses hits absorbed by the 60s revalidate cache, and
--                  crawlers inflate it. Read it as a weak "this link was
--                  rendered somewhere" signal, nothing more.
--   open_count     humans opening the landing page, counted from the client
--                  rather than the server so unfurls do not masquerade as
--                  visits.
--
-- A reusable link is opened and redeemed by many people, so per-person rates
-- have to be computed against opens and invitation_redemptions, never against
-- a count of invitation rows.

create type public.invitation_share_outcome as enum (
    'shared',
    'copied',
    'cancelled'
);

alter table public.invitations
    add column if not exists share_outcome public.invitation_share_outcome,
    add column if not exists preview_fetch_count integer not null default 0,
    add column if not exists open_count integer not null default 0,
    add column if not exists first_opened_at timestamptz,
    add column if not exists last_opened_at timestamptz;

-- The funnel report groups by creation time and invite shape.
create index if not exists invitations_created_at_idx
    on public.invitations (created_at);
