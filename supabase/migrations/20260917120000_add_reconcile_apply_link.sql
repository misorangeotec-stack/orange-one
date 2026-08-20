-- ===========================================================================
-- RECONCILE, AFTER THE CUTOVER — make a decision do something again.
--
-- WHY THIS EXISTS
--   The reconcile screen was built to RECORD opinions, and Phase 1's cutover
--   was the thing that APPLIED them. That was the right split while the cutover
--   was still ahead of us. It is wrong now: the cutover has run, so a link
--   recorded today writes a row to mst_reconcile_links and changes nothing —
--   the Dispatch row and its Tally twin stay two rows forever, and the screen
--   quietly lies about having resolved anything.
--
--   This function is the missing half. It performs, for ONE row, exactly what
--   the cutover did for 546 of them.
--
-- THE IDEA IS THE SAME ONE THAT MADE THE CUTOVER SAFE
--   The row Dispatch already points at SURVIVES and absorbs its Tally twin. It
--   keeps its id, so every order keeps the exact customer_id / item_id it has
--   today and nothing is rewritten. The twin's catalogue is repointed onto the
--   survivor, the twin's Tally-owned fields are carried across, and only then is
--   the twin deleted and its guid moved over.
--
-- ⚠ ORDER MATTERS, FOR THE SAME REASON IT DID IN THE CUTOVER
--   mst_party_items CASCADES from both party_id and item_id. Delete the twin
--   before repointing its catalogue and those rows vanish silently. So:
--   repoint first, delete second. Always.
--
-- ⚠ tally_guid IS UNIQUE. The guid can only be written onto the survivor after
--   the twin holding it is gone.
-- ===========================================================================

create schema if not exists private;

-- --------------------------------------------------------------------------
-- Undo data. Every merge is reversible because the twin is copied out whole
-- before it is deleted, along with any catalogue row that could not move.
-- --------------------------------------------------------------------------
create table if not exists private.reconcile_merges (
  id            uuid primary key default gen_random_uuid(),
  merged_at     timestamptz not null default now(),
  merged_by     uuid,
  legacy_table  text not null,
  survivor_id   uuid not null,
  twin_id       uuid not null,
  tally_guid    text not null,
  twin_row      jsonb not null,
  survivor_before jsonb not null,
  moved_links   int not null default 0,
  dropped_links jsonb not null default '[]'::jsonb
);

comment on table private.reconcile_merges is
  'One row per post-cutover reconcile merge. twin_row and survivor_before are complete pre-merge copies, so any single merge can be undone by hand.';

create index if not exists reconcile_merges_survivor_idx on private.reconcile_merges (survivor_id);


