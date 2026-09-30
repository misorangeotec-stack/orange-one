-- ===========================================================================
-- General Purchase (office-supplies) — REASSIGN AT SECOND APPROVAL.
--
-- The first approval could already be handed to someone else
-- (20260827140000, tightened by 20260928120000). This does the same for the
-- Management (second) approval, like Purchase's approval reassign: the
-- approval MOVES to one named person, who then replaces the second-approval
-- step owners until it is decided or handed back.
--
-- WHAT CHANGES
--   1. New nullable column fms_supplies_requests.second_assigned_approver_id.
--      Its own column, NOT a reuse of assigned_approver_id: that one is never
--      cleared (the first-approval holder revises through it), so sharing it
--      would overwrite the first handover and hand the revise right to the wrong
--      person.
--   2. fms_supplies_reassign_request — same signature, now branches on status.
--      pending_first_approval: the 20260928120000 rules, unchanged.
--      pending_second_approval: caller = admin / coordinator / a second_approval
--      step owner / the current holder; receiver = the reassign pool OR a
--      second_approval step owner; never the caller, the raiser or the
--      beneficiary. NULL hands it back to the step owners.
--   3. fms_supplies_can_act__ungated — a second_approval branch: a holder
--      REPLACES the step owners (not an OR, or nothing would move). Covers
--      decide_second_approval and update_second_approval, which both delegate.
--   4. fms_supplies_can_read_request — admits BOTH holders.
--      ⚠ ALSO A REPAIR. 20260925130100 (view-only reads) re-created this function
--      from an older body and DROPPED the `assigned_approver_id` arm that
--      20260827140000 had added, so an edit-level first-approval holder may be
--      unable to open the request they were handed. Base = 20260925130100.
--   5. fms_supplies_email_payload — a 'reassigned' card that links to the right
--      queue (p_meta->>'step'). ⚠ ALSO A REPAIR: 20260905120000 re-created this
--      function without the 'reassigned' branch that 20260827140100 had added,
--      so every reassign mail fell to the generic "updated a request" card.
--      Base = 20260905120000; the lines marked CHANGED are the only difference.
--
-- ⚠ BEFORE APPLYING ON LIVE: compare sections 3, 4 and 5 with pg_proc.prosrc.
--   They are rebuilt from the newest MIGRATION FILES, not from live, because
--   this worktree has no database connection. If live already differs (a hotfix
--   applied through the SQL editor), merge that in first.
--
-- ADDITIVE: one nullable column, four create-or-replace bodies with UNCHANGED
-- argument lists (a changed list would create a PostgREST overload).
-- Rollback: 20261227120000_fms_supplies_reassign_second_approval_rollback.sql.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The second-approval holder column.
-- ---------------------------------------------------------------------------
alter table public.fms_supplies_requests
  add column if not exists second_assigned_approver_id uuid references auth.users on delete set null;

comment on column public.fms_supplies_requests.second_assigned_approver_id is
  'Set while this request''s SECOND (Management) approval has been handed to one person. While set, that person replaces the second_approval step owners (fms_supplies_can_act__ungated) and may read the request (fms_supplies_can_read_request). Never cleared at the decision, so the holder can still revise via fms_supplies_update_second_approval.';


