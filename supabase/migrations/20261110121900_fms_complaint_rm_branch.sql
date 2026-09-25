-- ===========================================================================
-- Complaint (RM/FG) FMS — THE RAW-MATERIAL BRANCH (Phase 13).
--
-- Until now RM and FG ran the SAME chain (plant → service → [approval] →
-- management review). That was right for a customer complaining to us about a
-- finished good; it is wrong for US complaining to a supplier about raw
-- material, where the plant and the service team have nothing to do and the
-- desk that owns the problem is Purchase (a domestic supplier) or Management
-- (an imported one).
--
-- Confirmed with the user 18-09-2026. The raise panel gains ONE field —
-- `rm_origin`, Domestic / Import, asked immediately before the RM Lot No. — and
-- that field is the ONLY thing that chooses the branch:
--
--   RAW MATERIAL · DOMESTIC
--     raise → PURCHASE           remarks, submit
--           → MANAGEMENT REVIEW  review + close
--
--   RAW MATERIAL · IMPORT
--     raise → RM-COMPLAINT VIEW (MGT)  either  remarks → CLOSE
--                                      or      REASSIGN to a named person
--           → ASSIGNEE                 that person's remarks, submit
--           → MANAGEMENT REVIEW        review + close
--
--   FINISHED GOOD — UNCHANGED. plant → service → [approval] → review → closed.
--
-- ⚠ MANAGEMENT GETS ITS OWN STEP KEY, `rm_management` ("RM-Complaint View
--   (MGT)"), and NOT a second status on `management_review`. It was built the
--   other way first - one key, two passes, the way `service` models its two -
--   and the user asked for them split. They are right: the two are not the same
--   job. `rm_management` is WORK (read an imported-material complaint, answer it
--   or hand it on); `management_review` is a SIGN-OFF (one click on something
--   already settled). Sharing a key meant one queue mixing "decide this" with
--   "acknowledge that", one Setup row that could not staff them separately, and
--   one SLA for two very different clocks.
--
-- ⚠ THEY STILL SHARE THE mgmt_* COLUMNS. Closing at `rm_management` and signing
--   off at `management_review` are the same act recorded by the same fields, and
--   a complaint can only ever do one of them. A second column set would be four
--   dead columns on every row.
--
-- ⚠ `assignee` IS THE ONE STEP IN THIS MODULE THAT ROUTES TO A PERSON, NOT A
--   BUCKET, and that is the whole point of the reassign right: management picks
--   somebody, and it lands in THAT person's queue. So fms_complaint_can_act
--   grows its first per-request arm since the seven-step chain was retired, and
--   fms_complaint_can_see_request grows `rm_assignee_id` alongside the four
--   retired assignee columns it already carries. RE-ASSIGNMENT IS OFFERED ONLY
--   AT `rm_management`: the final review closes, and a reassign there would be
--   a loop with no terminus.
--
-- ⚠ ADDITIVE ONLY, as everywhere in this schema. No column is dropped, no
--   status is removed from a CHECK, and the FG arms of every RPC are untouched.
--
-- Reversal: re-apply 20261110121500 (which restores submit / can_act /
--   step_editable to their FG-only shape), then
--     drop function if exists public.fms_complaint_record_purchase(uuid,jsonb),
--                             public.fms_complaint_record_rm_management(uuid,jsonb),
--                             public.fms_complaint_record_assignee(uuid,jsonb);
--     alter table public.fms_complaint_requests
--       drop column if exists rm_origin, ... (the columns added below);
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- STATUSES — three new ones, alongside every live and retired one.
-- ---------------------------------------------------------------------------
alter table public.fms_complaint_requests drop constraint if exists fms_complaint_requests_status_check;
alter table public.fms_complaint_requests add constraint fms_complaint_requests_status_check
  check (status in (
    -- the FG chain
    'awaiting_plant', 'awaiting_service', 'awaiting_approval',
    'awaiting_service_close',
    -- the RM branch (phase 13)
    'awaiting_purchase', 'awaiting_rm_management', 'awaiting_assignee',
    -- shared terminus
    'awaiting_management_review',
    'closed', 'on_hold', 'cancelled',
    -- RETIRED with the seven-step chain (phase 12). Nothing produces these.
    'awaiting_acknowledge', 'awaiting_investigation', 'awaiting_capa',
    'awaiting_resolution', 'awaiting_confirmation', 'awaiting_close', 'rejected'));


-- ---------------------------------------------------------------------------
-- COLUMNS.
-- ---------------------------------------------------------------------------
alter table public.fms_complaint_requests
  -- THE BRANCH SWITCH. NULL on every finished-good complaint, and on the RM
  -- rows raised before this migration — which is why it is nullable rather than
  -- defaulted: a default would silently claim those old rows were domestic.
  add column if not exists rm_origin text,
  -- PURCHASE (RM domestic)
  add column if not exists pur_remarks text,
  add column if not exists pur_date    date,
  add column if not exists pur_at      timestamptz,
  add column if not exists pur_by      uuid references auth.users on delete set null,
  -- MANAGEMENT'S REASSIGNMENT (RM import, first pass)
  add column if not exists rm_assignee_id   uuid references auth.users on delete set null,
  -- FROZEN AT ASSIGN TIME, like item_name and party_name: the queue, the recap
  -- and the export all want the name management chose, not whatever the
  -- directory says today.
  add column if not exists rm_assignee_name text,
  add column if not exists rm_assign_note   text,
  add column if not exists rm_assigned_at   timestamptz,
  add column if not exists rm_assigned_by   uuid references auth.users on delete set null,
  -- THE ASSIGNEE'S OWN ENTRY
  add column if not exists asg_remarks text,
  add column if not exists asg_date    date,
  add column if not exists asg_at      timestamptz,
  add column if not exists asg_by      uuid references auth.users on delete set null;

alter table public.fms_complaint_requests drop constraint if exists fms_complaint_rm_origin_check;
alter table public.fms_complaint_requests add constraint fms_complaint_rm_origin_check
  check (rm_origin is null or rm_origin in ('domestic', 'import'));

comment on column public.fms_complaint_requests.rm_origin is
  'Raw material only: domestic -> the complaint opens in the Purchase bucket; import -> it opens in the Management bucket. NULL on every finished-good complaint and on RM rows raised before phase 13.';
comment on column public.fms_complaint_requests.rm_assignee_id is
  'Whom management reassigned an imported-material complaint to. THE ONE PER-REQUEST ACTOR IN THE LIVE CHAIN - fms_complaint_can_act reads it for step assignee, and fms_complaint_can_see_request for the read rule.';

create index if not exists fms_complaint_requests_rm_assignee_idx
  on public.fms_complaint_requests (rm_assignee_id) where rm_assignee_id is not null;


-- ---------------------------------------------------------------------------
-- THE READ RULE — the assignee must be able to open what they were handed.
--
-- ⚠ THIS RULE EXISTS TWICE — the function AND the inlined copy in the SELECT
--   policy (see 20261110120400). They move together or not at all.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_can_see_request(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.fms_complaint_requests r
    where r.id = p_req
      and (
        public.is_admin(p_uid)
        or public.fms_complaint_is_coordinator(p_uid)
        or r.raised_by = p_uid
        -- the live per-request actor (phase 13)
        or r.rm_assignee_id = p_uid
        -- the four retired ones; six test rows may still carry them
        or r.ack_assignee_id = p_uid
        or r.inv_capa_owner_id = p_uid
        or r.capa_resolver_id = p_uid
        or r.res_confirmer_id = p_uid
        or public.module_is_viewer(p_uid, 'complaint')
        or exists (
          select 1 from public.fms_complaint_step_owners o
          where p_uid = any(o.employee_ids)
        )
      )
  );
$fn$;

drop policy if exists fms_complaint_requests_select on public.fms_complaint_requests;
create policy fms_complaint_requests_select on public.fms_complaint_requests
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and (
      (select public.is_admin((select auth.uid())))
      or (select public.fms_complaint_is_coordinator((select auth.uid())))
      or raised_by = (select auth.uid())
      or rm_assignee_id = (select auth.uid())
      or ack_assignee_id = (select auth.uid())
      or inv_capa_owner_id = (select auth.uid())
      or capa_resolver_id = (select auth.uid())
      or res_confirmer_id = (select auth.uid())
      or (select public.module_is_viewer((select auth.uid()), 'complaint'))
      or exists (
        select 1 from public.fms_complaint_step_owners o
        where (select auth.uid()) = any(o.employee_ids)
      )
    )
  );


