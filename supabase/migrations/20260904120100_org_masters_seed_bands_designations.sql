-- ===========================================================================
-- SEED — the 9 bands, and the canonical designation ladder.
--
-- Split deliberately from the DEPARTMENT seed. Bands come verbatim from the
-- band categorisation sheet and designations are a de-duplication of HR's own
-- list, so neither asks anyone to make a judgement call. Departments do: the
-- portal's `Accounting & Finance` and HR's `Finance` are the same team under
-- two names, and deciding that is not this migration's business. That seed
-- lands separately, once the equivalence table has been signed off.
--
-- Idempotent: every insert is guarded, so re-running changes nothing.
--
-- ⚠ THE SIX PRE-EXISTING DESIGNATION ROWS ARE LEFT ACTIVE AND UNTOUCHED
--   (`Purchase Manager`, `Purchase Executive`, `ERP Executive`,
--   `Accounts Executive`, `Accounts Manager`, `Store / Gate Keeper`). They are
--   functional titles rather than rungs on this ladder, one of them is in use
--   on a live profile, and all of them are FK targets for
--   `fms_*_step_owners.designation_id`. Whether to retire them in favour of the
--   ladder is a question for HR, not a side effect of seeding.
--
-- Reversal:
--   delete from public.bands;                       -- only if no profile references one
--   delete from public.designations where sort_order between 10 and 270;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- bands — from `bAND cATEGORIZATION.jpeg`. `description` holds that sheet's
-- example designations as guidance; it constrains nothing.
-- ---------------------------------------------------------------------------
insert into public.bands (band_no, name, description, sort_order)
select v.band_no, v.name, v.description, v.band_no * 10
from (values
  (1, 'Support Staff',          'Office Boy, Pantry Staff, Driver, Housekeeping, Helper'),
  (2, 'Administrative Support', 'Receptionist, Office Assistant, Coordinator, Store Assistant, Data Entry Operator'),
  (3, 'Executive Level',        'HR Executive, Accounts Executive, Sales Executive, Purchase Executive, Service Engineer'),
  (4, 'Senior Executive Level', 'Sr. HR Executive, Sr. Accounts Executive, Sr. Engineer, Sr. Coordinator'),
  (5, 'Team Lead / Supervisor', 'Team Leader, Supervisor, Shift Incharge'),
  (6, 'Management',             'Assistant Manager, Deputy Manager, Manager'),
  (7, 'Senior Management',      'Sr. Manager, AGM, DGM, Regional Manager'),
  (8, 'Leadership',             'GM, AVP, VP, Business Head'),
  (9, 'Top Leadership',         'CEO, COO, CFO, CHRO, Director, Managing Director')
) as v(band_no, name, description)
where not exists (select 1 from public.bands b where b.band_no = v.band_no);

-- ---------------------------------------------------------------------------
-- designations — HR's 32 sheet values de-duplicated to one row per rank.
--
-- `sort_order` is the ladder, low to high, so the picker reads in seniority
-- order instead of alphabetically. It carries NO band meaning: band is chosen
-- per user and nothing here constrains it.
--
-- The variants each canonical row absorbs (`Ass. Manager` -> Assistant Manager,
-- `DGM`/`Deputy GM` -> Deputy General Manager, `Sr. Manager` -> Senior Manager,
-- and so on) are applied to live profiles by the backfill migration, not here.
-- HR's `-` and `HOD` values are deliberately NOT seeded: `-` is a blank and
-- `HOD` is a role, not a designation.
-- ---------------------------------------------------------------------------
insert into public.designations (name, sort_order)
select v.name, v.sort_order
from (values
  ('Office Assistant',            10),
  ('Operator',                    20),
  ('Junior',                      30),
  ('Junior Chemist',              40),
  ('Executive',                   50),
  ('Designer',                    60),
  ('Service Engineer',            70),
  ('Application Engineer',        80),
  ('Executive Assistant',         90),
  ('Senior Executive',           100),
  ('Senior Engineer',            110),
  ('Senior Service Engineer',    120),
  ('Senior Application Engineer',130),
  ('Assistant Manager',          140),
  ('Deputy Manager',             150),
  ('Manager',                    160),
  ('Application Manager',        170),
  ('Senior Manager',             180),
  ('Senior Service Manager',     190),
  ('Senior Application Manager', 200),
  ('Assistant General Manager',  210),
  ('Deputy General Manager',     220),
  ('General Manager',            230),
  ('Plant Head',                 240),
  ('Chief Financial Officer',    250),
  ('President',                  260),
  ('Director',                   270)
) as v(name, sort_order)
where not exists (
  select 1 from public.designations d where lower(d.name) = lower(v.name)
);

-- ---------------------------------------------------------------------------
-- Self-assertions.
-- ---------------------------------------------------------------------------
do $check$
declare
  n_bands   integer;
  n_desig   integer;
  n_legacy  integer;
begin
  select count(*) into n_bands from public.bands;
  if n_bands <> 9 then
    raise exception 'expected 9 bands, found %', n_bands;
  end if;

  select count(*) into n_desig from public.designations where sort_order between 10 and 270;
  if n_desig <> 27 then
    raise exception 'expected 27 ladder designations, found %', n_desig;
  end if;

  -- The six pre-existing rows must still be here and still active.
  select count(*) into n_legacy
    from public.designations
   where name in ('Purchase Manager', 'Purchase Executive', 'ERP Executive',
                  'Accounts Executive', 'Accounts Manager', 'Store / Gate Keeper')
     and active;
  if n_legacy <> 6 then
    raise exception 'the 6 pre-existing designations must survive untouched and active, found %', n_legacy;
  end if;
end
$check$;
