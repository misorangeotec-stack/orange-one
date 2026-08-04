-- ===========================================================================
-- HR Recruitment — an "Others" option on the job-posting platform list.
--
-- HR posts on things the master list does not know about, and the master list
-- only grows through request → approval (fms_hr_master_requests). That is the
-- right governance for a reusable platform, and the wrong tool for "we also put
-- it on a WhatsApp group once". So: ONE flagged master row, "Others", plus a
-- free-text note recorded against THAT posting only.
--
-- The note deliberately does NOT become a platform master. "Which platform
-- actually works" reads the CANDIDATE's source_platform_id, and crediting hires
-- to an ad-hoc string would make that report worse, not better — an Others
-- posting shows up as Others, which is the truth.
--
-- Purely ADDITIVE:
--   fms_hr_job_platforms.is_other          — new boolean column, default false
--   fms_hr_requisition_platforms.other_note— new nullable text column
--   one seeded 'Others' master row
--   fms_hr_post_job / fms_hr_update_post_job gain a 4th, defaulted parameter
--
-- Reversal:
--   drop function if exists public.fms_hr_post_job(uuid, uuid[], date, text);
--   drop function if exists public.fms_hr_update_post_job(uuid, uuid[], date, text);
--   -- then re-create the 3-arg versions from 20260712130000 / 20260721120000
--   alter table public.fms_hr_requisition_platforms drop column if exists other_note;
--   alter table public.fms_hr_job_platforms drop column if exists is_other;
--   delete from public.fms_hr_job_platforms where is_other;
-- ===========================================================================

-- ---- 1. The flag + the note column ---------------------------------------
--
-- is_other is a FLAG, not a name match. An admin can rename the row to "Other"
-- or "Something else" in Setup → Masters and the Post Job form keeps working,
-- because the form looks for the flag.

alter table public.fms_hr_job_platforms
  add column if not exists is_other boolean not null default false;

comment on column public.fms_hr_job_platforms.is_other is
  'The catch-all row. Selecting it on a job posting requires a free-text note naming the actual platform.';

alter table public.fms_hr_requisition_platforms
  add column if not exists other_note text;

comment on column public.fms_hr_requisition_platforms.other_note is
  'Only ever set on the is_other platform: what HR typed when they ticked Others.';

-- Exactly one flagged row. sort_order 99 keeps it last in every dropdown.
insert into public.fms_hr_job_platforms (name, sort_order, is_other) values ('Others', 99, true)
on conflict (name) do update set is_other = true;

-- ---- 2. fms_hr_post_job — now carries the note ---------------------------
--
-- The 3-arg signature is dropped so there is no overload to resolve against;
-- p_other_note is defaulted, so a caller that omits it still binds.

drop function if exists public.fms_hr_post_job(uuid, uuid[], date);
drop function if exists public.fms_hr_post_job(uuid, uuid[], date, text);
create or replace function public.fms_hr_post_job(
  p_req          uuid,
  p_platform_ids uuid[],
  p_posted_on    date default null,
  p_other_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_on     date := coalesce(p_posted_on, current_date);
  v_note   text := nullif(trim(coalesce(p_other_note, '')), '');
  v_other  boolean;
  pid      uuid;
begin
  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status <> 'posting' then
    raise exception 'This requisition is not ready to be posted (status %)', v_status;
  end if;
  if not public.fms_hr_can_act('job_posting', p_req, v_uid) then
    raise exception 'Not authorized to post this job';
  end if;
  if p_platform_ids is null or cardinality(p_platform_ids) = 0 then
    raise exception 'Pick at least one platform the job was posted on';
  end if;

  -- Ticking Others without saying which platform records nothing, so refuse it
  -- here rather than trusting the form to have asked.
  select exists (
    select 1 from public.fms_hr_job_platforms
     where id = any(p_platform_ids) and is_other
  ) into v_other;
  if v_other and v_note is null then
    raise exception 'Name the other platform the job was posted on';
  end if;

  delete from public.fms_hr_requisition_platforms where requisition_id = p_req;
  foreach pid in array p_platform_ids loop
    insert into public.fms_hr_requisition_platforms (requisition_id, platform_id, posted_on, other_note)
    values (
      p_req, pid, v_on,
      case when exists (select 1 from public.fms_hr_job_platforms where id = pid and is_other)
           then v_note end
    )
    on conflict do nothing;
  end loop;

  update public.fms_hr_requisitions set
    posted_at    = now(),
    posted_on    = v_on,
    status       = 'sourcing',
    current_step = 'resume_upload'
  where id = p_req;
end $$;
grant execute on function public.fms_hr_post_job(uuid, uuid[], date, text) to authenticated;

-- ---- 3. fms_hr_update_post_job — same, for the correction path -----------

drop function if exists public.fms_hr_update_post_job(uuid, uuid[], date);
drop function if exists public.fms_hr_update_post_job(uuid, uuid[], date, text);
create or replace function public.fms_hr_update_post_job(
  p_req          uuid,
  p_platform_ids uuid[],
  p_posted_on    date default null,
  p_other_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_on     date := coalesce(p_posted_on, current_date);
  v_note   text := nullif(trim(coalesce(p_other_note, '')), '');
  v_other  boolean;
  v_cands  integer;
  pid      uuid;
begin
  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status <> 'sourcing' then
    raise exception 'The job posting can no longer be edited (the requisition is %)', v_status;
  end if;

  select count(*) into v_cands from public.fms_hr_candidates where requisition_id = p_req;
  if v_cands > 0 then
    raise exception 'Candidates have already been added — the job posting can no longer be edited';
  end if;

  if not public.fms_hr_can_act('job_posting', p_req, v_uid) then
    raise exception 'Not authorized to edit the job posting';
  end if;
  if p_platform_ids is null or cardinality(p_platform_ids) = 0 then
    raise exception 'Pick at least one platform the job was posted on';
  end if;

  select exists (
    select 1 from public.fms_hr_job_platforms
     where id = any(p_platform_ids) and is_other
  ) into v_other;
  if v_other and v_note is null then
    raise exception 'Name the other platform the job was posted on';
  end if;

  delete from public.fms_hr_requisition_platforms where requisition_id = p_req;
  foreach pid in array p_platform_ids loop
    insert into public.fms_hr_requisition_platforms (requisition_id, platform_id, posted_on, other_note)
    values (
      p_req, pid, v_on,
      case when exists (select 1 from public.fms_hr_job_platforms where id = pid and is_other)
           then v_note end
    )
    on conflict do nothing;
  end loop;

  -- posted_by stays the original poster (coalesce — old rows have no actor); the
  -- corrector lands in edited_*. posted_at (the STEP-completed stamp) is untouched.
  update public.fms_hr_requisitions set
    posted_on = v_on, edited_at = now(), edited_by = v_uid
  where id = p_req;
end $$;
grant execute on function public.fms_hr_update_post_job(uuid, uuid[], date, text) to authenticated;
