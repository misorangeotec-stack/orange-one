-- ===========================================================================
-- VIEW-ONLY READS: General Purchase, Employee Exit, and the HR vacancy tier.
--
-- The companion to 20260925130000, which did Order to Dispatch and created
-- public.module_is_viewer(). Same rule, same shape, three more modules — and
-- one deliberate stop short, explained at D.
--
-- Only four of the nine FMS modules gate reads by ownership at all. Procurement,
-- Import, Sampling, Production Entry and Asset Maintenance are already
-- `for select using (true)`, so a view-only user reads them the moment the
-- frontend stops hiding the screens. Nothing is needed for those here.
--
-- ⚠ 'view', NOT "has any grant", in every arm below. An EDIT grant must not
--   widen row visibility: an editor still sees exactly what their ownership
--   says. Nobody working in these modules today sees one row more than they did
--   yesterday.
--
-- ⚠ DO NOT REACH FOR fms_<app>_is_step_owner / _is_master_manager IN A READ
--   PREDICATE. 20260923120000 replaced 35 such functions in place with
--   `module_can_edit(p_uid, '<app>') and <name>__ungated(...)`, so they are
--   FALSE for precisely the view-only users this exists to help. The un-gated
--   helpers — fms_exit_is_exit_staff, fms_supplies_is_fulfilment_staff,
--   fms_hr_is_recruitment_staff, fms_<app>_is_coordinator — are safe, and every
--   gate below is built from those.
--
-- ⚠ EVERY POLICY IS RECREATED `TO authenticated`. `anon` holds table grants by
--   Supabase default; that scope is the only thing keeping it out.
--
-- ⚠ IDEMPOTENT (create or replace / drop if exists + create).
--
-- Additive only: no table, column or row is created, altered or dropped.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A. GENERAL PURCHASE (office-supplies)
--
-- One function covers fms_supplies_requests; the activity policy carries its
-- own rule and needs the arm separately. No storage bucket for this module.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_can_read_request(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin(p_uid)
      or public.fms_supplies_is_coordinator(p_uid)
      or public.fms_supplies_is_fulfilment_staff(p_uid)
      or public.module_is_viewer(p_uid, 'office-supplies')
      or exists (
           select 1
             from public.fms_supplies_requests r
             left join public.fms_supplies_departments d on d.id = r.department_id
            where r.id = p_req
              and (r.raised_by = p_uid or r.requested_for_user_id = p_uid or d.hod_user_id = p_uid)
         );
$fn$;

drop policy if exists fms_supplies_activity_select on public.fms_supplies_activity;
create policy fms_supplies_activity_select
  on public.fms_supplies_activity
  for select
  to authenticated
  using (
       public.fms_supplies_is_coordinator(auth.uid())
    or public.fms_supplies_is_fulfilment_staff(auth.uid())
    or public.module_is_viewer(auth.uid(), 'office-supplies')
    or (entity_type = 'request'
        and public.fms_supplies_can_read_request(entity_id, auth.uid()))
  );


-- ---------------------------------------------------------------------------
-- B. EMPLOYEE EXIT — the operational tier
--
-- fms_exit_can_read_case covers cases, step_skips, clearance_checks, assets,
-- handover and documents. All six are the operational record of a leaver's
-- exit, and all six were named as in scope.
--
-- ⚠ THE TWO CONFIDENTIAL SATELLITES ARE DELIBERATELY NOT TOUCHED, and that is a
--   decision, not an oversight:
--     · fms_exit_interviews — the exit interview itself. Its policy is already
--       NARROWER than can_read_case (coordinator / HR-confidential only, with no
--       case-level arm at all), and it stays that way.
--     · fms_exit_settlements + fms_exit_payroll_lines — F&F money, behind
--       fms_exit_can_read_settlement, which 20260714170000 deliberately withholds
--       even from the leaver's own reporting manager.
--   A view-only grant is not a route into either. The frontend agrees: the
--   Interview and Settlement queues keep their own canReadConfidential /
--   isFinanceStaff guards rather than the module-viewer arm.
-- ---------------------------------------------------------------------------
create or replace function public.fms_exit_can_read_case(p_case uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin(p_uid)
      or public.fms_exit_is_coordinator(p_uid)
      or public.fms_exit_is_exit_staff(p_uid)
      or public.module_is_viewer(p_uid, 'hr-exit')
      or exists (
        select 1 from public.fms_exit_cases c
        where c.id = p_case
          and (c.employee_user_id = p_uid
            or c.raised_by = p_uid
            or p_uid = any(c.reporting_manager_ids))
      )
      -- …or you own a clearance row on THIS case. (M3.)
      or exists (
        select 1
          from public.fms_exit_clearance_checks k
          join public.fms_exit_cases c on c.id = k.case_id
         where k.case_id = p_case
           and (p_uid = any(k.owner_ids)
             or (k.owner_is_reporting_manager and p_uid = any(c.reporting_manager_ids)))
      );
$fn$;

drop policy if exists fms_exit_activity_select on public.fms_exit_activity;
create policy fms_exit_activity_select
  on public.fms_exit_activity
  for select
  to authenticated
  using (
       public.fms_exit_is_coordinator(auth.uid())
    or public.fms_exit_is_exit_staff(auth.uid())
    or public.module_is_viewer(auth.uid(), 'hr-exit')
  );

-- Attachments: resignation letters, clearance evidence, handover notes. Same
-- tier as fms_exit_documents, which the widened can_read_case now admits, so
-- the bucket has to follow or every document link on those screens 404s.
drop policy if exists "fms exit docs read" on storage.objects;
create policy "fms exit docs read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'fms-exit-docs'
    and (
         public.fms_exit_is_coordinator(auth.uid())
      or public.fms_exit_is_exit_staff(auth.uid())
      or public.module_is_viewer(auth.uid(), 'hr-exit')
    )
  );


-- ---------------------------------------------------------------------------
-- C. NEW RECRUITMENT — the vacancy, and ONLY the vacancy
--
-- A viewer gets the requisitions and the platforms they were posted on. That is
-- the whole widening, and the next section says why it stops there.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_can_view_requisition(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.fms_hr_can_read_requisition(p_req, p_uid)
      or public.module_is_viewer(p_uid, 'hr-recruitment');
$fn$;

comment on function public.fms_hr_can_view_requisition(uuid, uuid) is
  'The VACANCY tier: everyone fms_hr_can_read_requisition admits, plus a view-only grantee. Use for requisition-shaped tables only. Candidate-shaped tables must keep asking fms_hr_can_read_requisition, which is the candidate-PII gate — see 20260712180000 and 20260925130100.';

revoke all on function public.fms_hr_can_view_requisition(uuid, uuid) from public, anon;
grant execute on function public.fms_hr_can_view_requisition(uuid, uuid) to authenticated;

drop policy if exists fms_hr_requisitions_select on public.fms_hr_requisitions;
create policy fms_hr_requisitions_select
  on public.fms_hr_requisitions
  for select
  to authenticated
  using (public.fms_hr_can_view_requisition(id, auth.uid()));

drop policy if exists fms_hr_requisition_platforms_select on public.fms_hr_requisition_platforms;
create policy fms_hr_requisition_platforms_select
  on public.fms_hr_requisition_platforms
  for select
  to authenticated
  using (public.fms_hr_can_view_requisition(requisition_id, auth.uid()));


-- ---------------------------------------------------------------------------
-- D. WHY NEW RECRUITMENT STOPS THERE  —  read this before "finishing the job"
--
-- fms_hr_can_read_requisition IS THE CANDIDATE-PII GATE. It is not a general
-- visibility rule that happens to cover candidates; closing a PII hole is the
-- entire reason it exists (20260712180000: a Sales HOD could read the Purchase
-- team's applicants — names, phones, CVs, salary expectations — because raising
-- a requisition made them a step owner). Widening it would reopen exactly that
-- hole, for a different reason.
--
-- So these EIGHT policies are left alone, and each still asks
-- fms_hr_can_read_requisition:
--     fms_hr_candidates · fms_hr_interviews · fms_hr_candidate_scores
--     fms_hr_onboardings · fms_hr_onboarding_checks
--     fms_hr_probations · fms_hr_probation_reviews · fms_hr_activity
--
-- The consequence is honest and worth stating plainly: a view-only grantee
-- opens New Recruitment, reads the vacancies, and finds the candidate boards
-- EMPTY. That is the correct behaviour under "the operational tier only" — but
-- it is a half-open module, and if a viewer is meant to read candidates too,
-- the answer is NOT to widen this function. It is a masked projection — a view
-- that exposes stage, dates and counts while withholding name, phone, email,
-- CV and expected salary — which is a separate piece of work with its own
-- decision about which columns count as PII.
--
-- The fms-hr-docs storage bucket (CVs) is untouched for the same reason.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- ASSERTIONS — fail rather than silently widen access.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_public int;
  v_leak   int;
begin
  select count(*) into v_public
    from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_supplies_requests','fms_supplies_activity',
                       'fms_exit_cases','fms_exit_activity',
                       'fms_hr_requisitions','fms_hr_requisition_platforms')
     and roles::text like '%public%';
  if v_public > 0 then
    raise exception
      'REFUSING: % policy(ies) on the widened tables are scoped to PUBLIC, not authenticated. anon holds table grants — this would widen access.',
      v_public;
  end if;

  -- The candidate-PII gate must not have acquired a module-viewer arm, however
  -- it got there. This is the assertion that makes section D enforceable rather
  -- than merely documented.
  select count(*) into v_leak
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'fms_hr_can_read_requisition'
     and p.prosrc like '%module_is_viewer%';
  if v_leak > 0 then
    raise exception
      'REFUSING: fms_hr_can_read_requisition has a module_is_viewer arm. That function is the candidate-PII gate (20260712180000) and must not carry one — widen fms_hr_can_view_requisition instead.';
  end if;

  -- The two confidential exit satellites must likewise stay narrow.
  select count(*) into v_leak
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'fms_exit_can_read_settlement'
     and p.prosrc like '%module_is_viewer%';
  if v_leak > 0 then
    raise exception
      'REFUSING: fms_exit_can_read_settlement has a module_is_viewer arm. F&F settlement figures are outside the view-only tier.';
  end if;
end $mig$;


-- ===========================================================================
-- ROLLBACK — the previous definitions, verbatim. To revert, run everything
-- between the markers. module_is_viewer() is deliberately not dropped: other
-- modules' policies reference it, so dropping it turns a revert of one module
-- into an outage in another.
--
-- --8<-- BEGIN ROLLBACK --8<--
--
-- create or replace function public.fms_supplies_can_read_request(p_req uuid, p_uid uuid)
-- returns boolean language sql stable security definer set search_path = public as $fn$
--   select public.is_admin(p_uid)
--       or public.fms_supplies_is_coordinator(p_uid)
--       or public.fms_supplies_is_fulfilment_staff(p_uid)
--       or exists (
--            select 1 from public.fms_supplies_requests r
--            left join public.fms_supplies_departments d on d.id = r.department_id
--             where r.id = p_req
--               and (r.raised_by = p_uid or r.requested_for_user_id = p_uid or d.hod_user_id = p_uid));
-- $fn$;
--
-- drop policy if exists fms_supplies_activity_select on public.fms_supplies_activity;
-- create policy fms_supplies_activity_select on public.fms_supplies_activity
--   for select to authenticated
--   using (public.fms_supplies_is_coordinator(auth.uid())
--       or public.fms_supplies_is_fulfilment_staff(auth.uid())
--       or (entity_type = 'request' and public.fms_supplies_can_read_request(entity_id, auth.uid())));
--
-- create or replace function public.fms_exit_can_read_case(p_case uuid, p_uid uuid)
-- returns boolean language sql stable security definer set search_path = public as $fn$
--   select public.is_admin(p_uid)
--       or public.fms_exit_is_coordinator(p_uid)
--       or public.fms_exit_is_exit_staff(p_uid)
--       or exists (select 1 from public.fms_exit_cases c
--                   where c.id = p_case
--                     and (c.employee_user_id = p_uid or c.raised_by = p_uid
--                       or p_uid = any(c.reporting_manager_ids)))
--       or exists (select 1 from public.fms_exit_clearance_checks k
--                   join public.fms_exit_cases c on c.id = k.case_id
--                  where k.case_id = p_case
--                    and (p_uid = any(k.owner_ids)
--                      or (k.owner_is_reporting_manager and p_uid = any(c.reporting_manager_ids))));
-- $fn$;
--
-- drop policy if exists fms_exit_activity_select on public.fms_exit_activity;
-- create policy fms_exit_activity_select on public.fms_exit_activity
--   for select to authenticated
--   using (public.fms_exit_is_coordinator(auth.uid()) or public.fms_exit_is_exit_staff(auth.uid()));
--
-- drop policy if exists "fms exit docs read" on storage.objects;
-- create policy "fms exit docs read" on storage.objects
--   for select to authenticated
--   using (bucket_id = 'fms-exit-docs'
--      and (public.fms_exit_is_coordinator(auth.uid()) or public.fms_exit_is_exit_staff(auth.uid())));
--
-- drop policy if exists fms_hr_requisitions_select on public.fms_hr_requisitions;
-- create policy fms_hr_requisitions_select on public.fms_hr_requisitions
--   for select to authenticated using (public.fms_hr_can_read_requisition(id, auth.uid()));
--
-- drop policy if exists fms_hr_requisition_platforms_select on public.fms_hr_requisition_platforms;
-- create policy fms_hr_requisition_platforms_select on public.fms_hr_requisition_platforms
--   for select to authenticated using (public.fms_hr_can_read_requisition(requisition_id, auth.uid()));
--
-- --8<-- END ROLLBACK --8<--
-- ===========================================================================
