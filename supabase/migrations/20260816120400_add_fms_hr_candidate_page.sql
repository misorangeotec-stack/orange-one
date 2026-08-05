-- ===========================================================================
-- HR Recruitment — THE CANDIDATE PAGE.
--
-- A candidate has never had a screen of their own: they are a card in a popup, so
-- notifications about them had nowhere to land and the team had nowhere to say
-- anything about them. This adds the three things the page needs that the database
-- could not already answer.
--
-- 1. TAGS on a candidate — free text, one additive column.
-- 2. COMMENTS — a new activity `type`, NOT a new table. fms_hr_activity is already
--    "who did what to which entity, with a note", which is exactly a comment. The
--    page renders system events and comments as ONE timeline, which is what makes
--    the history readable rather than two lists to reconcile.
-- 3. Narrow writes for the note and the tags.
--
-- ⚠ THE THREE FIXES BELOW ARE NOT COSMETIC. Each was found by re-auditing the plan
--   against this database, and each would have shipped as a silent failure.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Tags. Additive; existing rows get '{}'.
-- ---------------------------------------------------------------------------
alter table public.fms_hr_candidates
  add column if not exists tags text[] not null default '{}';

comment on column public.fms_hr_candidates.tags is
  'Free-text marks the process has no field for — referred, rehire, do-not-hire. Set from the candidate page.';

