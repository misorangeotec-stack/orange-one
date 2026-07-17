-- ===========================================================================
-- Office Supplies FMS — stage history + edit-until-the-next-step.
--
-- WHY
-- All three stage screens are pending-only queues: the instant an owner acts the
-- row disappears and they can never see, let alone correct, what they did. This
-- is the Office Supplies twin of the Purchase FMS work (20260718120000 /
-- 20260718130000 / 20260718140000) and the Import one (20260719120000).
--
-- WHAT'S HERE
--   1. THE handover_by ATTRIBUTION FIX — a live bug, see section 1.
--   2. edited_at / edited_by on fms_supplies_requests.
--   3. One <step>_editable(id) predicate + one update_<step>(...) RPC per step:
--      first_approval · second_approval · handover
--
-- HOW THIS APP DIFFERS FROM PURCHASE / IMPORT — and it is not a small list:
--
--   • NO STAGE MACHINE. There is no fms_supplies_refresh_* : each RPC sets
--     `status` inline. So there is nothing derived to drift, and no
--     terminal-is-absorbing bar to respect. That is what makes editing a
--     DELIVERED handover safe (below) where Purchase's Tally equivalent is not.
--
--   • HANDOVER IS THE LAST STEP, and it closes the request. "Editable until the
--     next step is done" would give it a zero-second window and a Completed tab
--     of nothing but locked rows. Per an explicit product decision, a delivered
--     request's handover STAYS EDITABLE. Only rejected / cancelled / on_hold
--     lock it. This is safe precisely because of the previous point.
--
--   • THE ROUTE IS CONDITIONAL. A category with requires_approval = false is
--     submitted straight into 'pending_handover' (20260715170000). Such a
--     request has NO first/second approval, so it must never appear in an
--     approval stage's history. Handled natively — see section 3.
--
--   • A REJECTION NEVER STAMPS first_approved_at / second_approved_at. The
--     reject branch sets <step>_approver_id + rejected_at + reject_stage and
--     leaves the approved-at NULL. So a Completed list keyed on "approved_at is
--     not null" silently DROPS every rejection — which is exactly the thing an
--     approver most wants to look back at. reject_stage is the discriminator.
--
--   • AUTHZ ALREADY EXISTS. fms_supplies_can_act(step, req, uid) is admin OR
--     coordinator OR the request's HOD (first approval) OR the configured step
--     owner — precisely the "any step owner + admin" rule. Reused verbatim.
--
-- ⚠ A DELIBERATE DIVERGENCE FROM PURCHASE, called out so it is not read as a
--   slip. fms_purchase_update_approval re-stamps approver_id = auth.uid() on
--   EVERY edit while leaving approved_at alone — so B correcting A's remark
--   renders as "approved by B on <A's timestamp>", which is the same false
--   pairing this migration fixes in record_handover. Here the rule is split by
--   what actually changed:
--     • the decision STANDS (a remark correction) -> actor and timestamp are
--       untouched; the corrector lands in edited_by / edited_at. "Approved by A
--       on A's date, edited by B on B's date" is true in every part.
--     • the decision FLIPS to a rejection -> that IS a new decision, so it takes
--       a new actor AND a new timestamp (rejected_at = now()), and the stale
--       approved-at is cleared. Also true in every part.
--   Purchase would benefit from the same split; it is shipped and verified, so
--   it is flagged rather than changed from here.
--
-- Every RPC: authorized exactly like its create twin · re-checks the lock
-- SERVER-side (the disabled button is a courtesy, never the gate) · takes a row
-- lock · and writes its own activity row IN THIS TRANSACTION, because the
-- client-side announce used elsewhere is best-effort and swallows failures.
--
-- Additive / replace-only: no table, column or row of business data is dropped
-- or mutated. Existing rows keep NULL edit markers; actors are already recorded
-- and are NOT touched.
--
-- Deploy ordering: apply BEFORE the frontend that reads these columns.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Edit audit columns.
--
-- One pair, not one per step: the three steps write to disjoint columns
-- (first_*, second_*, handover_*) and a request only ever sits at one of them,
-- so per-step pairs would carry no information a single pair doesn't.
--
-- NAMED `edited_*`, NOT `updated_*`, and that is load-bearing: this table has a
-- set_updated_at TRIGGER that bumps updated_at on EVERY write, so updated_at
-- answers "when was this row last written", not "when was this entry corrected".
-- Pairing it with an actor would show a real editor against an unrelated moment.
-- ---------------------------------------------------------------------------
alter table public.fms_supplies_requests
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users on delete set null;

