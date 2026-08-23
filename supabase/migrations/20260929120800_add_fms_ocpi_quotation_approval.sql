-- ===========================================================================
-- OCPI FMS — approval gate 1: the quotation.
--
--   fms_ocpi_submit_quotation(deal)                  salesperson → approver
--   fms_ocpi_decide_quotation(deal, decision, note)  approver → approve/reject/rework
--   fms_ocpi_set_step_owners(step_key, …)            Settings → Step Owners
--
-- ⚠ 'rejected' IS ADDED TO THE STATUS SET, and it is NOT the same as
--   'cancelled'. Cancelled means we withdrew — the customer went quiet, the
--   requirement changed. Rejected means management looked at this quotation and
--   refused it. Collapsing the two would make "how many did we withdraw vs how
--   many did management stop?" unanswerable, which is exactly the question an
--   approval gate exists to make answerable. Widening a CHECK is additive: every
--   existing row still satisfies it.
--
-- ⚠ REWORK RETURNS THE DEAL TO 'draft', NOT TO A REWORK-SHAPED LIMBO.
--   The salesperson's next act is to edit and regenerate, which is exactly what
--   `draft` allows and what fms_ocpi_generate_quotation already accepts. The
--   fact that it came back is recorded in rework_stage / rework_reason /
--   rework_count, and the count is what makes "this one has been round three
--   times" visible. A separate live status would have needed every screen to
--   learn a synonym for draft.
--
-- ⚠ AN APPROVER CANNOT APPROVE THEIR OWN QUOTATION unless they are the only
--   person who could — see the check below. Someone who both raised a deal and
--   owns the approval step would otherwise wave their own work through, which
--   is the one thing an approval gate must not permit. Where they are the sole
--   owner the gate is a formality anyway and blocking it would deadlock the
--   deal, so it is allowed and the activity log records that it happened.
--
-- Purely ADDITIVE: one widened CHECK, three functions.
--
-- Reversal (reverse order):
--   drop function if exists public.fms_ocpi_set_step_owners(text, uuid[], uuid[], uuid);
--   drop function if exists public.fms_ocpi_decide_quotation(uuid, text, text);
--   drop function if exists public.fms_ocpi_submit_quotation(uuid);
--   alter table public.fms_ocpi_deals drop constraint fms_ocpi_deals_status_check;
--   -- then re-add the original CHECK without 'rejected'
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Widen the status set.
-- ---------------------------------------------------------------------------
alter table public.fms_ocpi_deals drop constraint if exists fms_ocpi_deals_status_check;
alter table public.fms_ocpi_deals add constraint fms_ocpi_deals_status_check check (status in (
  'draft',
  'awaiting_quotation_approval',
  'awaiting_order_confirmation',
  'awaiting_oc_approval',
  'awaiting_customer_sign',
  'awaiting_management_sign',
  'closed', 'rejected', 'rework', 'on_hold', 'cancelled'));

-- ---------------------------------------------------------------------------
-- 2. Send the quotation for approval.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_submit_quotation(p_deal uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_no     text;
  v_ver    integer;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, quotation_no, quotation_version_no
    into v_status, v_owner, v_no, v_ver
    from public.fms_ocpi_deals where id = p_deal for update;

  if v_status is null then raise exception 'Quotation not found'; end if;
  if not public.fms_ocpi_can_act('quotation', p_deal, v_uid) then
    raise exception 'You are not authorized to submit this quotation';
  end if;
  if v_owner is distinct from v_uid and not public.fms_ocpi_is_coordinator(v_uid) then
    raise exception 'This quotation belongs to someone else';
  end if;
  if v_status not in ('draft', 'rework') then
    raise exception 'This quotation is already %', replace(v_status, '_', ' ');
  end if;

  -- ⚠ A QUOTATION MUST EXIST BEFORE IT CAN BE APPROVED. Approving a set of form
  --   answers that were never rendered would mean the approver signed off
  --   something nobody has seen as a document.
  if v_no is null or coalesce(v_ver, 0) < 1 then
    raise exception 'Generate the quotation before sending it for approval';
  end if;

  update public.fms_ocpi_deals
     set status = 'awaiting_quotation_approval',
         current_step = 'quotation_approval'
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'quotation_submitted',
    v_no || ' sent for approval',
    public.fms_ocpi_step_owner_ids('quotation_approval'),
    jsonb_build_object('quotation_no', v_no, 'version_no', v_ver));
end $$;

comment on function public.fms_ocpi_submit_quotation(uuid) is
  'Mark a generated quotation final and send it to the quotation_approval owners. Refuses a quotation that has never been generated.';
