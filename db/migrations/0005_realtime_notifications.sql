-- Stage B / B4 — realtime notifications.
--
-- Add the notifications table to the supabase_realtime publication so the client
-- can subscribe to live INSERT/UPDATE (the bell updates without a refresh). RLS on
-- notifications (user_id = auth.uid()) still scopes what each client receives.
--
-- Reverse with:  alter publication supabase_realtime drop table public.notifications;

alter publication supabase_realtime add table public.notifications;
