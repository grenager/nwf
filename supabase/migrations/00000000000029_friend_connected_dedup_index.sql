-- A newly added enum label can't be referenced in the same transaction that
-- adds it, so this dedup-index update has to be a separate migration from
-- the ALTER TYPE that added 'friend_connected'.
drop index public.notifications_friend_dedup_idx;

create unique index notifications_friend_dedup_idx
    on public.notifications (recipient_id, actor_id, kind)
    where kind in ('friend_request', 'friend_accepted', 'friend_connected');
