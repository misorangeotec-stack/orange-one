-- ===========================================================================
-- Purchase FMS (import) — DISPATCH DATE moves from the PI to the PO, and
-- becomes REQUIRED at the Share-PO step.
--
-- The expected dispatch date is a property of the order, not of a vendor PI, and
-- it is the anchor for the Follow-up queue's "Dispatch Due". It is now captured
-- (mandatorily) when the PO is shared. The PI keeps its own dispatch_date column
-- for backward compatibility, but nothing new is written to it.
--
-- Additive only: one new nullable column on fms_import_pos (backfilled from the
-- earliest PI so in-flight orders keep their due date) + share_po gains a
-- p_dispatch_date param it now requires.
-- ===========================================================================

-- 1. PO dispatch-date column -------------------------------------------------
alter table public.fms_import_pos
  add column if not exists dispatch_date date;

-- Backfill from each PO's earliest PI (prefer a revised date if one was set).
update public.fms_import_pos p
   set dispatch_date = sub.dispatch_date
  from (
    select distinct on (po_id) po_id, coalesce(revised_dispatch_date, dispatch_date) as dispatch_date
      from public.fms_import_pis
     order by po_id, created_at
  ) sub
 where sub.po_id = p.id
   and p.dispatch_date is null
   and sub.dispatch_date is not null;

-- 2. Share PO RPC — capture a REQUIRED dispatch date at the Share step --------
drop function if exists public.fms_import_share_po(uuid, text, text, text, text, text);
create or replace function public.fms_import_share_po(
  p_po_id uuid,
  p_document_path text default null,
  p_document_name text default null,
  p_tally_po_no text default null,
  p_remarks text default null,
  p_payment_terms text default null,
  p_dispatch_date date default null
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
  if p_dispatch_date is null then
    raise exception 'The expected dispatch date is required to mark the PO shared';
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
         payment_terms = coalesce(nullif(p_payment_terms,''), payment_terms),
         dispatch_date = p_dispatch_date
   where id = p_po_id;
end $$;
grant execute on function public.fms_import_share_po(uuid, text, text, text, text, text, date) to authenticated;
