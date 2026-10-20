-- Legal Customer: a hand-kept master of customers under legal action.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange),
--    NOT the Orange One identity project. The repo's `supabase/migrations/` target the identity
--    project; never `supabase db push` this repo. Apply through the management API or the SQL editor.
--    Deploy this BEFORE the muster-write Edge Function that writes the table, and before the frontend
--    that reads it. Purely ADDITIVE: one new table, nothing existing is touched.
--
-- WHY (2026-10-20)
--   Settings → Masters gets a "Legal Customer" tab beside Red Mark, the same way: add a customer one
--   at a time or by Excel import, export the list, edit salesperson / reason / checked, and CLEAR a
--   case when it is settled (the row stays) or DELETE one marked by mistake.
--
-- THE SAME SHAPE AS ext_redmark, column for column, so the two masters share one screen component,
--   one import/export contract and one clear rule. One row per ledger; the row's presence is the flag.
--   Keyed by the Tally ledger GUID, so a rename never loses the flag. `tally_name` / `company` /
--   `location` are display fallbacks for a ledger that has left the snapshot, never a key.
--
-- ⚠️ `checked` IS NOT "SETTLED" — that is `cleared`. `checked` means "a human verified this row".
--
-- ⚠️ THE NOTE IS REQUIRED, AND THE DATABASE IS WHERE THAT IS TRUE — the same decision as Red Mark
--   (ext_redmark_cleared_needs_who_when_note).
--
-- WHO MAY WRITE: only the `muster-write` Edge Function, via the service key. The table is READ-open to
--   anon/authenticated (the Masters tab reads it from the browser) and has no write policy. Clear/reopen
--   carry their own per-ledger rule in that function (authorizeClear); add/edit/delete need an admin
--   or a Settings full-access user.
--
-- Reversal: legal_customer_rollback.sql. Rehearse it IMMEDIATELY after applying, while the table is
-- empty — once legal customers are recorded, the rollback destroys them.

create table if not exists public.ext_legal_customer (
  ledger_id    text        primary key,              -- Tally ledger GUID (= Customer.id)
  tally_name   text,                                  -- customer name at entry; display fallback only
  company      text,
  location     text,
  salesperson  text,                                  -- from the salesperson master (RC-15)
  reason       text,
  -- Stewardship, as on every muster.
  checked      boolean     not null default true,
  match_status text        not null default 'guid_matched',
  source       text                 default 'muster',
  -- The clear status, as on ext_redmark.
  cleared      boolean     not null default false,
  cleared_at   timestamptz,                           -- written by the Edge Function, never defaulted
  cleared_by   text,
  clear_note   text,
  updated_at   timestamptz not null default now(),
  updated_by   text,

  constraint ext_legal_customer_cleared_needs_who_when_note check (
    not cleared
    or (cleared_at is not null and cleared_by is not null and btrim(coalesce(clear_note, '')) <> '')
  )
);

comment on table public.ext_legal_customer is
  'Legal Customer master: customers under legal action, one row per Tally ledger GUID. Same shape and rules as ext_redmark. Written only by the muster-write Edge Function.';

comment on column public.ext_legal_customer.cleared is
  'The legal case is settled. The ROW STAYS — this is not a delete. Reopening sets it back to false and leaves cleared_at/cleared_by/clear_note as the record of the last clearing.';

-- Keep updated_at fresh on every in-app edit (the same trigger function every muster uses).
drop trigger if exists ext_legal_customer_touch on public.ext_legal_customer;
create trigger ext_legal_customer_touch before update on public.ext_legal_customer
  for each row execute function public.touch_updated_at();

-- RLS: read-open, write through the service role only.
-- ⚠ Grants are narrowed as well as policied. Supabase's default privileges hand anon/authenticated
--   INSERT/UPDATE/DELETE/TRUNCATE on every new public table, and RLS does not govern TRUNCATE.
alter table public.ext_legal_customer enable row level security;
revoke all on public.ext_legal_customer from anon, authenticated;
grant select on public.ext_legal_customer to anon, authenticated;
grant select, insert, update, delete on public.ext_legal_customer to service_role;
drop policy if exists ext_legal_customer_read on public.ext_legal_customer;
create policy ext_legal_customer_read on public.ext_legal_customer for select to anon, authenticated using (true);

-- PostgREST caches the schema; without this the table stays invisible until the cache turns over.
notify pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
--   select count(*) from public.ext_legal_customer;                            -- 0 on first apply
--   select conname from pg_constraint where conrelid = 'public.ext_legal_customer'::regclass order by 1;
--     -- ext_legal_customer_cleared_needs_who_when_note, ext_legal_customer_pkey
--   select policyname, cmd from pg_policies where tablename = 'ext_legal_customer';
--     -- ext_legal_customer_read SELECT
