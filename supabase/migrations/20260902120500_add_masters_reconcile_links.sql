-- ===========================================================================
-- CENTRAL MASTERS — the reconcile ledger.
--
-- WHY THIS EXISTS
--   Two lists describe the same firms and the same goods, and neither knows
--   about the other:
--     · fms_dispatch_customers (326) / fms_dispatch_items (246) — typed by hand
--       over months, and the thing every existing sales order points at.
--     · mst_parties (7,812) / mst_items (14,228) — just synced from Tally.
--   "AADESH DIGITAL PRINTS" is in both, under two different ids. Nothing can
--   join them: the Dispatch `code` column is free text and mostly empty, and the
--   names differ by punctuation, suffixes and spelling.
--
--   A human has to decide. This table is where those decisions are kept, so the
--   deciding and the applying are separate acts — the Phase 1 cutover then reads
--   settled data instead of guessing during a maintenance window.
--
-- ⚠ THE DIRECTION OF THE MERGE, AND WHY IT IS THIS WAY ROUND.
--   The matched pair collapses onto the DISPATCH row's id, not Tally's.
--   Twelve foreign keys across fms_dispatch_orders / _order_items / _rounds /
--   _round_items / _step_owners point at those ids. Keeping them means Phase 1
--   repoints constraints against data that already satisfies them — instant, and
--   reversible. Adopting Tally's ids instead would mean UPDATEing customer_id and
--   item_id on 199 live orders and 779 live order lines, which is exactly the
--   kind of write this project has been careful to avoid.
--
--   So Phase 1 will: insert the Dispatch masters into mst_* keeping their ids,
--   copy the confirmed tally_guid onto them, and delete the now-redundant
--   Tally-sourced twin (which nothing references). The sync upserts on
--   tally_guid, so from then on Tally updates land on the surviving row.
--
-- A row here is a DECISION, not a guess: it is written when a human confirms,
-- and `status` records what they decided. Suggestions are computed in the UI and
-- never stored, so re-running the matcher after a sync cannot quietly rewrite
-- somebody's answer.
--
-- Additive: one new table. Nothing existing is read or altered.
--
-- Reversal:
--   drop table if exists public.mst_reconcile_links;
-- ===========================================================================

create table if not exists public.mst_reconcile_links (
  id            uuid primary key default gen_random_uuid(),
  -- WHICH legacy list, so items and customers share one ledger.
  legacy_table  text not null check (legacy_table in ('fms_dispatch_customers', 'fms_dispatch_items')),
  legacy_id     uuid not null,
  legacy_name   text not null,
  -- The Tally record it IS. Null when status = 'portal_only'.
  tally_guid    text,
  matched_name  text,
  status        text not null check (status in ('linked', 'portal_only')),
  note          text,
  decided_by    uuid references auth.users on delete set null,
  decided_at    timestamptz not null default now(),
  -- One decision per legacy row. Re-deciding UPDATES; it never stacks.
  unique (legacy_table, legacy_id)
);

comment on table public.mst_reconcile_links is
  'One human decision per legacy master row: which Tally record it is, or that it has none. Read by the Phase 1 cutover. Suggestions are computed in the UI and deliberately never stored here.';
comment on column public.mst_reconcile_links.legacy_name is
  'The legacy name AS IT WAS WHEN DECIDED. A snapshot, so the ledger still reads sensibly after the legacy table is retired.';
comment on column public.mst_reconcile_links.status is
  'linked = the same real-world record as tally_guid; portal_only = genuinely has no Tally counterpart and stays a portal-owned row.';

-- ⚠ NOT UNIQUE ON tally_guid. Two Dispatch rows legitimately map to one Tally
--   record (the same firm typed twice, which is one of the duplicates this whole
--   exercise exists to find). The cutover reports those rather than refusing them.
create index if not exists mst_reconcile_links_guid_idx on public.mst_reconcile_links (tally_guid);
create index if not exists mst_reconcile_links_table_idx on public.mst_reconcile_links (legacy_table, status);

drop trigger if exists set_updated_at on public.mst_reconcile_links;

alter table public.mst_reconcile_links enable row level security;

drop policy if exists mst_reconcile_links_select on public.mst_reconcile_links;
create policy mst_reconcile_links_select
  on public.mst_reconcile_links for select to authenticated using (true);

-- Admin-only: this decides what the cutover does to live foreign keys.
drop policy if exists mst_reconcile_links_write on public.mst_reconcile_links;
create policy mst_reconcile_links_write
  on public.mst_reconcile_links for all to authenticated
  using      ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));


do $check$
begin
  if to_regclass('public.mst_reconcile_links') is null then
    raise exception 'reconcile: mst_reconcile_links was not created';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.mst_reconcile_links'::regclass and c.contype = 'u'
                    and pg_get_constraintdef(c.oid) = 'UNIQUE (legacy_table, legacy_id)') then
    raise exception 'reconcile: one-decision-per-legacy-row is not enforced';
  end if;
  if exists (select 1 from pg_constraint c
              where c.conrelid = 'public.mst_reconcile_links'::regclass and c.contype = 'u'
                and pg_get_constraintdef(c.oid) = 'UNIQUE (tally_guid)') then
    raise exception 'reconcile: tally_guid is unique - two legacy rows may legitimately share one Tally record';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'mst_reconcile_links'
                and (roles is null or 'public' = any (roles))) then
    raise exception 'reconcile: a policy is open to PUBLIC';
  end if;
end $check$;
