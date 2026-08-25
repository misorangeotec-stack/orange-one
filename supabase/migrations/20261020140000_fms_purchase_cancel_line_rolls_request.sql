-- ===========================================================================
-- RM Domestic — cancelling the LAST live line now closes the requisition out,
-- and a line cancellation finally records WHO did it inside its own transaction.
--
-- WHY
--   fms_purchase_cancel_line has only ever touched one row: the line. It never
--   looked up at fms_purchase_requests. So a requisition whose lines were
--   cancelled one at a time sat at status = 'open' forever:
--     · RequestDetail.tsx's red "This request was cancelled" banner never
--       appeared — it keys off requests.status, and would have read
--       "No reason recorded." even if it had;
--     · Dashboard.tsx (`r.status === "open"`) counted it, every day, forever.
--   Cancel the whole thing in one go via fms_purchase_cancel_request and both
--   work. Arrive at the identical end state one line at a time and neither does.
--   The requisition was never in two states; only the record disagreed with the
--   screens.
--
--   RequestStepper.tsx has always read it the honest way — it treats "no line
--   left that isn't rejected or cancelled" exactly like request.status =
--   'cancelled'. This makes the stored record agree with the rail.
--
-- ⚠ THIS IS PRESENTATIONAL. IT CLEARS NOTHING FROM ANY QUEUE.
--   Every queue and the RequestsList rollup read LINE status, never
--   requests.status — spelled out at 20260723120000. The lines were already
--   'cancelled' before this migration and had already left the queues. If a
--   requisition is stuck in somebody's queue, this is not the fix.
--
-- WHAT CHANGES (one function body, no DDL)
--   1. request_id is read alongside status, and the line update now also stamps
--      edited_at / edited_by. Until now the ONLY record of who cancelled a line
--      was the client's best-effort activity row, which can silently not exist.
--   2. The reason is btrim'd, not bare-nullif'd. A reason of three spaces used
--      to be stored as three spaces and rendered as an empty tooltip on the
--      status badge.
--   3. If no live line remains afterwards, the header rolls to 'cancelled' with
--      cancel_reason / cancelled_at / cancelled_by, and one request-scoped
--      activity row records the roll IN THIS TRANSACTION.
--
-- ⚠ THE DUPLICATION HAZARD, AND WHY THERE ISN'T ONE
--   procurement/store.tsx's cancelLines ALREADY announces ('line','cancelled')
--   with the requester and approver as recipients. If this migration announced
--   that same pair, every cancel would post two identical timeline rows and mail
--   everybody twice — the duplication fms_purchase_cancel_request lives with
--   today and its comment accepts.
--   So the announces are split by ENTITY and by TYPE and never collide:
--     · here, SQL      → ('request','request_cancelled'), and ONLY on the roll
--     · there, client  → ('line','cancelled'), once per line
--   The line row deliberately STAYS in the browser. fms_purchase_announce builds
--   its email_outbox payload from p_meta, and every key send-email renders
--   (subject / eyebrow / headline / rows / ctaLabel / ctaPath) is authored by
--   lib/emailMeta.ts client-side. A SQL announce with real recipients would
--   still SEND — it would just send a blank-looking card. Hence '{}'::uuid[]
--   below: audit row only, no bell, no email. Same choice as
--   fms_purchase_cancel_request.
--   ⚠ Note the actor is NO LONGER skipped as a recipient since 20260726150000,
--   so passing anybody here would also mail the person who just clicked Cancel.
--
-- WHAT DOES NOT CHANGE
--   · The permission gate — admin, or the 'po' or 'sourcing' step owner.
--   · The status gate — 'po', 'cancelled', 'rejected' still refuse.
--   · No reason is required, still. The modal requires one; the RPC never has,
--     and tightening that is a different decision from this one.
--   · fms_purchase_requests.status already allows 'cancelled' (20260630140000)
--     and the audit columns already exist (20260723120000). No DDL here.
--
-- ⚠ AN ALL-REJECTED REQUISITION IS DELIBERATELY LEFT AT 'open'.
--   The test below is `not in ('cancelled','rejected')`, matching RequestStepper
--   exactly — three rejected lines plus one just-cancelled line DOES roll, and
--   should. But this function is the only caller and only ever runs on a cancel,
--   so a requisition whose lines were ALL rejected never reaches it. That is
--   intended: 'cancelled' is the wrong word for "the approver turned it down",
--   the header has no 'rejected' value to roll to, and adding one is a bigger
--   change than this. Rolling on cancel only is the narrow, reversible half.
--
-- NO REOPEN BRANCH.
--   The nearest idiom in the suite, fms_hr_sync_requisition_fill
--   (20260713120000), pairs its close branch with a symmetric reopen. Here that
--   branch would be dead code: cancelled is terminal for a line (queues.ts
--   sourcingLockReason / approvalLockReason — "the app has no un-reject path and
--   this does not add one"), fms_purchase_save_sourcing_request RAISES on a
--   cancelled line rather than reviving it, and no RPC writes a line back off
--   'cancelled'. Nothing can put a live line under a rolled header.
--
-- ALSO NOT DONE: no backfill. Requisitions already stranded at 'open' stay
-- there. Stamping cancelled_by with somebody who never clicked Cancel is a worse
-- record than the wrong status we already have.
--
-- Reversal:
--   Re-run 20260630140000's fms_purchase_cancel_line body verbatim. The frontend
--   needs NO revert — the store is unchanged behaviourally — so the rollback is
--   SQL-only and deployable on its own.
--   ⚠ It restores BEHAVIOUR, NOT STATE. Headers rolled before the revert stay
--   'cancelled'; they are identifiable by their cancel_reason, which always
--   begins 'All lines on this requisition were cancelled.'
--
--   Rehearsed 2026-08-25 against production data inside a rolled-back
--   transaction, impersonating a real 'po' step owner via request.jwt.claims:
--   20/20 assertions passed across both apps, including the revert itself.
--   Confirmed there that the revert leaves rolled headers rolled — so if the
--   rows must go back too, this is the statement, and RECOMMENDED IS TO LEAVE
--   THEM: every line on those requisitions really was cancelled, so the header
--   is telling the truth. Un-rolling re-lists dead requisitions as open.
--
--     update public.fms_purchase_requests
--        set status = 'open', cancel_reason = null,
--            cancelled_at = null, cancelled_by = null
--      where cancel_reason like 'All lines on this requisition were cancelled.%';
--
--   ⚠ That predicate is the ONLY thing separating these from a genuine
--   fms_purchase_cancel_request cancellation, which must not be touched. Run it
--   as a select first and read the request_no list before updating.
-- ===========================================================================

begin;

create or replace function public.fms_purchase_cancel_line(
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
    from public.fms_purchase_request_items ri
   where ri.id = p_request_item_id;
  if v_request is null then raise exception 'Line not found'; end if;

  -- ⚠ HEADER LOCK BEFORE LINE LOCK. fms_purchase_cancel_request takes the same
  --   two locks in that order (header first, then its lines). Taking them the
  --   other way round here would let a concurrent cancel_line and
  --   cancel_request deadlock on one requisition.
  select r.status, r.request_no
    into v_hdr, v_no
    from public.fms_purchase_requests r
   where r.id = v_request
   for update;

  select ri.status into v_status
    from public.fms_purchase_request_items ri
   where ri.id = p_request_item_id
   for update;
  if v_status is null then raise exception 'Line not found'; end if;

  -- ---- the gates: byte for byte as they were, and not this migration's subject
  if not (public.is_admin(v_uid)
          or public.fms_purchase_is_step_owner('po', v_uid)
          or public.fms_purchase_is_step_owner('sourcing', v_uid)) then
    raise exception 'Not authorized to cancel this line';
  end if;
  if v_status in ('po','cancelled','rejected') then
    raise exception 'This line cannot be cancelled (status %)', v_status;
  end if;

  update public.fms_purchase_request_items
     set status        = 'cancelled',
         cancel_reason = v_clean,
         edited_at     = now(),
         edited_by     = v_uid
   where id = p_request_item_id;

  -- ---- the roll -----------------------------------------------------------
  -- ⚠ Evaluated AFTER the update above and inside the same transaction. That is
  --   the whole reason this cannot live in the browser: the store's closure is
  --   still holding its pre-invalidate() snapshot and literally cannot tell
  --   whether that was the last live line.
  if v_hdr = 'open'
     and not exists (
       select 1 from public.fms_purchase_request_items ri
        where ri.request_id = v_request
          and ri.status not in ('cancelled', 'rejected')
     )
  then
    update public.fms_purchase_requests
       set status        = 'cancelled',
           cancel_reason = 'All lines on this requisition were cancelled. '
                           || 'Reason on the last one: '
                           || coalesce(v_clean, 'none given'),
           cancelled_at  = now(),
           cancelled_by  = v_uid
     where id = v_request;

    perform public.fms_purchase_announce(
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

grant execute on function public.fms_purchase_cancel_line(uuid, text) to authenticated;

comment on function public.fms_purchase_cancel_line(uuid, text) is
  'Cancels ONE requisition line (admin, or the po / sourcing step owner; never a '
  'line already on a PO). Since 20261020 it also stamps edited_at/edited_by and '
  'rolls the request header to cancelled once no line is left that is not '
  'cancelled or rejected. That roll is PRESENTATIONAL — every queue reads line '
  'status, not requests.status. The line-level timeline row is still written '
  'client-side, so its email keeps its emailMeta payload.';

commit;
