-- ===========================================================================
-- Complaint (RM/FG) FMS — STEP RPCs (Phase 6).
--
--   fms_complaint_submit_request      — mint the number, insert, announce
--   fms_complaint_record_<step>       x6 — advance one step
--   fms_complaint_update_<step>       x6 — correct a completed step
--   fms_complaint_<step>_editable     x6 — may it still be corrected?
--   fms_complaint_add_doc / _delete_doc
--   fms_complaint_hold_request / _cancel_request
--   fms_complaint_step_owner_ids_for  — the fan-out, incl. the per-request actor
--
-- Every one is SECURITY DEFINER and re-checks fms_complaint_can_act. The
-- frontend wrappers are deliberately thin: THE DATABASE IS THE GATE, and
-- anything enforced only in TypeScript is not enforced.
--
-- ⚠ THE SHAPE OF EVERY record_* IS THE SAME, and deliberately so:
--     select ... for update  ->  status check  ->  can_act  ->  validate
--       ->  update stamping the step's OWN trio + status + current_step
--       ->  announce to the NEXT step's owners plus the person just named.
--
-- ⚠ EACH STEP NAMES THE ACTOR OF THE NEXT ONE. That is what routes a queue to a
--   person rather than to a static owner list, and it is why can_act has
--   per-request arms at all.
--
-- ⚠ AN EMPTY-STRING jsonb VALUE MEANS "NOT SUPPLIED". The frontend sends '' for
--   every absent optional field rather than omitting the key, so `nullif(x,'')`
--   is the idiom throughout. Omitting keys instead would make a missing key and
--   a deliberately-cleared field indistinguishable.
--
-- Additive. Reversal: drop each function listed above.
-- ===========================================================================

begin;

-- ===========================================================================
-- The notification fan-out for a step, INCLUDING the person named on this
-- complaint for it. A static owner list alone would leave the actual assignee
-- untold.
-- ===========================================================================
create or replace function public.fms_complaint_step_owner_ids_for(p_step_key text, p_req uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select (
    select coalesce(array_agg(distinct u), '{}'::uuid[])
    from unnest(
      public.fms_complaint_step_owner_ids(p_step_key)
      || coalesce((
           select case p_step_key
             when 'investigation' then array[r.ack_assignee_id]
             when 'capa'          then array[r.inv_capa_owner_id]
             when 'resolution'    then array[r.capa_resolver_id]
             when 'confirmation'  then array[r.res_confirmer_id]
             when 'close'         then array[r.raised_by]
             else '{}'::uuid[]
           end
           from public.fms_complaint_requests r where r.id = p_req
         ), '{}'::uuid[])
    ) as u
    where u is not null
  );
$$;
grant execute on function public.fms_complaint_step_owner_ids_for(text, uuid) to authenticated;


-- ===========================================================================
-- SUBMIT
-- ===========================================================================
create or replace function public.fms_complaint_submit_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_fy   text := public.fms_complaint_fy_code(current_date);
  v_seq  integer;
  v_no   text;
  v_type text := coalesce(nullif(trim(p->>'complaint_type'), ''), 'finished_good');
begin
  if not public.fms_complaint_can_raise(auth.uid()) then
    raise exception 'Not authorized to raise a complaint';
  end if;
  if v_type not in ('finished_good', 'raw_material') then
    raise exception 'Unknown complaint type: %', v_type;
  end if;

  v_seq := public.fms_complaint_next_seq('complaint:' || v_fy);
  v_no  := 'CMP-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_complaint_requests (
    complaint_no, complaint_type, status, current_step,
    raised_by, requester_name, company_id,
    lot_no, lot_expiry_date, lot_source, category, ink_type,
    item_id, item_name, party_id, party_name,
    invoice_no, invoice_date, qty_affected, unit_name, nature_id,
    issue_identified_at, problem_details, other_remarks, submitted_at
  ) values (
    v_no, v_type, 'awaiting_acknowledge', 'acknowledge',
    auth.uid(),
    coalesce(nullif(trim(p->>'requester_name'), ''),
             (select name from public.profiles where id = auth.uid()), 'Unknown'),
    nullif(p->>'company_id', '')::uuid,
    nullif(trim(p->>'lot_no'), ''),
    nullif(p->>'lot_expiry_date', '')::date,
    coalesce(nullif(trim(p->>'lot_source'), ''), 'manual'),
    nullif(trim(p->>'category'), ''),
    nullif(trim(p->>'ink_type'), ''),
    nullif(p->>'item_id', '')::uuid,
    nullif(trim(p->>'item_name'), ''),
    nullif(p->>'party_id', '')::uuid,
    nullif(trim(p->>'party_name'), ''),
    nullif(trim(p->>'invoice_no'), ''),
    nullif(p->>'invoice_date', '')::date,
    nullif(p->>'qty_affected', '')::numeric,
    nullif(trim(p->>'unit_name'), ''),
    nullif(p->>'nature_id', '')::uuid,
    nullif(p->>'issue_identified_at', '')::timestamptz,
    nullif(trim(p->>'problem_details'), ''),
    nullif(trim(p->>'other_remarks'), ''),
    now()
  )
  returning id into v_id;

  perform public.fms_complaint_announce(
    'request', v_id, 'raised',
    format('%s raised complaint %s against %s',
           coalesce((select name from public.profiles where id = auth.uid()), 'Someone'),
           v_no, coalesce(nullif(trim(p->>'party_name'), ''), 'a party')),
    public.fms_complaint_step_owner_ids('acknowledge'),
    jsonb_build_object('complaint_no', v_no, 'complaint_type', v_type,
                       'lot_no', nullif(trim(p->>'lot_no'), ''))
  );

  return v_id;
