-- ===========================================================================
-- Purchase FMS (import) — PAYMENT TERMS move from the PI to the PO.
--
-- Business change: payment terms are decided when the PO is shared, not when a
-- vendor PI is collected. From now on terms live on the PO and drive whether an
-- advance is due. The PI keeps its own (now dormant) payment_terms column for
-- backward compatibility, but nothing new is written to it.
--
-- Additive only: one new nullable column on fms_import_pos + the share_po RPC
-- gains a p_payment_terms param. Existing POs are backfilled from their first
-- PI's terms so in-flight orders keep behaving exactly as before.
-- (refresh_po is re-derived to read PO terms in the po-based-followup migration.)
-- ===========================================================================

-- 1. PO payment-terms column -------------------------------------------------
alter table public.fms_import_pos
  add column if not exists payment_terms text
    check (payment_terms is null
           or payment_terms in ('full_advance','partial_advance','credit','on_delivery'));

-- Backfill from each PO's earliest PI so existing orders keep their advance logic.
update public.fms_import_pos p
   set payment_terms = sub.payment_terms
  from (
    select distinct on (po_id) po_id, payment_terms
      from public.fms_import_pis
     order by po_id, created_at
  ) sub
 where sub.po_id = p.id
   and p.payment_terms is null;

-- 2. Share PO RPC — capture payment terms at the Share step ------------------
drop function if exists public.fms_import_share_po(uuid, text, text, text, text);
create or replace function public.fms_import_share_po(
  p_po_id uuid,
  p_document_path text default null,
  p_document_name text default null,
  p_tally_po_no text default null,
  p_remarks text default null,
  p_payment_terms text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to share this PO';
  end if;
  if nullif(p_document_path,'') is null then
    raise exception 'The PO PDF is required to mark the PO shared';
  end if;
  if nullif(p_tally_po_no,'') is null then
    raise exception 'The Tally PO number is required to mark the PO shared';
  end if;
  if nullif(p_payment_terms,'') is not null
     and p_payment_terms not in ('full_advance','partial_advance','credit','on_delivery') then
    raise exception 'Invalid payment terms';
  end if;
  update public.fms_import_pos
     set status        = case when status = 'generated' then 'shared' else status end,
         current_stage = case when current_stage = 'share_po' then 'collect_pi' else current_stage end,
         document_path = nullif(p_document_path,''),
         document_name = nullif(p_document_name,''),
         tally_po_no   = nullif(p_tally_po_no,''),
         share_remarks = nullif(p_remarks,''),
         payment_terms = coalesce(nullif(p_payment_terms,''), payment_terms)
   where id = p_po_id;
end $$;
grant execute on function public.fms_import_share_po(uuid, text, text, text, text, text) to authenticated;
