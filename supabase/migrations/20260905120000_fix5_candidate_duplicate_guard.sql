-- ============================================================================
-- FIX-5 · The same candidate can be added to a vacancy twice
--
-- The Executive Assistant board reads "4 · 2 in play" for two people, because
-- both were entered twice. Seven such rows are live across three vacancies, and
-- two of them (CA Vandit Mehta on MRF-2627-0015) are sitting at Interview Round 3
-- SIMULTANEOUSLY — two people can book the same person for two rounds without
-- either seeing the other.
--
-- Nothing stopped it. fms_hr_add_candidates validates status, authorisation and a
-- non-blank name, and inserts whatever else it is handed. fms_hr_candidates has no
-- uniqueness beyond `id` and `candidate_no` (which is minted fresh per insert, so
-- it can never collide). The only guard was client-side, advisory, and compared
-- phone and email only — returning nothing at all when both were missing, which is
-- the case for 30 of the 119 live rows.
--
-- This migration adds:
--   §1  resume_sha256          — the CV's own fingerprint
--   §2  fms_hr_norm_*          — four normalisers, mirrored in lib/duplicates.ts
--   §3  fms_hr_stage_label     — so an error message never prints a raw enum
--   §4  fms_hr_candidate_duplicate — the certain-tier check
--   §5  fms_hr_add_candidates  — re-issued WITH the guard
--   §6  fms_hr_update_candidate — re-issued WITH the guard (the other way in)
--   §7  fms_hr_reconsider_candidate — reopen the existing row instead of re-adding
--
-- ⚠ NO UNIQUE CONSTRAINT. `(requisition_id, lower(email))` would make this
--   structurally impossible and would also refuse a legitimate re-application
--   after a rejection — which is exactly what may have happened on the EA
--   vacancy. The guard plus an explicit, recorded override is the right shape.
--
-- Additive only: no column is dropped, no data is rewritten.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- §1 · The CV fingerprint.
--
-- Every duplicate that got past the old check was literally the same PDF uploaded
-- a second time. A hash of the bytes is the only signal that is PROOF rather than
-- inference, and it works no matter what the CV parser managed to read.
--
-- ⚠ DELIBERATELY NOT BACKFILLED. All 119 existing rows keep resume_sha256 = null
--   and simply do not participate in this signal; backfilling would mean
--   downloading every stored object, and the filename / name / email signals
--   already cover every historical row. The nulls are expected, not a defect.
-- ---------------------------------------------------------------------------
alter table public.fms_hr_candidates
  add column if not exists resume_sha256 text;

comment on column public.fms_hr_candidates.resume_sha256 is
  'Lowercase hex SHA-256 of the uploaded CV bytes, computed in the browser. Null for '
  'rows created before FIX-5 and for any upload where crypto.subtle was unavailable '
  '(a non-secure context) — the duplicate check falls back to its other signals.';

create index if not exists fms_hr_candidates_sha_idx
  on public.fms_hr_candidates (requisition_id, resume_sha256)
  where resume_sha256 is not null;


-- ---------------------------------------------------------------------------
-- §2 · The normalisers.
--
-- ⚠ THESE MIRROR `frontend/src/apps/hr-recruitment/lib/duplicates.ts` EXACTLY.
--   Change one and you must change the other, or the modal will warn about
--   something the server allows — or refuse to save something the server accepts.
--
-- Each rule was derived from a row that actually got past the old check. Verified
-- against all 119 live rows on 05-Sep-2026: they reproduce exactly the six known
-- duplicate groups and produce no false positive.
-- ---------------------------------------------------------------------------

create or replace function public.fms_hr_norm_email(p text)
returns text language sql immutable as $$
  select nullif(lower(btrim(coalesce(p, ''))), '');
$$;

-- Last ten digits. '+91 9723542928' and '9723542928' are one phone number; the
-- old check compared them as raw strings, so they were not.
create or replace function public.fms_hr_norm_phone(p text)
returns text language sql immutable as $$
  select case when length(d) >= 10 then right(d, 10) end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) t;
$$;

