-- ===========================================================================
-- NR-7 · The numbers the HR Head sets when approving a requisition
--
--   1. target_close_days   how long this position may take
--   2. cv_target           how many NEW CVs it should gather
--   3. shortlist_target    how many must reach the HOD          (default 3)
--   4. director_cv_target  how many must reach the directors    (default 3)
--
-- Decisions behind the shapes (client, 21-09-2026) are written into the column
-- comments so the next reader does not have to find WORKLIST.md.
--
-- ADDITIVE ONLY, and the module is LIVE. Nothing existing is altered, renamed,
-- dropped or rewritten. `fms_hr_decide_mrf` and `fms_hr_update_decide_mrf` gain
-- one OPTIONAL argument: the frontend deployed today calls them with four
-- arguments and keeps behaving exactly as it does now.
-- ===========================================================================

-- 1 ── the four numbers ------------------------------------------------------

alter table public.fms_hr_requisitions
  add column if not exists target_close_days  integer,
  add column if not exists cv_target          integer,
  add column if not exists shortlist_target   integer not null default 3,
  add column if not exists director_cv_target integer not null default 3,
  add column if not exists targets_set_at     timestamptz,
  add column if not exists targets_set_by     uuid;

comment on column public.fms_hr_requisitions.target_close_days is
  'NR-7. CALENDAR days allowed for this position, typed by the HR Head per position at approval (there is no per-role default). The clock STARTS at posted_on (the business date HR typed; posted_at when that is null) and STOPS when the first offer is accepted (candidates.finalized_at). The position itself still CLOSES when the seats are joined - a different fact, on a different date, deliberately not this clock.';
comment on column public.fms_hr_requisitions.cv_target is
  'NR-7. How many NEW CVs this position should gather, in TOTAL - never multiplied by positions_required. New means a person the hub has never seen (fms_hr_candidates.is_repeat = false). Disqualified CVs still count: the number measures sourcing effort.';
comment on column public.fms_hr_requisitions.shortlist_target is
  'NR-7 / KPI 1A.3. Minimum shortlisted profiles handed to the HOD. Client fixed the sheet''s "2-3" at 3 on 21-09-2026. Seeded on every requisition, overridable per position.';
comment on column public.fms_hr_requisitions.director_cv_target is
  'NR-7. Minimum candidates that must reach the director round (interview_3). Default 3 - the client''s "minimum benchmark for any position; more than 3 is always welcome". A shortfall is shown, never blocked.';
comment on column public.fms_hr_requisitions.targets_set_at is
  'NR-7. When the numbers above were last set. Null means nobody has set them - a real state, shown as "not set", never as a failure.';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'fms_hr_requisitions_targets_sane') then
    alter table public.fms_hr_requisitions
      add constraint fms_hr_requisitions_targets_sane check (
            (target_close_days is null or target_close_days between 1 and 365)
        and (cv_target         is null or cv_target         between 1 and 500)
        and shortlist_target   between 1 and 100
        and director_cv_target between 1 and 100
      );
  end if;
end
$do$;

-- 2 ── a CV is new, or it is a repeat ----------------------------------------
-- The verdict is decided when the CV is ADDED and stored here, never recomputed
-- later: a quarter of CV rows carry no email and no phone (FIX-5), so a
-- recomputation on another day would quietly disagree with what HR was shown.

alter table public.fms_hr_candidates
  add column if not exists is_repeat              boolean not null default false,
  add column if not exists repeat_of_candidate_id uuid,
  add column if not exists repeat_signal          text,
  add column if not exists duplicate_ack          text;

comment on column public.fms_hr_candidates.is_repeat is
  'NR-7. True when this person was already in the hub when the CV was added - on ANY requisition, matched on the CV file hash, the email or the phone. Repeats do not count toward the requisition''s cv_target. Decided at insert time and never recomputed.';
comment on column public.fms_hr_candidates.duplicate_ack is
  'NR-7. The reason typed when somebody added a CV despite a duplicate warning. fms_hr_add_candidates has always DEMANDED this and announced it; until now it was never kept on the row.';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'fms_hr_candidates_repeat_of_fkey') then
    alter table public.fms_hr_candidates
      add constraint fms_hr_candidates_repeat_of_fkey
      foreign key (repeat_of_candidate_id) references public.fms_hr_candidates(id) on delete set null;
  end if;
