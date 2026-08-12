-- ===========================================================================
-- CORRECTING A ROUND MAY NOW REPLACE THE RECEIVER COPY.
--
-- Until now the receiver copy was write-once and permanently uncorrectable:
--
--   * record_dispatch_confirm is its ONLY writer, and it runs once per round;
--   * update_dispatch_confirm — the one RPC that could rewrite it — is
--     unreachable, because record_dispatch_confirm archives the round in the
--     same transaction and the archive nulls dc_at, which is the single thing
--     fms_dispatch_dc_editable tests for;
--   * amend_round never named the column;
--   * a direct update on fms_dispatch_rounds is admin-only under RLS.
--
-- That was survivable while the attachment was a scanned PDF prepared at a
-- desk. It stops being survivable now that the receiver copy is PHOTOGRAPHED
-- ON A PHONE at the customer's gate: a blurred shot, a thumb over the stamp or
-- the wrong sheet of a two-delivery run are all ordinary, and every one of them
-- was permanent.
--
-- ⚠ THE FIX IS NOT TO REVIVE THE DEAD EDIT PATH. It is to add the attachment to
--   the one controlled door that already exists. amend_round is already
--   coordinator-only, already demands a written reason, and already stamps
--   amended_at / amended_by / amend_reason. A proof-of-delivery document that
--   anyone could silently swap months later would be worth less than one that
--   cannot be changed at all; this keeps the audit trail that makes the
--   replacement trustworthy.
--
-- ⚠ IT WRITES fms_dispatch_rounds, NOT fms_dispatch_orders. Only an ARCHIVED
--   round can be amended, and archiving already wiped the order header's dc_
--   block. Touching the header here would write the current round's paperwork.
--
-- ⚠ A ROUND CAN NEVER BE LEFT WITHOUT A RECEIVER COPY. This door REPLACES the
--   proof; it must never remove it. See the blank-primary refusal below.
--
-- Additive: no new columns (20260831120000 added them), no storage change —
-- fms_dispatch_can_add_doc already lets a coordinator write into `receiver`.
-- Superseded files are NOT deleted from the bucket; the row stops pointing at
-- them, which is what keeps the replaced evidence recoverable.
--
-- Restated from 20260827120000:541-655. The only changes are the three
-- attachment columns in the update, the refusal that guards them, and the
-- announcement wording.
-- ===========================================================================

begin;

