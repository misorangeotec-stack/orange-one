-- ===========================================================================
-- OUR OWN BRANCHES BECOME ORDERABLE CUSTOMERS IN ORDER TO DISPATCH.
--
-- WHY THIS EXISTS
--   A ledger under Tally's "Branch / Divisions" group is neither a debtor nor
--   a creditor, so masters-sync set is_customer = is_vendor = false and the row
--   appeared on no tab and in no picker. Four of those ledgers trade every
--   week -- ORANGE O TEC PVT. LTD.(SURAT BRANCH) alone carries 130 sale lines
--   and 1,836 purchase lines in the Noida book. The sync now reads the trade
--   registers as well as the group chain, which fixes the FLAGS.
--
--   It does not fix VISIBILITY, and deliberately so: the sync never writes
--   `modules`, because everything Tally sends arrives invisible and an admin
--   decides what a module offers. That tick is this migration's job, and it is
--   a one-off -- no later pull will undo it.
--
-- ⚠ WHY ITEMS TOO, AND WHY IT IS NOT OPTIONAL
--   store.tsx's itemsForCustomer() intersects the customer's catalogue with
--   the module-filtered item list. Ticking only the customer produces a
--   customer whose order form offers NOTHING: the whole O-tec - Noida book has
--   three items in Dispatch today, and none of the Surat branch's 84 catalogue
--   items is one of them. A customer you cannot order anything for reads as a
--   broken screen, not as a missing tick.
--
-- ⚠ SELECTED BY EVIDENCE, NOT BY id AND NOT BY is_customer
--   Not ids, because a hardcoded list rots and says nothing about why.
--   Not is_customer, because this migration is applied BEFORE the new
--   masters-sync is deployed -- the flags have not flipped yet, so keying on
--   them would select nothing and silently do no work. mst_party_items is
--   already populated from the sales register, so "has a catalogue" is true
--   now and means the same thing either side of the deploy.
--
-- Reversal:
--   update public.mst_items i set modules = array_remove(i.modules, 'order-to-dispatch')
--     from private.branch_dispatch_seeded_items s where s.item_id = i.id;
--   update public.mst_parties p set modules = array_remove(p.modules, 'order-to-dispatch')
--     from private.branch_dispatch_seeded_parties s where s.party_id = p.id;
--   drop table private.branch_dispatch_seeded_items;
--   drop table private.branch_dispatch_seeded_parties;
--
--   The snapshots are why the reversal is exact. `array_remove` over the
--   evidence query instead would also strip the tick from rows that already
--   had it before this ran -- unticking somebody else's work while claiming to
--   undo ours.
-- ===========================================================================

create schema if not exists private;

do $$
declare
  v_parties int;
  v_items   int;
begin
  if to_regclass('private.branch_dispatch_seeded_parties') is not null then
    raise exception 'ABORT: private.branch_dispatch_seeded_parties already exists - this migration has already run';
  end if;

  -- ------------------------------------------------------------------ parties
  -- A branch ledger that has actually traded. The 14 that have not stay
  -- hidden: "Branch / Divisions" also holds ISD registrations and dormant
  -- offices, and putting those in a salesperson's customer list is noise.
  create table private.branch_dispatch_seeded_parties as
  select p.id as party_id, p.name, p.company_id
    from public.mst_parties p
   where p.group_chain @> array['Branch / Divisions']
     and exists (select 1 from public.mst_party_items pi where pi.party_id = p.id)
     and not (p.modules @> array['order-to-dispatch']);

  select count(*) into v_parties from private.branch_dispatch_seeded_parties;

  if v_parties <> 4 then
    raise exception 'ABORT: expected 4 trading branch ledgers, found % - check the data before forcing this through', v_parties;
  end if;

  update public.mst_parties p
     set modules = array_append(p.modules, 'order-to-dispatch')
    from private.branch_dispatch_seeded_parties s
   where s.party_id = p.id;

  -- -------------------------------------------------------------------- items
  -- Everything those four have actually bought, so the order form is populated
  -- the moment the customer is picked.
  create table private.branch_dispatch_seeded_items as
  select distinct i.id as item_id
    from private.branch_dispatch_seeded_parties s
    join public.mst_party_items pi on pi.party_id = s.party_id
    join public.mst_items i        on i.id = pi.item_id
   where not (i.modules @> array['order-to-dispatch']);

  select count(*) into v_items from private.branch_dispatch_seeded_items;

  update public.mst_items i
     set modules = array_append(i.modules, 'order-to-dispatch')
    from private.branch_dispatch_seeded_items s
   where s.item_id = i.id;

  raise notice 'branch ledgers into dispatch: % parties, % items', v_parties, v_items;
end $$;


-- --------------------------------------------------------------------------
-- Self-assertions. A migration that reports success without having changed
-- what it claimed is worse than one that fails.
-- --------------------------------------------------------------------------
do $check$
declare
  v_missing int;
  v_unitless int;
begin
  -- Every seeded party and item now carries the tick.
  select count(*) into v_missing
    from private.branch_dispatch_seeded_parties s
    join public.mst_parties p on p.id = s.party_id
   where not (p.modules @> array['order-to-dispatch']);
  if v_missing <> 0 then
    raise exception 'CHECK FAILED: % seeded parties are still not in Dispatch', v_missing;
  end if;

  select count(*) into v_missing
    from private.branch_dispatch_seeded_items s
    join public.mst_items i on i.id = s.item_id
   where not (i.modules @> array['order-to-dispatch']);
  if v_missing <> 0 then
    raise exception 'CHECK FAILED: % seeded items are still not in Dispatch', v_missing;
  end if;

  -- ⚠ An item with no unit prints a quantity with no unit on the gate pass.
  --   Verified zero before writing this; asserted so it stays that way.
  select count(*) into v_unitless
    from private.branch_dispatch_seeded_items s
    join public.mst_items i on i.id = s.item_id
   where i.unit_id is null;
  if v_unitless <> 0 then
    raise exception 'CHECK FAILED: % newly-offered items have no unit', v_unitless;
  end if;

  -- The 14 branch ledgers with no trade must NOT have been swept in.
  select count(*) into v_missing
    from public.mst_parties p
   where p.group_chain @> array['Branch / Divisions']
     and not exists (select 1 from public.mst_party_items pi where pi.party_id = p.id)
     and p.modules @> array['order-to-dispatch'];
  if v_missing <> 0 then
    raise exception 'CHECK FAILED: % untraded branch ledgers were put into Dispatch', v_missing;
  end if;
end $check$;

comment on table private.branch_dispatch_seeded_parties is
  'Exactly the branch ledgers 20260920120000 ticked into order-to-dispatch. Kept so the reversal can untick those and only those.';
comment on table private.branch_dispatch_seeded_items is
  'Exactly the items 20260920120000 ticked into order-to-dispatch. Kept so the reversal can untick those and only those.';
