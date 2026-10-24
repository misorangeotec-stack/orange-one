-- ===========================================================================
-- Purchase (Domestic): the SOURCING person can cancel a PO, up to the goods.
--
-- WHY
--   Asked 2026-09-26: the purchase department - the people set as owners of the
--   "sourcing" step - must be able to cancel a PO at any stage from Share PO to
--   Follow-up, not only the PO's approver. The remark stays mandatory.
--
-- WHO MAY CANCEL
--   an owner of the "sourcing" step, the PO's approver, or an admin.
--
-- WHEN - the same for EVERYONE, admins included
--   only while the PO has NO goods receipt (GRN) and NO Tally booking. Once the
--   material is received or the purchase is booked in Tally the PO can no
--   longer be cancelled by anybody (user rule, 2026-09-26). A PO that is
--   already closed or cancelled cannot be cancelled either.
--
-- Replaces fms_purchase_cancel_po only. Same signature, so every caller keeps
-- working. Body carried forward from 20260715120000 with the gate widened.
--
-- Reversal: re-run section 3b of 20260715120000_add_fms_purchase_po_cancel.sql.
-- ===========================================================================

create or replace function public.fms_purchase_cancel_po(
  p_po_id uuid, p_reason text, p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage text;
begin
  select current_stage into v_stage from public.fms_purchase_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;

  -- The purchase department (sourcing step owners), an admin, or the PO's
  -- approver - a user stamped as approver_id on any of this PO's request lines.
  if not (public.is_admin(auth.uid())
          or public.fms_purchase_is_step_owner('sourcing', auth.uid())
          or exists (
            select 1
              from public.fms_purchase_po_items poi
              join public.fms_purchase_request_items ri on ri.id = poi.request_item_id
             where poi.po_id = p_po_id and ri.approver_id = auth.uid())) then
    raise exception 'Only the purchase department or the approver of this PO can cancel it';
  end if;

  if v_stage in ('closed','cancelled') then
    raise exception 'This PO is % and cannot be cancelled', v_stage;
  end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A remark is required to cancel a PO'; end if;

  -- No exceptions, not even for an admin.
  if exists (select 1 from public.fms_purchase_grns where po_id = p_po_id) then
    raise exception 'Goods already received — this PO can no longer be cancelled';
  end if;
  if exists (select 1 from public.fms_purchase_tally_bookings where po_id = p_po_id) then
    raise exception 'Already booked in Tally — this PO can no longer be cancelled';
  end if;

  update public.fms_purchase_pos
     set current_stage = 'cancelled',
         status        = 'cancelled',
         cancelled_by  = auth.uid(),
         cancelled_at  = now(),
         cancel_reason = btrim(p_reason)
   where id = p_po_id;

  update public.fms_purchase_request_items ri
     set status = 'cancelled',
         cancel_reason = btrim(p_reason)
   where ri.id in (
     select poi.request_item_id from public.fms_purchase_po_items poi where poi.po_id = p_po_id
   );

  if p_request_id is not null then
    update public.fms_purchase_po_cancel_requests
       set status = 'approved', reviewed_by = auth.uid()
     where id = p_request_id and po_id = p_po_id and status = 'pending';
  end if;
end $$;
grant execute on function public.fms_purchase_cancel_po(uuid, text, uuid) to authenticated;
