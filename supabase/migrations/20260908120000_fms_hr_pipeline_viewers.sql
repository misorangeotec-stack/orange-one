-- HR Recruitment — a named list of PIPELINE VIEWERS who may read every candidate.
--
-- WHY
-- NR-2 adds a management pipeline dashboard: every position's pipeline on one screen,
-- with the candidate's own detail readable from it. "Management" is nobody in code —
-- the client's decision (02-09-2026) was to make the permission a LIST IN SETUP that
-- an admin edits, seeded with the Directors.
--
-- A frontend list decides which SCREEN RENDERS, not which ROWS ARRIVE. Candidate read
-- is gated in SQL by fms_hr_can_read_requisition(), whose six arms are: admin ·
-- coordinator · recruitment staff (owns any step except `mrf`) · the requisition's own
-- requester / hiring manager / reporting-to · a step assignee · a booked interviewer.
-- Somebody added to a Setup-only list who owns no recruitment step would therefore get
-- the new screen and find it EMPTY — not an error, just nothing, which reads as a
-- broken build rather than a missing grant.
--
-- ⚠ THIS IS A PII GRANT, AND THAT IS THE INTENT — SAY IT OUT LOUD.
-- One OR below opens EIGHT relations to whoever is on the list:
--
--     fms_hr_candidates          ← names, phones, emails, expected salary
--     fms_hr_candidate_scores
--     fms_hr_interviews
--     fms_hr_onboardings
--     fms_hr_onboarding_checks
--     fms_hr_probations
--     fms_hr_probation_reviews
--     fms_hr_requisitions        ← indirectly: fms_hr_can_view_requisition() delegates
--                                  to can_read(), so the vacancy tier opens too
--
-- ...plus every file in the private `fms-hr-docs` bucket (139 resumes and 14 JDs as
-- this ships), because the storage policy is gated on a DIFFERENT pair of predicates
-- and would otherwise leave the resume panel — one of the candidate detail's three
-- columns — rendering blank for exactly the people this screen is built for.
--
-- Deliberately NOT widened: writes. The Setup list grants READ. Acting on a candidate
-- still needs fms_hr_can_act(), which requires module_can_edit(uid,'hr-recruitment')
-- AND the step's own authority — so a pipeline viewer sees everything and may press
-- only the buttons the existing rules already allow them. Storage insert / update /
-- delete keep their own quals untouched, so a viewer can read a CV but never replace
-- or remove one (NR-5's immutability is preserved).
--
-- Deliberately NOT used: module_is_viewer(). A "view only" module grant reaches the
-- VACANCY tier only, on purpose — 20260925130100 widened the SIBLING
-- fms_hr_can_view_requisition() precisely so the candidate-PII gate stayed shut. This
-- migration adds a separate, explicit, admin-editable grant rather than reopening that
-- decision.
--
-- ADDITIVE ONLY. No table, column, row or policy is dropped or mutated; the one
-- storage policy below is recreated with its existing predicate carried forward
-- verbatim and a third arm appended.

begin;

-- ---------------------------------------------------------------------------
-- 1. The predicate.
--
-- Copies the SHAPE of fms_hr_is_coordinator() exactly — `sql`, STABLE, SECURITY
-- DEFINER, search_path pinned, the same jsonb_array_elements_text(value->'user_ids')
-- read. It is called PER ROW by eight policies, so a VOLATILE twin would be re-planned
-- on every row; Order to Dispatch turned 15ms into 1.4s from exactly this mistake.
--
-- ⚠ One deliberate difference from fms_hr_is_coordinator: NO is_admin ARM. This
--   predicate answers "is this person on the list", and nothing else, so that it can be
--   tested on its own. Admins already pass every consumer of it by another arm.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_is_pipeline_viewer(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_hr_config c
    where c.key = 'pipeline_viewers'
      and p_uid::text in (
        select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
      )
  );
$$;

comment on function public.fms_hr_is_pipeline_viewer(uuid) is
  'True when the user is on the fms_hr_config `pipeline_viewers` list (NR-2). A PII '
  'grant: OR''d into fms_hr_can_read_requisition(), it opens every candidate, '
  'interview, onboarding and probation row, and every file in fms-hr-docs. Read only — '
  'acting still needs fms_hr_can_act().';

-- ---------------------------------------------------------------------------
-- 2. The arm.
--
-- The six existing arms are carried forward VERBATIM. The new one sits with the other
-- cheap function calls, ABOVE the three per-requisition EXISTS subqueries, so the
-- common cases still short-circuit before any table is touched.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_can_read_requisition(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_hr_is_coordinator(p_uid)
      or public.fms_hr_is_recruitment_staff(p_uid)
      -- NR-2: the management pipeline dashboard's Setup list. See the header.
      or public.fms_hr_is_pipeline_viewer(p_uid)
      or exists (
        select 1 from public.fms_hr_requisitions r
        where r.id = p_req
          and (r.requester_id = p_uid or p_uid = any(r.hiring_manager_ids) or p_uid = any(r.reporting_to_ids))
      )
      or exists (
        select 1 from public.fms_hr_step_assignees a
         where a.requisition_id = p_req and a.assigned_to = p_uid
      )
      or exists (
        select 1
          from public.fms_hr_interviews i
          join public.fms_hr_candidates c on c.id = i.candidate_id
         where c.requisition_id = p_req and p_uid = any(i.interviewer_ids)
      );
$$;

-- ---------------------------------------------------------------------------
-- 3. The CV / JD bucket.
--
-- `fms-hr-docs` is private and its SELECT policy is gated on a DIFFERENT pair —
-- fms_hr_is_coordinator OR fms_hr_is_any_step_owner — which is not what
-- fms_hr_can_read_requisition() checks. Without this arm a pipeline viewer sees the
-- candidate's name, phone and history and an EMPTY resume viewer.
--
-- Note the existing predicate is already coarse and bucket-wide (is_any_step_owner is
-- not scoped to a requisition, and unlike is_recruitment_staff it counts `mrf`), so
-- this arm matches the shape that is already there rather than inventing a new one.
--
-- ⚠ SELECT ONLY. `fms hr docs insert` / `update` / `delete` are untouched.
-- ---------------------------------------------------------------------------
drop policy if exists "fms hr docs read" on storage.objects;
create policy "fms hr docs read"
  on storage.objects for select
  using (
    bucket_id = 'fms-hr-docs'
    and (
      public.fms_hr_is_coordinator(auth.uid())
      or public.fms_hr_is_any_step_owner(auth.uid())
      -- NR-2: a pipeline viewer must be able to open the CV they are reading about.
      or public.fms_hr_is_pipeline_viewer(auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Seed the list with the Directors.
--
-- 853f57a4… Aayush Rathi · e3977634… Karan Toshniwal — the two people the dashboard
-- was asked for. Both are portal admins, so this changes nothing they can already do;
-- it is here so the list is never empty on arrival and the Setup screen opens with the
-- intended shape.
--
-- ⚠ ON CONFLICT DO NOTHING, not DO UPDATE. fms_hr_config's primary key is `key`, and
--   re-running this migration must never clobber a list an admin has since edited.
-- ---------------------------------------------------------------------------
insert into public.fms_hr_config (key, value)
values (
  'pipeline_viewers',
  jsonb_build_object('user_ids', jsonb_build_array(
    '853f57a4-fd21-4730-9666-09c2855fc815',
    'e3977634-30a3-4a1e-9d5f-4db93b327457'
  ))
)
on conflict (key) do nothing;

commit;
