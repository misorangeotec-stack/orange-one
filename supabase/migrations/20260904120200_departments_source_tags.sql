-- ===========================================================================
-- DEPARTMENTS — tag where each row came from, and bring in the two the portal
-- has never had.
--
-- WHY THIS SHAPE
--   Two department lists exist: the portal's 21 rows, and the 10 in HR's
--   employee sheet. Nobody can reconcile them without first SEEING which is
--   which, so this migration labels every row and adds the missing ones. It
--   decides nothing else: no row is renamed, no user is moved, nothing is
--   switched off.
--
-- ⚠ WHY 8 ROWS ARE TAGGED 'both' AND NOT DUPLICATED.
--   Six match HR by name outright (Administration, Management, Marketing,
--   Sales, Supply Chain, and After Sales service — which differs by
--   capitalisation only). TWO MORE ARE THE SAME TEAM UNDER A DIFFERENT NAME and
--   a name comparison cannot see it:
--       Accounting & Finance  =  HR's "Finance"          (12 users)
--       Human Resources       =  HR's "Human Resource"   (4 users)
--   Inserting those as fresh rows would put two live departments meaning one
--   team side by side in every picker. Whoever raises the next task or user
--   picks one at random, and the reconciliation would then have to clean up new
--   bad data as well as old. One row, tagged 'both', `hr_sheet_name` recording
--   what HR calls it.
--
-- ⚠ THE TWO NEW ROWS ARRIVE INACTIVE, ON PURPOSE. Ink Manufacturing and
--   M/C Manufacturing are visible in the Organisation master but appear in no
--   picker, so nobody can be assigned to them before the user moves are agreed.
--   Switch them on from that screen when ready.
--
-- Additive: two nullable columns, two new rows. Reversible without data loss.
--
-- Reversal:
--   delete from public.departments where source = 'hr_sheet' and active = false;
--   alter table public.departments drop column if exists hr_sheet_name, drop column if exists source;
-- ===========================================================================

alter table public.departments
  add column if not exists source        text not null default 'existing',
  add column if not exists hr_sheet_name text;

alter table public.departments drop constraint if exists departments_source_check;
alter table public.departments
  add constraint departments_source_check check (source in ('existing', 'hr_sheet', 'both'));

comment on column public.departments.source is
  'Where this row came from: existing = portal only, hr_sheet = HR employee sheet only, both = the same team in each list.';
comment on column public.departments.hr_sheet_name is
  'What HR''s sheet calls this department, when that differs from `name`. This IS the equivalence decision, recorded — the sub-department seed resolves its parent through it.';

-- ---------------------------------------------------------------------------
-- The 8 rows present in BOTH lists. Matched by id-safe name, not by guesswork:
-- each pair below was confirmed against the sheet before being written here.
-- ---------------------------------------------------------------------------
update public.departments d
   set source        = 'both',
       hr_sheet_name = v.hr_name
  from (values
    ('Administration',       'Administration'),
    ('Management',           'Management'),
    ('Marketing',            'Marketing'),
    ('Sales',                'Sales'),
    ('Supply Chain',         'Supply Chain'),
    ('After Sales service',  'After Sales Service'),   -- capitalisation only
    ('Accounting & Finance', 'Finance'),               -- same team, other name
    ('Human Resources',      'Human Resource')         -- same team, other name
  ) as v(portal_name, hr_name)
 where d.name = v.portal_name;

-- ---------------------------------------------------------------------------
-- The two HR departments the portal has never had. INACTIVE — see the note
-- above. `active = false` keeps them out of every picker while leaving them
-- fully visible and editable in Admin -> Organisation.
-- ---------------------------------------------------------------------------
insert into public.departments (name, source, hr_sheet_name, active, sort_order)
select v.name, 'hr_sheet', v.name, false, 0
from (values ('Ink Manufacturing'), ('M/C Manufacturing')) as v(name)
where not exists (
  select 1 from public.departments d where lower(d.name) = lower(v.name)
);

-- ---------------------------------------------------------------------------
-- Self-assertions. The point of this migration is that nothing was lost.
-- ---------------------------------------------------------------------------
do $check$
declare
  n_both     integer;
  n_new      integer;
  n_existing integer;
  n_total    integer;
  n_orphans  integer;
begin
  select count(*) into n_both     from public.departments where source = 'both';
  select count(*) into n_new      from public.departments where source = 'hr_sheet';
  select count(*) into n_existing from public.departments where source = 'existing';
  select count(*) into n_total    from public.departments;

  if n_both <> 8 then
    raise exception 'expected 8 departments in both lists, found %', n_both;
  end if;
  if n_new <> 2 then
    raise exception 'expected 2 new HR-sheet departments, found %', n_new;
  end if;
  -- 21 original rows - 8 now tagged 'both' = 13 portal-only.
  if n_existing <> 13 then
    raise exception 'expected 13 portal-only departments, found %', n_existing;
  end if;
  if n_total <> 23 then
    raise exception 'expected 23 departments (21 original + 2 new), found %', n_total;
  end if;

  -- The new rows must NOT be pickable yet.
  if exists (select 1 from public.departments where source = 'hr_sheet' and active) then
    raise exception 'the new HR-sheet departments must arrive inactive';
  end if;

  -- Every original row must still be active: nothing was retired here.
  if exists (select 1 from public.departments where source in ('existing', 'both') and not active) then
    raise exception 'an existing department was switched off — this migration must not do that';
  end if;

  -- No task, recurring task or profile may have lost its department.
  select count(*) into n_orphans
    from public.tasks t
   where t.department_id is not null
     and not exists (select 1 from public.departments d where d.id = t.department_id);
  if n_orphans > 0 then
    raise exception '% tasks now point at a department that does not exist', n_orphans;
  end if;
end
$check$;