end $$;
grant execute on function public.fms_complaint_submit_request(jsonb) to authenticated;


-- ===========================================================================
-- ACKNOWLEDGE — accept and assign an investigator, or reject outright.
-- ===========================================================================
create or replace function public.fms_complaint_record_acknowledge(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_no       text;
  v_decision text := nullif(trim(p->>'decision'), '');
  v_assignee uuid := nullif(p->>'assignee_id', '')::uuid;
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_acknowledge' then
    raise exception 'Complaint % is %, not awaiting acknowledgement', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('acknowledge', p_req, auth.uid()) then
    raise exception 'Not authorized to acknowledge this complaint';
  end if;
  if v_decision not in ('accept', 'reject') then
    raise exception 'Acknowledge needs a decision of accept or reject';
  end if;
  if v_decision = 'reject' and nullif(trim(p->>'reject_reason'), '') is null then
    raise exception 'A reason is required to reject a complaint';
  end if;
  if v_decision = 'accept' and v_assignee is null then
    raise exception 'An investigator must be named to accept a complaint';
  end if;

  update public.fms_complaint_requests set
    ack_decision      = v_decision,
    ack_severity      = nullif(trim(p->>'severity'), ''),
    ack_assignee_id   = v_assignee,
    ack_assignee_name = (select name from public.profiles where id = v_assignee),
    ack_target_date   = nullif(p->>'target_date', '')::date,
    ack_reject_reason = nullif(trim(p->>'reject_reason'), ''),
    ack_note          = nullif(trim(p->>'note'), ''),
    ack_date          = coalesce(nullif(p->>'date', '')::date, current_date),
    ack_at            = now(),
    ack_by            = auth.uid(),
    status            = case when v_decision = 'accept' then 'awaiting_investigation' else 'rejected' end,
    current_step      = case when v_decision = 'accept' then 'investigation' else 'rejected' end,
    rejected_at       = case when v_decision = 'reject' then now() else null end,
    reject_reason     = case when v_decision = 'reject' then nullif(trim(p->>'reject_reason'), '') else null end
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req,
    case when v_decision = 'accept' then 'acknowledged' else 'rejected' end,
    case when v_decision = 'accept'
         then format('%s was acknowledged and assigned for investigation', v_no)
         else format('%s was rejected: %s', v_no, nullif(trim(p->>'reject_reason'), '')) end,
    case when v_decision = 'accept'
         then public.fms_complaint_step_owner_ids_for('investigation', p_req)
         else (select coalesce(array_agg(raised_by), '{}'::uuid[])
                 from public.fms_complaint_requests where id = p_req and raised_by is not null) end,
    jsonb_build_object('complaint_no', v_no, 'decision', v_decision)
  );
end $$;
grant execute on function public.fms_complaint_record_acknowledge(uuid, jsonb) to authenticated;


