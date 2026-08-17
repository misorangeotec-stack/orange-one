-- ===========================================================================
-- SUB-DEPARTMENTS — the 38 pairs from HR's employee sheet.
--
-- Source: `Employee_Details - 30-05-2026 (2) (1).xlsx`, tab `Employee_details (2)`,
-- columns "New Department" and "Sub Department". Every row below is read from
-- that sheet verbatim; none is invented.
--
-- ⚠ THE PARENT IS RESOLVED THROUGH `hr_sheet_name`, NOT THROUGH `name`.
--   The equivalence decisions were recorded in 20260904120200 precisely so this
--   migration would not have to re-guess them: HR's "Finance" is the portal's
--   `Accounting & Finance` row, HR's "Human Resource" is `Human Resources`, and
--   HR's "After Sales Service" is `After Sales service`. Matching on `name`
--   would silently drop 13 of the 38.
--
-- ⚠ A SUB-DEPARTMENT UNDER A SWITCHED-OFF DEPARTMENT IS FINE AND DELIBERATE.
--   Ink Manufacturing and M/C Manufacturing are still inactive, so their 11
--   sub-departments are visible in the master but unreachable from the user
--   form — which is exactly the "look before you leap" state that was asked
--   for. Turning the parent on turns its children on with it.
--
-- ⚠ THIS MOVES NOBODY. Not one profile is touched here; the per-user backfill
--   is a separate migration that waits on the remaining name confirmations.
--
-- Idempotent: guarded on (department, name), so the one row already created by
-- hand (Administration -> Executive Assistant) is left alone.
--
-- Reversal:
--   delete from public.sub_departments where not exists (
--     select 1 from public.profiles p where p.sub_department_id = sub_departments.id);
-- ===========================================================================

insert into public.sub_departments (department_id, name, sort_order)
select d.id, v.sub_name, v.ord
from (values
  -- Administration
  ('Administration',      'Administration',                                    10),
  ('Administration',      'Executive Assistant',                               20),
  ('Administration',      'Facility',                                          30),
  -- After Sales Service  (portal row: "After Sales service")
  ('After Sales Service', 'After Sales Service - Application',                 10),
  ('After Sales Service', 'After Sales Service - CRM',                         20),
  ('After Sales Service', 'After Sales Service - Design',                      30),
  ('After Sales Service', 'After Sales Service - Service',                     40),
  ('After Sales Service', 'After Sales Service - Technical Excellence (L&D)',  50),
  -- Finance  (portal row: "Accounting & Finance")
  ('Finance',             'Finance and Accounts',                              10),
  ('Finance',             'Finance and Accounts - Accounts',                   20),
  ('Finance',             'Finance and Accounts - Collection',                 30),
  ('Finance',             'Finance and Accounts - EXIM',                       40),
  ('Finance',             'Finance and Accounts - MIS',                        50),
  -- Human Resource  (portal row: "Human Resources")
  ('Human Resource',      'Human Resource',                                    10),
  ('Human Resource',      'Human Resource and Admin',                          20),
  ('Human Resource',      'Human Resource and Travel Desk',                    30),
  -- Ink Manufacturing  (parent still switched off)
  ('Ink Manufacturing',   'FG Packing and Dispatch',                           10),
  ('Ink Manufacturing',   'Production',                                        20),
  ('Ink Manufacturing',   'Quality Lab',                                       30),
  ('Ink Manufacturing',   'R&D and Production',                                40),
  ('Ink Manufacturing',   'RM Store',                                          50),
  -- M/C Manufacturing  (parent still switched off)
  ('M/C Manufacturing',   'Assembly',                                          10),
  ('M/C Manufacturing',   'Assembly and Testing',                              20),
  ('M/C Manufacturing',   'Design',                                            30),
  ('M/C Manufacturing',   'Electrical and Control Servo',                      40),
  ('M/C Manufacturing',   'R&D and Design and Production',                     50),
  ('M/C Manufacturing',   'Store',                                             60),
  -- Management / Marketing
  ('Management',          'Management',                                        10),
  ('Marketing',           'Marketing',                                         10),
  -- Sales
  ('Sales',               'Business Development',                              10),
  ('Sales',               'Sales - Ink',                                       20),
  ('Sales',               'Sales - Machine - Label & Publication',             30),
  ('Sales',               'Sales - Machine - Textile',                         40),
  -- Supply Chain
  ('Supply Chain',        'Ink - M/C Warehouse',                               10),
  ('Supply Chain',        'Ink Warehouse',                                     20),
  ('Supply Chain',        'Procurement',                                       30),
  ('Supply Chain',        'Spare - Print Head Warehouse',                      40),
  ('Supply Chain',        'Spare Warehouse',                                   50)
) as v(hr_dept, sub_name, ord)
join public.departments d
  on coalesce(d.hr_sheet_name, d.name) = v.hr_dept
where not exists (
  select 1 from public.sub_departments s
   where s.department_id = d.id and lower(s.name) = lower(v.sub_name)
);

do $check$
declare
  n_total   integer;
  n_parents integer;
  n_moved   integer;
begin
  select count(*) into n_total from public.sub_departments;
  if n_total <> 38 then
    raise exception 'expected 38 sub-departments, found % — a parent probably failed to resolve', n_total;
  end if;

  -- All 10 HR departments must have picked up children.
  select count(distinct department_id) into n_parents from public.sub_departments;
  if n_parents <> 10 then
    raise exception 'expected 10 parent departments, found %', n_parents;
  end if;

  -- Nobody was moved by this migration.
  select count(*) into n_moved from public.profiles where sub_department_id is not null;
  if n_moved <> 0 then
    raise exception 'this migration must not assign anyone a sub-department, found %', n_moved;
  end if;
end
$check$;
