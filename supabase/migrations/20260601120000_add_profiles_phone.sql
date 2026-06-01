-- Add a mobile-number column to the profiles read-model, and backfill it from the
-- mobile number new users have always carried in their auth metadata
-- (auth.users.raw_user_meta_data->>'phone'). The app reads the directory from
-- public.profiles (RLS-gated); auth.users isn't reachable from the browser, so the
-- number has to live here for the Users screen to show/edit it.
--
-- Fully additive + idempotent. No existing row's identity, password, role, or any
-- other column is modified — the only write is populating the brand-new `phone`
-- column where it is currently NULL.

alter table public.profiles add column if not exists phone text;

-- Backfill existing profiles from the mobile already stored in auth metadata, so
-- current users keep their real number instead of showing blank. Only fills rows
-- where phone is still NULL and a metadata value exists.
update public.profiles p
set phone = nullif(trim(u.raw_user_meta_data->>'phone'), '')
from auth.users u
where u.id = p.id
  and p.phone is null
  and nullif(trim(u.raw_user_meta_data->>'phone'), '') is not null;
