-- NR-10 follow-up — the three-month decision follows the CHECK-INS, not the
-- retired monthly reviews.
--
-- Found by walking a hire end to end in the browser rather than by reading the
-- code: nobody could ever be confirmed.
--
-- b2690d30 retired the monthly cadence and deleted the ReviewRow form that wrote
-- fms_hr_probation_reviews (202 lines out of ProbationPanel.tsx). It left both
-- decision RPCs asking for a month-3 / month-4 review row that the app can no
-- longer create. The panel therefore sat forever on "Record all three monthly
-- reviews first — the decision follows from them", with nowhere to record them,
-- and the confirmation letter that hangs off the confirmation was unreachable
-- with it. Exactly the FIX-4 shape in CLAUDE.md: the handler, the store method
-- and the RPC all survived a trigger that no longer existed.
--
-- The frontend already models it correctly — lib/queues.ts moves to
-- `probation_final` once all five check-ins are complete — so only the gate had
-- to move. It now asks for the thing that actually gets recorded: Day 7, 15, 30,
-- 60 and 90, each with BOTH sides in, which is the whole point of the cadence.
-- The error names the day that is missing, so HR knows who to chase.
--
-- ⚠ A probation with NO check-in rows is not blocked. That is deliberate: a row
-- seeded before NR-10 has none and would otherwise be frozen for ever. There are
-- none today, and every new probation is seeded with five.
--
-- ⚠ Left for the client, NOT decided here: a joiner who simply never answers can
-- hold up their own confirmation, because "both sides in" is the rule they asked
-- for. If they want an HR override, that is a new decision.
--
-- The extension close-out loses its review gate outright. In the new cadence an
-- extension adds no sixth check-in, so the five that were already complete when
-- the extension was granted are the basis for closing it; asking for a month-4
-- row that cannot exist only made that path unreachable too.
--
-- Everything else in both functions is unchanged, character for character.

create or replace function public.fms_hr_decide_probation(
  p_probation uuid,
  p_decision text,
  p_remarks text default ''::text,
  p_permanent_from date default null::date,
  p_employee_code text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid;
  v_cand    uuid;
  v_join    date;
  v_outcome text;
  v_final   text;
  v_name    text;
  v_no      text;
  v_mgrs    uuid[];
  v_day     integer;
begin
  if p_decision not in ('approve','reject','extend') then
    raise exception 'Unknown probation decision %', p_decision;
  end if;

  select requisition_id, candidate_id, joining_date, outcome, final_status
    into v_req, v_cand, v_join, v_outcome, v_final
    from public.fms_hr_probations where id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;
  if v_final is not null or v_outcome is not null then
    raise exception 'The three-month decision has already been taken (%)', coalesce(v_final, v_outcome);
  end if;

  -- The decision exists to conclude the check-ins. A check-in counts only when the
  -- head of department AND the new joiner have both answered — `completed_at` is
  -- stamped when the second one lands — so half a cadence is nothing to conclude
  -- from. See the header for why an empty cadence is allowed through.
  select k.day_no into v_day
    from public.fms_hr_probation_checkins k
   where k.probation_id = p_probation and k.completed_at is null
   order by k.day_no
   limit 1;
  if v_day is not null then
    raise exception 'The Day-% check-in is not finished — the head of department and the new joiner both have to answer before the three-month decision', v_day;
  end if;

  if not public.fms_hr_can_act('probation_final', v_req, v_uid) then
    raise exception 'Not authorized to decide this probation — that is the hiring manager''s call';
  end if;

  if p_decision = 'approve' then
    if p_permanent_from is null then
      raise exception 'Give the date this person becomes permanent';
    end if;
    if coalesce(trim(p_employee_code), '') = '' then
      raise exception 'Give the final employee ID';
    end if;

    update public.fms_hr_probations set
      outcome         = 'approved',
      outcome_at      = now(),
      outcome_by      = v_uid,
      outcome_remarks = nullif(trim(p_remarks), ''),
      final_status    = 'approved',
      final_status_at = now(),
      permanent_from  = p_permanent_from,
      employee_code   = trim(p_employee_code)
    where id = p_probation;

  elsif p_decision = 'reject' then
    if coalesce(trim(p_remarks), '') = '' then
      raise exception 'Say why probation was not cleared';
    end if;

    -- NOTE the deliberate absence of fms_hr_sync_requisition_fill(v_req) here. This
    -- person joined and filled the seat; the vacancy that hired them is closed and
    -- stays closed. Replacing them is a new MRF, not a reopened old one.
    update public.fms_hr_probations set
      outcome         = 'rejected',
      outcome_at      = now(),
      outcome_by      = v_uid,
      outcome_remarks = trim(p_remarks),
      final_status    = 'rejected',
      final_status_at = now()
    where id = p_probation;

  else -- extend
    update public.fms_hr_probations set
      outcome         = 'extended',
      outcome_at      = now(),
      outcome_by      = v_uid,
      outcome_remarks = nullif(trim(p_remarks), '')
    where id = p_probation;
  end if;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.hiring_manager_ids into v_no, v_mgrs
    from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', p_probation,
    case p_decision when 'approve' then 'confirmed' when 'reject' then 'rejected' else 'extended' end,
    coalesce(v_name, 'The new hire') || ' — probation '
      || case p_decision
           when 'approve' then 'cleared; permanent from ' || to_char(p_permanent_from, 'DD-MM-YYYY')
           when 'reject'  then 'not cleared: ' || trim(p_remarks)
           -- No Month-4 review to point at any more: an extension adds a month, not
           -- a form. The date is still the one the decision is owed by.
           else 'extended by one month; the decision is due '
                || to_char(public.fms_hr_add_months(v_join, 4), 'DD-MM-YYYY')
         end
      || ' (' || coalesce(v_no, '') || ')',
    coalesce(v_mgrs, '{}'::uuid[]) || public.fms_hr_step_owner_ids('onboarding')
  );