end
$do$;

-- 3 ── "have we seen this person before?" ------------------------------------
-- The existing fms_hr_candidate_duplicate() is untouched: it answers a narrower
-- question (already on THIS vacancy?) and is what blocks a save. This one looks
-- across the whole board and only labels.

create or replace function public.fms_hr_candidate_seen_before(
  p_email text, p_phone text, p_sha text, p_exclude uuid default null)
returns table (id uuid, candidate_no text, name text, requisition_id uuid, signal text)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select c.id, c.candidate_no, c.name, c.requisition_id,
         case
           when p_sha is not null and c.resume_sha256 = p_sha then 'the identical CV file'
           when public.fms_hr_norm_email(p_email) is not null
                and public.fms_hr_norm_email(c.email) = public.fms_hr_norm_email(p_email)
             then 'the same email address'
           else 'the same phone number'
         end
    from public.fms_hr_candidates c
   where (p_exclude is null or c.id <> p_exclude)
     and (
          (p_sha is not null and c.resume_sha256 is not null and c.resume_sha256 = p_sha)
       or (public.fms_hr_norm_email(p_email) is not null
           and public.fms_hr_norm_email(c.email) = public.fms_hr_norm_email(p_email))
       or (public.fms_hr_norm_phone(p_phone) is not null
           and public.fms_hr_norm_phone(c.phone) = public.fms_hr_norm_phone(p_phone))
     )
   order by c.uploaded_at
   limit 1;
$fn$;

revoke all on function public.fms_hr_candidate_seen_before(text, text, text, uuid) from public;
grant execute on function public.fms_hr_candidate_seen_before(text, text, text, uuid) to service_role;

-- 4 ── label the CVs already on the board ------------------------------------
-- 4 of the 179 rows carry an earlier twin (all of them on the same vacancy -
-- the FIX-5 double entries). No row is moved, deleted or re-staged.

with seen as (
  select c.id, m.id as match_id, m.signal
    from public.fms_hr_candidates c
    cross join lateral (
      select b.id,
             case
               when nullif(trim(c.resume_sha256),'') is not null and b.resume_sha256 = c.resume_sha256
                 then 'the identical CV file'
               when public.fms_hr_norm_email(c.email) is not null
                    and public.fms_hr_norm_email(b.email) = public.fms_hr_norm_email(c.email)
                 then 'the same email address'
               else 'the same phone number'
             end as signal
        from public.fms_hr_candidates b
       where b.uploaded_at < c.uploaded_at
         and (
              (nullif(trim(c.resume_sha256),'') is not null and b.resume_sha256 = c.resume_sha256)
           or (public.fms_hr_norm_email(c.email) is not null
               and public.fms_hr_norm_email(b.email) = public.fms_hr_norm_email(c.email))
           or (public.fms_hr_norm_phone(c.phone) is not null
               and public.fms_hr_norm_phone(b.phone) = public.fms_hr_norm_phone(c.phone))
         )
       order by b.uploaded_at
       limit 1
    ) m
)
update public.fms_hr_candidates c
   set is_repeat = true,
       repeat_of_candidate_id = seen.match_id,
       repeat_signal = seen.signal
  from seen
 where c.id = seen.id
   and c.is_repeat = false;

-- 5 ── one place that validates and stores the numbers -----------------------