grant execute on function public.fms_ocpi_submit_quotation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The approver's decision.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_decide_quotation(
  p_deal uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_status    text;
  v_owner     uuid;
  v_no        text;
  v_next      text;
  v_sole      boolean;
  v_owners    uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_decision not in ('approve', 'reject', 'rework') then
    raise exception 'Unknown decision: %', p_decision;
  end if;

  select status, raised_by, quotation_no
    into v_status, v_owner, v_no
    from public.fms_ocpi_deals where id = p_deal for update;

  if v_status is null then raise exception 'Quotation not found'; end if;
  if v_status <> 'awaiting_quotation_approval' then
    raise exception 'This quotation is not waiting for approval';
  end if;
  if not public.fms_ocpi_can_act('quotation_approval', p_deal, v_uid) then
    raise exception 'You are not an approver for quotations';
  end if;

  -- Self-approval: refused, unless this person is the only approver there is.
  v_owners := public.fms_ocpi_step_owner_ids('quotation_approval');
  v_sole := (array_length(v_owners, 1) = 1 and v_owners[1] = v_uid);
  if v_owner = v_uid and not v_sole then
    raise exception 'You raised this quotation, so somebody else has to approve it';
  end if;

  -- Rejecting or reworking without saying why leaves the salesperson guessing.
  if p_decision in ('reject', 'rework') and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say why, so the salesperson knows what to do next';
  end if;

  v_next := case p_decision
              when 'approve' then 'awaiting_order_confirmation'
              when 'reject'  then 'rejected'
              else 'draft'
            end;

  update public.fms_ocpi_deals
     set status        = v_next,
         current_step  = case p_decision when 'approve' then 'order_confirmation' else 'quotation' end,
         qa_decision   = p_decision,
         qa_note       = nullif(btrim(coalesce(p_note, '')), ''),
         qa_at         = now(),
         qa_by         = v_uid,
         rejected_at   = case when p_decision = 'reject' then now() else rejected_at end,
         reject_stage  = case when p_decision = 'reject' then 'quotation_approval' else reject_stage end,
         reject_reason = case when p_decision = 'reject' then nullif(btrim(coalesce(p_note,'')),'') else reject_reason end,
         rework_at     = case when p_decision = 'rework' then now() else rework_at end,
         rework_stage  = case when p_decision = 'rework' then 'quotation_approval' else rework_stage end,
         rework_reason = case when p_decision = 'rework' then nullif(btrim(coalesce(p_note,'')),'') else rework_reason end,
         rework_count  = rework_count + case when p_decision = 'rework' then 1 else 0 end
   where id = p_deal;

  -- The salesperson is the one waiting on this answer, so they are the recipient
  -- whatever the decision was.
  perform public.fms_ocpi_announce(
    'deal', p_deal, 'quotation_' || p_decision || 'd',
    coalesce(v_no, 'The quotation') || ' was ' ||
      case p_decision when 'approve' then 'approved — fill in the order confirmation'
                      when 'reject'  then 'rejected'
                      else 'sent back for changes' end ||
      case when nullif(btrim(coalesce(p_note,'')),'') is null then '' else ': ' || btrim(p_note) end,
    case when v_owner is null then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('decision', p_decision, 'quotation_no', v_no));
end $$;

comment on function public.fms_ocpi_decide_quotation(uuid, text, text) is
  'Approve, reject or return a quotation. Reject and rework both require a reason. Self-approval is refused unless the approver is the only one configured.';
grant execute on function public.fms_ocpi_decide_quotation(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Settings → who owns each step.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_set_step_owners(
  p_step_key      text,
  p_employee_ids  uuid[] default '{}',
  p_department_ids uuid[] default '{}',
  p_designation_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.is_admin(v_uid) then raise exception 'Only an admin can change step owners'; end if;
  if nullif(btrim(coalesce(p_step_key,'')),'') is null then raise exception 'Which step?'; end if;

  insert into public.fms_ocpi_step_owners (step_key, employee_ids, department_ids, designation_id)
  values (p_step_key, coalesce(p_employee_ids,'{}'), coalesce(p_department_ids,'{}'), p_designation_id)
  on conflict (step_key) do update
     set employee_ids   = excluded.employee_ids,
         department_ids = excluded.department_ids,
         designation_id = excluded.designation_id;
end $$;

comment on function public.fms_ocpi_set_step_owners(text, uuid[], uuid[], uuid) is
  'Set who owns one OCPI step. Admin only. employee_ids is the authority; department_ids is a UI filter.';
grant execute on function public.fms_ocpi_set_step_owners(text, uuid[], uuid[], uuid) to authenticated;

commit;