-- ---------------------------------------------------------------------------
-- THE ACT GATE — bucket owners, plus the one named assignee.
--
-- ⚠ MIRRORED ARM FOR ARM in the app's store.tsx `canActOn`. Keep them in step.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_can_act(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.module_can_edit(p_uid, 'complaint')
     and exists (
       select 1 from public.fms_complaint_requests r
       where r.id = p_req
         and (
           public.is_admin(p_uid)
           or public.fms_complaint_is_coordinator(p_uid)
           or public.fms_complaint_is_step_owner(p_step_key, p_uid)
           -- THE PER-REQUEST ARM. `assignee` has no Setup owners by design:
           -- management names the person when they reassign, so the step is
           -- owned by whoever is on the row and nobody else.
           or (p_step_key = 'assignee' and r.rm_assignee_id = p_uid)
         )
     );
$fn$;

comment on function public.fms_complaint_can_act(text, uuid, uuid) is
  'May this user act on this step of this complaint? Bucket owners (plus admins and coordinators) for every step, and additionally the named assignee for step assignee.';


-- ---------------------------------------------------------------------------
-- SUBMIT — the fork.
--
-- ⚠ `rm_origin` IS REQUIRED ON A RAW-MATERIAL COMPLAINT and ignored on a
--   finished-good one. Defaulting it would route an unanswered complaint into
--   the Purchase bucket, which is the one outcome nobody could spot afterwards:
--   the row would look deliberate.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_submit_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id     uuid;
  v_fy     text := public.fms_complaint_fy_code(current_date);
  v_seq    integer;
  v_no     text;
  v_type   text := coalesce(nullif(trim(p->>'complaint_type'), ''), 'finished_good');
  v_origin text := nullif(trim(p->>'rm_origin'), '');
  v_status text;
  v_step   text;
