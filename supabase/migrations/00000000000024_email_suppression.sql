-- Per-invitation unsubscribe tokens plus a hard suppression list, so people who
-- were invited (and never signed up) can stop every email without an account.

alter table public.invitations
    add column if not exists unsubscribe_token uuid not null default gen_random_uuid(),
    add column if not exists last_activity_email_at timestamptz;

create unique index if not exists invitations_unsubscribe_token_key
    on public.invitations (unsubscribe_token);

-- Addresses that must never be emailed again. Keyed by the address itself
-- because a suppressed invitee has no profile row to hang a preference on.
create table public.email_suppressions (
    email         text primary key,
    reason        text,
    invitation_id uuid references public.invitations (id) on delete set null,
    created_at    timestamptz not null default now()
);

alter table public.email_suppressions enable row level security;

-- Writes go through the FastAPI service role, which bypasses RLS.
create policy email_suppressions_select on public.email_suppressions
    for select using (public.is_admin());
