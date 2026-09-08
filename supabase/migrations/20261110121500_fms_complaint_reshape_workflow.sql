-- ===========================================================================
-- Complaint (RM/FG) FMS — THE WORKFLOW RESHAPED (Phase 12).
--
-- The seven-step quality chain built in phases 1-11 was not how the business
-- actually handles a complaint. Confirmed with the user on 07-09-2026 and
-- replaced wholesale. THE OLD SHAPE NEVER RAN IN ANGER — six test rows, no real
-- complaint — so this is a correction, not a migration of live work.
--
--   raise
--     -> PLANT       check it, do the corrective action, remarks + attachment
--     -> SERVICE     requisition, remarks, conclusion,
--                    "Commercial call taken?"  Yes / No
--          Yes -> APPROVAL   management, with the commercial-call remarks
--                    -> BACK TO SERVICE, who work on it and close
--          No  -> service closes there, remarks MANDATORY
--     -> MANAGEMENT REVIEW   one click, "Review done"
--     -> closed
--
-- FOUR QUEUES, not seven: plant, service, approval, management_review.
--
-- ⚠ SERVICE IS ONE BUCKET ENTERED TWICE, and that is why it is one step key with
--   two statuses (`awaiting_service`, `awaiting_service_close`) rather than two
--   steps. The user's words were "its again come to service team bucket" — the
--   same desk, not a new one — and a second step key would have put a second,
--   near-duplicate entry in the sidebar. Sampling's `lab_process` models a
--   two-pass step the same way.
--
-- ⚠ THE COMMERCIAL CALL REPLACES THE CREDIT-NOTE VALUE THRESHOLD ENTIRELY.
--   Phase 11's ₹25,000 gate is retired: the service team knows whether a
--   commercial call was made, and a value cannot infer it. `approval_required`
--   is now driven by `svc_commercial_call`, and the `approval` config key is
--   left in place but unread.
--
-- ⚠ THE OLD STEP COLUMNS ARE KEPT, NOT DROPPED. Supabase changes here are
--   additive-only. ack_*, inv_*, capa_*, res_* and cfm_* are dead as of this
--   migration and documented as such; the six test rows keep whatever they hold.
--   apr_* and cls_* ARE REUSED — the management approval and the service close
--   mean the same thing in the new chain, so a second set would be waste.
--
-- ⚠ STATUSES ARE WIDENED, NEVER NARROWED. The retired ones stay legal in the
--   CHECK forever; nothing produces them any more.
--
-- Reversal: re-apply the RPCs from 20261110120500 / 20261110121400 and
--   alter table public.fms_complaint_requests
--     drop column if exists plant_action, ... (the columns added below).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- STATUSES — the four new ones, alongside every retired one.
-- ---------------------------------------------------------------------------
alter table public.fms_complaint_requests drop constraint if exists fms_complaint_requests_status_check;
alter table public.fms_complaint_requests add constraint fms_complaint_requests_status_check
  check (status in (
    -- the live chain
    'awaiting_plant', 'awaiting_service', 'awaiting_approval',
    'awaiting_service_close', 'awaiting_management_review',
    'closed', 'on_hold', 'cancelled',
    -- RETIRED with the seven-step chain (phase 12). Nothing produces these; the
    -- six pre-existing test rows may still hold them.
    'awaiting_acknowledge', 'awaiting_investigation', 'awaiting_capa',
    'awaiting_resolution', 'awaiting_confirmation', 'awaiting_close', 'rejected'));

alter table public.fms_complaint_requests
  -- PLANT
  add column if not exists plant_action   text,
  add column if not exists plant_remarks  text,
  add column if not exists plant_date     date,
  add column if not exists plant_at       timestamptz,
  add column if not exists plant_by       uuid references auth.users on delete set null,
  -- SERVICE (first pass)
  add column if not exists svc_requisition text,
  add column if not exists svc_remarks     text,
  add column if not exists svc_conclusion  text,
  -- THE GATE. NULL until the service team answers; true sends it to approval.
  add column if not exists svc_commercial_call boolean,
  add column if not exists svc_call_remarks    text,
  add column if not exists svc_date        date,
  add column if not exists svc_at          timestamptz,
  add column if not exists svc_by          uuid references auth.users on delete set null,
  -- SERVICE (second pass, after approval)
  add column if not exists svc_close_remarks text,
  add column if not exists svc_close_date    date,
  add column if not exists svc_close_at      timestamptz,
  add column if not exists svc_close_by      uuid references auth.users on delete set null,
  -- MANAGEMENT REVIEW
  add column if not exists mgmt_note text,
  add column if not exists mgmt_date date,
  add column if not exists mgmt_at   timestamptz,
  add column if not exists mgmt_by   uuid references auth.users on delete set null;

comment on column public.fms_complaint_requests.svc_commercial_call is
  'THE APPROVAL GATE. Yes sends the complaint to management approval with svc_call_remarks; No lets the service team close it there and then, with svc_close_remarks required.';

-- New complaints start at the plant.
alter table public.fms_complaint_requests alter column status set default 'awaiting_plant';
alter table public.fms_complaint_requests alter column current_step set default 'plant';


