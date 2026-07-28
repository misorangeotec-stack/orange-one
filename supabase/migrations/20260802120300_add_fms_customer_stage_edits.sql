-- ===========================================================================
-- CUSTOMER CREATION FMS — correcting a step that is already done.
--
-- WHAT THIS IS FOR
--   Every one of these steps records a judgement typed by a person: a
--   recommended credit limit, a customer grade, a Tally customer code. People
--   fat-finger those. Without a correction path the only options are "live with
--   a wrong number on the record" or "reject the whole request and re-raise it",
--   and teams reliably choose the first — so the record quietly becomes fiction.
--
-- THE RULE: A STEP MAY BE CORRECTED UNTIL THE NEXT STEP HAS ACTED ON IT.
--   Once the sales head has approved on the strength of an Accounts figure,
--   changing that figure would rewrite the basis of a decision that has already
--   been taken. So:
--     accounts    editable while acc_verified_at is set and sh_decided_at is not
--     sales head  editable while sh_decided_at is set and neither dir_decided_at
--                 nor tally_at is
--     director    editable while dir_decided_at is set and tally_at is not
--     tally        editable once tally_at is set — the ONE deliberate exception
--                  (see below)
--
--   Tally is the exception because nothing downstream consumes it inside this
--   module: it is the last step, and a mistyped customer code is exactly the
--   thing someone notices a week later. It stays correctable by its own step
--   owners and coordinators, and every correction is stamped and announced.
--
-- WHAT THESE RPCs DELIBERATELY CANNOT DO
--   • Change a DECISION. approve→reject is not an edit, it is a different
--     outcome with different consequences; that is reject/rework/reopen's job.
--   • Change the workflow `status` or `current_step`. Nothing here moves a
--     request.
--   • Re-route the Director. dir_required / dir_required_reason /
--     dir_threshold_at_decision are FROZEN when the sales head approves, so that
--     retuning the threshold — or correcting a limit afterwards — can never
--     rewrite why a past request did or did not need a Director. Note this is
--     not merely a convention: fms_customer_accounts_editable already refuses
--     once sh_decided_at exists, so the limit that drove the routing cannot be
--     edited behind the routing's back.
--
-- Purely ADDITIVE: four predicates, four update RPCs. No table, column,
-- constraint or policy changes.
--
-- Reversal:
--   drop function if exists public.fms_customer_update_tally(uuid, jsonb);
--   drop function if exists public.fms_customer_update_director(uuid, jsonb);
--   drop function if exists public.fms_customer_update_sales_head(uuid, jsonb);
--   drop function if exists public.fms_customer_update_accounts(uuid, jsonb);
--   drop function if exists public.fms_customer_tally_editable(uuid);
--   drop function if exists public.fms_customer_director_editable(uuid);
--   drop function if exists public.fms_customer_sales_head_editable(uuid);
--   drop function if exists public.fms_customer_accounts_editable(uuid);
-- ===========================================================================

-- ===========================================================================
-- PREDICATES
--
-- ⚠ MIRRORED CLIENT-SIDE as accountsLockReason / salesHeadLockReason /
--   directorLockReason / tallyLockReason in
--   frontend/src/apps/receivables-hub/lib/customerOnboarding/queues.ts.
--   Those return a human REASON so a greyed button can say why; these return a
--   bare boolean and are the gate. Keep the two sets in step.
-- ===========================================================================

