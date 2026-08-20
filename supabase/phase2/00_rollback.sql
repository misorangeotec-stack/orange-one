-- ===========================================================================
-- PHASE 2 ROLLBACK — put Order to Dispatch back on its own company and
-- location tables.
--
-- Written BEFORE the cutover and REHEARSED against live data before the
-- cutover was allowed to run for real: cutover -> rollback -> abort, in one
-- transaction, asserting every count came back to baseline. Phase 1 taught
-- that the hard way - its rollback was written carefully, read carefully, and
-- could not run at all. Reading a rollback proves nothing.
--
-- Installed as a function for the same reason the cutover is: the rehearsal
-- and the real undo must be the same code, not two typings of it.
--
--     rehearsal  begin;
--                select private.phase2_cutover();
--                select private.phase2_rollback();
--                rollback;
--     real       select private.phase2_rollback();
--
-- ⚠ ORDER MATTERS, AND THE TRAP IS THE OPPOSITE OF PHASE 1'S.
--   Phase 1's trap was a UNIQUE index. This one is the FOREIGN KEYS. After the
--   cutover, fms_dispatch_orders.company_id holds central ids. Restoring the
--   old Dispatch ids while a constraint pointing at either table is in place
--   fails on every row. So: DROP the five, restore the values, then ADD them
--   back pointing at the legacy tables. The cutover carries the mirror image
--   of this note - and it was the dry run, not the review, that found it.
--
-- WHAT IT DOES NOT UNDO, DELIBERATELY
--   The three mapping tables themselves and the mst_locations column
--   relaxation. Those came from migration 20260919120000, not from the
--   cutover, and they are additive - empty tables sitting unread cost nothing.
--   This file empties them; dropping them is a separate decision.
--
--   It also leaves the private.phase2_* snapshots in place, so the cutover's
--   own "refuse to re-run" guard still fires afterwards. Re-running the
--   cutover after a rollback is a considered act: drop those tables first.
-- ===========================================================================

create or replace function private.phase2_rollback()
returns text
language plpgsql
set search_path to 'public'
as $phase2r$
declare
  v_orders int; v_rounds int; v_owners int; v_fn int := 0;
  r record;