-- ===========================================================================
-- INVESTIGATION — the root cause, and who owns the corrective action.
-- ===========================================================================
create or replace function public.fms_complaint_record_investigation(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text;
  v_owner uuid := nullif(p->>'capa_owner_id', '')::uuid;
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_investigation' then
    raise exception 'Complaint % is %, not awaiting investigation', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('investigation', p_req, auth.uid()) then
    raise exception 'Not authorized to record the investigation on this complaint';
  end if;
  if nullif(trim(p->>'findings'), '') is null then
    raise exception 'Findings are required to record an investigation';
  end if;
  if v_owner is null then
    raise exception 'An owner for the corrective action must be named';
  end if;

  update public.fms_complaint_requests set
    inv_root_cause_id       = nullif(p->>'root_cause_id', '')::uuid,
    inv_root_cause_note     = nullif(trim(p->>'root_cause_note'), ''),
    inv_findings            = nullif(trim(p->>'findings'), ''),
    inv_responsible_dept_id = nullif(p->>'responsible_dept_id', '')::uuid,
    inv_capa_owner_id       = v_owner,
    inv_capa_owner_name     = (select name from public.profiles where id = v_owner),
    inv_date                = coalesce(nullif(p->>'date', '')::date, current_date),
    inv_at                  = now(),
    inv_by                  = auth.uid(),
    status                  = 'awaiting_capa',
    current_step            = 'capa'
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'investigated',
    format('%s has a root cause — corrective action is now owed', v_no),
    public.fms_complaint_step_owner_ids_for('capa', p_req),
    jsonb_build_object('complaint_no', v_no)
  );
end $$;
grant execute on function public.fms_complaint_record_investigation(uuid, jsonb) to authenticated;


-- ===========================================================================
-- CAPA — corrective and preventive action, and who resolves it with the party.
-- ===========================================================================
create or replace function public.fms_complaint_record_capa(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text;
  v_resolver uuid := nullif(p->>'resolver_id', '')::uuid;
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_capa' then
    raise exception 'Complaint % is %, not awaiting corrective action', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('capa', p_req, auth.uid()) then
    raise exception 'Not authorized to record the corrective action on this complaint';
  end if;
  -- BOTH are required. "Corrective" stops this one; "preventive" stops the next
  -- one, and a CAPA with only the first half is the reason the same complaint
  -- keeps coming back.
  if nullif(trim(p->>'corrective'), '') is null then
    raise exception 'The corrective action is required';
  end if;
  if nullif(trim(p->>'preventive'), '') is null then
    raise exception 'The preventive action is required — what stops it happening again';
  end if;
  if v_resolver is null then
    raise exception 'Someone must be named to resolve this with the party';
  end if;

  update public.fms_complaint_requests set
    capa_corrective    = nullif(trim(p->>'corrective'), ''),
    capa_preventive    = nullif(trim(p->>'preventive'), ''),
    capa_resolver_id   = v_resolver,
    capa_resolver_name = (select name from public.profiles where id = v_resolver),
    capa_target_date   = nullif(p->>'target_date', '')::date,
    capa_note          = nullif(trim(p->>'note'), ''),
    capa_date          = coalesce(nullif(p->>'date', '')::date, current_date),
    capa_at            = now(),
    capa_by            = auth.uid(),
    status             = 'awaiting_resolution',
    current_step       = 'resolution'
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'capa_recorded',
    format('%s has a corrective action — it is now ready to resolve with the party', v_no),
    public.fms_complaint_step_owner_ids_for('resolution', p_req),
    jsonb_build_object('complaint_no', v_no)
  );
end $$;
grant execute on function public.fms_complaint_record_capa(uuid, jsonb) to authenticated;