create or replace function public.fms_customer_accounts_editable(p_req uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select r.acc_verified_at is not null
     and r.sh_decided_at   is null
     and r.status not in ('completed','rejected','cancelled')
  from public.fms_customer_requests r where r.id = p_req;
$$;
grant execute on function public.fms_customer_accounts_editable(uuid) to authenticated;

create or replace function public.fms_customer_sales_head_editable(p_req uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select r.sh_decided_at  is not null
     and r.dir_decided_at is null
     and r.tally_at       is null
     and r.status not in ('completed','rejected','cancelled')
  from public.fms_customer_requests r where r.id = p_req;
$$;
grant execute on function public.fms_customer_sales_head_editable(uuid) to authenticated;

create or replace function public.fms_customer_director_editable(p_req uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select r.dir_decided_at is not null
     and r.tally_at       is null
     and r.status not in ('completed','rejected','cancelled')
  from public.fms_customer_requests r where r.id = p_req;
$$;
grant execute on function public.fms_customer_director_editable(uuid) to authenticated;

-- The exception: correctable AFTER completion. See the header.
create or replace function public.fms_customer_tally_editable(p_req uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select r.tally_at is not null and r.status = 'completed'
  from public.fms_customer_requests r where r.id = p_req;
$$;
grant execute on function public.fms_customer_tally_editable(uuid) to authenticated;

-- ===========================================================================
-- RPC — correct the accounts verification.
--   p = { gst_verified, refs_verified, recommended_limit, recommended_days,
--         remarks, verified_date }
--
-- No `decision` key: this cannot forward, reject or send back. The original
-- verifier's identity (acc_verified_by) and the original timestamp
-- (acc_verified_at) are NOT overwritten — who did the work is history. The
-- corrector is recorded in edited_by and on the activity trail.
-- ===========================================================================
create or replace function public.fms_customer_update_accounts(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.fms_customer_requests%rowtype;
  v_uid uuid := auth.uid();
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not public.fms_customer_accounts_editable(p_req) then
    raise exception 'The accounts verification can no longer be corrected — the sales head has already decided';
  end if;
  if not public.fms_customer_can_act('accounts_verification', p_req, v_uid) then
    raise exception 'Not authorized to correct the accounts verification';
  end if;

  update public.fms_customer_requests set
    acc_gst_verified      = (p->>'gst_verified')::boolean,
    acc_refs_verified     = (p->>'refs_verified')::boolean,
    acc_recommended_limit = nullif(btrim(p->>'recommended_limit'), '')::numeric,
    acc_recommended_days  = nullif(btrim(p->>'recommended_days'), '')::integer,
    acc_remarks           = nullif(btrim(p->>'remarks'), ''),
    acc_verified_date     = coalesce(nullif(btrim(p->>'verified_date'), '')::date, acc_verified_date),
    edited_at             = now(),
    edited_by             = v_uid
  where id = p_req;

  perform public.fms_customer_announce('request', p_req, 'amended',
    'Accounts verification corrected for ' || coalesce(r.legal_name, '')
      || ' (' || coalesce(r.req_no, '') || ').',
    array[r.raised_by, r.acc_verified_by],
    jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name, 'stage', 'accounts'));
end $$;
grant execute on function public.fms_customer_update_accounts(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — correct the sales-head approval. p = { customer_category,
--   business_potential, remarks, decided_date }
--
-- ⚠ NOT EDITABLE HERE: sh_decision, sh_force_director, dir_required,
--   dir_required_reason, dir_threshold_at_decision. Those four decided WHERE
--   this request went; changing them after the fact would leave a request
--   sitting in a queue its own record says it should never have entered.
-- ===========================================================================
create or replace function public.fms_customer_update_sales_head(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.fms_customer_requests%rowtype;
  v_uid uuid := auth.uid();
  v_cat text := nullif(btrim(p->>'customer_category'), '');
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not public.fms_customer_sales_head_editable(p_req) then
    raise exception 'The sales-head approval can no longer be corrected — a later step has already acted on it';
  end if;
  if not public.fms_customer_can_act('sales_head_approval', p_req, v_uid) then
    raise exception 'Not authorized to correct the sales-head approval';
  end if;
  -- An approved request without a grade cannot be placed on the Category
  -- report, so a correction may not blank one that already exists.
  if r.sh_decision = 'approve' and v_cat is null then
    raise exception 'Choose a customer category (A-E) — an approved customer must carry a grade';
  end if;

  update public.fms_customer_requests set
    sh_customer_category  = v_cat,
    sh_business_potential = nullif(btrim(p->>'business_potential'), ''),
    sh_remarks            = nullif(btrim(p->>'remarks'), ''),
    sh_decided_date       = coalesce(nullif(btrim(p->>'decided_date'), '')::date, sh_decided_date),
    edited_at             = now(),
    edited_by             = v_uid
  where id = p_req;

  perform public.fms_customer_announce('request', p_req, 'amended',
    'Sales-head approval corrected for ' || coalesce(r.legal_name, '')
      || ' (' || coalesce(r.req_no, '') || ').',
    array[r.raised_by, r.sh_decided_by],
    jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name, 'stage', 'sales_head'));
end $$;
grant execute on function public.fms_customer_update_sales_head(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — correct the director's record. p = { remarks, decided_date }
-- The decision itself is not editable; see the header.
-- ===========================================================================
create or replace function public.fms_customer_update_director(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.fms_customer_requests%rowtype;
  v_uid uuid := auth.uid();
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not public.fms_customer_director_editable(p_req) then
    raise exception 'The director decision can no longer be corrected — the Tally ledger has been recorded';
  end if;
  if not public.fms_customer_can_act('director_approval', p_req, v_uid) then
    raise exception 'Not authorized to correct the director decision';
  end if;

  update public.fms_customer_requests set
    dir_remarks      = nullif(btrim(p->>'remarks'), ''),
    dir_decided_date = coalesce(nullif(btrim(p->>'decided_date'), '')::date, dir_decided_date),
    edited_at        = now(),
    edited_by        = v_uid
  where id = p_req;

  perform public.fms_customer_announce('request', p_req, 'amended',
    'Director''s remarks corrected for ' || coalesce(r.legal_name, '')
      || ' (' || coalesce(r.req_no, '') || ').',
    array[r.raised_by, r.dir_decided_by],
    jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name, 'stage', 'director'));
end $$;
grant execute on function public.fms_customer_update_director(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — correct the Tally record on a COMPLETED request.
--   p = { customer_code, tally_ledger_created, tally_ledger_name,
--         customer_status, tally_date }
--
-- Does NOT reopen the request and does NOT touch `status` — a completed
-- customer stays completed. The assigned sales executive is changed through
-- fms_customer_assign_sales_exec, which already works at any point and
-- notifies the new owner.
--
-- ⚠ STILL NOTHING DOWNSTREAM. Correcting a customer code here does not, and
--   must not, write to fms_dispatch_* or anywhere else — Order-to-Dispatch
--   sources its customers elsewhere (28-Jul-2026).
-- ===========================================================================
create or replace function public.fms_customer_update_tally(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.fms_customer_requests%rowtype;
  v_uid  uuid := auth.uid();
  v_code text := nullif(btrim(p->>'customer_code'), '');
  v_cs   text := nullif(btrim(p->>'customer_status'), '');
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not public.fms_customer_tally_editable(p_req) then
    raise exception 'There is no Tally record on this request to correct';
  end if;
  if not public.fms_customer_can_act('tally_creation', p_req, v_uid) then
    raise exception 'Not authorized to correct the Tally record';
  end if;
  if v_code is null then raise exception 'The customer code cannot be blanked'; end if;
  if v_cs is null or v_cs not in ('active','hold','rejected') then
    raise exception 'Choose a customer status (Active, Hold or Rejected)';
  end if;

  update public.fms_customer_requests set
    customer_code        = v_code,
    tally_ledger_created = coalesce((p->>'tally_ledger_created')::boolean, tally_ledger_created),
    tally_ledger_name    = nullif(btrim(p->>'tally_ledger_name'), ''),
    customer_status      = v_cs,
    tally_date           = coalesce(nullif(btrim(p->>'tally_date'), '')::date, tally_date),
    edited_at            = now(),
    edited_by            = v_uid
  where id = p_req;

  perform public.fms_customer_announce('request', p_req, 'amended',
    coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '')
      || ') was corrected — customer code ' || v_code || '.',
    array[r.raised_by, r.assigned_sales_exec_id, r.tally_by],
    jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name,
                       'customer_code', v_code, 'stage', 'tally'));
end $$;
grant execute on function public.fms_customer_update_tally(uuid, jsonb) to authenticated;
