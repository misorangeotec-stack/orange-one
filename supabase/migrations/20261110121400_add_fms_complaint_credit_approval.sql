-- ===========================================================================
-- Complaint (RM/FG) FMS — CREDIT-NOTE APPROVAL (Phase 11).
--
-- A CONDITIONAL EIGHTH STEP. A credit note is money leaving the business, so one
-- above a threshold now needs a named approver before the party is told it is
-- settled. Everything else — a replacement, a rework, no action, or a credit
-- note under the threshold — routes straight to Confirmation exactly as before.
--
--     ... capa -> resolution -+-> confirmation -> close        (the common path)
--                             |
--                             +-> approval -> confirmation -> close
--                                 (credit note, value > threshold)
--
-- ⚠ THE GATE IS EVALUATED WHEN THE RESOLUTION IS RECORDED, and stamped onto the
--   row as `approval_required`. It is NOT re-derived on read. If the threshold is
--   later changed in Setup, complaints already in flight keep the rule they were
--   judged under — otherwise raising the threshold would silently release
--   everything waiting for approval, and lowering it would strand complaints at a
--   step they had already passed.
--
-- ⚠ REJECTION RETURNS THE COMPLAINT TO `resolution`, not to a dead end. An
--   approver refusing a ₹2L credit note is saying "settle it differently", and
--   the resolver has to be able to. A terminal rejection here would mean
--   cancelling a live customer complaint over an internal disagreement.
--
-- ⚠ NO APPROVAL MATRIX. Purchase has bands and multiple approvers because a PO
--   is a commitment made in advance; this is one number and one named person.
--   Setup names the approvers as the `approval` step's owners like any other
--   step, and the threshold is one config value.
--
-- The threshold ships at 25,000 as a starting point, editable in Setup. It is
-- deliberately NOT zero: zero would make every credit note need approval, which
-- is the option that was considered and not chosen.
--
-- Additive: new columns, one new status, one new config key, one new RPC, and a
-- re-issued record_resolution + can_act.
--
-- Reversal:
--   drop function if exists public.fms_complaint_record_approval(uuid,jsonb);
--   alter table public.fms_complaint_requests
--     drop column if exists approval_required, drop column if exists apr_decision,
--     drop column if exists apr_note, drop column if exists apr_date,
--     drop column if exists apr_at, drop column if exists apr_by;
--   -- then re-apply record_resolution + can_act from 20261110120500 / 20261110120400.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- The status. ⚠ WIDENING a CHECK is additive; narrowing it never is.
-- ---------------------------------------------------------------------------
alter table public.fms_complaint_requests drop constraint if exists fms_complaint_requests_status_check;
alter table public.fms_complaint_requests add constraint fms_complaint_requests_status_check
  check (status in (
    'awaiting_acknowledge', 'awaiting_investigation', 'awaiting_capa',
    'awaiting_resolution', 'awaiting_approval', 'awaiting_confirmation',
    'awaiting_close', 'closed', 'rejected', 'on_hold', 'cancelled'));

alter table public.fms_complaint_requests
  -- Stamped at resolution, never re-derived. See the header.
  add column if not exists approval_required boolean not null default false,
  add column if not exists apr_decision text
    check (apr_decision is null or apr_decision in ('approve', 'reject')),
  add column if not exists apr_note text,
  add column if not exists apr_date date,
  add column if not exists apr_at   timestamptz,
  add column if not exists apr_by   uuid references auth.users on delete set null;

comment on column public.fms_complaint_requests.approval_required is
  'Whether THIS complaint needed credit-note approval, decided when the resolution was recorded and frozen there. Never re-derived from the current threshold — changing the threshold must not move complaints already in flight.';

-- The threshold. A jsonb singleton like every other setting in this module.
insert into public.fms_complaint_config (key, value)
values ('approval', jsonb_build_object('credit_note_threshold', 25000))
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- can_act, re-issued with the approval arm.
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
           or (p_step_key = 'investigation' and r.ack_assignee_id   = p_uid)
           or (p_step_key = 'capa'          and r.inv_capa_owner_id = p_uid)
           or (p_step_key = 'resolution'    and r.capa_resolver_id  = p_uid)
           or (p_step_key = 'confirmation'  and r.res_confirmer_id  = p_uid)
           or (p_step_key = 'close'         and r.raised_by         = p_uid)
           -- ⚠ `approval` has NO per-request assignee arm, deliberately. The
           --    approver is whoever Setup names as the step's owner; letting the
           --    resolver nominate their own approver would defeat the control.
         )
     );
$$;