-- ===========================================================================
-- RESOLUTION — what was actually done, and who confirms it.
-- ===========================================================================
create or replace function public.fms_complaint_record_resolution(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text;
  v_type text := nullif(trim(p->>'type'), '');
  v_confirmer uuid := nullif(p->>'confirmer_id', '')::uuid;
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_resolution' then
    raise exception 'Complaint % is %, not awaiting resolution', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('resolution', p_req, auth.uid()) then
    raise exception 'Not authorized to resolve this complaint';
  end if;
  if v_type not in ('replace', 'credit_note', 'rework', 'no_action') then
    raise exception 'A resolution type is required (replace, credit_note, rework or no_action)';
  end if;
  -- A replacement or a credit note produced a document with a number on it;
  -- without that number the resolution cannot be traced to anything in Tally.
  if v_type in ('replace', 'credit_note') and nullif(trim(p->>'reference'), '') is null then
    raise exception 'A reference is required for a % resolution', v_type;
  end if;
  if v_confirmer is null then
    raise exception 'Someone must be named to confirm this with the party';
  end if;

  update public.fms_complaint_requests set
    res_type           = v_type,
    res_reference      = nullif(trim(p->>'reference'), ''),
    res_qty            = nullif(p->>'qty', '')::numeric,
    res_value          = nullif(p->>'value', '')::numeric,
    res_confirmer_id   = v_confirmer,
    res_confirmer_name = (select name from public.profiles where id = v_confirmer),
    res_note           = nullif(trim(p->>'note'), ''),
    res_date           = coalesce(nullif(p->>'date', '')::date, current_date),
    res_at             = now(),
    res_by             = auth.uid(),
    status             = 'awaiting_confirmation',
    current_step       = 'confirmation'
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'resolved',
    format('%s was resolved (%s) — awaiting the party''s confirmation', v_no, replace(v_type, '_', ' ')),
    public.fms_complaint_step_owner_ids_for('confirmation', p_req),
    jsonb_build_object('complaint_no', v_no, 'resolution', v_type)
  );
end $$;
grant execute on function public.fms_complaint_record_resolution(uuid, jsonb) to authenticated;


-- ===========================================================================
-- CONFIRMATION — the party's verdict. `false` still advances; see the column note.
-- ===========================================================================
create or replace function public.fms_complaint_record_confirmation(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text;
  v_ok boolean := nullif(p->>'party_satisfied', '')::boolean;
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_confirmation' then
    raise exception 'Complaint % is %, not awaiting confirmation', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('confirmation', p_req, auth.uid()) then
    raise exception 'Not authorized to confirm this complaint';
  end if;
  if v_ok is null then
    raise exception 'Record whether the party is satisfied';
  end if;

  update public.fms_complaint_requests set
    cfm_party_satisfied = v_ok,
    cfm_note            = nullif(trim(p->>'note'), ''),
    cfm_date            = coalesce(nullif(p->>'date', '')::date, current_date),
    cfm_at              = now(),
    cfm_by              = auth.uid(),
    status              = 'awaiting_close',
    current_step        = 'close'
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'confirmed',
    format('%s was confirmed (%s) — ready to close', v_no,
           case when v_ok then 'party satisfied' else 'party NOT satisfied' end),
    public.fms_complaint_step_owner_ids_for('close', p_req),
    jsonb_build_object('complaint_no', v_no, 'party_satisfied', v_ok)
  );
end $$;
grant execute on function public.fms_complaint_record_confirmation(uuid, jsonb) to authenticated;


-- ===========================================================================
-- CLOSE
-- ===========================================================================
create or replace function public.fms_complaint_record_close(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text;
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_close' then
    raise exception 'Complaint % is %, not awaiting close', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('close', p_req, auth.uid()) then
    raise exception 'Not authorized to close this complaint';
  end if;

  update public.fms_complaint_requests set
    cls_note     = nullif(trim(p->>'note'), ''),
    cls_date     = coalesce(nullif(p->>'date', '')::date, current_date),
    cls_at       = now(),
    cls_by       = auth.uid(),
    closed_at    = now(),
    status       = 'closed',
    current_step = 'closed'
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'closed', format('%s was closed', v_no),
    '{}'::uuid[],     -- nobody is owed anything by a closed complaint
    jsonb_build_object('complaint_no', v_no)
  );
end $$;
grant execute on function public.fms_complaint_record_close(uuid, jsonb) to authenticated;


-- ===========================================================================
-- EDIT WINDOWS — "correctable until the next step has run".
--
-- Mirrored in lib/queues.ts, which greys the button and SAYS WHY. The server is
-- the gate; those exist so the UI can explain rather than merely refuse.
--
-- ⚠ A HELD COMPLAINT IS STILL EDITABLE, unlike Sampling. Sampling must lock
--   edits while held because its resume decision is re-derived from the very
--   timestamps an edit touches; this module stores hold_from_status explicitly,
--   so the two are independent. A hold is often exactly when a mistake is spotted.
-- ===========================================================================
create or replace function public.fms_complaint_effective_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when r.status = 'on_hold'
              then coalesce(r.hold_from_status, r.status) else r.status end
  from public.fms_complaint_requests r where r.id = p_req;
