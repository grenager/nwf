-- Google OAuth sign-ins populate raw_user_meta_data with given_name/family_name
-- rather than the first/last keys the magic-link flow sets, so fall back to those.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, first, last)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'first', new.raw_user_meta_data ->> 'given_name'),
        coalesce(new.raw_user_meta_data ->> 'last', new.raw_user_meta_data ->> 'family_name')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;