-- The CV's filename, folded onto what two copies of it have in common:
--   'Kajal Bhalerao (2).pdf'            -> kajalbhalerao   (browser download collision)
--   '1787824267285-Sunil_Sharma_CV.pdf' -> sunilsharmacv   (an upload-id prefix)
--
-- Returns NULL for names that identify nobody. Two people both sending
-- 'Resume.pdf' is not evidence, and WhatsApp/camera auto-names encode a DATE:
-- CAN-2627-0033 and CAN-2627-0040, on two different vacancies, both carry the
-- byte-identical 'DOC-20260604-WA0001. (1).pdf'.
--
-- ⚠ Does NOT strip cv/resume tokens the way the person-name normaliser does. A
--   filename is not a name: stripping them collapses 'Resume.pdf' to nothing and
--   every generic CV in a batch would match every other one.
create or replace function public.fms_hr_norm_resume_name(p text)
returns text language sql immutable as $$
  select case
    when v = '' then null
    when v = any (array['resume','cv','curriculumvitae','biodata','document','untitled','download','attachment']) then null
    when v ~ '^(doc|img|vid|aud|ptt|mvimg)\d{6,}wa\d+$' then null  -- WhatsApp
    when v ~ '^(img|dsc|pxl|mvimg)\d{3,}$'              then null  -- camera roll
    when v ~ '^screenshot'                              then null
    when v ~ '^scan(ned)?\d*$'                          then null
    when v ~ '^(image|photo|file|doc|document|new)\d*$'  then null
    when v ~ '^\d+$'                                    then null  -- a bare timestamp
    else v
  end
  from (
    select regexp_replace(
             lower(
               regexp_replace(                                        -- '(1)', '(2)'
                 regexp_replace(                                      -- upload-id prefix
                   regexp_replace(btrim(coalesce(p, '')), '\.[^./\\]+$', ''),   -- extension
                 '^\d{8,}[-_[:space:]]+', ''),
               '[[:space:]_-]*\(\d+\)$', '')
             ),
           '[^a-z0-9]', '', 'g') as v
  ) t;
$$;

-- A person's name, stripped of the tokens that ride along when the name was
-- lifted from a filename because the parser failed. Nobody is called CV, so this
-- is safe here in a way it is not for a filename.
--
-- This is what makes the name signal work: the live data holds 'CV   CA Vandit
-- Mehta', 'Sunil Sharma CV' and 'Purvi Upadhyay   EA' beside their parsed twins.
create or replace function public.fms_hr_norm_person_name(p text)
returns text language sql immutable as $$
  select case when length(v) >= 3 then v end
  from (
    select regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(lower(coalesce(p, '')), '\.[a-z0-9]{2,4}$', ''),
               '[^a-z[:space:]]', ' ', 'g'),
             '\y(cv|resume|resumes|curriculumvitae|curriculum|vitae|biodata|naukri|final|updated|new|copy|doc|document|img|image|photo|file|scan|scanned|screenshot|whatsapp|wa|vid|aud)\y', ' ', 'g'),
           '[^a-z]', '', 'g') as v
  ) t;
$$;


-- ---------------------------------------------------------------------------
-- §3 · Stage labels in SQL.
--
-- Mirrors STAGE_LABEL in lib/board.ts. Exists so the guard's error message can
-- say "Shortlisted by HR" rather than 'hr_shortlisted' — a raw enum leaking into
-- a user-facing string is a mistake this module has already made once.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_stage_label(p_stage text)
returns text language sql immutable as $$
  select case p_stage
    when 'resume_uploaded' then 'Resumes Uploaded'
    when 'hr_shortlisted'  then 'Shortlisted by HR'
    when 'shared_with_hod' then 'Shared with the HOD'
    when 'hod_shortlisted' then 'Shortlisted by HOD'
    when 'telephonic'      then 'Telephonic Screening'
    when 'interview_1'     then 'Interview R1 — HR'
    when 'interview_2'     then 'Interview R2 — HOD'
    when 'interview_3'     then 'Interview R3 — Director'
    when 'final_decision'  then 'Awaiting Decision'
    when 'finalized'       then 'Made Offer'
    when 'hired'           then 'Hired'
    when 'disqualified'    then 'Disqualified'
    else coalesce(p_stage, 'an unknown stage')
  end;
