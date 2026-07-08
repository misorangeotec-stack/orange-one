-- Orange One LEADS — fix app_leads.id type (uuid → text).
--
-- The mobile app uses a STABLE, CLIENT-GENERATED id as the primary key so that
-- upsert-by-id is idempotent (no duplication) — see newId('c') in the store,
-- which produces values like `c-lx8k2f-a9b3c1`. Those are NOT valid uuids, so
-- every sync upsert failed with:
--     invalid input syntax for type uuid: "c-..."
-- and no lead ever reached the server.
--
-- app_leads is empty at this point, so retyping the column is a clean, safe
-- change (no data is mutated). id stays the PK; the (user_id, updated_at) index
-- and all RLS policies are unaffected.
--
-- Apply in the Orange One identity project (ref coshondiqdhorwvibrwu).

alter table public.app_leads
  alter column id type text using id::text;
