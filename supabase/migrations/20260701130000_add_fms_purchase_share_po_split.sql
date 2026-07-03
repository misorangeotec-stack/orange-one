-- ===========================================================================
-- Purchase FMS — split "Share PO & Collect PI" into TWO steps and attach the
-- PO PDF (generated in the ERP/Tally) at the Share step.
--
--   Step 5  share_po    — Share PO + upload the PO PDF (now REQUIRED)
--   Step 6  collect_pi  — Collect the vendor PI(s)   [was folded into share_po]
--
-- Additive only: two new nullable columns on fms_purchase_pos (reusing the
-- existing private `fms-purchase-docs` bucket + policies from the PI-doc
-- migration), the share RPC gains the document params + requires the PDF and
-- advances the stage to `collect_pi`, and the add-PI RPC is re-owned to the new
-- `collect_pi` step so the two steps can have different owners.
-- ===========================================================================

-- 1. PO document + share-detail columns --------------------------------------
alter table public.fms_purchase_pos
  add column if not exists document_path text,   -- storage object path in fms-purchase-docs
  add column if not exists document_name text,   -- original filename for display
  add column if not exists tally_po_no   text,   -- the PO number generated in Tally/ERP (entered at Share)
  add column if not exists share_remarks text;   -- optional remarks captured when sharing

-- 2. Share PO RPC — require the PDF, store it, advance to collect_pi ----------
drop function if exists public.fms_purchase_share_po(uuid);
drop function if exists public.fms_purchase_share_po(uuid, text, text);
create or replace function public.fms_purchase_share_po(
  p_po_id uuid,
  p_document_path text default null,
  p_document_name text default null,
  p_tally_po_no text default null,
  p_remarks text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to share this PO';
  end if;
  if nullif(p_document_path,'') is null then
    raise exception 'The PO PDF is required to mark the PO shared';
  end if;
  if nullif(p_tally_po_no,'') is null then
    raise exception 'The Tally PO number is required to mark the PO shared';
  end if;
  update public.fms_purchase_pos
     set status        = case when status = 'generated' then 'shared' else status end,
         current_stage = case when current_stage = 'share_po' then 'collect_pi' else current_stage end,
         document_path = nullif(p_document_path,''),
         document_name = nullif(p_document_name,''),
         tally_po_no   = nullif(p_tally_po_no,''),
         share_remarks = nullif(p_remarks,'')
   where id = p_po_id;
end $$;
grant execute on function public.fms_purchase_share_po(uuid, text, text, text, text) to authenticated;

-- 3. Re-own the add-PI RPC to the new collect_pi step ------------------------
-- (same signature as the PI-document migration; only the step-owner check changes)
create or replace function public.fms_purchase_add_pi(
  p_po_id uuid,
  p_vendor_pi_no text,
  p_items jsonb,           -- [{po_item_id, qty}]
  p_payment_terms text default 'on_delivery',
  p_pi_value numeric default 0,
  p_dispatch_date date default null,
  p_document_path text default null,
  p_document_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pi_id uuid; v_elem jsonb;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('collect_pi', auth.uid())) then
    raise exception 'Not authorized to add PIs';
  end if;
  if nullif(p_vendor_pi_no,'') is null then raise exception 'Vendor PI number is required'; end if;

  insert into public.fms_purchase_pis (po_id, vendor_pi_no, payment_terms, pi_value, dispatch_date, document_path, document_name, created_by)
  values (p_po_id, p_vendor_pi_no, coalesce(nullif(p_payment_terms,''),'on_delivery'), coalesce(p_pi_value,0), p_dispatch_date,
          nullif(p_document_path,''), nullif(p_document_name,''), auth.uid())
  returning id into v_pi_id;

  if p_items is not null then
    for v_elem in select * from jsonb_array_elements(p_items) loop
      if coalesce((v_elem->>'qty')::numeric,0) > 0 then
        insert into public.fms_purchase_pi_items (pi_id, po_item_id, qty)
        values (v_pi_id, (v_elem->>'po_item_id')::uuid, (v_elem->>'qty')::numeric);
      end if;
    end loop;
  end if;

  update public.fms_purchase_pos set status = case when status='generated' then 'shared' else status end where id = p_po_id;
  return v_pi_id;
end $$;
grant execute on function public.fms_purchase_add_pi(uuid, text, jsonb, text, numeric, date, text, text) to authenticated;
