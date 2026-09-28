-- ===========================================================================
-- OD-14 PHASE 1 — AN ADMIN CAN GIVE A NEW CUSTOMER SOMETHING TO ORDER,
--                 WITHOUT LEAVING THE FORM THAT CREATES THEM.
--
-- Setup → Customer Logins can tick a customer's ledgers, name who is told, and
-- create their login — and then cannot give them a single item to order. The
-- save refuses ("No items mapped — their order screen would be empty") and the
-- admin has to go to Central Masters → Customer Items and do it again there.
--
-- Only 817 of 7,948 active ledgers carry any row in mst_party_items, so this is
-- the ordinary case for a new customer, not an edge.
--
-- ⚠ WHY A NEW RPC AND NOT ONE OF THE TWO THAT EXIST.
--
--   • A direct insert (what core/admin/Masters.tsx does) is refused by RLS:
--     mst_party_items_write is `is_admin OR mst_is_master_manager('party_item')`.
--     The customer form is COORDINATOR-gated, and a process coordinator who is
--     neither of those would get a policy violation on save — from a form that
--     had just let them fill everything in.
--
--   • fms_dispatch_map_customer_item (OD-9) takes ONE COMPANY at a time and can
--     only insert or reactivate. A customer org spans up to five books, and this
--     screen has to be able to take an item AWAY as well.
--
-- ⚠ THE ADMIN NEVER PICKS A BOOK, AND THAT IS THE WHOLE POINT OF THE SIGNATURE.
--   Tally files a stock item in exactly one company book, so the item ITSELF
--   says which book it belongs to. Asking the admin to choose the book first —
--   as the OD-9 modal does — is asking them a question the data already answers.
--   So `p_add` and `p_remove` are plain item ids and this function resolves the
--   ledger for each one.
--
--   That resolution is only unambiguous because fms_dispatch_save_customer_org
--   refuses two ticked ledgers in the same book. This function re-asserts that
--   rule rather than trusting it, because it accepts party_ids from the caller
--   and the Add form calls it before any org row exists.
--
-- ⚠ IT TAKES party_ids, NOT AN ORG ID. On the Add form there is no org yet —
--   the ledgers are ticked in the browser and the customer is saved afterwards.
--   Keying on the org would make the item section dead until after the first
--   save, which is exactly the trip to another screen this removes.
--
-- Also fixes a real inconsistency in the readiness check — see part 2.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. SET A CUSTOMER'S ITEMS, ACROSS EVERY BOOK THEY ARE TICKED IN
-- ===========================================================================