begin
  if not public.fms_complaint_can_raise(auth.uid()) then
    raise exception 'Not authorized to raise a complaint';
  end if;
  if v_type not in ('finished_good', 'raw_material') then
    raise exception 'Unknown complaint type: %', v_type;
  end if;

  if v_type = 'raw_material' then
    if v_origin is null then
      raise exception 'Choose the type - Domestic or Import. It decides who handles the complaint.';
    end if;
    if v_origin not in ('domestic', 'import') then
      raise exception 'Unknown raw-material type: %', v_origin;
    end if;
    -- Domestic -> Purchase. Import -> Management.
    if v_origin = 'domestic' then
      v_status := 'awaiting_purchase';       v_step := 'purchase';
    else
      v_status := 'awaiting_rm_management';  v_step := 'rm_management';
    end if;
  else
    -- Finished goods are unchanged: they still start at the plant.
    v_origin := null;
    v_status := 'awaiting_plant';  v_step := 'plant';
  end if;

  v_seq := public.fms_complaint_next_seq('complaint:' || v_fy);
  v_no  := 'CMP-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_complaint_requests (
    complaint_no, complaint_type, rm_origin, status, current_step,
    raised_by, requester_name, company_id,
    lot_no, lot_expiry_date, lot_source, category, ink_type,
    item_id, item_name, party_id, party_name,
    invoice_no, invoice_date, qty_affected, unit_name, nature_id,
    issue_identified_at, problem_details, other_remarks, submitted_at
  ) values (
    v_no, v_type, v_origin, v_status, v_step,
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
    -- Whichever bucket the fork above chose.
    public.fms_complaint_step_owner_ids(v_step),
    jsonb_build_object('complaint_no', v_no, 'complaint_type', v_type,
                       'rm_origin', v_origin,
                       'lot_no', nullif(trim(p->>'lot_no'), ''))
  );
  return v_id;
end $fn$;


-- ---------------------------------------------------------------------------
-- PURCHASE — RM domestic. Remarks, and on to management.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_record_purchase(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_status text; v_no text;
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_purchase' then
    raise exception 'Complaint % is %, not with the purchase department', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('purchase', p_req, auth.uid()) then
    raise exception 'Not authorized to act for the purchase department on this complaint';
  end if;
  if nullif(trim(p->>'remarks'), '') is null then
    raise exception 'The purchase remarks are required';
  end if;

  update public.fms_complaint_requests set
    pur_remarks  = nullif(trim(p->>'remarks'), ''),
    pur_date     = coalesce(nullif(p->>'date', '')::date, current_date),
    pur_at       = now(),
    pur_by       = auth.uid(),
    status       = 'awaiting_management_review',
    current_step = 'management_review'
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'purchase_done',
    format('%s - the purchase department has responded; it is ready for management review', v_no),
    public.fms_complaint_step_owner_ids('management_review'),
    jsonb_build_object('complaint_no', v_no));
