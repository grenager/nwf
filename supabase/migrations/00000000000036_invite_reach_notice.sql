-- Watermark for the "your link was opened, nobody joined" note sent to the
-- *inviter*.
--
-- Share-tray links carry no invitee_email, so the existing invitee nudge
-- (invitations.last_activity_email_at) can never fire for them and they
-- expire in silence. This column tracks the one follow-up the inviter gets
-- instead, so a link is never used to mail the same person twice.
--
-- Additive only: existing rows get NULL, which reads as "never notified" and
-- makes every already-opened link eligible for its first note.
alter table public.invitations
  add column if not exists inviter_reach_email_at timestamptz;

-- The reach sweep filters on unconverted, opened, not-yet-notified links.
create index if not exists invitations_inviter_reach_idx
  on public.invitations (inviter_id)
  where inviter_reach_email_at is null
    and invitee_email is null
    and open_count > 0;

comment on column public.invitations.inviter_reach_email_at is
  'When the inviter was told this share link was opened but nobody joined. '
  'NULL means never; set once so the follow-up cannot repeat.';