-- ---------------------------------------------------------------------------
-- 2. Hand a request over (or take it back) — now at either approval.
--    ⚠ Keep the DEFAULT: the live signature is (uuid, uuid default null).
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_reassign_request(p_req uuid, p_approver_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_hod     uuid;
  v_holder  uuid;
  v_holder2 uuid;
  v_raiser  uuid;
  v_for     uuid;
begin
  select status, assigned_approver_id, second_assigned_approver_id, raised_by, requested_for_user_id
    into v_status, v_holder, v_holder2, v_raiser, v_for
    from public.fms_supplies_requests
   where id = p_req
   for update;

  if v_status is null then raise exception 'Request not found'; end if;
  if v_status not in ('pending_first_approval','pending_second_approval') then
    raise exception 'This request is not awaiting an approval (status %) — it can no longer be reassigned', v_status;
  end if;

  if p_approver_id is not null then
    if p_approver_id = v_uid then
      raise exception 'Pick someone else — a request cannot be reassigned to yourself';
    end if;
    -- Nobody approves their own request, however it reached them.
    if p_approver_id = v_raiser or (v_for is not null and p_approver_id = v_for) then
      raise exception 'Pick someone else — this request cannot be approved by the person who raised it or who it is for';
    end if;
  end if;

  -- ---- first approval: the 20260928120000 rules, unchanged ----
  if v_status = 'pending_first_approval' then
    v_hod := public.fms_supplies_request_hod(p_req);

    if not (public.is_admin(v_uid)
            or public.fms_supplies_is_coordinator(v_uid)
            or (v_hod is not null and v_hod = v_uid)
            or (v_holder is not null and v_holder = v_uid)) then
      raise exception 'Not authorized to reassign this request';
    end if;

    if p_approver_id is not null
       and not (public.fms_supplies_can_receive_reassignment(p_approver_id)
                or (v_hod is not null and p_approver_id = v_hod)) then
      raise exception 'That person may not receive an approval. Add them in Setup, under Approvals, first.';
    end if;

    update public.fms_supplies_requests
       set assigned_approver_id = p_approver_id
     where id = p_req;
    return;
  end if;

  -- ---- second approval (Management) ----
  -- The step owners keep the right to pull it back after handing it over, the
  -- same way the HOD does at first approval.
  if not (public.is_admin(v_uid)
          or public.fms_supplies_is_coordinator(v_uid)
          or public.fms_supplies_is_step_owner('second_approval', v_uid)
          or (v_holder2 is not null and v_holder2 = v_uid)) then
    raise exception 'Not authorized to reassign this request';
  end if;

  if p_approver_id is not null
     and not (public.fms_supplies_can_receive_reassignment(p_approver_id)
              or public.fms_supplies_is_step_owner('second_approval', p_approver_id)) then
    raise exception 'That person may not receive an approval. Add them in Setup, under Approvals, first.';
  end if;

  -- ⚠ status and current_step are NOT touched; only who owes the decision changes.
  update public.fms_supplies_requests
     set second_assigned_approver_id = p_approver_id
   where id = p_req;
end $$;

comment on function public.fms_supplies_reassign_request(uuid, uuid) is
  'Hand one General Purchase request awaiting FIRST or SECOND approval to another person, or pass NULL to return it to its default owners (the department HOD / the second_approval step owners). Does not announce - the store raises the notification client-side.';

grant execute on function public.fms_supplies_reassign_request(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. can_act__ungated — the holder rule at BOTH approvals.
--    Base = 20260827140000. Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_can_act__ungated(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hod    uuid;
  v_holder uuid;
begin
  if public.is_admin(p_uid) or public.fms_supplies_is_coordinator(p_uid) then
    return true;
  end if;

  if p_step_key = 'first_approval' then
    select assigned_approver_id into v_holder
      from public.fms_supplies_requests where id = p_req;
    if v_holder is not null then
      return v_holder = p_uid;
    end if;

    v_hod := public.fms_supplies_request_hod(p_req);
    return v_hod is not null and v_hod = p_uid;
  end if;

  if p_step_key = 'second_approval' then                                           -- NEW
    -- A handover MOVES the work: the holder replaces the step owners.
    select second_assigned_approver_id into v_holder
      from public.fms_supplies_requests where id = p_req;
    if v_holder is not null then
      return v_holder = p_uid;
    end if;
  end if;

  return public.fms_supplies_is_step_owner(p_step_key, p_uid);
end $$;


-- ---------------------------------------------------------------------------
-- 4. can_read_request — admit both holders. Base = 20260925130100.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_can_read_request(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin(p_uid)
      or public.fms_supplies_is_coordinator(p_uid)
      or public.fms_supplies_is_fulfilment_staff(p_uid)
      or public.module_is_viewer(p_uid, 'office-supplies')
      or exists (
           select 1
             from public.fms_supplies_requests r
             left join public.fms_supplies_departments d on d.id = r.department_id
            where r.id = p_req
              and (r.raised_by = p_uid
                or r.requested_for_user_id = p_uid
                or r.assigned_approver_id = p_uid          -- restored (lost in 20260925130100)
                or r.second_assigned_approver_id = p_uid   -- NEW
                or d.hod_user_id = p_uid)
         );
$fn$;


-- ---------------------------------------------------------------------------
-- 5. email_payload — the 'reassigned' card, per step. Base = 20260905120000.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_email_payload(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_meta        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b text := '/general-purchase';
  r record;
  mr record;
  v_cat text;
  v_doc text;
  v_subject text; v_eyebrow text; v_headline text; v_action text;
  v_cta_label text; v_cta_path text;
  v_rows jsonb;
  v_note jsonb := '{}'::jsonb;
  v_label text;
  v_name text;
  v_back boolean;                                                                  -- CHANGED
  v_second boolean;                                                                -- CHANGED
begin
  -- ---- master-data governance ----
  if p_entity_type = 'master_request' then
    select * into mr from public.fms_supplies_master_requests where id = p_entity_id;
    if not found then return jsonb_build_object('headline', p_text); end if;
    v_label := case when coalesce(p_meta->>'masterType', mr.master_type) = 'service_type'
                    then 'service type' else 'item' end;
    v_name  := coalesce(mr.proposed_payload->>'name', 'entry');
    if p_type = 'master_requested' then
      return jsonb_build_object(
        'subject', 'New ' || v_label || ' requested - "' || v_name || '"',
        'eyebrow', 'Master request',
        'headline', 'A new ' || v_label || ' was requested',
        'action', 'requested a new ' || v_label,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Review master requests', 'ctaPath', b || '/master-requests');
    else
      return jsonb_build_object(
        'subject', case when p_type = 'master_approved'
                        then 'Your ' || v_label || ' was approved - "' || v_name || '"'
                        else 'Your ' || v_label || ' request was rejected' end,
        'eyebrow', case when p_type = 'master_approved' then 'Master approved' else 'Master rejected' end,
        'headline', case when p_type = 'master_approved'
                         then 'Your new ' || v_label || ' was approved'
                         else 'Your ' || v_label || ' request was rejected' end,
        'action', case when p_type = 'master_approved' then 'approved a ' || v_label else 'rejected a ' || v_label end,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Open masters', 'ctaPath', b || '/master-requests')
      || case when coalesce(btrim(mr.review_note),'') <> ''
              then jsonb_build_object('note', jsonb_build_object('label','Note','text', mr.review_note))
              else '{}'::jsonb end;
    end if;
  end if;

  -- ---- request workflow ----
  select req.*,
         c.name  as company_name,
         d.name  as dept_name,
         cat.name as category_name,
         st.name as service_name
    into r
    from public.fms_supplies_requests req
    left join public.fms_supplies_companies     c   on c.id  = req.company_id
    left join public.fms_supplies_departments   d   on d.id  = req.department_id
    left join public.fms_supplies_categories    cat on cat.id = req.category_id
    left join public.fms_supplies_service_types st  on st.id  = req.service_type_id
   where req.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_cat := coalesce(r.category_name, r.service_name, '-');
  v_doc := 'Request #' || r.req_no;

  v_rows := jsonb_build_array(
    jsonb_build_object('label','Item','value', coalesce(nullif(btrim(r.item_name),''), '-')),
    jsonb_build_object('label','Quantity','value', coalesce(r.quantity,'-')),
    jsonb_build_object('label', case when r.request_type = 'services_maintenance' then 'Service' else 'Category' end,
                       'value', v_cat),
    jsonb_build_object('label','Company','value', coalesce(r.company_name,'-')),
    jsonb_build_object('label','Department','value', coalesce(r.dept_name,'-')),
    jsonb_build_object('label','Location','value', coalesce(r.location,'-')),
    jsonb_build_object('label','Requested for','value', coalesce(r.requested_for_name,'-'))
  );

  if p_type = 'raised' then
    v_eyebrow := 'New request'; v_action := 'raised a general purchase request';
    if r.status = 'pending_handover' then
      v_headline  := 'A purchase request is ready to hand over';
      v_cta_label := 'Open Handover queue'; v_cta_path := b || '/queues/handover';
    elsif r.status = 'pending_second_approval' then                                 -- CHANGED (new branch)
      v_headline  := 'A purchase request needs your management approval';
      v_cta_label := 'Open Second-approval queue'; v_cta_path := b || '/queues/second-approval';
    else
      v_headline  := 'A purchase request needs your approval';
      v_cta_label := 'Open First-approval queue'; v_cta_path := b || '/queues/first-approval';
    end if;
    v_subject := 'New purchase request - ' || coalesce(nullif(btrim(r.item_name),''), v_cat);
    if coalesce(btrim(r.reason),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object('label','Reason','text', r.reason));
    end if;

  elsif p_type = 'first_approved' then
    v_eyebrow := 'First approval'; v_action := 'gave the first approval';
    v_headline := 'First approval done - ready for management approval';
    v_subject := 'Approved (1/2) - ready for management (' || v_doc || ')';
    v_cta_label := 'Open Second-approval queue'; v_cta_path := b || '/queues/second-approval';
    if coalesce(btrim(r.first_remarks),'') <> '' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','HOD remark','value', r.first_remarks));
    end if;

  elsif p_type = 'second_approved' then
    v_eyebrow := 'Second approval'; v_action := 'gave the second approval';
    v_headline := 'Approved - ready for handover';
    v_subject := 'Approved - ready for handover (' || v_doc || ')';
    v_cta_label := 'Open Handover queue'; v_cta_path := b || '/queues/handover';
    if coalesce(btrim(r.second_remarks),'') <> '' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','Management remark','value', r.second_remarks));
    end if;

  elsif p_type = 'reassigned' then                                                  -- CHANGED (branch restored, now per step)
    v_back   := coalesce(p_meta->>'returned','false') = 'true';
    v_second := coalesce(p_meta->>'step','first_approval') = 'second_approval';
    v_eyebrow := case when v_back then 'Returned' else 'Reassigned' end;
    v_action  := case when v_back and v_second then 'returned a request to Management'
                      when v_back then 'returned a request to the department head'
                      else 'reassigned a request for approval' end;
    v_headline := case when v_back and v_second then 'A request has come back to Management'
                       when v_back then 'A request has come back to the department head'
                       when v_second then 'A request has been handed to you for management approval'
                       else 'A request has been handed to you for approval' end;
    v_subject := case when v_back and v_second then 'Approval returned to Management (' || v_doc || ')'
                      when v_back then 'Approval returned to the department head (' || v_doc || ')'
                      else 'Approval reassigned to you (' || v_doc || ')' end;
    -- Both directions point at the queue the approval sits in: that is where the
    -- work now is for whoever is being told about it.
    if v_second then
      v_cta_label := 'Open Second-approval queue'; v_cta_path := b || '/queues/second-approval';
    else
      v_cta_label := 'Open First-approval queue'; v_cta_path := b || '/queues/first-approval';
    end if;
    if coalesce(btrim(p_meta->>'note'),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object('label','Why the change','text', p_meta->>'note'));
    end if;

  elsif p_type in ('first_rejected','second_rejected') then
    v_eyebrow := 'Rejected'; v_action := 'rejected a request';
    v_headline := 'Your purchase request was rejected';
    v_subject := 'Your purchase request was rejected';
    v_cta_label := 'Open my request'; v_cta_path := b || '/requests/' || r.id::text;
    if coalesce(btrim(r.reject_reason),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object(
        'label', 'Reason' || case when r.reject_stage = 'first_approval' then ' (first approval)'
                                   when r.reject_stage = 'second_approval' then ' (second approval)'
                                   else '' end,
        'text', r.reject_reason));
    end if;

  elsif p_type = 'delivered' then
    v_eyebrow := 'Delivered'; v_action := 'handed over the items';
    v_headline := 'Your purchase request was delivered';
    v_subject := 'Delivered - ' || v_doc;
    v_cta_label := 'Open the request'; v_cta_path := b || '/requests/' || r.id::text;
    if r.actual_delivery_date is not null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','Delivered on','value', to_char(r.actual_delivery_date,'DD-MM-YYYY')));
    end if;
    if coalesce(btrim(r.handover_remarks),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object('label','Handover note','text', r.handover_remarks));
    end if;

  else
    -- unknown / future type: a clean minimal email from the bell text
    v_eyebrow := 'General Purchase'; v_action := 'updated a request';
    v_headline := coalesce(nullif(btrim(p_text),''), 'General Purchase update');
    v_subject := 'General Purchase: ' || v_headline;
    v_cta_label := 'Open the request'; v_cta_path := b || '/requests/' || r.id::text;
  end if;

  return jsonb_build_object(
    'subject', v_subject, 'eyebrow', v_eyebrow, 'headline', v_headline,
    'action', v_action, 'docLabel', v_doc,
    'rows', v_rows,
    'ctaLabel', v_cta_label, 'ctaPath', v_cta_path
  ) || v_note;
exception when others then
  -- content is best-effort: never let a payload glitch break the announce
  return jsonb_build_object('headline', coalesce(nullif(btrim(p_text),''), 'General Purchase update'));
end $$;

commit;