end $function$;

create or replace function public.fms_hr_decide_extension(
  p_probation uuid,
  p_decision text,
  p_remarks text default ''::text,
  p_permanent_from date default null::date,
  p_employee_code text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid;
  v_cand    uuid;
  v_outcome text;
  v_ext     text;
  v_final   text;
  v_name    text;
  v_no      text;
  v_mgrs    uuid[];
  v_day     integer;
begin
  if p_decision not in ('approve','reject') then
    raise exception 'An extended probation ends in approve or reject — it cannot be extended again';
  end if;

  select requisition_id, candidate_id, outcome, extension_outcome, final_status
    into v_req, v_cand, v_outcome, v_ext, v_final
    from public.fms_hr_probations where id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;
  if v_outcome is distinct from 'extended' then
    raise exception 'This probation was not extended — use the three-month decision';
  end if;
  if v_final is not null or v_ext is not null then
    raise exception 'The extended probation has already been decided (%)', coalesce(v_final, v_ext);
  end if;

  -- An extension buys a month; it does not add a sixth check-in. The five that were
  -- already complete when it was granted are what this closes on, so the test is the
  -- same one — and, by construction, already satisfied. It stays here rather than
  -- being dropped so that a check-in RE-OPENED by a correction still blocks the
  -- close-out, as it does on the three-month path.
  select k.day_no into v_day
    from public.fms_hr_probation_checkins k
   where k.probation_id = p_probation and k.completed_at is null
   order by k.day_no
   limit 1;
  if v_day is not null then
    raise exception 'The Day-% check-in is not finished — both sides have to answer before the extended probation can be closed', v_day;
  end if;

  if not public.fms_hr_can_act('probation_final', v_req, v_uid) then
    raise exception 'Not authorized to decide this probation — that is the hiring manager''s call';
  end if;

  if p_decision = 'approve' then
    if p_permanent_from is null then
      raise exception 'Give the date this person becomes permanent';
    end if;
    if coalesce(trim(p_employee_code), '') = '' then
      raise exception 'Give the final employee ID';
    end if;

    update public.fms_hr_probations set
      extension_outcome    = 'approved',
      extension_outcome_at = now(),
      extension_outcome_by = v_uid,
      extension_remarks    = nullif(trim(p_remarks), ''),
      final_status         = 'approved',
      final_status_at      = now(),
      permanent_from       = p_permanent_from,
      employee_code        = trim(p_employee_code)
    where id = p_probation;

  else
    if coalesce(trim(p_remarks), '') = '' then
      raise exception 'Say why the extended probation was not cleared';
    end if;

    -- Same rule as the three-month rejection: the seat was filled, so the requisition
    -- is not touched.
    update public.fms_hr_probations set
      extension_outcome    = 'rejected',
      extension_outcome_at = now(),
      extension_outcome_by = v_uid,
      extension_remarks    = trim(p_remarks),
      final_status         = 'rejected',
      final_status_at      = now()
    where id = p_probation;
  end if;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.hiring_manager_ids into v_no, v_mgrs
    from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', p_probation,
    case p_decision when 'approve' then 'confirmed' else 'rejected' end,
    coalesce(v_name, 'The new hire') || ' — extended probation '
      || case p_decision
           when 'approve' then 'cleared; permanent from ' || to_char(p_permanent_from, 'DD-MM-YYYY')
           else 'not cleared: ' || trim(p_remarks)
         end
      || ' (' || coalesce(v_no, '') || ')',
    coalesce(v_mgrs, '{}'::uuid[]) || public.fms_hr_step_owner_ids('onboarding')
  );
end $function$;
