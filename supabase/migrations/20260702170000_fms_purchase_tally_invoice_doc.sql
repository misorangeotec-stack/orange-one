-- Purchase FMS (procurement) — Book-in-Tally captures the TALLY INVOICE.
--
-- The "Book in Tally" step records the vendor invoice as entered in Tally. The
-- field was mislabelled "Tally PI No." and could only store a number — the team
-- also wants to attach the actual Tally invoice document and add a remark.
--
-- Additive-only: keep the existing `tally_pi_no` column (it now holds the Tally
-- invoice number) and add three nullable columns. Replace the book_tally RPC
-- with an overload that also persists the document + remarks.

alter table public.fms_purchase_tally_bookings
  add column if not exists document_path text,
  add column if not exists document_name text,
  add column if not exists remarks       text;

-- Replace the RPC with the wider signature (old signature dropped first).
drop function if exists public.fms_purchase_book_tally(uuid, text, uuid);
create or replace function public.fms_purchase_book_tally(
  p_po_id uuid,
  p_tally_pi_no text,
  p_grn_id uuid default null,
  p_document_path text default null,
  p_document_name text default null,
  p_remarks text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('tally', auth.uid())) then
    raise exception 'Not authorized to book in Tally';
  end if;
  if nullif(p_tally_pi_no,'') is null then raise exception 'Tally invoice number is required'; end if;
  insert into public.fms_purchase_tally_bookings
    (po_id, grn_id, tally_pi_no, document_path, document_name, remarks, booked_by)
  values
    (p_po_id, p_grn_id, p_tally_pi_no, nullif(p_document_path,''), nullif(p_document_name,''), nullif(p_remarks,''), auth.uid())
  returning id into v_id;
  perform public.fms_purchase_refresh_po(p_po_id);
  return v_id;
end $$;
grant execute on function public.fms_purchase_book_tally(uuid, text, uuid, text, text, text) to authenticated;
