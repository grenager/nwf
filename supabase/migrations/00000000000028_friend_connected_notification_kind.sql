-- A reusable-invite acceptance forms a friendship in one step -- there's no
-- separate pending request for either side to "send" or "accept" -- so
-- neither existing friend-notification wording ("sent a friend request",
-- "accepted your friend request") is accurate for either party. Add a
-- symmetric kind used for both sides of that event.
alter type public.notification_kind add value 'friend_connected';