end $fn$;
grant execute on function public.fms_complaint_record_purchase(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- RM-COMPLAINT VIEW (MGT) — RM import. Close it, or hand it to somebody.
--
-- ⚠ TWO ACTIONS, ONE RPC, because they are one decision taken at one desk in
--   one sitting: "I'll deal with this" or "you deal with this". Splitting them
--   would mean two authorization checks and two status guards saying the same
--   thing, and a caller free to run the second on a row the first already moved.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_record_rm_management(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status   text;
  v_no       text;
  v_action   text := nullif(trim(p->>'action'), '');
  v_assignee uuid := nullif(p->>'assignee_id', '')::uuid;
  v_name     text;
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_rm_management' then
    raise exception 'Complaint % is %, not with management for the first time', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('rm_management', p_req, auth.uid()) then
    raise exception 'Not authorized to act for management on this complaint';
  end if;
  if v_action is null or v_action not in ('close', 'assign') then
    raise exception 'Management must either close this complaint or assign it to someone';
  end if;

  if v_action = 'assign' then
    if v_assignee is null then
      raise exception 'Name the person this complaint is being assigned to';
    end if;
    -- ⚠ THE NAME IS RESOLVED AND FROZEN HERE, and a person who is not in
    --   profiles is refused outright: `assignee` is the one step authorized off
    --   a column on the row, so an id nobody can be looked up by would create a
    --   queue entry with no owner.
    select name into v_name from public.profiles where id = v_assignee;
    if v_name is null then
      raise exception 'That person is not in the directory, so the complaint cannot be assigned to them';
    end if;

    update public.fms_complaint_requests set
      rm_assignee_id   = v_assignee,
      rm_assignee_name = v_name,
      rm_assign_note   = nullif(trim(p->>'note'), ''),
      rm_assigned_at   = now(),
      rm_assigned_by   = auth.uid(),
      status           = 'awaiting_assignee',
      current_step     = 'assignee'
    where id = p_req;

    perform public.fms_complaint_announce(
      'request', p_req, 'rm_assigned',
      format('%s was assigned to %s by management', v_no, v_name),
      -- The one person it was handed to. Management already know they sent it.
      array[v_assignee],
      jsonb_build_object('complaint_no', v_no, 'assignee_id', v_assignee));
    return;
  end if;

  -- close: management deal with it themselves, and the complaint ends here.
  if nullif(trim(p->>'note'), '') is null then
    raise exception 'Management remarks are required to close this complaint';
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
    'request', p_req, 'closed_by_management',
    format('%s was closed by management', v_no),
    '{}'::uuid[],   -- nobody is owed anything by a closed complaint
    jsonb_build_object('complaint_no', v_no));
end $fn$;
grant execute on function public.fms_complaint_record_rm_management(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- THE ASSIGNEE — remarks, and back to management to be reviewed and closed.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_record_assignee(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_status text; v_no text;
begin
  select status, complaint_no into v_status, v_no
    from public.fms_complaint_requests where id = p_req for update;
  if v_status is null then raise exception 'Complaint % not found', p_req; end if;
  if v_status <> 'awaiting_assignee' then
    raise exception 'Complaint % is %, not with its assignee', v_no, v_status;
  end if;
  if not public.fms_complaint_can_act('assignee', p_req, auth.uid()) then
    raise exception 'This complaint was assigned to someone else';
  end if;
  if nullif(trim(p->>'remarks'), '') is null then
    raise exception 'Your remarks are required';
  end if;

  update public.fms_complaint_requests set
    asg_remarks  = nullif(trim(p->>'remarks'), ''),
    asg_date     = coalesce(nullif(p->>'date', '')::date, current_date),
    asg_at       = now(),
    asg_by       = auth.uid(),
    status       = 'awaiting_management_review',
    current_step = 'management_review'
  where id = p_req;

  perform public.fms_complaint_announce(
    'request', p_req, 'assignee_done',
    format('%s - the assignee has responded; it is ready for management review', v_no),
    public.fms_complaint_step_owner_ids('management_review'),
    jsonb_build_object('complaint_no', v_no));
end $fn$;
grant execute on function public.fms_complaint_record_assignee(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- EDIT WINDOWS — the two new steps stay correctable until management reviews.
--
-- `management_review` stays last-and-unlockable; `rm_management` is never
-- correctable at all (see its arm below).
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_step_editable(p_step_key text, p_req uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.fms_complaint_requests r
    where r.id = p_req
      and r.status <> 'cancelled'
      and public.fms_complaint_effective_status(p_req) = case p_step_key
            when 'plant'    then 'awaiting_service'
            when 'service'  then case
                                   when public.fms_complaint_effective_status(p_req) = 'awaiting_approval'
                                     then 'awaiting_approval'
                                   else 'awaiting_management_review'
                                 end
            when 'approval' then 'awaiting_service_close'
            when 'purchase' then 'awaiting_management_review'
            when 'assignee' then 'awaiting_management_review'
            -- Never correctable: closing ends the complaint, and assigning
            -- has already put the row on somebody else's desk.
            when 'rm_management' then '~never~'
            -- The review is last; nothing downstream can lock it.
            when 'management_review' then public.fms_complaint_effective_status(p_req)
            else '~never~'
          end
  );
$fn$;


do $mig$
begin
  if (select count(*) from information_schema.columns
       where table_name = 'fms_complaint_requests'
         and column_name in ('rm_origin','pur_at','rm_assignee_id','rm_assigned_at','asg_at')) <> 5 then
    raise exception 'Complaint: the RM branch columns did not all install';
  end if;
end $mig$;

commit;
