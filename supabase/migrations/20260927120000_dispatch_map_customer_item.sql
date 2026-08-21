-- =============================================================================
--  OD-9 · The user maps a customer to an item themselves
-- =============================================================================
--
--  Mapping a customer to an item stops being a REQUEST somebody approves and
--  becomes something the person raising the order does, in place. Of the 122
--  master requests ever raised in this module, 85 were customer-item mappings
--  and only 5 were ever rejected — the queue was ceremony, and it blocked the
--  one person who could see what was missing.
--
--  Two things here, and neither drops or rewrites anything:
--
--    1. a trigger that stamps `created_by` on a hand-made mapping;
--    2. the SECURITY DEFINER RPC that lets an ordinary order-raiser write one.
--
--  ⚠ WHY AN RPC AT ALL, rather than letting the browser insert the row.
--    `mst_party_items_write` is
--        is_admin(uid) OR mst_is_master_manager('party_item', uid)
--    so a direct insert fails with a policy violation for EXACTLY the people
--    this feature exists for. The gate below is the one that already decides
--    who may raise the sales order: if you may raise the order, you may map the
--    item it needs.
-- =============================================================================


-- ============================================================ created_by ====
--
-- WHO MADE THIS MAPPING — and it has to be this column, not `source`.
--
-- ⚠ `source` CANNOT CARRY THE MARK. masters-sync upserts mst_party_items on
--   (party_id, item_id) and sets source = 'sales_register' unconditionally, so
--   the first time the customer actually BUYS the item they were mapped to, any
--   'portal' mark is overwritten and the row silently drops out of the filter
--   that was supposed to show it. Four rows on the live table already show that
--   damage: created_by set, source reading 'sales_register'.
--
--   `created_by` is not in that upsert's column list, so nothing overwrites it.
--   And the sync runs on the service key, where auth.uid() is null — which
--   makes the reading exact rather than approximate:
--
--       created_by IS NULL      -> a machine derived it from the sales register
--       created_by IS NOT NULL  -> a person created it by hand
--
-- The trigger exists because the client write path does NOT set the column:
-- masterWrites.insertMasters sends only source, so every mapping hand-added in
-- Central Masters today is anonymous. Defaulting it here fixes every path at
-- once — this RPC, the Masters screen, and the approve arm that still sets it
-- explicitly (a non-null value is left exactly as sent).
create or replace function public.mst_party_items_stamp_created_by()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();   -- null under the service key. Deliberate.
  end if;
  return new;
end $$;

drop trigger if exists stamp_created_by on public.mst_party_items;
create trigger stamp_created_by
  before insert on public.mst_party_items
  for each row execute function public.mst_party_items_stamp_created_by();


-- ================================================== map customer -> item ====
--
-- Returns jsonb { created, reactivated, skipped } rather than a bare count,
-- because the three outcomes are not interchangeable on screen:
--
--   created     — the pair is new.
--   reactivated — the pair EXISTED and was switched off. Somebody turned it off
--                 on purpose, so turning it back on has to be reported, never
--                 silent. UNIQUE (party_id, item_id) means this is the only
--                 alternative to a unique-violation the user cannot interpret.
--   skipped     — already mapped and already active. Nothing to do, no error.
create or replace function public.fms_dispatch_map_customer_item(
  p_customer uuid,
  p_company  uuid,
  p_items    uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_created     integer := 0;
  v_reactivated integer := 0;
  v_skipped     integer := 0;
  v_item        uuid;
  v_bad         text;
  v_existing    boolean;
begin
  -- THE GATE. Deliberately `fms_dispatch_can_raise` and not a new rule: the
  -- mapping only ever exists to unblock an order, so the right to create one is
  -- the right to raise one. It already folds in module_can_edit, so a view-only
  -- user is refused here without a second test.
  if not public.fms_dispatch_can_raise(auth.uid()) then
    raise exception 'You do not have permission to map items in Order to Dispatch.';
  end if;

  if p_customer is null or p_company is null then
    raise exception 'A mapping needs both a customer and a company';
  end if;

  -- Empty selection is a no-op, not an error. The modal can call this on a
  -- save with nothing ticked and get an honest zero back.
  if p_items is null or cardinality(p_items) = 0 then
    return jsonb_build_object('created', 0, 'reactivated', 0, 'skipped', 0);
  end if;

  -- Already written, already produces a message naming BOTH halves of the pair
  -- it refused. A null company_id on the party still means "no book yet", which
  -- every company may bill — the newly-approved-customer case.
  perform public.fms_dispatch_assert_customer_of_company(p_customer, p_company);

  /*
    THE COMPANY RULE IS ENFORCED HERE, not only in the picker.

    The screen offers only the selected company's own book, but the argument is
    just an array of uuids: a tab left open across a company change, or a
    hand-rolled call, would otherwise write a pair the form would never have
    shown. Same reasoning as fms_dispatch_replace_lines, which re-checks the
    customer-item rule server-side for exactly this reason.

    ⚠ Named, not counted. "Invalid item" sends somebody hunting; the name says
      which one was refused and therefore what to change.
  */
  select string_agg(i.name, ', ' order by i.name) into v_bad
    from public.mst_items i
   where i.id = any(p_items)
     and (i.company_id is distinct from p_company or not i.active);

  if v_bad is not null then
    raise exception 'These items are not in that company''s book, or are switched off: %', v_bad;
  end if;

  -- Every id must resolve. A stale id would otherwise vanish silently and the
  -- user would count the rows and find one missing with nothing to explain it.
  if (select count(*) from public.mst_items i where i.id = any(p_items))
     <> cardinality(p_items) then
    raise exception 'One of those items no longer exists. Reload and try again.';
  end if;

  foreach v_item in array p_items loop
    select active into v_existing
      from public.mst_party_items
     where party_id = p_customer and item_id = v_item;

    if v_existing is null then
      insert into public.mst_party_items (party_id, item_id, source, created_by)
      values (p_customer, v_item, 'portal', auth.uid());
      v_created := v_created + 1;

    elsif v_existing then
      v_skipped := v_skipped + 1;

    else
      -- Switched off by somebody. Turn it back on, and COUNT it separately so
      -- the caller can say so out loud.
      update public.mst_party_items
         set active = true, updated_at = now()
       where party_id = p_customer and item_id = v_item;
      v_reactivated := v_reactivated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created, 'reactivated', v_reactivated, 'skipped', v_skipped);
end $$;

revoke all on function public.fms_dispatch_map_customer_item(uuid, uuid, uuid[]) from public;
grant execute on function public.fms_dispatch_map_customer_item(uuid, uuid, uuid[]) to authenticated;

comment on function public.fms_dispatch_map_customer_item(uuid, uuid, uuid[]) is
  'OD-9. Lets an order-raiser map a customer to items of that company''s book directly, with no approval step. Gated on fms_dispatch_can_raise. Reactivates a pair that was switched off rather than failing the unique index, and reports which happened.';
