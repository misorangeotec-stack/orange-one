-- Ritesh review-list tasks -> tick the company checklist for ALL 7 companies.
--
-- The Ritesh delegation/review list (load_ritesh_tasks.py) was loaded with NO
-- location checklist, so its tasks show no company selection in the UI. This
-- backfills every company onto those templates AND onto their already-generated
-- open task instances.
--
-- Target set = recurring templates created_by Ritesh that currently have NO
-- location links. Every team task already has locations, so this hits exactly
-- the 42 Ritesh-review templates (34 -> Ritesh, 5 -> Dimple, 3 -> Bushra) and
-- nothing else.
--
-- "All companies" = the 7 active non-General locations (the special "General"
-- entry is intentionally excluded).
--
-- Additive + idempotent: ON CONFLICT DO NOTHING, and the "no locations yet"
-- selector makes a re-run a no-op. Safe to re-apply.
--
--   psql "$SUPABASE_DB_URL" -f db/seed/ritesh_tasks_all_companies.sql

begin;

with companies(loc) as (
  values
    ('01c1f41e-50fa-459f-b21b-f098fdf204b0'::uuid),  -- O-Tec Surat
    ('1c9c6c9f-6fa2-450b-b883-64fbfe9cd882'::uuid),  -- O-Tec Noida
    ('2943b5b6-a1d9-4afc-a38b-381425d1dd6c'::uuid),  -- Enterprise Surat
    ('521b79c0-80df-480d-a130-7d946b7683ae'::uuid),  -- Enterprise Noida
    ('e98c2cf0-ca28-446e-8633-f99291f3d058'::uuid),  -- Ink Jet
    ('940fa09a-6472-4249-b17e-d47818159a06'::uuid),  -- Colorix
    ('d7c30d44-997f-4eb4-bce6-35339ad0f86d'::uuid)   -- Personal Accounts
),
-- Ritesh-review templates: created_by Ritesh, no location links yet.
ritesh_tpl as (
  select rt.id
  from public.recurring_tasks rt
  left join public.recurring_task_locations rl on rl.recurring_task_id = rt.id
  where rt.created_by = '79174071-1f03-46dd-bdf7-a6a7d3699877'
    and rl.recurring_task_id is null
),
-- 1) attach all 7 companies to each template (future instances inherit them).
ins_tpl as (
  insert into public.recurring_task_locations (recurring_task_id, location_id)
  select t.id, c.loc
  from ritesh_tpl t cross join companies c
  on conflict (recurring_task_id, location_id) do nothing
  returning recurring_task_id
)
-- 2) retrofit the same checklist onto already-generated OPEN instances so the
--    company selection appears now (leave completed / N/A tasks untouched).
insert into public.task_locations (task_id, location_id)
select tk.id, c.loc
from public.tasks tk
join ritesh_tpl rt on rt.id = tk.recurring_task_id
cross join companies c
where tk.status <> 'completed'
  and tk.not_applicable is not true
on conflict (task_id, location_id) do nothing;

commit;
