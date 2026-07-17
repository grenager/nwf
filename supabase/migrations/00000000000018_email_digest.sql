-- Daily activity digest emails: opt-out, send watermark, unsubscribe token.

alter table public.profiles
    add column if not exists digest_opt_out boolean not null default false,
    add column if not exists last_digest_sent_at timestamptz,
    add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists profiles_unsubscribe_token_key
    on public.profiles (unsubscribe_token);

create index if not exists profiles_digest_eligible_idx
    on public.profiles (last_digest_sent_at)
    where digest_opt_out = false;