begin
  if to_regclass('private.phase2_orders_before') is null
     or to_regclass('private.phase2_functions_before') is null then
    raise exception 'ROLLBACK ABORTED: snapshot tables missing - the cutover never ran, or they were dropped';
  end if;

  select count(*) into v_orders from public.fms_dispatch_orders;
  select count(*) into v_rounds from public.fms_dispatch_rounds;

  -- 1. DROP the five constraints. Not "repoint" - the rows still hold central
  --    ids at this instant and would fail validation against either table.
  alter table public.fms_dispatch_orders      drop constraint if exists fms_dispatch_orders_company_id_fkey;
  alter table public.fms_dispatch_orders      drop constraint if exists fms_dispatch_orders_location_id_fkey;
  alter table public.fms_dispatch_rounds      drop constraint if exists fms_dispatch_rounds_company_id_fkey;
  alter table public.fms_dispatch_rounds      drop constraint if exists fms_dispatch_rounds_location_id_fkey;
  alter table public.fms_dispatch_step_owners drop constraint if exists fms_dispatch_step_owners_location_id_fkey;

  -- 2. the values back
  update public.fms_dispatch_orders o
     set company_id = b.company_id, location_id = b.location_id
    from private.phase2_orders_before b
   where b.order_id = o.id
     and (o.company_id is distinct from b.company_id
       or o.location_id is distinct from b.location_id);

  update public.fms_dispatch_rounds rr
     set company_id = b.company_id, location_id = b.location_id
    from private.phase2_rounds_before b
   where b.round_id = rr.id
     and (rr.company_id is distinct from b.company_id
       or rr.location_id is distinct from b.location_id);

  -- 3. the owner rows back, including the department labels the merge unioned.
  --    Survivors are moved by id first, so the re-inserted rows do not collide
  --    with them on the unique (step_key, location_id).
  update public.fms_dispatch_step_owners so
     set location_id    = b.location_id,
         employee_ids   = b.employee_ids,
         designation_id = b.designation_id,
         department_ids = b.department_ids
    from private.phase2_step_owners_before b
   where b.id = so.id;

  insert into public.fms_dispatch_step_owners
        (id, step_key, location_id, employee_ids, designation_id, department_ids,
         created_at, updated_at)
  select b.id, b.step_key, b.location_id, b.employee_ids, b.designation_id, b.department_ids,
         b.created_at, b.updated_at
    from private.phase2_step_owners_before b
   where not exists (select 1 from public.fms_dispatch_step_owners so where so.id = b.id);

  -- 4. constraints back, pointing at the legacy tables, ON DELETE spelled out
  alter table public.fms_dispatch_orders
    add constraint fms_dispatch_orders_company_id_fkey
    foreign key (company_id) references public.fms_dispatch_companies(id) on delete restrict;
  alter table public.fms_dispatch_orders
    add constraint fms_dispatch_orders_location_id_fkey
    foreign key (location_id) references public.fms_dispatch_company_locations(id) on delete restrict;
  alter table public.fms_dispatch_rounds
    add constraint fms_dispatch_rounds_company_id_fkey
    foreign key (company_id) references public.fms_dispatch_companies(id) on delete restrict;
  alter table public.fms_dispatch_rounds
    add constraint fms_dispatch_rounds_location_id_fkey
    foreign key (location_id) references public.fms_dispatch_company_locations(id) on delete restrict;
  alter table public.fms_dispatch_step_owners
    add constraint fms_dispatch_step_owners_location_id_fkey
    foreign key (location_id) references public.fms_dispatch_company_locations(id) on delete cascade;

  -- 5. un-seed. Pairs before sites: mst_company_locations RESTRICTs on sites.
  delete from public.mst_company_locations cl
   where exists (select 1 from private.phase2_seeded_company_locations s where s.id = cl.id);
  delete from public.mst_party_companies pc
   where exists (select 1 from private.phase2_seeded_party_companies s where s.id = pc.id);
  delete from public.mst_item_companies ic
   where exists (select 1 from private.phase2_seeded_item_companies s where s.id = ic.id);
  delete from public.mst_locations l
   where exists (select 1 from private.phase2_seeded_locations s where s.id = l.id);

  -- 6. the gate-pass prefixes this cutover wrote, and only where they are still
  --    what it wrote: a human who has since corrected one keeps the correction.
  update public.mst_companies c
     set gate_pass_prefix = b.gate_pass_prefix_before
    from private.phase2_company_prefix_before b
   where b.company_id = c.id
     and c.gate_pass_prefix is distinct from b.gate_pass_prefix_before
     and c.gate_pass_prefix = b.gate_pass_prefix_after;

  -- 7. the function bodies back
  for r in select proname, definition from private.phase2_functions_before loop
    execute r.definition;
    v_fn := v_fn + 1;
  end loop;

  -- 8. prove it
  if exists (select 1 from public.fms_dispatch_orders o
              join private.phase2_orders_before b on b.order_id = o.id
             where o.company_id is distinct from b.company_id
                or o.location_id is distinct from b.location_id) then
    raise exception 'ROLLBACK FAILED: an order did not return to its snapshot values';
  end if;
  if exists (select 1 from public.fms_dispatch_rounds rr
              join private.phase2_rounds_before b on b.round_id = rr.id
             where rr.company_id is distinct from b.company_id
                or rr.location_id is distinct from b.location_id) then
    raise exception 'ROLLBACK FAILED: a dispatch did not return to its snapshot values';
  end if;

  select count(*) into v_owners from public.fms_dispatch_step_owners;
  if v_owners <> (select count(*) from private.phase2_step_owners_before) then
    raise exception 'ROLLBACK FAILED: step owners are % rows, snapshot has %',
      v_owners, (select count(*) from private.phase2_step_owners_before);
  end if;
  if exists (select 1 from public.fms_dispatch_step_owners so
              join private.phase2_step_owners_before b on b.id = so.id
             where so.location_id    is distinct from b.location_id
                or so.employee_ids   is distinct from b.employee_ids
                or so.designation_id is distinct from b.designation_id
                or so.department_ids is distinct from b.department_ids) then
    raise exception 'ROLLBACK FAILED: a step owner row does not match the snapshot';
  end if;

  if (select count(*) from public.fms_dispatch_orders) <> v_orders
     or (select count(*) from public.fms_dispatch_rounds) <> v_rounds then
    raise exception 'ROLLBACK FAILED: an order or dispatch count changed during the rollback';
  end if;

  if exists (
    select 1 from pg_constraint con
     where con.contype = 'f'
       and con.conrelid in ('public.fms_dispatch_orders'::regclass,
                            'public.fms_dispatch_rounds'::regclass,
                            'public.fms_dispatch_step_owners'::regclass)
       and con.confrelid in ('public.mst_companies'::regclass,
                             'public.mst_locations'::regclass)) then
    raise exception 'ROLLBACK FAILED: a foreign key still points at the central masters';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (select proname from private.phase2_functions_before)
       and pg_get_functiondef(p.oid) ilike '%mst\_company\_locations%') then
    raise exception 'ROLLBACK FAILED: a restored function still reads the central site mapping';
  end if;

  if (select count(*) from public.mst_locations) <> 0 then
    raise exception 'ROLLBACK FAILED: mst_locations still holds % row(s)',
      (select count(*) from public.mst_locations);
  end if;

  return format(
    'PHASE 2 ROLLBACK OK: %s orders, %s dispatches, %s owner rows, %s functions restored',
    v_orders, v_rounds, v_owners, v_fn);
end
$phase2r$;