create or replace function public.fms_hr_apply_targets(p_req uuid, p_targets jsonb, p_uid uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_days  integer := nullif(trim(p_targets->>'target_close_days'), '')::integer;
  v_cv    integer := nullif(trim(p_targets->>'cv_target'), '')::integer;
  v_short integer := nullif(trim(p_targets->>'shortlist_target'), '')::integer;
  v_dir   integer := nullif(trim(p_targets->>'director_cv_target'), '')::integer;
begin
  -- No payload at all = an older client. It behaves exactly as it always did.
  if p_targets is null or p_targets = 'null'::jsonb then return; end if;

  if v_days is not null and (v_days < 1 or v_days > 365) then
    raise exception 'The closure period must be between 1 and 365 days (got %)', v_days;
  end if;
  if v_cv is not null and (v_cv < 1 or v_cv > 500) then
    raise exception 'The CV target must be between 1 and 500 (got %)', v_cv;
  end if;
  if v_short is not null and (v_short < 1 or v_short > 100) then
    raise exception 'The shortlist target must be between 1 and 100 (got %)', v_short;
  end if;
  if v_dir is not null and (v_dir < 1 or v_dir > 100) then
    raise exception 'The director target must be between 1 and 100 (got %)', v_dir;
  end if;

  -- Only what was sent is written; an absent key leaves the stored value alone.
  update public.fms_hr_requisitions set
    target_close_days  = coalesce(v_days,  target_close_days),
    cv_target          = coalesce(v_cv,    cv_target),
    shortlist_target   = coalesce(v_short, shortlist_target),
    director_cv_target = coalesce(v_dir,   director_cv_target),
    targets_set_at     = now(),
    targets_set_by     = p_uid
  where id = p_req;
end
$fn$;

revoke all on function public.fms_hr_apply_targets(uuid, jsonb, uuid) from public;
grant execute on function public.fms_hr_apply_targets(uuid, jsonb, uuid) to service_role;

-- 6 ── setting the numbers on a position that is ALREADY approved ------------
-- The client asked for the 24 open positions to be brought under the rules, so
-- the numbers cannot live only inside the approval dialog.

create or replace function public.fms_hr_set_requisition_targets(p_req uuid, p_targets jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_status text;
begin
  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;

  if not (public.is_admin(v_uid) or public.fms_hr_can_act('hr_head_approval', p_req, v_uid)) then
    raise exception 'Only the HR Head can set the targets on this requisition';
  end if;

  if v_status in ('rejected', 'cancelled') then
    raise exception 'This requisition is % - its targets can no longer be set', v_status;
  end if;
  if p_targets is null then
    raise exception 'No targets supplied';
  end if;

  perform public.fms_hr_apply_targets(p_req, p_targets, v_uid);
end
$fn$;

grant execute on function public.fms_hr_set_requisition_targets(uuid, jsonb) to authenticated;

-- 7 ── the two approval RPCs learn the numbers -------------------------------
-- DROP + CREATE rather than CREATE OR REPLACE: a new argument makes a second
-- overload, and PostgREST cannot choose between two candidates. Both bodies are
-- copied from pg_proc.prosrc as they run TODAY - the live database is the
-- source, never the newest migration file - with one block added.

drop function if exists public.fms_hr_decide_mrf(uuid, text, text, text);

create or replace function public.fms_hr_decide_mrf(
  p_req uuid, p_stage text, p_decision text, p_remarks text default ''::text,
  p_targets jsonb default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_step   text;
begin
  if p_stage not in ('hr','mgmt') then raise exception 'Unknown approval stage %', p_stage; end if;
  if p_decision not in ('approve','reject','send_back') then
    raise exception 'Unknown decision %', p_decision;
  end if;

  v_step := case when p_stage = 'hr' then 'hr_head_approval' else 'mgmt_approval' end;

  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;

  -- Each stage may only act when the requisition is actually sitting at it.
  if p_stage = 'hr'   and v_status <> 'hr_review'   then
    raise exception 'This requisition is not awaiting HR Head approval (status %)', v_status;
  end if;
  if p_stage = 'mgmt' and v_status <> 'mgmt_review' then
    raise exception 'This requisition is not awaiting Management approval (status %)', v_status;
  end if;

  if not public.fms_hr_can_act(v_step, p_req, v_uid) then
    raise exception 'Not authorized to decide this requisition';
  end if;
  if p_decision in ('reject','send_back') and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when rejecting or sending back';
  end if;

  if p_decision = 'approve' then
    if p_stage = 'hr' then
      update public.fms_hr_requisitions set
        hr_approved_at = now(), hr_approver_id = v_uid, hr_remarks = nullif(trim(p_remarks),''),
        status = 'mgmt_review', current_step = 'mgmt_approval'
      where id = p_req;

      -- NR-7: the HR Head's own numbers, set in the same breath as the approval.
      perform public.fms_hr_apply_targets(p_req, p_targets, v_uid);
    else
      update public.fms_hr_requisitions set
        mgmt_approved_at = now(), mgmt_approver_id = v_uid, mgmt_remarks = nullif(trim(p_remarks),''),
        status = 'posting', current_step = 'job_posting'
      where id = p_req;
    end if;

  elsif p_decision = 'reject' then
    update public.fms_hr_requisitions set
      status = 'rejected', rejected_at = now(), reject_reason = trim(p_remarks), decided_by = v_uid
    where id = p_req;

  else -- send_back
    update public.fms_hr_requisitions set
      status = 'sent_back', sent_back_at = now(), sent_back_reason = trim(p_remarks), decided_by = v_uid
    where id = p_req;
  end if;
end
$fn$;

grant execute on function public.fms_hr_decide_mrf(uuid, text, text, text, jsonb) to anon, authenticated, service_role;

drop function if exists public.fms_hr_update_decide_mrf(uuid, text, text, text);

create or replace function public.fms_hr_update_decide_mrf(
  p_req uuid, p_stage text, p_decision text, p_remarks text default ''::text,
  p_targets jsonb default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_step   text;
begin
  if p_stage not in ('hr','mgmt') then raise exception 'Unknown approval stage %', p_stage; end if;
  if p_decision not in ('approve','reject','send_back') then
    raise exception 'Unknown decision %', p_decision;
  end if;

  v_step := case when p_stage = 'hr' then 'hr_head_approval' else 'mgmt_approval' end;

  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;

  -- The edit window: the stage is DONE (approved) and the NEXT step has not acted.
  if p_stage = 'hr' and v_status <> 'mgmt_review' then
    raise exception 'The HR Head approval can no longer be edited (the requisition is %)', v_status;
  end if;
  if p_stage = 'mgmt' and v_status <> 'posting' then
    raise exception 'The Management approval can no longer be edited (the requisition is %)', v_status;
  end if;

  if not public.fms_hr_can_act(v_step, p_req, v_uid) then
    raise exception 'Not authorized to edit this approval';
  end if;
  if p_decision in ('reject','send_back') and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when rejecting or sending back';
  end if;

  if p_decision = 'approve' then
    -- Keep the approval: original approver + approved_at untouched, only the remark.
    if p_stage = 'hr' then
      update public.fms_hr_requisitions set
        hr_remarks = nullif(trim(p_remarks),''), edited_at = now(), edited_by = v_uid
      where id = p_req;

      -- NR-7: a corrected approval may correct its numbers too.
      perform public.fms_hr_apply_targets(p_req, p_targets, v_uid);
    else
      update public.fms_hr_requisitions set
        mgmt_remarks = nullif(trim(p_remarks),''), edited_at = now(), edited_by = v_uid
      where id = p_req;
    end if;

  elsif p_decision = 'reject' then
    -- Flip to a rejection — terminal, taken by whoever flips it. The stage's own
    -- approval stamp is cleared (it is no longer approved).
    update public.fms_hr_requisitions set
      status = 'rejected', rejected_at = now(), reject_reason = trim(p_remarks), decided_by = v_uid,
      hr_approved_at   = case when p_stage = 'hr'   then null else hr_approved_at end,
      mgmt_approved_at = case when p_stage = 'mgmt' then null else mgmt_approved_at end,
      current_step = v_step, edited_at = now(), edited_by = v_uid
    where id = p_req;

  else -- send_back
    update public.fms_hr_requisitions set
      status = 'sent_back', sent_back_at = now(), sent_back_reason = trim(p_remarks), decided_by = v_uid,
      hr_approved_at   = case when p_stage = 'hr'   then null else hr_approved_at end,
      mgmt_approved_at = case when p_stage = 'mgmt' then null else mgmt_approved_at end,
      current_step = 'mrf_resubmit', edited_at = now(), edited_by = v_uid
    where id = p_req;
  end if;
end
$fn$;

grant execute on function public.fms_hr_update_decide_mrf(uuid, text, text, text, jsonb) to anon, authenticated, service_role;

-- 8 ── adding a CV now records whether the person is new ---------------------
-- Body copied from pg_proc.prosrc as it runs today. Two things are added: the
-- cross-board lookup, and four more columns on the insert. Every existing
-- guard, message and announcement is untouched.

create or replace function public.fms_hr_add_candidates(p_req uuid, p_candidates jsonb)
returns setof uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_fy     text := public.fms_hr_fy_code(current_date);
  c        jsonb;
  v_id     uuid;
  v_no     text;
  v_ack    text;
  v_sha    text;
  v_dup    record;
  v_seen   record;
begin
  select status into v_status from public.fms_hr_requisitions where id = p_req;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status <> 'sourcing' then
    raise exception 'CVs can only be added once the job is posted (status %)', v_status;
  end if;
  if not public.fms_hr_can_act('resume_upload', p_req, v_uid) then
    raise exception 'Not authorized to add candidates to this requisition';
  end if;
  if p_candidates is null or jsonb_array_length(p_candidates) = 0 then
    raise exception 'No candidates supplied';
  end if;

  for c in select * from jsonb_array_elements(p_candidates) loop
    if coalesce(trim(c->>'name'), '') = '' then
      raise exception 'Every candidate needs a name';
    end if;

    v_sha := nullif(trim(c->>'resume_sha256'), '');
    v_ack := nullif(trim(c->>'duplicate_ack'), '');

    select * into v_dup
      from public.fms_hr_candidate_duplicate(
             p_req, nullif(trim(c->>'email'), ''), nullif(trim(c->>'phone'), ''), v_sha);

    if v_dup.id is not null and v_ack is null then
      raise exception '% is already on this vacancy as % — % — matched on %. Tick "Add anyway" if this is deliberate.',
        trim(c->>'name'), v_dup.candidate_no, public.fms_hr_stage_label(v_dup.stage), v_dup.signal;
    end if;

    -- NR-7: new or repeat, decided here and kept. It only LABELS - a repeat is
    -- never refused, it simply does not count toward the requisition's CV target.
    select * into v_seen
      from public.fms_hr_candidate_seen_before(
             nullif(trim(c->>'email'), ''), nullif(trim(c->>'phone'), ''), v_sha);

    v_no := 'CAN-' || v_fy || '-' || lpad(public.fms_hr_next_seq('CAN-' || v_fy)::text, 4, '0');

    insert into public.fms_hr_candidates (
      requisition_id, candidate_no, name, phone, email, current_company, experience_years,
      skills, notes, source_platform_id, resume_path, resume_name, resume_sha256,
      parse_status, parsed_json, stage, uploaded_at, created_by,
      is_repeat, repeat_of_candidate_id, repeat_signal, duplicate_ack
    ) values (
      p_req, v_no,
      trim(c->>'name'),
      nullif(trim(c->>'phone'), ''),
      nullif(trim(c->>'email'), ''),
      nullif(trim(c->>'current_company'), ''),
      nullif(c->>'experience_years','')::numeric,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(c->'skills','[]'::jsonb)) x), '{}'::text[]),
      nullif(trim(c->>'notes'), ''),
      nullif(c->>'source_platform_id','')::uuid,
      nullif(c->>'resume_path',''),
      nullif(c->>'resume_name',''),
      v_sha,
      coalesce(nullif(c->>'parse_status',''), 'manual'),
      coalesce(c->'parsed_json', '{}'::jsonb),
      'resume_uploaded', now(), v_uid,
      v_seen.id is not null, v_seen.id, v_seen.signal, v_ack
    )
    returning id into v_id;

    if v_dup.id is not null then
      perform public.fms_hr_announce(
        'requisition', p_req, 'duplicate_override',
        format('%s (%s) was added although %s is already on this vacancy — matched on %s. Reason: %s',
               trim(c->>'name'), v_no, v_dup.candidate_no, v_dup.signal, v_ack),
        '{}'::uuid[],
        jsonb_build_object('candidate_id', v_id, 'matched_candidate_id', v_dup.id,
                           'matched_candidate_no', v_dup.candidate_no,
                           'signal', v_dup.signal, 'reason', v_ack));
    end if;

    return next v_id;
  end loop;
end
$fn$;
