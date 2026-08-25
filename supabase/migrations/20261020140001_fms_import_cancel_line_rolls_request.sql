-- ===========================================================================
-- RM Import — the twin of 20261020140000. Cancelling the LAST live line closes
-- the requisition out, and a line cancellation records WHO did it in-transaction.
--
-- Read 20261020140000's header for the full argument; it applies verbatim. Only
-- the four things that are NOT the same are written out here.
--
-- 1 · ⚠ NOTHING IN THIS FUNCTION NAMES A START STATE, AND THAT IS LOAD-BEARING.
--   Import lines are born at 'approval' (20260727120000); RM Domestic's are born
--   at 'sourcing'. The two cancel_request RPCs DO encode that difference — the
--   domestic one sweeps `and status = 'sourcing'`, this app's sweeps
--   `and status in ('approval','on_hold')`. The live-line test below is
--   `not in ('cancelled','rejected')`, which is birth-state agnostic, so this
--   half copies across unchanged. Do not "correct" it to name a start state.
--   The permission gate still names a 'sourcing' step owner: that is Import's
--   RE-source owner, it is real, and it is unchanged.
--
-- 2 · ⚠ DO NOT COPY THIS APP'S OWN BAD EXAMPLE.
--   fms_import_cancel_request passes v_appr as its announce recipients, so
--   Import approvers already receive the payload-less version of this module's
--   mail — headline = p_text, no rows, no CTA — because every key send-email
--   renders is authored client-side in lib/emailMeta.ts. That is not the
--   pattern. '{}'::uuid[] is: audit row only, no bell, no email. The client's
--   cancelLines still mails the requester and the approver properly.
--
-- 3 · Import is a QUANTITY requisition — no rate, no line value, no approval
--   banding. Nothing here reads a value, so nothing here changes for it. Noted
--   only so the next reader does not go looking for the missing amount logic.
--
-- 4 · Reversal: re-run 20260716120200's fms_import_cancel_line body verbatim.
--   ⚠ Restores BEHAVIOUR, NOT STATE. Headers rolled before the revert stay
--   'cancelled'; they are identifiable by their cancel_reason, which always
--   begins 'All lines on this requisition were cancelled.'
--
--   Rehearsed 2026-08-25 against production data inside a rolled-back
--   transaction, impersonating the real 'po' step owner. Recommended is to LEAVE
--   rolled headers rolled; if they must go back, the statement is:
--
--     update public.fms_import_requests
--        set status = 'open', cancel_reason = null,
--            cancelled_at = null, cancelled_by = null
--      where cancel_reason like 'All lines on this requisition were cancelled.%';
--
--   ⚠ Select first and read the request_no list. That predicate is the only
--   thing separating these from a genuine fms_import_cancel_request cancellation.
--
-- 5 · ⚠ IMPORT HAS NO 'sourcing' STEP OWNER CONFIGURED (checked 2026-08-25).
--   Only the 'po' owner can reach this RPC in Import today. The sourcing arm of
--   the gate below is therefore dead in practice — kept because it is the
--   existing gate and this migration does not touch permissions, but it is one
--   more reason the sourcing stage needs the decision booked in WORKLIST PU-1.
-- ===========================================================================

begin;

create or replace function public.fms_import_cancel_line(
  p_request_item_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_request uuid;
  v_hdr     text;
  v_no      text;
  v_uid     uuid := auth.uid();
  v_clean   text := nullif(btrim(p_reason), '');
begin
  -- Unlocked read, purely to learn which header to lock first.
  select ri.request_id into v_request
    from public.fms_import_request_items ri
   where ri.id = p_request_item_id;
  if v_request is null then raise exception 'Line not found'; end if;

  -- ⚠ HEADER LOCK BEFORE LINE LOCK — see 20261020140000. The reverse order
  --   would let a concurrent cancel_line and cancel_request deadlock.
  select r.status, r.request_no
    into v_hdr, v_no
    from public.fms_import_requests r
   where r.id = v_request
   for update;

  select ri.status into v_status
    from public.fms_import_request_items ri
   where ri.id = p_request_item_id
   for update;
  if v_status is null then raise exception 'Line not found'; end if;

  -- ---- the gates: byte for byte as they were, and not this migration's subject
  if not (public.is_admin(v_uid)
          or public.fms_import_is_step_owner('po', v_uid)
          or public.fms_import_is_step_owner('sourcing', v_uid)) then
    raise exception 'Not authorized to cancel this line';
  end if;
  if v_status in ('po','cancelled','rejected') then
    raise exception 'This line cannot be cancelled (status %)', v_status;
  end if;

  update public.fms_import_request_items
     set status        = 'cancelled',
         cancel_reason = v_clean,
         edited_at     = now(),
         edited_by     = v_uid
   where id = p_request_item_id;

  -- ---- the roll -----------------------------------------------------------
  if v_hdr = 'open'
     and not exists (
       select 1 from public.fms_import_request_items ri
        where ri.request_id = v_request
          and ri.status not in ('cancelled', 'rejected')
     )
  then
    update public.fms_import_requests
       set status        = 'cancelled',
           cancel_reason = 'All lines on this requisition were cancelled. '
                           || 'Reason on the last one: '
                           || coalesce(v_clean, 'none given'),
           cancelled_at  = now(),
           cancelled_by  = v_uid
     where id = v_request;

    perform public.fms_import_announce(
      'request', v_request, 'request_cancelled',
      format('Request %s was cancelled — its last open line was cancelled',
             coalesce(v_no, '')),
      '{}'::uuid[],
      jsonb_build_object(
        'status_from',     v_hdr,
        'status_to',       'cancelled',
        'cause',           'last_line_cancelled',
        'request_item_id', p_request_item_id,
        'reason',          v_clean
      )
    );
  end if;
end $$;

grant execute on function public.fms_import_cancel_line(uuid, text) to authenticated;

comment on function public.fms_import_cancel_line(uuid, text) is
  'Cancels ONE requisition line (admin, or the po / sourcing step owner; never a '
  'line already on a PO). Since 20261020 it also stamps edited_at/edited_by and '
  'rolls the request header to cancelled once no line is left that is not '
  'cancelled or rejected. That roll is PRESENTATIONAL — every queue reads line '
  'status, not requests.status. The line-level timeline row is still written '
  'client-side, so its email keeps its emailMeta payload.';

commit;
