-- Purchase FMS (procurement) — GRN PHOTO capture.
--
-- Lets the inward step attach a photo to a goods receipt (esp. for damaged /
-- partial-damage condition, for records). Additive: two nullable columns on
-- fms_purchase_grns, and record_grn extended to persist them. Photos live in the
-- existing `fms-purchase-docs` storage bucket (same as PI/PO documents).

alter table public.fms_purchase_grns add column if not exists photo_path text;
alter table public.fms_purchase_grns add column if not exists photo_name text;

-- Replace record_grn to persist the optional photo. Drop the old 6-arg signature
-- first so there is no ambiguous overload for PostgREST to resolve.
drop function if exists public.fms_purchase_record_grn(uuid, jsonb, uuid, text, text, text);

create or replace function public.fms_purchase_record_grn(
  p_po_id uuid,
  p_items jsonb,            -- [{po_item_id, received_qty, condition}]
  p_pi_id uuid default null, p_gate_register_no text default '', p_condition text default 'good', p_note text default '',
  p_photo_path text default '', p_photo_name text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_grn_id uuid; v_elem jsonb; v_ordered numeric(14,3); v_recv numeric(14,3); v_poid uuid;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('inward', auth.uid())) then
    raise exception 'Not authorized to record receipts';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Record at least one received item'; end if;

  insert into public.fms_purchase_grns (po_id, pi_id, gate_register_no, condition, note, received_by, photo_path, photo_name)
  values (p_po_id, p_pi_id, nullif(p_gate_register_no,''), coalesce(nullif(p_condition,''),'good'), nullif(p_note,''), auth.uid(),
          nullif(p_photo_path,''), nullif(p_photo_name,''))
  returning id into v_grn_id;

  for v_elem in select * from jsonb_array_elements(p_items) loop
    if coalesce((v_elem->>'received_qty')::numeric,0) <= 0 then continue; end if;
    -- guard: cannot receive more than the ordered qty across all GRNs.
    select qty, po_id into v_ordered, v_poid from public.fms_purchase_po_items where id = (v_elem->>'po_item_id')::uuid;
    if v_poid is distinct from p_po_id then raise exception 'Line does not belong to this PO'; end if;
    select coalesce(sum(received_qty),0) into v_recv from public.fms_purchase_grn_items where po_item_id = (v_elem->>'po_item_id')::uuid;
    if v_recv + (v_elem->>'received_qty')::numeric > v_ordered + 0.001 then
      raise exception 'Received qty exceeds ordered qty for a line';
    end if;
    insert into public.fms_purchase_grn_items (grn_id, po_item_id, received_qty, condition)
    values (v_grn_id, (v_elem->>'po_item_id')::uuid, (v_elem->>'received_qty')::numeric, coalesce(nullif(v_elem->>'condition',''),'good'));
  end loop;

  perform public.fms_purchase_refresh_po(p_po_id);
  return v_grn_id;
end $$;
grant execute on function public.fms_purchase_record_grn(uuid, jsonb, uuid, text, text, text, text, text) to authenticated;