$$;


-- ---------------------------------------------------------------------------
-- §4 · The certain-tier duplicate check.
--
-- CERTAIN SIGNALS ONLY — the same file, the same email, the same phone. The
-- "likely" tier (matching filename or matching name) stays a client-side
-- advisory: two real people can share a name, and the server has no way to ask.
--
-- Scoped to ONE requisition on purpose. The same person applying to two different
-- vacancies is legitimate and must never be blocked.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_candidate_duplicate(
  p_req     uuid,
  p_email   text,
  p_phone   text,
  p_sha     text,
  p_exclude uuid default null
)
returns table (id uuid, candidate_no text, name text, stage text, signal text)
language sql stable security definer set search_path = public as $$
  select c.id, c.candidate_no, c.name, c.stage,
         case
           when p_sha is not null and c.resume_sha256 = p_sha then 'the identical CV file'
           when public.fms_hr_norm_email(p_email) is not null
                and public.fms_hr_norm_email(c.email) = public.fms_hr_norm_email(p_email)
             then 'the same email address'
           else 'the same phone number'
         end
    from public.fms_hr_candidates c
   where c.requisition_id = p_req
     and (p_exclude is null or c.id <> p_exclude)
     and (
          (p_sha is not null and c.resume_sha256 is not null and c.resume_sha256 = p_sha)
       or (public.fms_hr_norm_email(p_email) is not null
           and public.fms_hr_norm_email(c.email) = public.fms_hr_norm_email(p_email))
       or (public.fms_hr_norm_phone(p_phone) is not null
           and public.fms_hr_norm_phone(c.phone) = public.fms_hr_norm_phone(p_phone))
     )
   order by c.uploaded_at
   limit 1;
$$;


-- ---------------------------------------------------------------------------
-- §5 · fms_hr_add_candidates, re-issued WITH the guard.
--
-- ⚠ THE SIGNATURE IS UNCHANGED, DELIBERATELY. The acknowledgement and the hash
--   ride inside each jsonb element instead of becoming new parameters. Adding a
--   defaulted third argument would create a Postgres OVERLOAD: the old two-arg
--   function would survive and a stale browser tab could call straight past this
--   guard — precisely the bypass it exists to close. Dropping the two-arg version
--   instead would break the deployed frontend between migration and deploy.
--   Widening the payload has neither problem.
--
-- Everything outside the guard is byte-identical to 20260712140000.
-- ---------------------------------------------------------------------------
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
  v_ack    text;
  v_sha    text;
  v_dup    record;
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

    -- The backstop. The browser checks this too and checks MORE (it also compares
    -- the filename and the normalised name), so reaching this raise means a stale
    -- tab, a second window, or a direct RPC call.
    select * into v_dup
      from public.fms_hr_candidate_duplicate(
             p_req,
             nullif(trim(c->>'email'), ''),
             nullif(trim(c->>'phone'), ''),
             v_sha);

    if v_dup.id is not null and v_ack is null then
      raise exception '% is already on this vacancy as % — % — matched on %. Tick "Add anyway" if this is deliberate.',
        trim(c->>'name'), v_dup.candidate_no, public.fms_hr_stage_label(v_dup.stage), v_dup.signal;
    end if;

    v_no := 'CAN-' || v_fy || '-' || lpad(public.fms_hr_next_seq('CAN-' || v_fy)::text, 4, '0');

    insert into public.fms_hr_candidates (
      requisition_id, candidate_no, name, phone, email, current_company, experience_years,
      skills, notes, source_platform_id, resume_path, resume_name, resume_sha256,
      parse_status, parsed_json, stage, uploaded_at, created_by
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
      'resume_uploaded', now(), v_uid
    )
    returning id into v_id;

    -- A deliberate duplicate is a decision, and a decision needs a trail. No
    -- recipient array, so fms_hr_announce writes the activity row and stops:
    -- the bell loop never runs, and its email arm covers only master_request and
    -- candidate.interview_* types, so a requisition-scoped type cannot mail.
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
end $function$;


