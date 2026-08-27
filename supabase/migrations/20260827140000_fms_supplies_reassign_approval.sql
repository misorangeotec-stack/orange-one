-- ===========================================================================
-- Office Supplies FMS — the first approver may HAND A REQUEST to someone else.
--
-- Third module to get the handover, after Import (20260827120000) and Purchase
-- RM Domestic (20260827130000). Read the Import file for the shape; this header
-- records only what is DIFFERENT, and Office Supplies differs the most so far.
--
-- ⚠ DIFFERENCE 1 — THE EXCLUSIVITY HERE IS STRUCTURAL, NOT A CONFIGURATION GAP.
-- In Purchase every band held one person, but the schema allowed a list, so the
-- business could have fixed it in Setup. Not here. First approval routes to
-- fms_supplies_departments.hod_user_id — ONE uuid column, compared with a bare
-- `= p_uid` in fms_supplies_can_act__ungated — and the `first_approval` row in
-- fms_supplies_step_owners was DELIBERATELY EMPTIED by 20260720100000 precisely
-- so that step-owner list could not be mistaken for the routing rule. There is
-- no second name to add anywhere. Until this migration, a department whose HOD
-- was away had no way to move its requests at all.
--
-- ⚠ DIFFERENCE 2 — ONE AUTHZ SITE, NOT FOUR.
-- fms_supplies_decide_first_approval and fms_supplies_update_first_approval both
-- delegate to fms_supplies_can_act('first_approval', p_req, auth.uid()), so the
-- holder rule goes in ONE place — fms_supplies_can_act__ungated — and both RPCs
-- pick it up untouched. Neither RPC body is rewritten here. That is a real
-- advantage of this module's design over Purchase's, where the same rule had to
-- be repeated in four hand-written function bodies.
--
-- ⚠ DIFFERENCE 3 — THE READ GATE HAD TO BE WIDENED, AND FOR A COUNTERINTUITIVE
--   REASON. fms_supplies_can_read_request admits admin / coordinator / fulfilment
--   staff / module VIEWER / raiser / requested-for / department HOD. It looks as
--   though anyone with module access can read a request — but `module_is_viewer`
--   is `module_level(...) = 'view'` EXACTLY. A receiver holding an *edit* grant is
--   therefore NOT a viewer and matches no arm at all: the handover would land on
--   a request they cannot open. Import never hit this (its tables are
--   `select ... using (true)`) and Purchase never hit it either. A holder arm is
--   added below.
--
-- ⚠ DIFFERENCE 4 — NOTHING NEEDS TO STOP CLEARING assigned_approver_id, because
--   the column is NEW here. Purchase had ten historical clear-sites to audit;
--   this has none. The column is written only by the RPC below, so it survives
--   the decision by construction — which is what lets the holder still use
--   fms_supplies_update_first_approval to revise her own decision afterwards.
--
-- SCOPE: `first_approval` only. `second_approval` already has two step owners
-- configured and `handover` has two, so neither is blocked on one person; adding
-- a handover there would be solving a problem nobody has. Note also that
-- `handover` is an existing STEP KEY in this module meaning physical delivery —
-- nothing here is named "handover" for that reason.
--
-- A request must be at status 'pending_first_approval' to be reassigned. Unlike
-- Import, a hold here is a STATUS ('on_hold') rather than a per-line flag, so a
-- held request has to be resumed before it can be passed on.
--
-- ADDITIVE, per the repo rule: one new nullable column, two new functions, and
-- two create-or-replace bodies that keep their EXACT argument lists (changing a
-- signature would create a PostgREST OVERLOAD, not a replacement).
--
-- NO SERVER-SIDE ANNOUNCE HERE, DELIBERATELY — fms_supplies_announce copies
-- p_meta straight into email_outbox, and the card's content is authored in the
-- app's lib/emailMeta.ts. The store raises the announce client-side.
--
-- VERIFIED ON LIVE DATA 2026-08-27, both inside rolled-back transactions:
--   * 17 authorisation cases, 17 passed. Two of them are the point of section 5:
--     BEFORE the handover fms_supplies_can_read_request(req, receiver) returned
--     FALSE for an edit-level receiver, and TRUE after. Without section 5 the
--     handover would have moved a request onto a desk that could not open it.
--   * The holder was proved end to end, not just by predicate: she called
--     fms_supplies_decide_first_approval and the request moved to
--     pending_second_approval, the column SURVIVED that decision, and she could
--     then revise it through fms_supplies_update_first_approval.
--
-- REVERSAL — REHEARSED ON LIVE DATA 2026-08-27 with a handover deliberately in
-- flight; 9 of 9 checks passed. Both standing claims held again: the drop order
-- is NOT enforced (dropping the helper while the RPC still referenced it was
-- accepted, and only the CALL failed), and restoring the two bodies is optional
-- once the column is all NULL — the HOD owns the request again, an outsider
-- still cannot act, and the read gate closes back to exactly its old answers.
--
-- The recipe:
--   1. drop function public.fms_supplies_reassign_request(uuid, uuid);
--      drop function public.fms_supplies_can_receive_reassignment(uuid);
--      (helper last, to keep the broken window short — Postgres does NOT enforce
--       the order, as the Import and Purchase rehearsals both proved.)
--   2. update public.fms_supplies_requests set assigned_approver_id = null
--       where assigned_approver_id is not null;
--   3. delete from public.fms_supplies_config where key = 'reassign_pool';
--   4. re-run the fms_supplies_can_act__ungated body from
--      20260905120000_add_fms_supplies_raise_gate_and_hod_routing.sql and the
--      fms_supplies_can_read_request body from its own defining migration.
--      Optional once step 2 has run — with the column all NULL both new bodies
--      behave exactly like the old ones.
--   5. (optional) alter table public.fms_supplies_requests drop column assigned_approver_id;
--      Only if the column itself is unwanted; leaving it costs nothing.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The holder column.
-- ---------------------------------------------------------------------------
alter table public.fms_supplies_requests
  add column if not exists assigned_approver_id uuid references auth.users on delete set null;