-- ---------------------------------------------------------------------------
-- can_act — the new arms.
--
-- ⚠ NO PER-REQUEST ASSIGNEES ANY MORE. The old chain named the next actor at
--   every step; this one routes to BUCKETS — plant, service, management — whose
--   members are the step's owners in Setup. That is the whole reason it is
--   simpler, and it means authorization is entirely `is_step_owner`.
--
-- ⚠ THE RAISER KEEPS NOTHING. They raise and then wait; the close belongs to the
--   service team and the review to management.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_can_act(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.module_can_edit(p_uid, 'complaint')
     and exists (
       select 1 from public.fms_complaint_requests r
       where r.id = p_req
         and (
           public.is_admin(p_uid)
           or public.fms_complaint_is_coordinator(p_uid)
           or public.fms_complaint_is_step_owner(p_step_key, p_uid)
         )
     );
$$;


-- ---------------------------------------------------------------------------
-- SUBMIT — now lands at the plant.
-- ---------------------------------------------------------------------------
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
    v_no, v_type, 'awaiting_plant', 'plant',
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
    public.fms_complaint_step_owner_ids('plant'),
    jsonb_build_object('complaint_no', v_no, 'complaint_type', v_type,
                       'lot_no', nullif(trim(p->>'lot_no'), ''))
  );
  return v_id;
end $$;


-- ---------------------------------------------------------------------------
-- PLANT — check it and act on it.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_record_plant(p_req uuid, p jsonb)
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
  if v_status <> 'awaiting_plant' then
    raise exception 'Complaint % is %, not with the plant', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('plant', p_req, auth.uid()) then
    raise exception 'Not authorized to record the plant action on this complaint';
  end if;
  if nullif(trim(p->>'action'), '') is null then
    raise exception 'The corrective action is required';
  end if;
  if nullif(trim(p->>'remarks'), '') is null then
    raise exception 'The plant remarks are required';
  end if;

  update public.fms_complaint_requests set
    plant_action  = nullif(trim(p->>'action'), ''),
    plant_remarks = nullif(trim(p->>'remarks'), ''),
    plant_date    = coalesce(nullif(p->>'date', '')::date, current_date),
    plant_at      = now(),
    plant_by      = auth.uid(),
    status        = 'awaiting_service',
    current_step  = 'service'
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'plant_done',
    format('%s — the plant has acted; it is now with the service team', v_no),
    public.fms_complaint_step_owner_ids('service'),
    jsonb_build_object('complaint_no', v_no));
