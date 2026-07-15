-- Reusable share links for the viral loop.
-- Open (no-email) invitations are multi-redeem; each joiner is tracked in
-- invitation_redemptions. Email invites remain single-use on the invitations row.

alter table public.invitations
    alter column invitee_email drop not null;

alter table public.invitations
    add column become_friend boolean not null default false;

alter table public.invitations
    add column reusable boolean not null default false;

create table public.invitation_redemptions (
    id              uuid primary key default gen_random_uuid(),
    invitation_id   uuid not null references public.invitations (id) on delete cascade,
    user_id         uuid not null references public.profiles (id) on delete cascade,
    became_friend   boolean not null default false,
    created_at      timestamptz not null default now(),
    unique (invitation_id, user_id)
);

create index invitation_redemptions_invitation_idx
    on public.invitation_redemptions (invitation_id);

create index invitation_redemptions_user_idx
    on public.invitation_redemptions (user_id);

alter table public.invitation_redemptions enable row level security;

-- Inviter (via parent invitation) and admins can read redemptions.
-- Writes go through FastAPI with the service role (bypasses RLS).
create policy invitation_redemptions_select on public.invitation_redemptions
    for select using (
        public.is_admin()
        or exists (
            select 1
            from public.invitations i
            where i.id = invitation_id
              and i.inviter_id = auth.uid()
        )
        or user_id = auth.uid()
    );
