-- ===========================================================================
-- Purchase (Domestic): the PO Desk can put a requisition ON HOLD at the
-- Generate PO step, and keep REMARKS against it.
--
-- WHY
--   An approved requisition lands on the PO Desk to be turned into a PO. The
--   buyer sometimes has to stop there - "vendor is revising the rate, don't
--   raise the PO yet" - and had nowhere to say so. The hold belongs BEFORE the
--   PO exists: once a PO is generated there is nothing left to hold back.
--   So the hold and remarks sit on the REQUISITION, and the PO Desk can:
--     * write / update remarks on it,
--     * put it on hold (remarks required, so the hold always says why),
--     * resume it.
--   While a requisition is on hold the Generate PO dialog offers no Generate
--   button, and the PO queue marks it "On hold". The requester is notified with
--   the remarks (the app sends that through fms_purchase_announce, the same path
--   every other step's notification takes).
--
-- WHO
--   An owner of the "po" step (the same people who may generate a PO), or an
--   admin - the same rule fms_purchase_generate_po uses.
--
-- WHEN
--   Only while the requisition still has lines waiting for a PO
--   (status approved_pending_po). The remarks stay on the requisition after its
--   PO is generated, so the PO page can still show them.
--
-- ADDITIVE ONLY: four nullable columns and one new function. Nothing existing is
-- changed, so a frontend that does not know about these columns keeps working.
--
-- ⚠ THE HOLD IS NOT ENFORCED BY fms_purchase_generate_po. The app hides the
--   Generate button instead. Enforcing it server-side would mean replacing the
--   live generate function, which is a bigger change than was asked for.
--
-- Reversal:
--   drop function if exists public.fms_purchase_set_po_hold(uuid, boolean, text);
--   alter table public.fms_purchase_requests
--     drop column if exists po_remarks,
--     drop column if exists po_remarks_updated_at,
--     drop column if exists po_on_hold_at,
--     drop column if exists po_on_hold_by;
-- ===========================================================================

alter table public.fms_purchase_requests
  add column if not exists po_remarks            text,
  add column if not exists po_remarks_updated_at timestamptz,
  add column if not exists po_on_hold_at         timestamptz,
  add column if not exists po_on_hold_by         uuid;

comment on column public.fms_purchase_requests.po_remarks is
  'PO Desk remarks written at the Generate PO step. Required while the requisition is on hold there.';
comment on column public.fms_purchase_requests.po_on_hold_at is
  'Set when the PO Desk holds the requisition at Generate PO; NULL = not on hold.';

create or replace function public.fms_purchase_set_po_hold(
  p_request_id uuid,
  p_on_hold    boolean,
  p_remarks    text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req     public.fms_purchase_requests%rowtype;
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('po', auth.uid())) then
    raise exception 'Only the PO Desk can hold a requisition or change its PO remarks';
  end if;

  select * into v_req from public.fms_purchase_requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'Requisition not found'; end if;

  if not exists (
    select 1 from public.fms_purchase_request_items
     where request_id = p_request_id and status = 'approved_pending_po'
  ) then
    raise exception 'Nothing on this requisition is waiting for a PO, so it can no longer be held';
  end if;

  if p_on_hold and v_remarks is null then
    raise exception 'Remarks are required to put a requisition on hold';
  end if;

  update public.fms_purchase_requests
     set po_remarks            = v_remarks,
         po_remarks_updated_at = case when v_remarks is distinct from v_req.po_remarks
                                      then now() else po_remarks_updated_at end,
         -- Keep the ORIGINAL hold time and person while it stays on hold, so
         -- editing the remarks does not look like a fresh hold.
         po_on_hold_at         = case when p_on_hold then coalesce(po_on_hold_at, now()) else null end,
         po_on_hold_by         = case when p_on_hold then coalesce(po_on_hold_by, auth.uid()) else null end
   where id = p_request_id;
end $$;

revoke all on function public.fms_purchase_set_po_hold(uuid, boolean, text) from public, anon;
grant execute on function public.fms_purchase_set_po_hold(uuid, boolean, text) to authenticated;

do $check$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'fms_purchase_requests'
         and column_name in ('po_remarks', 'po_remarks_updated_at', 'po_on_hold_at', 'po_on_hold_by')) <> 4 then
    raise exception 'po hold columns missing';
  end if;
end $check$;