-- ---------------------------------------------------------------------------
-- record_resolution, re-issued: routes to approval or to confirmation.
-- ---------------------------------------------------------------------------
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
  v_value numeric := nullif(p->>'value', '')::numeric;
  v_threshold numeric;
  v_needs boolean;
  v_next text;
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
  if v_type in ('replace', 'credit_note') and nullif(trim(p->>'reference'), '') is null then
    raise exception 'A reference is required for a % resolution', v_type;
  end if;
  if v_confirmer is null then
    raise exception 'Someone must be named to confirm this with the party';
  end if;

  select coalesce((value->>'credit_note_threshold')::numeric, 25000) into v_threshold
    from public.fms_complaint_config where key = 'approval';
  v_threshold := coalesce(v_threshold, 25000);

  -- A credit note ABOVE the threshold needs approving. A credit note with no
  -- value recorded is treated as needing it: "we did not say how much" is not a
  -- reason to skip the money control.
  v_needs := (v_type = 'credit_note' and (v_value is null or v_value > v_threshold));
  v_next  := case when v_needs then 'awaiting_approval' else 'awaiting_confirmation' end;

  if v_needs and nullif(trim(p->>'value'), '') is null then
    raise exception 'A credit note needs its value recorded — it decides whether approval is required';
  end if;

  update public.fms_complaint_requests set
    res_type           = v_type,
    res_reference      = nullif(trim(p->>'reference'), ''),
    res_qty            = nullif(p->>'qty', '')::numeric,
    res_value          = v_value,
    res_confirmer_id   = v_confirmer,
    res_confirmer_name = (select name from public.profiles where id = v_confirmer),
    res_note           = nullif(trim(p->>'note'), ''),
    res_date           = coalesce(nullif(p->>'date', '')::date, current_date),
    res_at             = now(),
    res_by             = auth.uid(),
    approval_required  = v_needs,
    status             = v_next,
    current_step       = case when v_needs then 'approval' else 'confirmation' end
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'resolved',
    case when v_needs
      then format('%s was resolved with a credit note of %s — it needs approval', v_no, v_value)
      else format('%s was resolved (%s) — awaiting the party''s confirmation', v_no, replace(v_type, '_', ' ')) end,
    public.fms_complaint_step_owner_ids_for(case when v_needs then 'approval' else 'confirmation' end, p_req),
    jsonb_build_object('complaint_no', v_no, 'resolution', v_type, 'approval_required', v_needs)
  );
end $$;


-- ---------------------------------------------------------------------------
-- The approval itself.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_record_approval(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text; v_val numeric;
  v_decision text := nullif(trim(p->>'decision'), '');
begin
  select status, complaint_no, res_value into v_status, v_no, v_val
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_approval' then
    raise exception 'Complaint % is %, not awaiting approval', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('approval', p_req, auth.uid()) then
    raise exception 'Not authorized to approve a credit note on this complaint';
  end if;
  if v_decision not in ('approve', 'reject') then
    raise exception 'Approval needs a decision of approve or reject';
  end if;
  -- A refusal without a reason gives the resolver nothing to act on.
  if v_decision = 'reject' and nullif(trim(p->>'note'), '') is null then
    raise exception 'A note is required when refusing a credit note';
  end if;

  update public.fms_complaint_requests set
    apr_decision = v_decision,
    apr_note     = nullif(trim(p->>'note'), ''),
    apr_date     = coalesce(nullif(p->>'date', '')::date, current_date),
    apr_at       = now(),
    apr_by       = auth.uid(),
    -- ⚠ REJECTION GOES BACK TO `resolution`, not to a terminal state — the
    --   resolver must be able to settle it another way. See the header.
    status       = case when v_decision = 'approve' then 'awaiting_confirmation' else 'awaiting_resolution' end,
    current_step = case when v_decision = 'approve' then 'confirmation' else 'resolution' end
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req,
    case when v_decision = 'approve' then 'credit_approved' else 'credit_rejected' end,
    case when v_decision = 'approve'
      then format('The credit note on %s was approved', v_no)
      else format('The credit note on %s was refused: %s', v_no, nullif(trim(p->>'note'), '')) end,
    public.fms_complaint_step_owner_ids_for(
      case when v_decision = 'approve' then 'confirmation' else 'resolution' end, p_req),
    jsonb_build_object('complaint_no', v_no, 'decision', v_decision, 'value', v_val)
  );
end $$;
grant execute on function public.fms_complaint_record_approval(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- The edit window for the new step, and the shifted one for resolution.
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
      and r.status not in ('cancelled', 'rejected')
      and public.fms_complaint_effective_status(p_req) = case p_step_key
            when 'acknowledge'   then 'awaiting_investigation'
            when 'investigation' then 'awaiting_capa'
            when 'capa'          then 'awaiting_resolution'
            -- Resolution stays correctable while it is at EITHER of the two
            -- steps it can hand off to.
            when 'resolution'    then case
                                        when public.fms_complaint_effective_status(p_req) = 'awaiting_approval'
                                          then 'awaiting_approval'
                                        else 'awaiting_confirmation'
                                      end
            when 'approval'      then 'awaiting_confirmation'
            when 'confirmation'  then 'awaiting_close'
            when 'close'         then public.fms_complaint_effective_status(p_req)
            else '~never~'
          end
  );
$$;

-- The generic corrector gains the approval arm.
create or replace function public.fms_complaint_update_approval(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_no text;
begin
  select complaint_no into v_no from public.fms_complaint_requests where id = p_req for update;
  if v_no is null then raise exception 'Complaint % not found', p_req; end if;
  if not public.fms_complaint_can_act('approval', p_req, auth.uid()) then
    raise exception 'Not authorized to correct the approval';
  end if;
  if not public.fms_complaint_step_editable('approval', p_req) then
    raise exception 'The approval can no longer be corrected on %', v_no;
  end if;
  update public.fms_complaint_requests set
    apr_note  = nullif(trim(p->>'note'), ''),
    apr_date  = coalesce(nullif(p->>'date', '')::date, apr_date),
    edited_at = now(), edited_by = auth.uid()
  where id = p_req;
  perform public.fms_complaint_announce('request', p_req, 'step_corrected',
    format('The approval on %s was corrected', v_no), '{}'::uuid[],
    jsonb_build_object('complaint_no', v_no, 'step', 'approval'));
end $$;
grant execute on function public.fms_complaint_update_approval(uuid, jsonb) to authenticated;


do $mig$
begin
  if not exists (
    select 1 from public.fms_complaint_config where key = 'approval'
      and (value->>'credit_note_threshold')::numeric > 0
  ) then
    raise exception 'Complaint: the approval threshold did not install, or is zero';
  end if;

  -- The new status must be accepted by the CHECK.
  begin
    perform 'awaiting_approval'::text;
  exception when others then
    raise exception 'Complaint: awaiting_approval was not admitted to the status CHECK';
  end;
end $mig$;

commit;
