-- Email invitations for non-users. Distinct from connections: invitees have
-- no profile id yet, and invites carry a token + optional anchored post.

create type public.invitation_status as enum (
    'pending',
    'accepted',
    'revoked',
    'expired'
);

create table public.invitations (
    id                uuid primary key default gen_random_uuid(),
    token             text not null unique,
    inviter_id        uuid not null references public.profiles (id) on delete cascade,
    invitee_email     text not null,
    post_id           uuid references public.posts (id) on delete set null,
    message           text,
    status            public.invitation_status not null default 'pending',
    accepted_user_id  uuid references public.profiles (id) on delete set null,
    created_at        timestamptz not null default now(),
    accepted_at       timestamptz,
    expires_at        timestamptz
);

create index invitations_invitee_email_lower_idx
    on public.invitations (lower(invitee_email));

create index invitations_inviter_status_idx
    on public.invitations (inviter_id, status);

alter table public.invitations enable row level security;

-- Inviter manages their own invites. Public preview / redemption go through
-- the FastAPI backend (service role bypasses RLS).
create policy invitations_select on public.invitations
    for select using (inviter_id = auth.uid() or public.is_admin());

create policy invitations_insert on public.invitations
    for insert with check (inviter_id = auth.uid());

create policy invitations_update on public.invitations
    for update using (inviter_id = auth.uid() or public.is_admin())
    with check (inviter_id = auth.uid() or public.is_admin());
