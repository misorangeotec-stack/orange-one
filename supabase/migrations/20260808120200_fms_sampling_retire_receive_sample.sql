-- Sampling FMS — retire the "Sample Received at Lab" step (`receive_sample`).
--
-- It is how inward requests started BEFORE the lab gate existed. Since the gate
-- landed, every inward request starts at `sample_collect` and NOTHING routes into
-- `receive_sample` any more — but three requests raised on 22–23 July are still
-- parked in it, so retiring the step means moving them first.
--
-- ⚠ APPLY THIS BEFORE THE FRONTEND GOES LIVE. Between the two the rows sit at
--   `awaiting_collect`, which the OLD build already renders correctly. The other
--   way round, the new build has no queue for `awaiting_receipt` and the three
--   requests would vanish from every screen at once.
--
-- DELIBERATELY NOT TOUCHED — this is not an oversight, do not "finish the job":
--   • the `status` CHECK still allows 'awaiting_receipt'  (dropping a CHECK is not
--     additive, and nothing can reach that value any more)
--   • `fms_sampling_can_act` keeps its now-dead `receive_sample` clause — re-issuing
--     it means restating NINE clauses in a function already re-issued five times,
--     for a branch that can never be entered. The server simply permits one thing
--     no client offers.
--   • the `received_*` columns stay, and are still READ for the one closed legacy
--     row that went through the step properly
--   • the orphaned `fms_sampling_step_owners` row for 'receive_sample' stays

begin;

/* -------- 1. resume_status: drop the arm that resumes INTO the dead step ------ */
-- Re-issued IN FULL from the LIVE body (pg_get_functiondef), NOT from an older
-- migration file — 20260731140000 fixed the outward "confirmed → awaiting_result"
-- arm, and copying the 20260728 text would silently revert it.
-- The only change: the `lab_testing_required is null → 'awaiting_receipt'` arm is
-- gone. `received_at is not null → 'awaiting_testing'` STAYS: a held row that
-- already passed receipt must not be thrown back to collect.

create or replace function public.fms_sampling_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    -- terminal
    when r.handed_over_at     is not null then 'closed'
    when r.result_received_at is not null then 'closed'
    when r.sample_received_at is not null then 'closed'
    -- inward, lab branch (newest first)
    when r.lab_completed_at   is not null then 'awaiting_result_received'
    when r.lab_sent_at        is not null then 'awaiting_lab_process'
    -- inward, no-lab branch
    when r.collected_at       is not null then
      case when r.lab_testing_required is true then 'awaiting_sample_to_lab'
           else 'awaiting_sample_received' end
    -- legacy inward + outward tail
    when r.resulted_at        is not null then 'awaiting_handover'
    when r.tested_at          is not null then 'awaiting_result'
    when r.direction = 'inward' then
      -- RETIRED 08-08-2026: the `awaiting_receipt` arm is gone with the step. A
      -- legacy row that already passed receipt still resumes at testing; anything
      -- else inward resumes at collect, which is where every inward request now
      -- begins whichever branch it is on.
      case when r.received_at is not null then 'awaiting_testing'
           else 'awaiting_collect' end
    else
      -- outward no longer runs testing, so a confirmed outward request resumes at
      -- the result.
      case when r.confirmed_at is not null then 'awaiting_result'
           when r.sent_at      is not null then 'awaiting_confirm'
           else 'awaiting_send' end
  end
  from public.fms_sampling_requests r where r.id = p_req;
$function$;

/* ---------------- 2. move the three parked requests forward ------------------ */
-- Scoped by req_no so the change is provably those three and provably reversible,
-- and guarded so it is a no-op if anything was recorded on them in the meantime.
--
-- `lab_testing_required = true` is LOAD-BEARING, not cosmetic: `record_collect`
-- branches on `v_lab is true`, and NULL is NOT true — leaving it NULL would send
-- these down the NO-LAB branch at the very next step, closing them at handover
-- without ever reaching a lab. These are legacy rows whose whole purpose was
-- receipt-then-testing, so the lab branch is the faithful continuation.

create temp table _fms_sampling_retire_moved on commit drop as
with moved as (
  update public.fms_sampling_requests
     set lab_testing_required = true,
         status               = 'awaiting_collect',
         current_step         = 'sample_collect'
   where req_no in ('SMP-2627-0005', 'SMP-2627-0007', 'SMP-2627-0008')
     and status = 'awaiting_receipt'
     and received_at is null
     and lab_testing_required is null
  returning id, req_no, raised_by
)
select * from moved;

-- A bare UPDATE writes no activity row and rings no bell, so announce each move.
-- Recipient is the RAISER: `sample_collect` has no step owners seeded, and the
-- person who raised it is the one whose request just became actionable again.
do $$
declare r record;
begin
  for r in select * from _fms_sampling_retire_moved loop
    perform public.fms_sampling_announce('request', r.id, 'step_retired',
      'Sample Received at Lab has been retired — ' || r.req_no ||
        ' now starts at Sample Collect & Handover.',
      (case when r.raised_by is not null then array[r.raised_by] else '{}'::uuid[] end),
      jsonb_build_object(
        'req_no', r.req_no, 'direction', 'inward',
        'eyebrow', 'Request moved',
        'headline', 'Your request now starts at Sample Collect & Handover',
        'action', 'moved the request off the retired step',
        'docLabel', r.req_no,
        'ctaPath', '/sampling/requests/' || r.id::text,
        'ctaLabel', 'Open in Sampling'
      ));
  end loop;
  raise notice 'moved % request(s) off receive_sample', (select count(*) from _fms_sampling_retire_moved);
end $$;

/* -------------------- 3. refuse to finish if any row is left ----------------- */
-- The frontend in the matching commit deletes `openStep`'s case for this status,
-- and a row with no openStep disappears from every queue, My Work, the Dashboard
-- and the Control Center at once. Better to fail here than to lose a request.
do $$
declare n int;
begin
  select count(*) into n from public.fms_sampling_requests where status = 'awaiting_receipt';
  if n > 0 then
    raise exception 'Retirement aborted: % request(s) still sit at awaiting_receipt. Move them before the frontend ships — they would have no queue.', n;
  end if;
end $$;

/* ------------------------- 4. mark the dead RPCs ----------------------------- */
-- Kept (dropping them is not additive, and the closed legacy row's history still
-- reads the columns they wrote) but flagged so nobody wires them up again.

comment on function public.fms_sampling_record_receipt(uuid, jsonb) is
  'RETIRED 08-08-2026 with the receive_sample step. Nothing routes into awaiting_receipt any more and no client calls this. Kept because dropping it is not additive.';
comment on function public.fms_sampling_update_receipt(uuid, jsonb) is
  'RETIRED 08-08-2026 with the receive_sample step. See fms_sampling_record_receipt.';
comment on function public.fms_sampling_receipt_editable(uuid) is
  'RETIRED 08-08-2026 with the receive_sample step. See fms_sampling_record_receipt.';

commit;
