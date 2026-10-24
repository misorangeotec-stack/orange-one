-- NR-14 — stop telling people about work they cannot do.
--
-- fms_hr_can_act() is `module_can_edit(uid,'hr-recruitment') AND can_act__ungated(…)`.
-- A step owner named in Setup who holds the module at VIEW-ONLY therefore fails
-- every authorization check, yet fms_hr_step_owner_ids() returned them anyway — so
-- they were notified about work the app then refused to let them touch.
--
-- Live example: DHARMISHTHA PRAJAPATI is an owner of the `onboarding` step and was
-- notified of a concern raised on 22-09-2026, while fms_hr_can_act('onboarding', …)
-- returns false for her.
--
-- All eleven callers of this function use it for ONE thing: the recipient list of a
-- notification or an announcement. fms_hr_can_act() is NOT among them, so filtering
-- here changes who is TOLD and can change nobody's permissions.
--
-- ⚠ The filter is `module_can_edit`, not `fms_hr_can_act`, and it has to be: this
-- function is given a step key and no requisition, so the per-requisition half of
-- the rule cannot be evaluated here. That is the correct granularity anyway — it
-- removes exactly the people who fail the gate for EVERY requisition.
--
-- ⚠ It does not touch hiring managers, the joiner, or anyone notified by id rather
-- than by step ownership. Those arrive through other arms of the same calls.

create or replace function public.fms_hr_step_owner_ids(p_step text)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (
      select array_agg(u)
        from unnest(
          coalesce(
            (select o.employee_ids from public.fms_hr_step_owners o where o.step_key = p_step),
            '{}'::uuid[]
          )
        ) as u
       where public.module_can_edit(u, 'hr-recruitment')
    ),
    '{}'::uuid[]
  );
$function$;

comment on function public.fms_hr_step_owner_ids(text) is
  'NR-14 — the step''s owners from Setup, minus anyone who holds New Recruitment at view-only. Used only for notification recipients; fms_hr_can_act() does not read it.';
