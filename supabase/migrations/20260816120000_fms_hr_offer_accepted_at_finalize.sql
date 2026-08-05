-- ===========================================================================
-- HR Recruitment — finalizing a candidate IS the acceptance.
--
-- The onboarding panel used to ask HR to record an offer outcome (accepted /
-- declined / did-not-join) before the checklist. It was a click that never said
-- anything new: finalizing on the kanban already captures the agreed salary and
-- the joining date. The card is gone from the UI, and with it the only writer of
-- offer_status anywhere in the app.
--
-- offer_status is load-bearing, though: fms_hr_try_complete_onboarding returns
-- early unless it reads 'accepted' (20260712160000, "no acceptance, no joining"),
-- and onboardings were born 'pending'. Left alone, no onboarding could ever
-- complete again — no joined_at, no requisition close, no probation.
--
-- So the field keeps its meaning and simply gets its answer earlier: an
-- onboarding is born accepted. A drop-out is now the backward card move, which
-- already deletes the onboarding row and hands the seat back.
--
-- Additive only. Nothing is dropped; fms_hr_set_offer_status stays callable,
-- and declined / no_show history is left exactly as it is.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The default. Every insert site omits offer_status — the finalize RPC
--    (20260813120200 / 20260813120100) and the original move (20260712160000) —
--    so the default alone covers all of them. No RPC needs re-issuing.
-- ---------------------------------------------------------------------------
alter table public.fms_hr_onboardings alter column offer_status set default 'accepted';

comment on table public.fms_hr_onboardings is
  'One onboarding per finalized candidate. Born accepted — finalizing IS the acceptance; a drop-out is a backward card move, which deletes this row. offer_status declined/no_show (historical) releases the seat; completed_at means they actually joined.';

-- ---------------------------------------------------------------------------
-- 2. In-flight rows. Anyone sitting in 'pending' was waiting on a button that
--    no longer exists — they are accepted. declined / no_show are untouched.
-- ---------------------------------------------------------------------------
update public.fms_hr_onboardings
   set offer_status = 'accepted'
 where offer_status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. Anyone whose checklist was ALREADY fully ticked was blocked on 'pending'
--    alone, and would otherwise sit finished-but-not-complete until someone
--    untick/re-ticked an item. try_complete is idempotent (it returns early on
--    completed_at, on a status that is not 'accepted', and on an unfinished
--    checklist), and fms_hr_activity.actor_id is nullable — so a null auth.uid()
--    here is safe.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select id from public.fms_hr_onboardings
     where completed_at is null and offer_status = 'accepted'
  loop
    perform public.fms_hr_try_complete_onboarding(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RE-ISSUED fms_hr_cancel_requisition — body from 20260713120000 VERBATIM,
--    with only the guard's MESSAGE changed.
--
--    The guard keys on offer_status = 'accepted', which now matches every
--    finalized candidate, and it told the admin to "mark them as declined or
--    did-not-join first" — pointing at a UI that no longer exists. It now names
--    the way out that does exist.
--
--    Note the knock-on: a requisition with a finalized-but-not-yet-joined
--    candidate can no longer be cancelled where it previously could. That is the
--    guard's stated intent ("a person who has accepted is not a line item"), and
--    it stops a cancel orphaning a live onboarding.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_cancel_requisition(p_req uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_who    text;
begin
  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status in ('closed','cancelled') then
    raise exception 'This requisition is already %', v_status;
  end if;
  if not (public.is_admin(v_uid) or public.fms_hr_is_coordinator(v_uid)) then
    raise exception 'Only an admin or a process coordinator can cancel a requisition';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to cancel'; end if;

  -- THE GUARD. A person mid-onboarding is not a line item. Name them, and say
  -- the way out — "cancel failed" is useless; "Yash Agarwal has been finalized"
  -- is actionable.
  select c.name into v_who
    from public.fms_hr_onboardings o
    join public.fms_hr_candidates c on c.id = o.candidate_id
   where o.requisition_id = p_req
     and o.offer_status = 'accepted'
   order by c.name
   limit 1;

  if v_who is not null then
    raise exception
      '% has been finalized on this requisition and is being onboarded. Move their card back to an earlier stage first, then cancel.', v_who;
  end if;

  update public.fms_hr_requisitions
     set status = 'cancelled', cancel_reason = trim(p_reason), closed_at = now(), decided_by = v_uid
   where id = p_req;
end $$;

grant execute on function public.fms_hr_cancel_requisition(uuid, text) to authenticated;