end $$;
grant execute on function public.fms_complaint_record_plant(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- SERVICE, first pass — requisition, conclusion, and THE COMMERCIAL CALL.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_record_service(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text;
  v_call boolean := nullif(p->>'commercial_call', '')::boolean;
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_service' then
    raise exception 'Complaint % is %, not with the service team', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('service', p_req, auth.uid()) then
    raise exception 'Not authorized to act for the service team on this complaint';
  end if;
  if v_call is null then
    raise exception 'Answer whether a commercial call was taken — it decides whether this needs approval';
  end if;
  if nullif(trim(p->>'conclusion'), '') is null then
    raise exception 'The conclusion is required';
  end if;
  -- Yes: management need the reason for the call. No: the service team is
  -- closing it here and now, so their closing remarks are MANDATORY.
  if v_call and nullif(trim(p->>'call_remarks'), '') is null then
    raise exception 'Commercial call remarks are required — management approve on the strength of them';
  end if;
  if not v_call and nullif(trim(p->>'close_remarks'), '') is null then
    raise exception 'Closing remarks are required when no commercial call was taken';
  end if;

  update public.fms_complaint_requests set
    svc_requisition     = nullif(trim(p->>'requisition'), ''),
    svc_remarks         = nullif(trim(p->>'remarks'), ''),
    svc_conclusion      = nullif(trim(p->>'conclusion'), ''),
    svc_commercial_call = v_call,
    svc_call_remarks    = nullif(trim(p->>'call_remarks'), ''),
    svc_date            = coalesce(nullif(p->>'date', '')::date, current_date),
    svc_at              = now(),
    svc_by              = auth.uid(),
    -- No commercial call: the service team closes it right here.
    svc_close_remarks   = case when v_call then null else nullif(trim(p->>'close_remarks'), '') end,
    svc_close_date      = case when v_call then null else coalesce(nullif(p->>'date', '')::date, current_date) end,
    svc_close_at        = case when v_call then null else now() end,
    svc_close_by        = case when v_call then null else auth.uid() end,
    approval_required   = v_call,
    status              = case when v_call then 'awaiting_approval' else 'awaiting_management_review' end,
    current_step        = case when v_call then 'approval' else 'management_review' end
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req,
    case when v_call then 'service_to_approval' else 'service_closed' end,
    case when v_call
      then format('%s — a commercial call was taken; it needs management approval', v_no)
      else format('%s was closed by the service team; it is ready for management review', v_no) end,
    public.fms_complaint_step_owner_ids(case when v_call then 'approval' else 'management_review' end),
    jsonb_build_object('complaint_no', v_no, 'commercial_call', v_call));
end $$;
grant execute on function public.fms_complaint_record_service(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- APPROVAL — management, on the commercial call.
--
-- ⚠ A REFUSAL RETURNS IT TO THE SERVICE BUCKET with a reason, never to a dead
--   end: management refusing the call is saying "settle it another way", and the
--   customer still has to be answered.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_record_approval(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text;
  v_decision text := nullif(trim(p->>'decision'), '');
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_approval' then
    raise exception 'Complaint % is %, not awaiting approval', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('approval', p_req, auth.uid()) then
    raise exception 'Not authorized to approve the commercial call on this complaint';
  end if;
  if v_decision not in ('approve', 'reject') then
    raise exception 'Approval needs a decision of approve or reject';
  end if;
  if v_decision = 'reject' and nullif(trim(p->>'note'), '') is null then
    raise exception 'A reason is required when refusing the commercial call';
  end if;

  update public.fms_complaint_requests set
    apr_decision = v_decision,
    apr_note     = nullif(trim(p->>'note'), ''),
    apr_date     = coalesce(nullif(p->>'date', '')::date, current_date),
    apr_at       = now(),
    apr_by       = auth.uid(),
    -- Approved OR refused, it goes back to the service team: approved so they can
    -- act on it and close, refused so they can settle it another way.
    status       = 'awaiting_service_close',
    current_step = 'service'
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req,
    case when v_decision = 'approve' then 'call_approved' else 'call_refused' end,
    case when v_decision = 'approve'
      then format('The commercial call on %s was approved — back to the service team', v_no)
      else format('The commercial call on %s was refused: %s', v_no, nullif(trim(p->>'note'), '')) end,
    public.fms_complaint_step_owner_ids('service'),
    jsonb_build_object('complaint_no', v_no, 'decision', v_decision));
end $$;


-- ---------------------------------------------------------------------------
-- SERVICE, second pass — work it and close.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_record_service_close(p_req uuid, p jsonb)
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
  if v_status <> 'awaiting_service_close' then
    raise exception 'Complaint % is %, not waiting on the service team to close', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('service', p_req, auth.uid()) then
    raise exception 'Not authorized to close this complaint for the service team';
  end if;
  if nullif(trim(p->>'close_remarks'), '') is null then
    raise exception 'Closing remarks are required';
  end if;

  update public.fms_complaint_requests set
    svc_close_remarks = nullif(trim(p->>'close_remarks'), ''),
    svc_close_date    = coalesce(nullif(p->>'date', '')::date, current_date),
    svc_close_at      = now(),
    svc_close_by      = auth.uid(),
    status            = 'awaiting_management_review',
    current_step      = 'management_review'
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'service_closed',
    format('%s was closed by the service team; it is ready for management review', v_no),
    public.fms_complaint_step_owner_ids('management_review'),
    jsonb_build_object('complaint_no', v_no));
end $$;
grant execute on function public.fms_complaint_record_service_close(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- MANAGEMENT REVIEW — one click, and the chain is closed.
--
-- EVERY complaint passes here, whichever branch it took. The note is optional:
-- the user asked for "one click as review done", and demanding a sentence to
-- acknowledge something already settled is how a final step gets skipped.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_record_management_review(p_req uuid, p jsonb)
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
  if v_status <> 'awaiting_management_review' then
    raise exception 'Complaint % is %, not awaiting management review', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('management_review', p_req, auth.uid()) then
    raise exception 'Not authorized to review this complaint';
  end if;

  update public.fms_complaint_requests set
    mgmt_note    = nullif(trim(p->>'note'), ''),
    mgmt_date    = coalesce(nullif(p->>'date', '')::date, current_date),
    mgmt_at      = now(),
    mgmt_by      = auth.uid(),
    closed_at    = now(),
    status       = 'closed',
    current_step = 'closed'
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'reviewed',
    format('%s was reviewed by management and closed', v_no),
    '{}'::uuid[],   -- nobody is owed anything by a closed complaint
    jsonb_build_object('complaint_no', v_no));
end $$;
grant execute on function public.fms_complaint_record_management_review(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- EDIT WINDOWS for the new chain.
-- ---------------------------------------------------------------------------
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
      and r.status <> 'cancelled'
      and public.fms_complaint_effective_status(p_req) = case p_step_key
            when 'plant'    then 'awaiting_service'
            -- Service's first pass stays correctable at either place it can hand
            -- to: approval (call taken) or the review (closed there and then).
            when 'service'  then case
                                   when public.fms_complaint_effective_status(p_req) = 'awaiting_approval'
                                     then 'awaiting_approval'
                                   else 'awaiting_management_review'
                                 end
            when 'approval' then 'awaiting_service_close'
            -- The review is last; nothing downstream can lock it.
            when 'management_review' then public.fms_complaint_effective_status(p_req)
            else '~never~'
          end
  );
$$;

do $mig$
begin
  if (select count(*) from information_schema.columns
       where table_name = 'fms_complaint_requests'
         and column_name in ('plant_at','svc_at','svc_commercial_call','svc_close_at','mgmt_at')) <> 5 then
    raise exception 'Complaint: the reshaped workflow columns did not all install';
  end if;
end $mig$;

commit;