create or replace function public.fms_dispatch_set_customer_org_items(
  p_party_ids uuid[], p_add uuid[] default '{}', p_remove uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_parties uuid[] := coalesce(p_party_ids, '{}'::uuid[]);
  v_add     uuid[] := coalesce(p_add,       '{}'::uuid[]);
  v_remove  uuid[] := coalesce(p_remove,    '{}'::uuid[]);
  v_bad     text;
  v_item    uuid;
  v_party   uuid;
  v_book    text;
  v_state   boolean;
  v_added       integer := 0;
  v_reactivated integer := 0;
  v_removed     integer := 0;
  v_skipped     integer := 0;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then
    raise exception 'Only a dispatch coordinator can change what a customer may order';
  end if;

  if cardinality(v_parties) = 0 then
    raise exception 'Tick the customer''s ledgers first';
  end if;

  -- --- the ticked ledgers must be what they claim to be --------------------
  -- Same three assertions fms_dispatch_save_customer_org makes, and for the same
  -- reasons. They are repeated rather than assumed because this function takes
  -- the list from the caller, not from a saved row.
  select string_agg(x::text, ', ') into v_bad
    from unnest(v_parties) x
   where not exists (select 1 from public.mst_parties mp
                      where mp.id = x and mp.is_customer and mp.active);
  if v_bad is not null then
    raise exception 'One of the ticked ledgers is not an active customer ledger (%)', v_bad;
  end if;

  select string_agg(mp.name, ', ') into v_bad
    from public.mst_parties mp
   where mp.id = any (v_parties) and mp.company_id is null;
  if v_bad is not null then
    raise exception 'This ledger has no billing company, so no item could be filed against it: %', v_bad;
  end if;

  -- ⚠ WITHOUT THIS THE ITEM→LEDGER RESOLUTION BELOW IS A COIN TOSS. Two ticked
  --   ledgers in one book and `select ... limit 1` would pick either.
  select string_agg(c.name, ', ') into v_bad
    from (select mp.company_id, count(*) n
            from public.mst_parties mp
           where mp.id = any (v_parties)
           group by mp.company_id having count(*) > 1) d
    join public.mst_companies c on c.id = d.company_id;
  if v_bad is not null then
    raise exception 'Two ticked ledgers belong to the same billing company (%). Tick only one per company.', v_bad;
  end if;

  -- --- every id must resolve ----------------------------------------------
  -- A stale id would otherwise vanish silently and the admin would count the
  -- rows and find one missing with nothing to explain it. Same guard, same
  -- reason, as fms_dispatch_map_customer_item.
  if (select count(*) from public.mst_items i
       where i.id = any (v_add || v_remove)) <> cardinality(v_add || v_remove) then
    raise exception 'One of those items no longer exists. Reload and try again.';
  end if;

  -- --- add -----------------------------------------------------------------
  foreach v_item in array v_add loop
    select mp.id into v_party
      from public.mst_items i
      join public.mst_parties mp on mp.company_id = i.company_id
     where i.id = v_item and mp.id = any (v_parties);

    if v_party is null then
      -- ⚠ NAME THE BOOK. "That item cannot be mapped" sends the admin looking
      --   for a fault; naming the book tells them the actual answer, which is
      --   either "tick that ledger too" or "this customer does not buy from
      --   that company".
      select coalesce(nullif(trim(c.alias), ''), c.name) || coalesce(' - ' || c.location, ''),
             i.name
        into v_book, v_bad
        from public.mst_items i
        left join public.mst_companies c on c.id = i.company_id
       where i.id = v_item;
      raise exception '% is filed under %''s book, and this customer has no ticked ledger there.',
        coalesce(v_bad, 'That item'), coalesce(v_book, 'no company');
    end if;

    select active into v_state
      from public.mst_party_items where party_id = v_party and item_id = v_item;

    if v_state is null then
      insert into public.mst_party_items (party_id, item_id, source, created_by)
      values (v_party, v_item, 'portal', v_uid);
      v_added := v_added + 1;
    elsif v_state then
      v_skipped := v_skipped + 1;
    else
      -- Switched off by somebody. Reactivate rather than fail the unique index,
      -- and count it apart so the caller can say which happened.
      update public.mst_party_items
         set active = true, updated_at = now()
       where party_id = v_party and item_id = v_item;
      v_reactivated := v_reactivated + 1;
    end if;
  end loop;

  -- --- remove ---------------------------------------------------------------
  -- ⚠ SOFT, ALWAYS. mst_party_items carries `active` and the whole app treats a
  --   switched-off pair as removed; masters-sync deliberately never rewrites it,
  --   so a hand-removed pair stays removed even after the customer buys the item
  --   again. A DELETE here would be undone by the next Tally sync.
  --
  -- ⚠ AND IT SWEEPS EVERY TICKED LEDGER, NOT THE ITEM'S OWN BOOK. Removal is the
  --   one place the tidy "an item knows its book" rule breaks down, because
  --   NOTHING CONSTRAINS A MAPPING TO ITS OWN BOOK: Central Masters → Customer
  --   Items has an optional company filter, so an O-tec item can be, and is,
  --   mapped to a customer's Enterprise ledger as well.
  --
  --   Measured on live data: 5 of Bishen's items and 5 of Kalahansh's are each
  --   mapped to TWO of that customer's ledgers. Resolving the ledger from
  --   `mst_items.company_id` on the way out would switch off one of the pair and
  --   leave the other active — so the admin presses ×, the row disappears, they
  --   save, and the customer can still order it. Which is worse than the button
  --   not being there.
  foreach v_item in array v_remove loop
    update public.mst_party_items
       set active = false, updated_at = now()
     where item_id = v_item and party_id = any (v_parties) and active;
    if found then v_removed := v_removed + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  return jsonb_build_object(
    'added', v_added, 'reactivated', v_reactivated,
    'removed', v_removed, 'skipped', v_skipped);
end
$fn$;

revoke all on function public.fms_dispatch_set_customer_org_items(uuid[], uuid[], uuid[]) from public;
grant execute on function public.fms_dispatch_set_customer_org_items(uuid[], uuid[], uuid[]) to authenticated;

comment on function public.fms_dispatch_set_customer_org_items(uuid[], uuid[], uuid[]) is
  'OD-14. Sets what a customer may order, from Setup -> Customer Logins, across every book '
  'their ticked ledgers occupy. Takes plain item ids and resolves the ledger from each item''s '
  'own company, so the admin never picks a book. Coordinator-gated, because the form is; '
  'removals are soft (active = false), because masters-sync would undo a delete.';

-- ===========================================================================
-- 2. READINESS COUNTED SWITCHED-OFF MAPPINGS AS ITEMS
-- ===========================================================================
-- Both arms filtered `i.active` but not `pi.active`, so a pair an admin had
-- deliberately switched off still counted toward `item_count` and still
-- satisfied the "items" readiness arm. A customer whose every mapping had been
-- withdrawn therefore read "Ready to switch on: Yes" and opened an empty order
-- screen.
--
-- Invisible until now because nothing showed the mapping list next to the
-- count. Phase 1 puts them side by side, so the two have to agree.
--
-- The signature is unchanged on purpose: fms_dispatch_customer_orgs_admin and
-- fms_dispatch_save_customer_org both call it and neither needs touching.
create or replace function public.fms_dispatch_customer_org_readiness(
  p_party_ids uuid[], p_notify_user_ids uuid[], p_primary_party_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select jsonb_build_object(
    'missing', coalesce(jsonb_agg(m order by m), '[]'::jsonb),
    'item_count', (
      select count(distinct i.name)
        from public.mst_party_items pi
        join public.mst_items i on i.id = pi.item_id
       where pi.party_id = any (coalesce(p_party_ids, '{}'::uuid[]))
         and pi.active and i.active
    )
  )
  from (
    select 'ledgers' as m where coalesce(cardinality(p_party_ids), 0) = 0
    union all
    select 'primary_ledger'
     where p_primary_party_id is null
        or not (p_primary_party_id = any (coalesce(p_party_ids, '{}'::uuid[])))
    union all
    select 'recipients' where coalesce(cardinality(p_notify_user_ids), 0) = 0
    union all
    select 'items' where not exists (
       select 1 from public.mst_party_items pi
        join public.mst_items i on i.id = pi.item_id
        where pi.party_id = any (coalesce(p_party_ids, '{}'::uuid[]))
          and pi.active and i.active)
  ) s;
$fn$;

commit;