create or replace function public.fms_dispatch_amend_round(p_round uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order uuid; v_no text; v_round integer; v_raiser uuid; v_status text; v_old text;
  v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
  v_reason text := nullif(trim(p->>'amend_reason'), '');
  l jsonb; v_pending numeric; v_bad text;
  v_allow numeric; v_headroom numeric; v_to_credit boolean;
  v_doc_path text; v_doc_new boolean := p ? 'dc_attachment_path';
begin
  select r.order_id, r.round_no, r.dc_status into v_order, v_round, v_old
    from public.fms_dispatch_rounds r where r.id = p_round for update;
  if v_order is null then raise exception 'That dispatch round was not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then
    raise exception 'Only a coordinator or admin can correct a completed round';
  end if;
  if v_reason is null then raise exception 'A reason is required when correcting a round'; end if;

  select o.status, o.order_no, o.raised_by, o.cc_approved_qty
    into v_status, v_no, v_raiser, v_allow
    from public.fms_dispatch_orders o where o.id = v_order for update;
  if v_status = 'cancelled' then raise exception 'This order was cancelled - its rounds can no longer be corrected'; end if;
  if v_status = 'awaiting_sales_return' then
    raise exception 'This order is waiting on its sales return - record or withdraw that first';
  end if;
  if v_dc is not null and v_dc not in ('delivered','returned') then
    raise exception 'The outcome must be Delivered or Returned';
  end if;

  -- ⚠ THE PROOF CANNOT BE REMOVED, ONLY REPLACED. Same presence contract as
  --   everywhere else in this module: the key OMITTED keeps the stored document
  --   untouched, which is what a quantity-only correction sends. But a key that
  --   IS present and blank is not "clear it" here as it would be for an optional
  --   slot - a delivered round with no receiver copy is a delivery nobody can
  --   evidence, and record_dispatch_confirm refuses to create one.
  if v_doc_new and coalesce(trim(p->>'dc_attachment_path'), '') = '' then
    raise exception 'A round cannot be left without a receiver copy - attach the replacement before saving';
  end if;

  if p ? 'lines' and jsonb_typeof(p->'lines') = 'array' then
    for l in select * from jsonb_array_elements(p->'lines') loop
      if coalesce(trim(l->>'id'), '') = '' then continue; end if;
      if coalesce(nullif(l->>'ship_qty','')::numeric, 0) <= 0 then
        raise exception 'A corrected quantity must be greater than zero - remove the line instead';
      end if;
      update public.fms_dispatch_round_items
         set ship_qty = (l->>'ship_qty')::numeric,
             lot_no   = coalesce(nullif(trim(l->>'lot_no'), ''), lot_no)
       where id = (l->>'id')::uuid and round_id = p_round;
    end loop;
  end if;

  -- The primary this correction will leave behind - the new one when page one is
  -- being replaced, the stored one when only the extra pages are. It is what the
  -- normaliser must strip from the extra pages, or a replaced page one is stored
  -- twice: once as the primary and once as an extra.
  select case when v_doc_new then nullif(p->>'dc_attachment_path','') else r.dc_attachment_path end
    into v_doc_path from public.fms_dispatch_rounds r where r.id = p_round;

  update public.fms_dispatch_rounds set
    dc_status    = coalesce(v_dc, dc_status),
    dc_attachment_path  = case when p ? 'dc_attachment_path'  then nullif(p->>'dc_attachment_path','')  else dc_attachment_path  end,
    dc_attachment_name  = case when p ? 'dc_attachment_name'  then nullif(p->>'dc_attachment_name','')  else dc_attachment_name  end,
    dc_attachment_pages = case when p ? 'dc_attachment_pages'
                               then public.fms_dispatch_doc_pages(p->'dc_attachment_pages', v_doc_path)
                               else dc_attachment_pages end,
    amended_at   = now(), amended_by = v_uid, amend_reason = v_reason
  where id = p_round;

  -- Catch an over-delivery BEFORE the recalculation trips the table CHECK and
  -- surfaces as a constraint name nobody can read.
  select string_agg(it.name, ', ') into v_bad
    from public.fms_dispatch_order_items li
    left join public.fms_dispatch_items it on it.id = li.item_id
   where li.order_id = v_order
     and coalesce((select sum(ri.ship_qty) from public.fms_dispatch_round_items ri
                   join public.fms_dispatch_rounds r on r.id = ri.round_id
                  where ri.order_item_id = li.id and r.order_id = v_order and r.dc_status = 'delivered'), 0)
         > li.quantity;
  if v_bad is not null then
    raise exception 'That correction would deliver more than was ordered on: %', v_bad;
  end if;

  perform public.fms_dispatch_recalc_dispatched(v_order);

  -- A correction that leaves something owing must re-open a closed order,
  -- otherwise the balance has nowhere to go.
  select coalesce(sum(greatest(quantity - dispatched_qty, 0)), 0),
         case when v_allow is null then null else v_allow - coalesce(sum(dispatched_qty), 0) end
    into v_pending, v_headroom
    from public.fms_dispatch_order_items where order_id = v_order;

  v_to_credit := (v_headroom is not null and v_headroom <= 0);

  if v_status = 'closed' and v_pending > 0 then
    update public.fms_dispatch_orders set
      round_no = round_no + 1, round_started_at = now(),
      status       = case when v_to_credit then 'awaiting_credit_check' else 'awaiting_material_status' end,
      current_step = case when v_to_credit then 'credit_check'          else 'material_status'          end,
      -- The same reset as the dispatch-confirm loop, for the same reason: the
      -- balance is unapproved, so the decision must be made again. Only the
      -- cumulative ceiling survives.
      cc_status     = case when v_to_credit then null else cc_status     end,
      cc_remarks    = case when v_to_credit then null else cc_remarks    end,
      cc_round_no   = case when v_to_credit then null else cc_round_no   end,
      cc_at         = case when v_to_credit then null else cc_at         end,
      cc_by         = case when v_to_credit then null else cc_by         end,
      cc_decided_at = case when v_to_credit then null else cc_decided_at end,
      cc_decided_by = case when v_to_credit then null else cc_decided_by end,
      cc_edited_at  = case when v_to_credit then null else cc_edited_at  end,
      cc_edited_by  = case when v_to_credit then null else cc_edited_by  end,
      closed_at = null
    where id = v_order;
    update public.fms_dispatch_rounds set archived_reason = 'looped'
      where id = p_round and archived_reason = 'closed';
  end if;

  -- ⚠ THE DOCUMENT SWAP IS ANNOUNCED. A correction that only replaces the
  --   receiver copy changes no quantity and no outcome, so without this clause
  --   the notification would read as though nothing happened and the swap would
  --   be invisible to everyone downstream.
  perform public.fms_dispatch_announce(
    'order', v_order, 'round_amended',
    'Round ' || v_round || ' of ' || coalesce(v_no,'an order') || ' was corrected'
      || case when v_dc is not null and v_dc is distinct from v_old
              then ' (' || v_old || ' -> ' || v_dc || ')' else '' end
      || case when v_doc_new then ' (receiver copy replaced)' else '' end
      || ': ' || v_reason
      || case when v_status = 'closed' and v_pending > 0
              then ' The order has re-opened with ' || trim(to_char(v_pending,'FM999999990.###'))
                   || ' still pending'
                   || case when v_to_credit then ', awaiting a fresh credit decision.' else '.' end
              else '' end,
    case when v_status = 'closed' and v_pending > 0
         then public.fms_dispatch_step_owner_ids(case when v_to_credit then 'credit_check' else 'material_status' end)
              || array_remove(array[v_raiser], null)
         else array_remove(array[v_raiser], null) end,
    jsonb_build_object('order_no', v_no, 'round_no', v_round, 'reason', v_reason)
  );
end $$;
grant execute on function public.fms_dispatch_amend_round(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- asserts --
do $check$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_amend_round'
     and pg_get_function_identity_arguments(p.oid) = 'p_round uuid, p jsonb';

  -- The change itself, under the presence contract.
  if v_src not like '%p ? ''dc_attachment_pages''%' then
    raise exception 'amend_round does not presence-check the replacement receiver pages'; end if;
  if v_src not like '%p ? ''dc_attachment_path''%' then
    raise exception 'amend_round does not presence-check the replacement receiver copy'; end if;
  -- ⚠ Replacing must never become clearing.
  if v_src not like '%A round cannot be left without a receiver copy%' then
    raise exception 'amend_round can now blank a round''s receiver copy'; end if;

  -- ⚠ THE HEADER IS NOT THE ARCHIVE. Only an archived round is amendable, and
  --   its header dc_ block was wiped at archive time - writing it here would
  --   stamp the CURRENT round with a historic round's paperwork.
  if v_src ~ 'update public\.fms_dispatch_orders set[^;]*dc_attachment' then
    raise exception 'amend_round writes the order header''s receiver copy'; end if;

  -- Carried forward from 20260818120000 / 20260827120000.
  if v_src not like '%Only a coordinator or admin can correct a completed round%' then
    raise exception 'amend_round lost its coordinator gate'; end if;
  if v_src not like '%A reason is required when correcting a round%' then
    raise exception 'amend_round no longer requires a reason'; end if;
  if v_src not like '%awaiting_sales_return%' then
    raise exception 'amend_round can correct a round underneath an order mid-cancellation'; end if;
  if v_src not like '%its rounds can no longer be corrected%' then
    raise exception 'amend_round lost its cancelled-order refusal'; end if;
  if v_src not like '%would deliver more than was ordered%' then
    raise exception 'amend_round lost the over-delivery guard'; end if;
  if v_src not like '%fms_dispatch_recalc_dispatched%' then
    raise exception 'amend_round no longer recalculates the delivered totals'; end if;
  if v_src not like '%archived_reason = ''looped''%' then
    raise exception 'amend_round no longer re-opens a closed order that still owes'; end if;

  -- 20260831120000 is a hard dependency: the normaliser and the column must
  -- both already exist, or every replacement silently stores nothing.
  if v_src not like '%fms_dispatch_doc_pages%' then
    raise exception 'amend_round does not normalise the replacement pages'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'fms_dispatch_rounds'
                    and column_name = 'dc_attachment_pages') then
    raise exception 'fms_dispatch_rounds.dc_attachment_pages is missing - apply 20260831120000 first'; end if;
end $check$;

commit;