-- ---------------------------------------------------------------------------
-- 2. WHO MAY WORK WITH A CANDIDATE.
--
--    Mirrors canSeeBoard() in the client (lib/access.ts): a coordinator, anyone who
--    owns a step, or the person whose requisition it is. Kept as one function so the
--    comment RPC, the note RPC and the tags RPC cannot drift apart — three copies of
--    an authorisation rule is three chances to get it wrong.
--
-- ⚠ DELIBERATELY WIDER THAN fms_hr_can_act('resume_upload'), which is what the
--   existing fms_hr_update_candidate requires. That predicate is HR-only, so a HOD
--   or an interviewer could not leave a note on a candidate they are interviewing —
--   which is precisely who the note is for.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_may_touch_candidate(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.fms_hr_is_coordinator(p_uid)
      or public.fms_hr_is_any_step_owner(p_uid)
      or exists (
           select 1 from public.fms_hr_requisitions r
            where r.id = p_req
              and (p_uid = any(coalesce(r.hiring_manager_ids, '{}'::uuid[]))
                   or r.requester_id = p_uid)
         );
$$;

grant execute on function public.fms_hr_may_touch_candidate(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. FIX #1 — A HOD COULD NOT READ THE DISCUSSION.
--
--    fms_hr_activity's read policy was `is_coordinator OR is_any_step_owner`
--    (20260712120000). But the board's own access rule ALSO admits anyone whose
--    requisition it is — a HOD who raised the MRF is usually neither a coordinator
--    nor a step owner.
--
--    So that HOD could open the candidate page and see an EMPTY discussion, with no
--    error and no way to tell "no comments yet" from "you cannot see them". The
--    discussion is the whole point of the page, and the HOD is exactly who we are
--    asking to comment.
--
-- ⚠ ADDITIVE. The two existing arms are untouched; a third is added. Nobody who
--   could read activity before loses it.
-- ---------------------------------------------------------------------------

-- Which requisition an activity row ultimately belongs to. Needed because the trail
-- is polymorphic — a row may hang off a requisition, a candidate, an onboarding or a
-- probation, and only the requisition knows its hiring managers.
create or replace function public.fms_hr_activity_requisition(p_entity_type text, p_entity_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_entity_type
    when 'requisition' then p_entity_id
    when 'candidate'   then (select c.requisition_id from public.fms_hr_candidates  c  where c.id  = p_entity_id)
    when 'onboarding'  then (select o.requisition_id from public.fms_hr_onboardings o  where o.id  = p_entity_id)
    when 'probation'   then (select pr.requisition_id from public.fms_hr_probations pr where pr.id = p_entity_id)
    else null
  end;
$$;

grant execute on function public.fms_hr_activity_requisition(text, uuid) to authenticated;

drop policy if exists fms_hr_activity_select on public.fms_hr_activity;
create policy fms_hr_activity_select on public.fms_hr_activity
  for select to authenticated
  using (
    public.fms_hr_is_coordinator(auth.uid())
    or public.fms_hr_is_any_step_owner(auth.uid())
    -- New: the requisition's own hiring manager / requester.
    or exists (
         select 1 from public.fms_hr_requisitions r
          where r.id = public.fms_hr_activity_requisition(entity_type, entity_id)
            and (auth.uid() = any(coalesce(r.hiring_manager_ids, '{}'::uuid[]))
                 or r.requester_id = auth.uid())
       )
  );

-- ---------------------------------------------------------------------------
-- 4. POST A COMMENT.
--
--    A comment is an activity row of type 'comment'. It carries the people tagged in
--    it in `meta.mentions` — a jsonb column that already exists and was unused, so
--    tagging costs no schema at all.
--
--    Notifies: the requisition's hiring managers, the owner of the step the candidate
--    is currently waiting on, and anyone tagged. fms_hr_announce already skips the
--    author and de-duplicates the list, so overlap between those three is harmless.
--
-- ⚠ security definer is REQUIRED: fms_hr_activity's write policy is admin-only, so
--   an ordinary user can never insert into it directly.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_post_comment(
  p_candidate uuid,
  p_text      text,
  p_mentions  uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid;
  v_stage   text;
  v_step    text;
  v_text    text := nullif(trim(p_text), '');
  v_targets uuid[] := '{}';
  v_name    text;
begin
  if v_text is null then
    raise exception 'Write something before posting';
  end if;

  select c.requisition_id, c.stage, c.name
    into v_req, v_stage, v_name
    from public.fms_hr_candidates c where c.id = p_candidate;
  if v_req is null then raise exception 'Candidate not found'; end if;

  if not public.fms_hr_may_touch_candidate(v_req, v_uid) then
    raise exception 'Not authorized to comment on this candidate';
  end if;

  -- Everyone who should hear about it, in one array. announce() de-duplicates.
  select coalesce(r.hiring_manager_ids, '{}'::uuid[]) into v_targets
    from public.fms_hr_requisitions r where r.id = v_req;

  v_step := public.fms_hr_pending_step(v_stage);
  if v_step is not null then
    v_targets := v_targets || public.fms_hr_step_owner_ids(v_step);
  end if;

  -- Tagged people are notified even when they own nothing on this vacancy — being
  -- named IS the reason to tell them.
  if p_mentions is not null then
    v_targets := v_targets || p_mentions;
  end if;

  perform public.fms_hr_announce(
    'candidate', p_candidate, 'comment', v_text, v_targets,
    jsonb_build_object('mentions', to_jsonb(coalesce(p_mentions, '{}'::uuid[])))
  );
end $function$;

grant execute on function public.fms_hr_post_comment(uuid, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. FIX #2 — THE QUICK NOTE AND THE TAGS NEED THEIR OWN WRITES.
--
--    The only existing edit path, fms_hr_update_candidate, is wrong for this twice
--    over:
--      a) it requires fms_hr_can_act('resume_upload', …) — HR only, so the HOD or
--         interviewer the note is FOR could not save one; and
--      b) it rewrites every column from the payload — name, phone, email, skills —
--         so saving a note means posting the whole record back, and anything stale in
--         the browser silently overwrites the real value.
--
--    These two touch exactly one column each and authorise like the page does.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_set_candidate_note(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_req uuid;
  v_uid uuid := auth.uid();
begin
  select c.requisition_id into v_req from public.fms_hr_candidates c where c.id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if not public.fms_hr_may_touch_candidate(v_req, v_uid) then
    raise exception 'Not authorized to note against this candidate';
  end if;

  update public.fms_hr_candidates
     set notes = nullif(trim(p_note), '')
   where id = p_id;
end $function$;

grant execute on function public.fms_hr_set_candidate_note(uuid, text) to authenticated;

create or replace function public.fms_hr_set_candidate_tags(p_id uuid, p_tags text[])
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_req  uuid;
  v_uid  uuid := auth.uid();
  v_tags text[];
begin
  select c.requisition_id into v_req from public.fms_hr_candidates c where c.id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if not public.fms_hr_may_touch_candidate(v_req, v_uid) then
    raise exception 'Not authorized to tag this candidate';
  end if;

  -- Trimmed, blanks dropped, de-duplicated case-insensitively, order preserved.
  select coalesce(array_agg(t order by ord), '{}'::text[]) into v_tags
    from (
      select distinct on (lower(trim(x))) trim(x) as t, ord
        from unnest(coalesce(p_tags, '{}'::text[])) with ordinality as u(x, ord)
       where coalesce(trim(x), '') <> ''
       order by lower(trim(x)), ord
    ) d;

  update public.fms_hr_candidates set tags = v_tags where id = p_id;
end $function$;

grant execute on function public.fms_hr_set_candidate_tags(uuid, text[]) to authenticated;

commit;
