-- ===========================================================================
-- Purchase FMS (import) — advances & final payments are recorded against
-- the PO, with the PI reference reduced to an optional free-text remark.
--
-- The whole-PO pending cap (total_value − Σ payments) already exists in
-- record_payment for the p_pi_id-is-null path; the frontend now always calls it
-- with p_pi_id null, so payments draw down one PO-level balance. This migration
-- just adds an optional pi_remarks note. Additive / replace-only.
-- ===========================================================================

alter table public.fms_import_payments add column if not exists pi_remarks text;

drop function if exists public.fms_import_record_payment(uuid, text, numeric, uuid, date, text);
create or replace function public.fms_import_record_payment(
  p_po_id uuid, p_kind text, p_amount numeric,
  p_pi_id uuid default null, p_paid_on date default null, p_utr text default null,
  p_pi_remarks text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_total numeric(16,2);
  v_paid numeric(16,2);
  v_pi_value numeric(16,2);
  v_pi_paid numeric(16,2);
begin
  if not (public.is_admin(auth.uid())
          or public.fms_import_is_step_owner('advance_payment', auth.uid())
          or public.fms_import_is_step_owner('final_payment', auth.uid())) then
    raise exception 'Not authorized to record payments';
  end if;
  if p_kind not in ('advance','installment') then raise exception 'Invalid payment kind'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be greater than 0'; end if;

  if p_pi_id is not null then
    -- Legacy per-PI cap (kept for backward compatibility; the UI no longer uses it).
    select pi_value into v_pi_value
      from public.fms_import_pis
     where id = p_pi_id and po_id = p_po_id
     for update;
    if v_pi_value is null then raise exception 'PI not found for this PO'; end if;
    select coalesce(sum(amount),0) into v_pi_paid
      from public.fms_import_payments where pi_id = p_pi_id;
    if v_pi_paid + p_amount > v_pi_value + 0.01 then
      raise exception 'Payment exceeds the PI pending amount';
    end if;
  else
    -- PO-level cap: amount cannot exceed the whole-PO pending.
    select total_value into v_total from public.fms_import_pos where id = p_po_id for update;
    select coalesce(sum(amount),0) into v_paid from public.fms_import_payments where po_id = p_po_id;
    if v_paid + p_amount > v_total + 0.01 then
      raise exception 'Payment exceeds the pending amount';
    end if;
  end if;

  insert into public.fms_import_payments (po_id, pi_id, kind, amount, paid_on, utr_ref, pi_remarks, created_by)
  values (p_po_id, p_pi_id, p_kind, p_amount, coalesce(p_paid_on, current_date), nullif(p_utr,''), nullif(p_pi_remarks,''), auth.uid())
  returning id into v_id;

  perform public.fms_import_refresh_po(p_po_id);
  return v_id;
end $$;
grant execute on function public.fms_import_record_payment(uuid, text, numeric, uuid, date, text, text) to authenticated;