comment on column public.fms_supplies_requests.edited_at is
  'When a stage entry on this request was last CORRECTED via an update_* RPC. Distinct from updated_at, which a trigger bumps on every write.';

-- ---------------------------------------------------------------------------
-- 2. record_handover — fix the attribution theft.
--
-- THE BUG (live until this migration): handover_by is set UNCONDITIONALLY while
-- handed_over_at is coalesce-protected. record_handover is legitimately callable
-- more than once (it is how a tentative date is saved before delivery), so the
-- second caller silently becomes "the handover person" against the FIRST
-- caller's timestamp — a record that reads as true and is not. Same shape as the
-- Share PO hole closed in 20260718140000.
--
-- This was cosmetic while nothing read the column. It stops being cosmetic here:
-- Completed -> Mine is built on exactly this column, so the theft would move the
-- entry out of the real owner's list and into the editor's.
--
-- Body otherwise carried forward verbatim from 20260715170000; the ONLY change
-- is the coalesce on handover_by.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_record_handover(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_uid       uuid := auth.uid();
  v_delivered date := nullif(p->>'actual_delivery_date','')::date;
begin
  select status into v_status from public.fms_supplies_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'pending_handover' then
    raise exception 'This request is not ready for handover (status %)', v_status;
  end if;
  if not public.fms_supplies_can_act('handover', p_req, v_uid) then
    raise exception 'Not authorized to hand over this request';
  end if;

  update public.fms_supplies_requests set
    handed_over_at          = coalesce(handed_over_at, now()),
    -- First doer wins, matching handed_over_at above. A later corrector is
    -- recorded in edited_by by update_handover, not by overwriting this.
    handover_by             = coalesce(handover_by, v_uid),
    handover_remarks        = nullif(trim(p->>'handover_remarks'), ''),
    tentative_delivery_date = nullif(p->>'tentative_delivery_date','')::date,
    actual_delivery_date    = v_delivered,
    -- A delivery date closes the request; without one it stays open at handover.
    delivered_at            = case when v_delivered is not null then now() else null end,
    status                  = case when v_delivered is not null then 'delivered' else 'pending_handover' end,
    current_step            = 'handover'
  where id = p_req;
end $$;
grant execute on function public.fms_supplies_record_handover(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. FIRST APPROVAL (HOD) — the line's decision.
--    Next step: the second approval.
--
--    The whole rule is `status = 'pending_second_approval'`, and that single
--    condition is doing a lot of work — deliberately, because every alternative
--    leaks:
--      • it implies first_approved_at is not null  -> the step IS done;
--      • it implies second_approved_at is null     -> the next step is NOT done;
--      • it excludes 'rejected' and 'cancelled'    -> terminal, no un-reject path
--        exists in this app and this does not invent one;
--      • it excludes 'on_hold', which matters MECHANICALLY and not merely out of
--        caution: fms_supplies_resume_status decides where a held request comes
--        back to by reading first_approved_at / second_approved_at /
--        handed_over_at / requires_approval — the very columns an edit touches.
--        Editing under hold could silently move where the request resumes to.
--        Resume it first, then edit.
--      • it excludes the SKIP PATH for free: a requires_approval = false request
--        is born at 'pending_handover' and is never once 'pending_second_approval'.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_first_approval_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_supplies_requests r
     where r.id = p_req and r.status = 'pending_second_approval'
  );
$$;
grant execute on function public.fms_supplies_first_approval_editable(uuid) to authenticated;

comment on function public.fms_supplies_first_approval_editable(uuid) is
  'True while the first-approval decision may still be corrected: approved, awaiting the second approval, not held / rejected / cancelled.';

create or replace function public.fms_supplies_update_first_approval(
  p_req uuid, p_approve boolean, p_remarks text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_uid uuid := auth.uid(); v_no text;
begin
  select status, req_no into v_status, v_no
    from public.fms_supplies_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;

  if not public.fms_supplies_can_act('first_approval', p_req, v_uid) then
    raise exception 'Not authorized to change this approval';
  end if;

  if not public.fms_supplies_first_approval_editable(p_req) then
    if v_status in ('rejected','cancelled') then
      raise exception 'This request is % — its first approval can no longer be changed.', v_status;
    elsif v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing its first approval.';
    end if;
    raise exception 'The first approval can no longer be changed: the second approval has already been decided (status %).', v_status;
  end if;

  if not p_approve and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when the request is not approved';
  end if;

  if p_approve then
    -- The decision STANDS; only the remark moves. first_approver_id and
    -- first_approved_at are the record of who decided and when — untouched.
    update public.fms_supplies_requests set
      first_remarks = nullif(trim(p_remarks), ''),
      edited_at = now(), edited_by = v_uid
    where id = p_req;
  else
    -- The decision FLIPS: this is a new decision, so it takes a new actor and a
    -- new timestamp, and the stale approved-at is cleared — leaving it would date
    -- an approval that was withdrawn.
    update public.fms_supplies_requests set
      first_approved_at = null,
      first_approver_id = v_uid,
      first_remarks     = nullif(trim(p_remarks), ''),
      rejected_at       = now(),
      reject_stage      = 'first_approval',
      reject_reason     = trim(p_remarks),
      status            = 'rejected',
      current_step      = 'first_approval',
      edited_at = now(), edited_by = v_uid
    where id = p_req;
  end if;

  perform public.fms_supplies_announce('request', p_req, 'first_approval_edited',
    format('First approval on %s changed to %s', coalesce(v_no,'the request'),
           case when p_approve then 'approved' else 'not approved' end),
    '{}'::uuid[], jsonb_build_object('approved', p_approve));
end $$;
grant execute on function public.fms_supplies_update_first_approval(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. SECOND APPROVAL (Management) — the line's decision.
--    Next step: the handover being recorded.
--
--    `status = 'pending_handover'` alone is NOT enough here, and this is the one
--    place the skip path needs an explicit word: a requires_approval = false
--    request sits at 'pending_handover' too, having never had a second approval.
--    `second_approved_at is not null` is what separates them.
--
--    `handed_over_at is null` is the next-step test: record_handover stamps it
--    the first time it runs, which is the moment this decision stops being the
--    last word.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_second_approval_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_supplies_requests r
     where r.id = p_req
       and r.status = 'pending_handover'        -- not held / rejected / cancelled / delivered
       and r.second_approved_at is not null     -- ...and it really was approved here (not the skip path)
       and r.handed_over_at is null             -- ...and the next step hasn't started
  );
$$;
grant execute on function public.fms_supplies_second_approval_editable(uuid) to authenticated;

comment on function public.fms_supplies_second_approval_editable(uuid) is
  'True while the second-approval decision may still be corrected: approved here, awaiting handover, nothing handed over yet.';

create or replace function public.fms_supplies_update_second_approval(
  p_req uuid, p_approve boolean, p_remarks text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_uid uuid := auth.uid(); v_no text; v_handed timestamptz; v_second timestamptz;
begin
  select status, req_no, handed_over_at, second_approved_at
    into v_status, v_no, v_handed, v_second
    from public.fms_supplies_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;

  if not public.fms_supplies_can_act('second_approval', p_req, v_uid) then
    raise exception 'Not authorized to change this approval';
  end if;

  if not public.fms_supplies_second_approval_editable(p_req) then
    if v_status in ('rejected','cancelled') then
      raise exception 'This request is % — its second approval can no longer be changed.', v_status;
    elsif v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing its second approval.';
    elsif v_second is null then
      raise exception 'This request skipped the approvals — there is no second approval to edit.';
    elsif v_handed is not null or v_status = 'delivered' then
      raise exception 'The second approval can no longer be changed: the handover has already been recorded.';
    end if;
    raise exception 'The second approval can no longer be changed (status %).', v_status;
  end if;

  if not p_approve and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when the request is not approved';
  end if;

  if p_approve then
    update public.fms_supplies_requests set
      second_remarks = nullif(trim(p_remarks), ''),
      edited_at = now(), edited_by = v_uid
    where id = p_req;
  else
    update public.fms_supplies_requests set
      second_approved_at = null,
      second_approver_id = v_uid,
      second_remarks     = nullif(trim(p_remarks), ''),
      rejected_at        = now(),
      reject_stage       = 'second_approval',
      reject_reason      = trim(p_remarks),
      status             = 'rejected',
      current_step       = 'second_approval',
      edited_at = now(), edited_by = v_uid
    where id = p_req;
  end if;

  perform public.fms_supplies_announce('request', p_req, 'second_approval_edited',
    format('Second approval on %s changed to %s', coalesce(v_no,'the request'),
           case when p_approve then 'approved' else 'not approved' end),
    '{}'::uuid[], jsonb_build_object('approved', p_approve));
end $$;
grant execute on function public.fms_supplies_update_second_approval(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. HANDOVER — the final confirmation.
--    There IS no next step, so nothing downstream can lock this.
--
--    A DELIVERED REQUEST'S HANDOVER STAYS EDITABLE. That is a product decision,
--    and it is a safe one here in a way it would not be in Purchase: this app
--    has no stage machine, so a late correction to a delivery date or remark has
--    nothing derived hanging off it to drift. (Purchase's Tally booking locks on
--    the PO closing because refresh_po short-circuits on terminal POs — a
--    mechanical bar. No such mechanism exists in this app.)
--
--    Only rejected / cancelled / on_hold lock it.
--
--    record_handover cannot serve as the edit: it hard-refuses once
--    status <> 'pending_handover', which is precisely the delivered case.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_handover_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_supplies_requests r
     where r.id = p_req
       and r.handed_over_at is not null                    -- the step must be DONE to be edited
       and r.status in ('pending_handover','delivered')     -- excludes on_hold / rejected / cancelled
  );
$$;
grant execute on function public.fms_supplies_handover_editable(uuid) to authenticated;

comment on function public.fms_supplies_handover_editable(uuid) is
  'True while the handover may still be corrected: recorded, and not held / rejected / cancelled. Deliberately stays true after delivery — handover is the last step and nothing is derived from it.';

create or replace function public.fms_supplies_update_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status    text;
  v_uid       uuid := auth.uid();
  v_no        text;
  v_handed    timestamptz;
  v_delivered date := nullif(p->>'actual_delivery_date','')::date;
  v_old       date;
begin
  select status, req_no, handed_over_at, actual_delivery_date
    into v_status, v_no, v_handed, v_old
    from public.fms_supplies_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;

  if not public.fms_supplies_can_act('handover', p_req, v_uid) then
    raise exception 'Not authorized to edit this handover';
  end if;

  if not public.fms_supplies_handover_editable(p_req) then
    if v_handed is null then
      raise exception 'No handover has been recorded on this request yet — there is nothing to edit.';
    elsif v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing its handover.';
    end if;
    raise exception 'This request is % — its handover can no longer be edited.', v_status;
  end if;

  update public.fms_supplies_requests set
    handover_remarks        = nullif(trim(p->>'handover_remarks'), ''),
    tentative_delivery_date = nullif(p->>'tentative_delivery_date','')::date,
    actual_delivery_date    = v_delivered,
    -- coalesce, not now(): re-saving a delivered request must not restamp WHEN it
    -- was delivered. Clearing the actual date reopens it — that is record_handover's
    -- own rule, and fms_supplies_resume_status agrees (handed_over_at is not null
    -- => resumes to pending_handover), so the two cannot disagree.
    delivered_at            = case when v_delivered is not null then coalesce(delivered_at, now()) else null end,
    status                  = case when v_delivered is not null then 'delivered' else 'pending_handover' end,
    current_step            = 'handover',
    -- handover_by / handed_over_at are NOT touched: who did the step and when are
    -- history. The corrector is recorded here.
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_supplies_announce('request', p_req, 'handover_edited',
    format('Handover on %s edited', coalesce(v_no,'the request')), '{}'::uuid[],
    jsonb_build_object('delivered_from', v_old, 'delivered_to', v_delivered));
end $$;
grant execute on function public.fms_supplies_update_handover(uuid, jsonb) to authenticated;