create or replace function public.mst_apply_reconcile_link(
  p_legacy_table text,
  p_legacy_id    uuid,
  p_tally_guid   text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_keep uuid; v_twin uuid; v_moved int := 0; v_dropped jsonb := '[]'::jsonb;
  v_twin_row jsonb; v_keep_row jsonb; v_orders int;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an admin may apply a reconcile decision';
  end if;
  if p_legacy_table not in ('fms_dispatch_customers', 'fms_dispatch_items') then
    raise exception 'Unknown legacy table %', p_legacy_table;
  end if;
  if coalesce(trim(p_tally_guid), '') = '' then
    raise exception 'A Tally record is required';
  end if;

  -- =====================================================================
  if p_legacy_table = 'fms_dispatch_customers' then
    select id into v_keep from public.mst_parties where id = p_legacy_id;
    if v_keep is null then
      raise exception 'That customer is not in the central masters';
    end if;

    select id into v_twin from public.mst_parties where tally_guid = p_tally_guid;
    if v_twin is null then
      raise exception 'No Tally party carries that record any more - re-sync and try again';
    end if;
    if v_twin = v_keep then
      return 'already linked';
    end if;

    -- Nothing may be pointing at the row about to be deleted.
    select count(*) into v_orders from public.fms_dispatch_orders where customer_id = v_twin;
    if v_orders > 0 then
      raise exception 'The Tally record is itself used by % order(s) - merge refused', v_orders;
    end if;

    select to_jsonb(t) into v_twin_row from public.mst_parties t where t.id = v_twin;
    select to_jsonb(k) into v_keep_row from public.mst_parties k where k.id = v_keep;

    -- 1. repoint the twin's catalogue, BEFORE anything is deleted
    with moved as (
      update public.mst_party_items pi set party_id = v_keep
       where pi.party_id = v_twin
         and not exists (select 1 from public.mst_party_items x
                          where x.party_id = v_keep and x.item_id = pi.item_id)
      returning 1)
    select count(*) into v_moved from moved;

    -- whatever could not move is a duplicate pair; record it, then let it cascade
    select coalesce(jsonb_agg(to_jsonb(pi)), '[]'::jsonb) into v_dropped
      from public.mst_party_items pi where pi.party_id = v_twin;

    -- 2. carry the Tally-owned values across while the twin still exists
    --    is_customer / is_vendor / modules are UNIONED, never overwritten: a
    --    ledger Tally files as a creditor is still a Dispatch customer, and
    --    overwriting would hide it from the module that just linked it.
    update public.mst_parties keep set
        name            = twin.name,
        gstin           = coalesce(twin.gstin, keep.gstin),
        sub_group       = twin.sub_group,
        group_chain     = twin.group_chain,
        credit_limit    = twin.credit_limit,
        credit_period   = twin.credit_period,
        company_id      = twin.company_id,
        tally_tenant    = coalesce(twin.tally_tenant, keep.tally_tenant),
        is_customer     = keep.is_customer or twin.is_customer,
        is_vendor       = keep.is_vendor  or twin.is_vendor,
        modules         = (select coalesce(array_agg(distinct m), '{}')
                             from unnest(keep.modules || twin.modules) m),
        source          = 'tally',
        tally_synced_at = twin.tally_synced_at
      from public.mst_parties twin
     where keep.id = v_keep and twin.id = v_twin;

    -- 3. delete the twin, then move its guid across (UNIQUE forces this order)
    delete from public.mst_parties where id = v_twin;
    update public.mst_parties set tally_guid = p_tally_guid where id = v_keep;

  -- =====================================================================
  else
    select id into v_keep from public.mst_items where id = p_legacy_id;
    if v_keep is null then
      raise exception 'That item is not in the central masters';
    end if;

    select id into v_twin from public.mst_items where tally_guid = p_tally_guid;
    if v_twin is null then
      raise exception 'No Tally item carries that record any more - re-sync and try again';
    end if;
    if v_twin = v_keep then
      return 'already linked';
    end if;

    select count(*) into v_orders from public.fms_dispatch_order_items where item_id = v_twin;
    if v_orders > 0 then
      raise exception 'The Tally record is itself used by % order line(s) - merge refused', v_orders;
    end if;

    select to_jsonb(t) into v_twin_row from public.mst_items t where t.id = v_twin;
    select to_jsonb(k) into v_keep_row from public.mst_items k where k.id = v_keep;

    with moved as (
      update public.mst_party_items pi set item_id = v_keep
       where pi.item_id = v_twin
         and not exists (select 1 from public.mst_party_items x
                          where x.item_id = v_keep and x.party_id = pi.party_id)
      returning 1)
    select count(*) into v_moved from moved;

    select coalesce(jsonb_agg(to_jsonb(pi)), '[]'::jsonb) into v_dropped
      from public.mst_party_items pi where pi.item_id = v_twin;

    -- item_type is RE-DERIVED, not inherited blind: the guess trigger is
    -- INSERT-only, so a portal row created without a group carries the weakest
    -- possible guess. The twin knows its real name and its real Tally group.
    update public.mst_items keep set
        name            = twin.name,
        company_id      = twin.company_id,
        group_id        = twin.group_id,
        unit_id         = coalesce(twin.unit_id, keep.unit_id),
        hsn_code        = coalesce(twin.hsn_code, keep.hsn_code),
        item_type       = coalesce(twin.item_type,
                            public.mst_guess_item_type(
                              twin.name,
                              (select g.name from public.mst_item_groups g where g.id = twin.group_id)),
                            keep.item_type),
        tally_tenant    = coalesce(twin.tally_tenant, keep.tally_tenant),
        modules         = (select coalesce(array_agg(distinct m), '{}')
                             from unnest(keep.modules || twin.modules) m),
        source          = 'tally',
        tally_synced_at = twin.tally_synced_at
      from public.mst_items twin
     where keep.id = v_keep and twin.id = v_twin;

    delete from public.mst_items where id = v_twin;
    update public.mst_items set tally_guid = p_tally_guid where id = v_keep;
  end if;

  insert into private.reconcile_merges
    (merged_by, legacy_table, survivor_id, twin_id, tally_guid,
     twin_row, survivor_before, moved_links, dropped_links)
  values (auth.uid(), p_legacy_table, v_keep, v_twin, p_tally_guid,
          v_twin_row, v_keep_row, v_moved, v_dropped);

  return format('merged: %s catalogue row(s) moved, %s duplicate(s) dropped',
                v_moved, jsonb_array_length(v_dropped));
end $function$;

comment on function public.mst_apply_reconcile_link(text, uuid, text) is
  'Applies ONE reconcile link after the Phase 1 cutover: the row Dispatch already points at absorbs its Tally twin, keeping its id so no order is rewritten. Backed up into private.reconcile_merges.';

revoke all on function public.mst_apply_reconcile_link(text, uuid, text) from public, anon;
grant execute on function public.mst_apply_reconcile_link(text, uuid, text) to authenticated;
