-- Per-user access to the LEGACY (pre-Tally) pipeline source in the Receivables Hub.
--
-- The hub now defaults everyone to the Live (Tally / ConnectWave) source. The old
-- pipeline source (Python -> Sheets -> Supabase mirror / static JSON) becomes an
-- opt-in view that only permitted users may switch to:
--   admin                       -> may always switch to the legacy source (ignores this column)
--   non-admin, NULL / false     -> Live only, no source toggle shown (the default)
--   non-admin, true             -> gets the topbar toggle to view the legacy pipeline
--
-- This is the flip side of the "make Live the default" change and the first step
-- toward retiring the legacy pipeline entirely: once no one needs it, this column,
-- the toggle, and the legacy fetchers all go away.
--
-- Purely ADDITIVE: a new nullable column, no existing column or row touched.
-- Apply in the Orange One Supabase project (ref coshondiqdhorwvibrwu) via the
-- SQL editor or `supabase db push`.

alter table public.profiles
  add column if not exists receivables_allow_pipeline boolean;

comment on column public.profiles.receivables_allow_pipeline is
  'Receivables Hub: may this user switch to the legacy (pre-Tally) pipeline source? NULL/false = Live only; admins bypass.';
