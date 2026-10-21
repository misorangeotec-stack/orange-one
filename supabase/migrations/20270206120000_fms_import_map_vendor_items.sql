-- =============================================================================
--  Purchase RM Import · the requester maps a vendor to items themselves
-- =============================================================================
--
--  Same change Order to Dispatch made in 20260927120000 (OD-9), on the Import
--  side. An Import requisition names a vendor, and only items MAPPED to that
--  vendor can be ordered. Until now, an item that existed in the Import item
--  master but was not mapped to the vendor needed a "Vendor-Item Mapping" master
--  request that the master's owner had to approve. The person raising the
--  requisition is the one who knows the vendor supplies it, so they now map it
--  in place and carry on.
--
--  Creating a NEW item or a NEW vendor is unchanged: still a master request.
--
--  ⚠ WHY AN RPC, rather than letting the browser insert the row.
--    `fms_import_vendor_item_prices_write` is
--        is_admin(uid) OR fms_import_is_master_manager('vendor_item_price', uid)
--    so a direct insert fails for exactly the people this is for. The gate here
--    is the one that already decides who may raise an Import requisition: an
--    edit grant on the Import app (module_can_edit folds in admin, and refuses a
--    view-only grant).
--
--  Additive: one function. No table, column, policy or row is changed by this
--  file itself.
-- =============================================================================

-- Returns jsonb { created, reactivated, skipped }:
--   created     — the pair is new.
--   reactivated — the pair EXISTED but was switched off. Somebody turned it off
--                 on purpose, so the screen says so instead of hiding it.
--                 UNIQUE (vendor_id, item_id) makes this the only alternative to
--                 a unique-violation the user could not interpret.
--   skipped     — already mapped and active. Nothing to do, no error.
create or replace function public.fms_import_map_vendor_items(
  p_vendor uuid,
  p_items  uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid         uuid := auth.uid();
  v_created     integer := 0;
  v_reactivated integer := 0;
  v_skipped     integer := 0;
  v_item        uuid;
  v_bad         text;
  v_existing    boolean;
  v_row_id      uuid;
begin
  -- Same shape as the OD-13 P0c guard, plus the Import edit grant.
  if v_uid is null or not public.is_staff(v_uid) then
    raise exception 'Not authorized';
  end if;
  if not public.module_can_edit(v_uid, 'import') then
    raise exception 'You do not have permission to map items in Purchase RM Import.';
  end if;

  if p_vendor is null then
    raise exception 'Pick the vendor first.';
  end if;
  if not exists (select 1 from public.fms_import_vendors v where v.id = p_vendor and v.active) then
    raise exception 'That vendor no longer exists or is switched off. Reload and try again.';
  end if;

  -- Empty selection is a no-op, not an error.
  if p_items is null or cardinality(p_items) = 0 then
    return jsonb_build_object('created', 0, 'reactivated', 0, 'skipped', 0);
  end if;

  -- Every id must resolve, or one would vanish silently from the count.
  if (select count(*) from public.fms_import_items i where i.id = any(p_items))
     <> (select count(distinct x) from unnest(p_items) x) then
    raise exception 'One of those items no longer exists. Reload and try again.';
  end if;

  -- Named, not counted: the name says which one was refused.
  select string_agg(i.name, ', ' order by i.name) into v_bad
    from public.fms_import_items i
   where i.id = any(p_items) and not i.active;
  if v_bad is not null then
    raise exception 'These items are switched off in the item master: %', v_bad;
  end if;

  foreach v_item in array (select array_agg(distinct x) from unnest(p_items) x) loop
    select id, active into v_row_id, v_existing
      from public.fms_import_vendor_item_prices
     where vendor_id = p_vendor and item_id = v_item;

    if v_row_id is null then
      -- `rate` is NOT NULL with no default; Import carries no price, and 0 is
      -- what the whole catalogue already holds. `currency` keeps its default.
      insert into public.fms_import_vendor_item_prices (vendor_id, item_id, rate, created_by)
      values (p_vendor, v_item, 0, v_uid)
      returning id into v_row_id;
      v_created := v_created + 1;
    elsif v_existing then
      v_skipped := v_skipped + 1;
    else
      update public.fms_import_vendor_item_prices
         set active = true
       where id = v_row_id;
      v_reactivated := v_reactivated + 1;
    end if;

    -- A pending "Vendor-Item Mapping" request for this same pair is now moot.
    -- Close it as approved so it leaves the owner's queue (approving it later
    -- would only hit the unique index).
    update public.fms_import_master_requests r
       set status = 'approved',
           reviewed_by = v_uid,
           review_note = 'Mapped directly on the request form',
           resolved_master_id = v_row_id
     where r.status = 'pending'
       and r.master_type = 'vendor_item_price'
       and r.proposed_payload->>'vendor_id' = p_vendor::text
       and r.proposed_payload->>'item_id'   = v_item::text;

    v_row_id := null;
    v_existing := null;
  end loop;

  return jsonb_build_object(
    'created', v_created, 'reactivated', v_reactivated, 'skipped', v_skipped);
end $$;

revoke all on function public.fms_import_map_vendor_items(uuid, uuid[]) from public, anon;
grant execute on function public.fms_import_map_vendor_items(uuid, uuid[]) to authenticated;

comment on function public.fms_import_map_vendor_items(uuid, uuid[]) is
  'Lets anyone who may raise an Import requisition map a vendor to existing Import items directly, with no approval. Gated on is_staff + module_can_edit(uid, ''import''). Reactivates a switched-off pair and reports it; closes a matching pending vendor_item_price request.';