$$;
grant execute on function public.fms_complaint_effective_status(uuid) to authenticated;

create or replace function public.fms_complaint_step_editable(p_step_key text, p_req uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_complaint_requests r
    where r.id = p_req
      and r.status not in ('cancelled', 'rejected')
      and public.fms_complaint_effective_status(p_req) = case p_step_key
            when 'acknowledge'   then 'awaiting_investigation'
            when 'investigation' then 'awaiting_capa'
            when 'capa'          then 'awaiting_resolution'
            when 'resolution'    then 'awaiting_confirmation'
            when 'confirmation'  then 'awaiting_close'
            -- Close is the LAST step: nothing downstream can lock it, so a closed
            -- complaint's note stays correctable. Safe — no stage machine reads it.
            when 'close'         then public.fms_complaint_effective_status(p_req)
            else '~never~'
          end
  );
$$;
grant execute on function public.fms_complaint_step_editable(text, uuid) to authenticated;


-- One generic corrector rather than six near-identical ones. It re-stamps only
-- the step's own columns and sets edited_at / edited_by — never `status` or
-- `current_step`, because a correction must not move the complaint.
create or replace function public.fms_complaint_update_step(p_step_key text, p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_no text;
begin
  select complaint_no into v_no from public.fms_complaint_requests where id = p_req for update;
  if v_no is null then raise exception 'Complaint % not found', p_req; end if;
  if not public.fms_complaint_can_act(p_step_key, p_req, auth.uid()) then
    raise exception 'Not authorized to correct this step';
  end if;
  if not public.fms_complaint_step_editable(p_step_key, p_req) then
    raise exception 'The % step can no longer be corrected on %', p_step_key, v_no;
  end if;

  if p_step_key = 'acknowledge' then
    update public.fms_complaint_requests set
      ack_severity      = nullif(trim(p->>'severity'), ''),
      ack_target_date   = nullif(p->>'target_date', '')::date,
      ack_note          = nullif(trim(p->>'note'), ''),
      ack_date          = coalesce(nullif(p->>'date', '')::date, ack_date),
      ack_assignee_id   = coalesce(nullif(p->>'assignee_id', '')::uuid, ack_assignee_id),
      ack_assignee_name = coalesce(
                            (select name from public.profiles
                              where id = nullif(p->>'assignee_id', '')::uuid), ack_assignee_name),
      edited_at = now(), edited_by = auth.uid()
    where id = p_req;

  elsif p_step_key = 'investigation' then
    update public.fms_complaint_requests set
      inv_root_cause_id       = nullif(p->>'root_cause_id', '')::uuid,
      inv_root_cause_note     = nullif(trim(p->>'root_cause_note'), ''),
      inv_findings            = coalesce(nullif(trim(p->>'findings'), ''), inv_findings),
      inv_responsible_dept_id = nullif(p->>'responsible_dept_id', '')::uuid,
      inv_capa_owner_id       = coalesce(nullif(p->>'capa_owner_id', '')::uuid, inv_capa_owner_id),
      inv_capa_owner_name     = coalesce(
                                  (select name from public.profiles
                                    where id = nullif(p->>'capa_owner_id', '')::uuid), inv_capa_owner_name),
      inv_date                = coalesce(nullif(p->>'date', '')::date, inv_date),
      edited_at = now(), edited_by = auth.uid()
    where id = p_req;

  elsif p_step_key = 'capa' then
    update public.fms_complaint_requests set
      capa_corrective    = coalesce(nullif(trim(p->>'corrective'), ''), capa_corrective),
      capa_preventive    = coalesce(nullif(trim(p->>'preventive'), ''), capa_preventive),
      capa_resolver_id   = coalesce(nullif(p->>'resolver_id', '')::uuid, capa_resolver_id),
      capa_resolver_name = coalesce(
                             (select name from public.profiles
                               where id = nullif(p->>'resolver_id', '')::uuid), capa_resolver_name),
      capa_target_date   = nullif(p->>'target_date', '')::date,
      capa_note          = nullif(trim(p->>'note'), ''),
      capa_date          = coalesce(nullif(p->>'date', '')::date, capa_date),
      edited_at = now(), edited_by = auth.uid()
    where id = p_req;

  elsif p_step_key = 'resolution' then
    update public.fms_complaint_requests set
      res_type           = coalesce(nullif(trim(p->>'type'), ''), res_type),
      res_reference      = nullif(trim(p->>'reference'), ''),
      res_qty            = nullif(p->>'qty', '')::numeric,
      res_value          = nullif(p->>'value', '')::numeric,
      res_confirmer_id   = coalesce(nullif(p->>'confirmer_id', '')::uuid, res_confirmer_id),
      res_confirmer_name = coalesce(
                             (select name from public.profiles
                               where id = nullif(p->>'confirmer_id', '')::uuid), res_confirmer_name),
      res_note           = nullif(trim(p->>'note'), ''),
      res_date           = coalesce(nullif(p->>'date', '')::date, res_date),
      edited_at = now(), edited_by = auth.uid()
    where id = p_req;

  elsif p_step_key = 'confirmation' then
    update public.fms_complaint_requests set
      cfm_party_satisfied = coalesce(nullif(p->>'party_satisfied', '')::boolean, cfm_party_satisfied),
      cfm_note            = nullif(trim(p->>'note'), ''),
      cfm_date            = coalesce(nullif(p->>'date', '')::date, cfm_date),
      edited_at = now(), edited_by = auth.uid()
    where id = p_req;

  elsif p_step_key = 'close' then
    update public.fms_complaint_requests set
      cls_note  = nullif(trim(p->>'note'), ''),
      cls_date  = coalesce(nullif(p->>'date', '')::date, cls_date),
      edited_at = now(), edited_by = auth.uid()
    where id = p_req;

  else
    raise exception 'Unknown step: %', p_step_key;
  end if;

  -- An EMPTY recipient list: a correction belongs on the audit trail without
  -- paging anyone.
  perform public.fms_complaint_announce(
    'request', p_req, 'step_corrected',
    format('The %s step on %s was corrected', replace(p_step_key, '_', ' '), v_no),
    '{}'::uuid[], jsonb_build_object('complaint_no', v_no, 'step', p_step_key)
  );
end $$;
grant execute on function public.fms_complaint_update_step(text, uuid, jsonb) to authenticated;

-- Thin per-step wrappers, so the frontend names the step in the call rather than
-- passing it as a string it could misspell.
create or replace function public.fms_complaint_update_acknowledge(p_req uuid, p jsonb)
returns void language sql security definer set search_path = public as
$$ select public.fms_complaint_update_step('acknowledge', p_req, p); $$;
create or replace function public.fms_complaint_update_investigation(p_req uuid, p jsonb)
returns void language sql security definer set search_path = public as
$$ select public.fms_complaint_update_step('investigation', p_req, p); $$;
create or replace function public.fms_complaint_update_capa(p_req uuid, p jsonb)
returns void language sql security definer set search_path = public as
$$ select public.fms_complaint_update_step('capa', p_req, p); $$;
create or replace function public.fms_complaint_update_resolution(p_req uuid, p jsonb)
returns void language sql security definer set search_path = public as
$$ select public.fms_complaint_update_step('resolution', p_req, p); $$;
create or replace function public.fms_complaint_update_confirmation(p_req uuid, p jsonb)
returns void language sql security definer set search_path = public as
$$ select public.fms_complaint_update_step('confirmation', p_req, p); $$;
create or replace function public.fms_complaint_update_close(p_req uuid, p jsonb)
returns void language sql security definer set search_path = public as
$$ select public.fms_complaint_update_step('close', p_req, p); $$;

grant execute on function public.fms_complaint_update_acknowledge(uuid, jsonb)   to authenticated;
grant execute on function public.fms_complaint_update_investigation(uuid, jsonb) to authenticated;
grant execute on function public.fms_complaint_update_capa(uuid, jsonb)          to authenticated;
grant execute on function public.fms_complaint_update_resolution(uuid, jsonb)    to authenticated;
grant execute on function public.fms_complaint_update_confirmation(uuid, jsonb)  to authenticated;
grant execute on function public.fms_complaint_update_close(uuid, jsonb)         to authenticated;


-- ===========================================================================
-- DOCUMENTS
-- ===========================================================================
create or replace function public.fms_complaint_add_doc(p_req uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.fms_complaint_can_see_request(p_req, auth.uid())
     or not public.module_can_edit(auth.uid(), 'complaint') then
    raise exception 'Not authorized to attach a document to this complaint';
  end if;

  insert into public.fms_complaint_docs (complaint_id, step_key, slot, path, name, mime, size_bytes, uploaded_by)
  values (p_req,
          coalesce(nullif(trim(p->>'step_key'), ''), 'raise'),
          coalesce(nullif(trim(p->>'slot'), ''), 'other'),
          nullif(trim(p->>'path'), ''),
          nullif(trim(p->>'name'), ''),
          nullif(trim(p->>'mime'), ''),
          nullif(p->>'size_bytes', '')::bigint,
          auth.uid())
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.fms_complaint_add_doc(uuid, jsonb) to authenticated;

create or replace function public.fms_complaint_delete_doc(p_doc uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_req uuid; v_uploader uuid;
begin
  select complaint_id, uploaded_by into v_req, v_uploader
    from public.fms_complaint_docs where id = p_doc;
  if v_req is null then raise exception 'Document % not found', p_doc; end if;
  -- Your own upload, or an admin/coordinator's call. Evidence somebody else
  -- attached is not yours to remove.
  if not (v_uploader = auth.uid()
          or public.is_admin(auth.uid())
          or public.fms_complaint_is_coordinator(auth.uid())) then
    raise exception 'Not authorized to remove this document';
  end if;
  delete from public.fms_complaint_docs where id = p_doc;
end $$;
grant execute on function public.fms_complaint_delete_doc(uuid) to authenticated;


-- ===========================================================================
-- HOLD / CANCEL
-- ===========================================================================
create or replace function public.fms_complaint_hold_request(p_req uuid, p_hold boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text;
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if not (public.is_admin(auth.uid()) or public.fms_complaint_is_coordinator(auth.uid())) then
    raise exception 'Only an admin or a coordinator may hold a complaint';
  end if;

  if p_hold then
    if v_status in ('closed', 'cancelled', 'rejected', 'on_hold') then
      raise exception 'Complaint % is % and cannot be held', v_no, v_status;
    end if;
    update public.fms_complaint_requests set
      hold_from_status = v_status,   -- explicit; see fms_complaint_resume_status
      status = 'on_hold', hold_at = now(),
      hold_reason = nullif(trim(coalesce(p_reason, '')), '')
    where id = p_req;
  else
    if v_status <> 'on_hold' then
      raise exception 'Complaint % is not on hold', v_no;
    end if;
    update public.fms_complaint_requests set
      status = public.fms_complaint_resume_status(p_req),
      hold_at = null, hold_reason = null, hold_from_status = null
    where id = p_req;
  end if;

  perform public.fms_complaint_announce(
    'request', p_req, case when p_hold then 'held' else 'resumed' end,
    format('%s was %s', v_no, case when p_hold then 'put on hold' else 'taken off hold' end),
    '{}'::uuid[], jsonb_build_object('complaint_no', v_no)
  );
end $$;
grant execute on function public.fms_complaint_hold_request(uuid, boolean, text) to authenticated;

create or replace function public.fms_complaint_cancel_request(p_req uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_raiser uuid;
begin
  select status, complaint_no, raised_by into v_status, v_no, v_raiser
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status in ('closed', 'cancelled', 'rejected') then
    raise exception 'Complaint % is already %', v_no, v_status;
  end if;
  if not (v_raiser = auth.uid()
          or public.is_admin(auth.uid())
          or public.fms_complaint_is_coordinator(auth.uid())) then
    raise exception 'Only the raiser, an admin or a coordinator may cancel a complaint';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required to cancel a complaint';
  end if;

  update public.fms_complaint_requests set
    status = 'cancelled', current_step = 'cancelled',
    cancelled_at = now(), cancel_reason = trim(p_reason)
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'cancelled', format('%s was cancelled: %s', v_no, trim(p_reason)),
    '{}'::uuid[], jsonb_build_object('complaint_no', v_no)
  );
end $$;
grant execute on function public.fms_complaint_cancel_request(uuid, text) to authenticated;

commit;
