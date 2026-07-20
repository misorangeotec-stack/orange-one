-- Domestic Purchase FMS: let a requester CANCEL their own request, but only
-- while nobody has started sourcing it.
--
-- Mirrors the Import feature (20260722120000), with one deliberate difference:
-- domestic lines are BORN at 'sourcing' (Import's are born at 'approval'), and
-- the first sourcing action stamps sourced_at + flips the line to 'approval'.
-- So "nobody has acted yet" here means every line is still 'sourcing' AND
-- sourced_at is null. That same predicate gates Edit in a later migration.
--
-- Edit and Cancel share ONE predicate, exactly as in Import.
--
-- fms_purchase_requests.status already allows 'cancelled'; only the audit
-- columns are missing. fms_purchase_request_items already has cancel_reason /
-- edited_at / edited_by.

begin;

-- ---- audit columns on the request header -----------------------------------
-- edited_* not updated_*: the table has a set_updated_at trigger that fires on
-- every write, so updated_at cannot mark "a human corrected this".
alter table public.fms_purchase_requests
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references auth.users on delete set null,
  add column if not exists edited_at     timestamptz,
  add column if not exists edited_by     uuid references auth.users on delete set null;

comment on column public.fms_purchase_requests.cancel_reason is
  'Why the requester (or an admin) cancelled this request before sourcing began. '
  'The request is KEPT, marked cancelled — never hard-deleted.';

-- ---- the shared editable predicate -----------------------------------------
create or replace function public.fms_purchase_request_editable(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_purchase_requests r
     where r.id = p_request_id
       and r.status = 'open'
       and exists (
         select 1 from public.fms_purchase_request_items ri where ri.request_id = r.id
       )
       -- THE RULE: every line still untouched at sourcing. The sourced_at test is
       -- belt-and-braces — a re-sourced line is back at 'sourcing' but carries a
       -- sourced_at, and its buyer's shortlist/quotes must not be silently voided.
       and not exists (
         select 1 from public.fms_purchase_request_items ri
          where ri.request_id = r.id
            and (ri.status <> 'sourcing' or ri.sourced_at is not null)
       )
       -- Defence in depth: fms_purchase_po_items.request_item_id is ON DELETE
       -- RESTRICT, so a line that reached a PO would make Edit's delete raise a
       -- raw 23503. The status test already excludes this; this makes it certain.
       and not exists (
         select 1
           from public.fms_purchase_po_items pit
           join public.fms_purchase_request_items ri on ri.id = pit.request_item_id
          where ri.request_id = r.id
       )
  );
$$;
grant execute on function public.fms_purchase_request_editable(uuid) to authenticated;

comment on function public.fms_purchase_request_editable(uuid) is
  'True while a domestic request may still be edited OR cancelled by its '
  'requester: open, has lines, and EVERY line is still an untouched sourcing '
  'line (status=sourcing, sourced_at null, no PO item). The first sourcing '
  'action locks the whole request.';

-- ---- cancel ----------------------------------------------------------------
create or replace function public.fms_purchase_cancel_request(
  p_request_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid;
  v_status    text;
  v_no        text;
  v_uid       uuid := auth.uid();
  v_lines     int;
begin
  select requester_id, status, request_no
    into v_requester, v_status, v_no
    from public.fms_purchase_requests where id = p_request_id for update;
  if v_status is null then raise exception 'Request not found'; end if;

  if not (v_requester = v_uid or public.is_admin(v_uid)) then
    raise exception 'Only the requester or an admin can cancel this request';
  end if;
  if v_status = 'cancelled' then
    raise exception 'This request is already cancelled';
  end if;
  if not public.fms_purchase_request_editable(p_request_id) then
    raise exception 'This request can no longer be cancelled: sourcing has already begun on at least one of its lines. Cancel the individual lines instead.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to cancel';
  end if;

  update public.fms_purchase_requests
     set status        = 'cancelled',
         cancel_reason = trim(p_reason),
         cancelled_at  = now(),
         cancelled_by  = v_uid
   where id = p_request_id;

  -- LOAD-BEARING: every queue and the RequestsList rollup read LINE status,
  -- never requests.status. Cancelling only the header would leave the request
  -- sitting in the sourcing queue forever.
  update public.fms_purchase_request_items
     set status        = 'cancelled',
         cancel_reason = trim(p_reason),
         edited_at     = now(),
         edited_by     = v_uid
   where request_id = p_request_id
     and status = 'sourcing';
  get diagnostics v_lines = row_count;

  perform public.fms_purchase_announce(
    'request', p_request_id, 'request_cancelled',
    format('Request %s was cancelled by the requester — %s',
           coalesce(v_no, ''), trim(p_reason)),
    '{}'::uuid[],
    jsonb_build_object(
      'status_from', v_status,
      'status_to',   'cancelled',
      'reason',      trim(p_reason),
      'lines_cancelled', v_lines
    )
  );
end $$;
grant execute on function public.fms_purchase_cancel_request(uuid, text) to authenticated;

commit;