comment on column public.fms_supplies_requests.assigned_approver_id is
  'Set while this request''s FIRST approval has been handed to one person. While it is set that person, not the department HOD, is the only non-admin who may decide it (fms_supplies_can_act__ungated) and they are admitted to reading it (fms_supplies_can_read_request). It is never cleared at the decision, so the holder can still revise it via fms_supplies_update_first_approval.';


-- ---------------------------------------------------------------------------
-- 2. Who may RECEIVE a handover.
--
-- Backed by fms_supplies_config key 'reassign_pool':
--     { "department_ids": [...], "user_ids": [...] }
--
-- ⚠ AUTHORIZATION COMES SOLELY FROM user_ids. department_ids is a Setup picker
--   filter and grants nothing — the same rule every FMS step-owner table follows.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_can_receive_reassignment(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_supplies_config c
     where c.key = 'reassign_pool'
       and p_uid::text in (
         select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
       )
  );
$$;

comment on function public.fms_supplies_can_receive_reassignment(uuid) is
  'Is this user on the configured list of people who may be handed an Office Supplies first approval? Reads ONLY fms_supplies_config.reassign_pool -> user_ids; department_ids in that same row is a Setup picker filter and grants nothing.';

grant execute on function public.fms_supplies_can_receive_reassignment(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Hand a request over (or take it back).
--
-- p_approver_id NULL = return it to the department HOD. That is the "take it
-- back" path, and it is why this is one RPC rather than two.
--
-- WHO MAY CALL IT is deliberately BROADER than who may decide: the department
-- HOD keeps the right to pull a request back after handing it over, which the
-- holder rule in section 4 would otherwise deny him.
--
-- WHO MAY RECEIVE is the pool OR the request's own HOD, so it can always be
-- handed back without an admin having to list every HOD in the pool.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_reassign_request(
  p_req         uuid,
  p_approver_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_hod    uuid;
  v_holder uuid;
begin
  select status, assigned_approver_id
    into v_status, v_holder
    from public.fms_supplies_requests
   where id = p_req
   for update;

  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'pending_first_approval' then
    raise exception 'This request is not awaiting first approval (status %) — it can no longer be reassigned', v_status;
  end if;

  v_hod := public.fms_supplies_request_hod(p_req);

  if not (public.is_admin(v_uid)
          or public.fms_supplies_is_coordinator(v_uid)
          or (v_hod is not null and v_hod = v_uid)
          or (v_holder is not null and v_holder = v_uid)) then
    raise exception 'Not authorized to reassign this request';
  end if;

  if p_approver_id is not null then
    if p_approver_id = v_uid then
      raise exception 'Pick someone else — a request cannot be reassigned to yourself';
    end if;
    if not (public.fms_supplies_can_receive_reassignment(p_approver_id)
            or (v_hod is not null and p_approver_id = v_hod)) then
      raise exception 'That person may not receive an approval. Add them in Setup, under Approvals, first.';
    end if;
  end if;

  -- ⚠ status and current_step are NOT touched. The request stays exactly where
  --   it is in the flow; only who owes the decision changes.
  update public.fms_supplies_requests
     set assigned_approver_id = p_approver_id
   where id = p_req;
end $$;

comment on function public.fms_supplies_reassign_request(uuid, uuid) is
  'Hand one Office Supplies request awaiting FIRST approval to another person, or pass NULL to return it to the department HOD. Callable by an admin, a process coordinator, the request''s HOD, or the current holder. Does not announce - the store raises the notification client-side so the email renders with content.';

grant execute on function public.fms_supplies_reassign_request(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. can_act__ungated — the holder rule.
--
--    Base body = 20260905120000_add_fms_supplies_raise_gate_and_hod_routing.sql.
--    ONE delta: inside the `first_approval` branch, a handover REPLACES the HOD.
--    Deliberately not an OR against the HOD — an OR would be a SHARE, leaving the
--    request in the HOD's queue as well, and the whole point is that it moves.
--
--    The gated wrapper fms_supplies_can_act is NOT touched and still opens with
--    module_can_edit(p_uid,'office-supplies'), so a receiver without an edit
--    grant is refused by the DATABASE, not merely stranded in the UI. Setup warns
--    about that next to the admin who can grant it.
--
--    Signature unchanged.
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
    -- A HANDOVER MOVES THE WORK. While assigned_approver_id is set, the holder is
    -- the only non-admin who may decide — the HOD no longer can, which is what
    -- takes the request out of the HOD's queue.
    select assigned_approver_id into v_holder
      from public.fms_supplies_requests where id = p_req;
    if v_holder is not null then
      return v_holder = p_uid;
    end if;

    v_hod := public.fms_supplies_request_hod(p_req);
    return v_hod is not null and v_hod = p_uid;
  end if;

  return public.fms_supplies_is_step_owner(p_step_key, p_uid);
end $$;


-- ---------------------------------------------------------------------------
-- 5. can_read_request — admit the holder.
--
--    ⚠ WITHOUT THIS THE FEATURE IS A DEAD END. The existing arms are admin /
--      coordinator / fulfilment staff / module VIEWER / raiser / requested-for /
--      department HOD. `module_is_viewer` is `module_level(...) = 'view'`
--      EXACTLY, so somebody holding an *edit* grant — which every receiver must
--      hold, because fms_supplies_can_act requires module_can_edit — matches
--      none of them. The handover would put the request in their queue and then
--      refuse to let them open it.
--
--    ONE delta: `or r.assigned_approver_id = p_uid` inside the existing exists().
--    Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_can_read_request(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_supplies_is_coordinator(p_uid)
      or public.fms_supplies_is_fulfilment_staff(p_uid)
      or public.module_is_viewer(p_uid, 'office-supplies')
      or exists (
        select 1 from public.fms_supplies_requests r
        left join public.fms_supplies_departments d on d.id = r.department_id
        where r.id = p_req
          and (r.raised_by = p_uid
            or r.requested_for_user_id = p_uid
            or r.assigned_approver_id = p_uid
            or d.hod_user_id = p_uid)
      );
$$;

commit;
