-- ============================================================================
-- ROLLBACK for 20260905120000_fix5_candidate_duplicate_guard.sql
--
-- Restores fms_hr_add_candidates and fms_hr_update_candidate to their bodies as
-- at 20260712140000 (captured from the LIVE function definitions on 05-Sep-2026,
-- not from the migration file), and drops everything the guard added.
--
-- ⚠ `resume_sha256` IS DELIBERATELY KEPT. The repo rule is additive-only: the
--   column holds real fingerprints once anything has been uploaded, and dropping
--   it would destroy data to undo a behaviour change. It simply stops being read.
--   The index goes, because nothing reads it once the functions are back.
--
-- ⚠ REHEARSE THIS, DO NOT MERELY READ IT. Run cutover → rollback → re-apply on
--   the live database and confirm a plain two-key payload still inserts after the
--   rollback. A rollback that has never been executed is not a rollback.
-- ============================================================================

drop index if exists public.fms_hr_candidates_sha_idx;

-- Order matters: the two RPCs must stop referencing the helpers before the
-- helpers can be dropped.

create or replace function public.fms_hr_add_candidates(p_req uuid, p_candidates jsonb)
returns setof uuid
language plpgsql security definer set search_path = public as $function$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_fy     text := public.fms_hr_fy_code(current_date);
  c        jsonb;
  v_id     uuid;
  v_no     text;
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

    v_no := 'CAN-' || v_fy || '-' || lpad(public.fms_hr_next_seq('CAN-' || v_fy)::text, 4, '0');

    insert into public.fms_hr_candidates (
      requisition_id, candidate_no, name, phone, email, current_company, experience_years,
      skills, notes, source_platform_id, resume_path, resume_name, parse_status, parsed_json,
      stage, uploaded_at, created_by
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
      coalesce(nullif(c->>'parse_status',''), 'manual'),
      coalesce(c->'parsed_json', '{}'::jsonb),
      'resume_uploaded', now(), v_uid
    )
    returning id into v_id;

    return next v_id;
  end loop;
end $function$;

create or replace function public.fms_hr_update_candidate(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $function$
declare
  v_req uuid;
  v_uid uuid := auth.uid();
begin
  select requisition_id into v_req from public.fms_hr_candidates where id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if not public.fms_hr_can_act('resume_upload', v_req, v_uid) then
    raise exception 'Not authorized to edit this candidate';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'A name is required'; end if;

  update public.fms_hr_candidates set
    name             = trim(p->>'name'),
    phone            = nullif(trim(p->>'phone'), ''),
    email            = nullif(trim(p->>'email'), ''),
    current_company  = nullif(trim(p->>'current_company'), ''),
    experience_years = nullif(p->>'experience_years','')::numeric,
    skills           = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'skills','[]'::jsonb)) x), skills),
    notes            = nullif(trim(p->>'notes'), ''),
    source_platform_id = nullif(p->>'source_platform_id','')::uuid,
    resume_path      = coalesce(nullif(p->>'resume_path',''), resume_path),
    resume_name      = coalesce(nullif(p->>'resume_name',''), resume_name)
  where id = p_id;
end $function$;

drop function if exists public.fms_hr_reconsider_candidate(uuid, text);
drop function if exists public.fms_hr_candidate_duplicate(uuid, text, text, text, uuid);
drop function if exists public.fms_hr_stage_label(text);
drop function if exists public.fms_hr_norm_person_name(text);
drop function if exists public.fms_hr_norm_resume_name(text);
drop function if exists public.fms_hr_norm_phone(text);
drop function if exists public.fms_hr_norm_email(text);
