-- Instant activity emails: separate opt-out from the daily digest.

alter table public.profiles
    add column if not exists instant_email_opt_out boolean not null default false;