-- ---------------------------------------------------------------------------
-- §6 · fms_hr_update_candidate, re-issued WITH the same guard.
--
-- 🔴 THE OTHER WAY IN. This function sets email and phone unconditionally, so
--    editing one candidate's contact details onto another's re-creates the
--    duplicate through the back door. It has no callers today — but NR-5 plans to
--    wire it to a real Edit-candidate control, which would reopen the hole the
--    moment it ships. Guarding it now costs nothing and closes it in advance.
--
-- Everything outside the guard is byte-identical to 20260712140000.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_update_candidate(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $function$
declare
  v_req uuid;
  v_uid uuid := auth.uid();
  v_dup record;
begin
  select requisition_id into v_req from public.fms_hr_candidates where id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if not public.fms_hr_can_act('resume_upload', v_req, v_uid) then
    raise exception 'Not authorized to edit this candidate';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'A name is required'; end if;

  if nullif(trim(p->>'duplicate_ack'), '') is null then
    select * into v_dup
      from public.fms_hr_candidate_duplicate(
             v_req,
             nullif(trim(p->>'email'), ''),
             nullif(trim(p->>'phone'), ''),
             nullif(trim(p->>'resume_sha256'), ''),
             p_id);   -- never match itself
    if v_dup.id is not null then
      raise exception 'Those details already belong to % on this vacancy — % — matched on %.',
        v_dup.candidate_no, public.fms_hr_stage_label(v_dup.stage), v_dup.signal;
    end if;
  end if;

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
    resume_name      = coalesce(nullif(p->>'resume_name',''), resume_name),
    resume_sha256    = coalesce(nullif(p->>'resume_sha256',''), resume_sha256)
  where id = p_id;
end $function$;


-- ---------------------------------------------------------------------------
-- §7 · Reconsider — reopen the existing row instead of adding a second one.
--
-- This is the fix that removes the CAUSE. In all three real cases HR's intent was
-- "look at this person again"; a second row was never what they wanted, and it
-- restarted them at stage 1 with none of their history.
--
-- 🔴 WHY THIS EXISTS RATHER THAN REUSING fms_hr_move_candidate. Dragging a card
--    back out of Disqualified already works — and its backward branch runs
--    `delete from fms_hr_interviews where round > greatest(-1, v_to_rank - 5)`
--    and nulls the disqualification reason. Reinstating to hr_shortlisted (rank 2)
--    therefore DESTROYS EVERY INTERVIEW ROW the person has and erases why they
--    were dropped. This function deletes nothing and records the old reason first.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_reconsider_candidate(p_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $function$
declare
  v_uid        uuid := auth.uid();
  v_c          record;
  v_req_status text;
  v_to         text;
  v_old_reason text;
  v_max_round  integer;
begin
  select * into v_c from public.fms_hr_candidates where id = p_id for update;
  if v_c.id is null then raise exception 'Candidate not found'; end if;

  if v_c.stage <> 'disqualified' then
    raise exception 'Only a dropped candidate can be reconsidered — % is at %',
      v_c.name, public.fms_hr_stage_label(v_c.stage);
  end if;

  select status into v_req_status from public.fms_hr_requisitions where id = v_c.requisition_id for update;
  if v_req_status <> 'sourcing' then
    raise exception 'This vacancy is % — nobody can be brought back into play on it', v_req_status;
  end if;

  -- A declined or lapsed OFFER is not a rejection to reconsider; it is a
  -- different thing entirely, and re-offering runs through the finalized path so
  -- the seat accounting and the onboarding stay honest.
  if exists (select 1 from public.fms_hr_onboardings o where o.candidate_id = p_id) then
    raise exception 'An offer was already made to % — re-offer them from the board instead of reconsidering', v_c.name;
  end if;

  -- Authorised exactly like the disqualification that put them here.
  -- fms_hr_pending_step('disqualified') is null, so this is the final_decision owner.
  if not (public.fms_hr_can_act('final_decision', v_c.requisition_id, v_uid)
          or public.fms_hr_can_act('hr_shortlist', v_c.requisition_id, v_uid)) then
    raise exception 'Not authorized to bring this candidate back into play';
  end if;

  -- Back to the stage they had actually reached.
  --
  -- ⚠ TWO KINDS OF EVIDENCE, AND BOTH ARE NEEDED. `interviewN_at` is stamped by
  --   fms_hr_record_interview_result when the round is HELD — NOT when the card is
  --   moved into that column. So a candidate dropped while sitting at Round 2
  --   booked-but-not-yet-held has interview2_at = null, and timestamps alone would
  --   send them all the way back to the HR shortlist, losing their place. The
  --   interview ROW is the record of having got that far, so the highest booked
  --   round counts too.
  select max(round) into v_max_round
    from public.fms_hr_interviews where candidate_id = p_id;

  -- ⚠ hod_decided_at is deliberately NOT used. It is stamped whether the HOD
  --   shortlisted them or dropped them, so landing on 'hod_shortlisted' would
  --   assert an approval that may never have happened. That case falls back a
  --   step and lets the HOD be asked again.
  v_to := case
    when v_c.final_decision_at is not null                      then 'final_decision'
    when v_c.interview3_at is not null or v_max_round = 3       then 'interview_3'
    when v_c.interview2_at is not null or v_max_round = 2       then 'interview_2'
    when v_c.interview1_at is not null or v_max_round = 1       then 'interview_1'
    when v_c.telephonic_at is not null or v_max_round = 0       then 'telephonic'
    when v_c.hr_shortlisted_at is not null                      then 'hr_shortlisted'
    else 'resume_uploaded'
  end;

  -- Capture the reason BEFORE clearing it — this row is the only record that the
  -- rejection ever happened, once the columns below are nulled.
  v_old_reason := nullif(btrim(v_c.disqualification_note), '');
  if v_old_reason is null and v_c.disqualification_reason_id is not null then
    select d.name into v_old_reason
      from public.fms_hr_disqualification_reasons d
     where d.id = v_c.disqualification_reason_id;
  end if;
  v_old_reason := coalesce(v_old_reason, 'no reason recorded');

  perform public.fms_hr_announce(
    'candidate', p_id, 'reconsidered',
    format('%s was brought back into play at %s. Originally dropped %s — %s.%s',
           v_c.name,
           public.fms_hr_stage_label(v_to),
           coalesce(to_char(v_c.disqualified_at at time zone 'Asia/Kolkata', 'DD Mon YYYY'), 'earlier'),
           v_old_reason,
           case when nullif(btrim(p_note), '') is not null then ' Reason: ' || btrim(p_note) else '' end),
    '{}'::uuid[],
    jsonb_build_object('from_stage', 'disqualified', 'to_stage', v_to,
                       'original_reason', v_old_reason,
                       'original_disqualified_at', v_c.disqualified_at,
                       'note', nullif(btrim(p_note), '')));

  update public.fms_hr_candidates set
    stage                      = v_to,
    disqualified_at            = null,
    disqualification_reason_id = null,
    disqualification_note      = null
  where id = p_id;

  -- NOTHING IS DELETED. Their interviews, scores and comments all stand.
end $function$;

-- ---------------------------------------------------------------------------
-- §8 · Grants.
--
-- The module's convention is anon + authenticated + service_role on every RPC
-- (the Supabase default), and fms_hr_reconsider_candidate follows it — it
-- authorises the caller itself, like every other write here.
--
-- 🔴 fms_hr_candidate_duplicate is the ONE exception, and deliberately so. It is
--    SECURITY DEFINER, so it reads straight past RLS, and it returns a real
--    person's NAME and stage in response to a guessed email address. Left on the
--    PUBLIC default that every other function here carries, an anonymous caller
--    could use it to ask "is this person in your recruitment system" and be told.
--    Nothing outside this file calls it — both callers are SECURITY DEFINER and
--    execute as the owner — so it costs nothing to close.
-- ---------------------------------------------------------------------------
grant execute on function public.fms_hr_reconsider_candidate(uuid, text) to authenticated, service_role;

revoke all on function public.fms_hr_candidate_duplicate(uuid, text, text, text, uuid) from public;
revoke all on function public.fms_hr_candidate_duplicate(uuid, text, text, text, uuid) from anon, authenticated;
