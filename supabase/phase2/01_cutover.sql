-- ===========================================================================
-- PHASE 2 CUTOVER — Order to Dispatch moves onto the central company and the
-- central dispatch location, and gains the three lists that let a sales order
-- narrow down.
--
-- Installed as a FUNCTION rather than run as a script, for the reason Phase 1
-- found: dry run, rehearsal and the real run must execute byte-identical code.
-- A script retyped into a client three times is three slightly different
-- scripts. So:
--
--     dry run   begin; select private.phase2_cutover(); rollback;
--     rehearsal begin; select private.phase2_cutover();
--                      <run 00_rollback.sql>; rollback;
--     real      select private.phase2_cutover();
--
-- WHAT MOVES
--   fms_dispatch_companies (2 rows)          -> mst_companies (5 Tally books)
--   fms_dispatch_company_locations (6 rows)  -> mst_locations (3 real sites)
--                                             + mst_company_locations (6 pairs)
--   and 303 orders, 165 dispatches and 28 step-owner rows are repointed.
--
-- WHY THE LOCATION COUNT FALLS FROM 6 TO 3
--   Dispatch stored each site once per company: NOIDA, SURAT-HOJIWALA and
--   SURAT-SACHIN, twice over. Measured before deciding: all 14 (step, site)
--   owner pairs carry IDENTICAL people for both companies, so the company half
--   of that key has never distinguished anything. The site is the physical
--   place; which companies dispatch from it is mst_company_locations.
--
-- THE ID TRICK, AND ITS LIMIT
--   Each surviving site KEEPS the id of the legacy row most orders already
--   point at, so most rows need no rewrite at all and the foreign key validates
--   instantly. The company cannot do the same - 2 Dispatch ids must become 5
--   central ones - so company_id IS rewritten on every order and dispatch.
--   Deterministic: company name -> alias, site name -> Noida/Surat, and the
--   pair identifies exactly one Tally book.
--
-- WHAT IT DOES NOT TOUCH, DELIBERATELY
--   fms_dispatch_customers.company_id and fms_dispatch_company_locations.
--   company_id keep pointing at fms_dispatch_companies. Those tables are the
--   rollback, and repointing a rollback snapshot at the live masters is how you
--   lose it - the D4 lesson from Phase 1.
-- ===========================================================================

create or replace function private.phase2_cutover()
returns text
language plpgsql
set search_path to 'public'
as $phase2$
declare
  v_orders_before  int;
  v_rounds_before  int;
  v_lines_before   int;
  v_owners_before  int;
  v_sites          int;
  v_pairs          int;
  v_party_co       int;
  v_item_co        int;
  v_owners_dropped int;
  v_def            text;
  v_new            text;
  v_hits           int;
  r                record;
begin
  -- Fail fast rather than stall the app if a query is mid-flight.
  set local lock_timeout = '3s';

  -- =================================================== 0. refuse to re-run ==
  if to_regclass('private.phase2_orders_before') is not null then
    raise exception 'ABORT: private.phase2_orders_before already exists - the cutover has already run';
  end if;
  if (select count(*) from public.mst_locations) <> 0 then
    raise exception 'ABORT: mst_locations already holds % row(s); this cutover expects it empty',
      (select count(*) from public.mst_locations);
  end if;
  if to_regclass('public.mst_company_locations') is null
     or to_regclass('public.mst_party_companies') is null
     or to_regclass('public.mst_item_companies') is null then
    raise exception 'ABORT: run migration 20260919120000_add_company_scoped_masters.sql first';
  end if;
  --    The seeded-id snapshots below record "everything in these tables", which
  --    is only the same thing as "everything this cutover added" while they
  --    start empty. Asserted rather than assumed - otherwise a rollback would
  --    delete somebody else's rows.
  if (select count(*) from public.mst_company_locations)
   + (select count(*) from public.mst_party_companies)
   + (select count(*) from public.mst_item_companies) <> 0 then
    raise exception 'ABORT: the company-scoped mapping tables are not empty; this cutover seeds them';
  end if;

  select count(*) into v_orders_before from public.fms_dispatch_orders;
  select count(*) into v_rounds_before from public.fms_dispatch_rounds;
  select count(*) into v_lines_before  from public.fms_dispatch_order_items;
  select count(*) into v_owners_before from public.fms_dispatch_step_owners;

  -- ================================================= 1. the two id maps ====
  --
  -- ⚠ BUILT AND ASSERTED BEFORE ANYTHING IS WRITTEN. Every later step reads
  --   these; a gap here would be a silently mis-billed order, not an error.

  -- (legacy company, region) -> Tally book.
  create table private.phase2_company_map as
  select fc.id                                as legacy_company_id,
         reg.region                           as region,
         mc.id                                as book_company_id,
         coalesce(mc.alias, mc.name)          as book_label
    from public.fms_dispatch_companies fc
    cross join (values ('Noida'), ('Surat')) as reg(region)
    join public.mst_companies mc
      on mc.alias = case when fc.name ilike '%enterprise%' then 'Enterprise' else 'O-tec' end
     and mc.location = reg.region;

  if (select count(*) from private.phase2_company_map)
     <> (select count(*) from public.fms_dispatch_companies) * 2 then
    raise exception
      'ABORT: company map has % rows, expected % (one per company per region) - an alias did not match',
      (select count(*) from private.phase2_company_map),
      (select count(*) from public.fms_dispatch_companies) * 2;
  end if;

  -- legacy location -> the site row that survives, and the region it sits in.
  create table private.phase2_location_map as
  with ranked as (
    select l.id, l.name, l.active, l.sort_order,
           case when upper(l.name) like '%NOIDA%' then 'Noida' else 'Surat' end as region,
           row_number() over (
             partition by l.name
             order by (select count(*) from public.fms_dispatch_orders o where o.location_id = l.id) desc,
                      l.id
           ) as rn
      from public.fms_dispatch_company_locations l
  )
  -- ⚠ ALIASES ARE lr/ls, NOT r/s. `r` is a declared record variable in this
  --   function, and plpgsql resolves the name to the variable before the query
  --   alias - "record r is not assigned yet", raised from a query that looks
  --   entirely self-contained. Found by the dry run, which is the point of it.
  select lr.id         as legacy_location_id,
         ls.id         as survivor_location_id,
         lr.name       as site_name,
         lr.region     as region,
         ls.active     as survivor_active,
         ls.sort_order as survivor_sort_order,
         (lr.id = ls.id) as survives
    from ranked lr
    join ranked ls on ls.name = lr.name and ls.rn = 1;

  if (select count(*) from private.phase2_location_map)
     <> (select count(*) from public.fms_dispatch_company_locations) then
    raise exception 'ABORT: location map is incomplete';
  end if;

  -- ================================================= 2. the pre-flight ====
  --
  -- Every one of these is a thing that would be silently wrong afterwards.

  -- 2a. every order and dispatch already agrees with itself: the location it
  --     names really is a location of the company it names. If this were ever
  --     false the rewrite would move it to a book it never traded under.
  if exists (
    select 1 from public.fms_dispatch_orders o
      join public.fms_dispatch_company_locations l on l.id = o.location_id
     where l.company_id is distinct from o.company_id) then
    raise exception 'ABORT: an order names a location belonging to a different company';
  end if;
  if exists (
    select 1 from public.fms_dispatch_rounds rr
      join public.fms_dispatch_company_locations l on l.id = rr.location_id
     where l.company_id is distinct from rr.company_id) then
    raise exception 'ABORT: a dispatch names a location belonging to a different company';
  end if;

  -- 2b. the step-owner rows about to be merged are genuinely identical.
  --     Measured as true today; asserted because merging two DIFFERENT owner
  --     sets would quietly widen or narrow who can act on a queue.
  if exists (
    select 1
      from public.fms_dispatch_step_owners so
      join private.phase2_location_map m on m.legacy_location_id = so.location_id
      join public.fms_dispatch_step_owners keep
        on keep.step_key = so.step_key and keep.location_id = m.survivor_location_id
     where not m.survives
       and ((select array_agg(x order by x) from unnest(so.employee_ids) x)
              is distinct from
            (select array_agg(x order by x) from unnest(keep.employee_ids) x)
         or so.designation_id is distinct from keep.designation_id)) then
    raise exception
      'ABORT: two step-owner rows for the same site carry different people - merging would change who can act';
  end if;
  -- ⚠ ARRAYS ARE COMPARED AS SETS, NOT AS ARRAYS. Three of the four pairs that
  --   first tripped this check held the SAME ids in a different order, which
  --   `is distinct from` reports as different. Only one pair really differed.
  --
  --   department_ids is deliberately NOT in the test above. It is a LABEL, not
  --   a gate: the stepper prints the department names beside a step, while who
  --   may act is employee_ids alone - canActOn in the store, and no server
  --   function reads departments at all. So the two are unioned below rather
  --   than being allowed to block the cutover, and every union is recorded.

  -- ==================================================== 3. the snapshots ===
  create table private.phase2_orders_before as
    select id as order_id, company_id, location_id from public.fms_dispatch_orders;
  create table private.phase2_rounds_before as
    select id as round_id, company_id, location_id from public.fms_dispatch_rounds;
  create table private.phase2_step_owners_before as
    select id, step_key, location_id, employee_ids, designation_id, department_ids,
           created_at, updated_at
      from public.fms_dispatch_step_owners;

  create table private.phase2_functions_before (proname text primary key, definition text);
  insert into private.phase2_functions_before (proname, definition)
  select p.proname, pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fms_dispatch_submit_order', 'fms_dispatch_update_order',
                       'fms_dispatch_gate_pass_no', 'fms_dispatch_email_payload',
                       'fms_dispatch_resolve_master_request');
  if (select count(*) from private.phase2_functions_before) <> 5 then
    raise exception 'ABORT: expected 5 function definitions to snapshot, found %',
      (select count(*) from private.phase2_functions_before);
  end if;

  create table private.phase2_seeded_locations         (id uuid primary key);
  create table private.phase2_seeded_company_locations  (id uuid primary key);
  create table private.phase2_seeded_party_companies    (id uuid primary key);
  create table private.phase2_seeded_item_companies     (id uuid primary key);
  create table private.phase2_company_prefix_before (
    company_id uuid primary key,
    gate_pass_prefix_before text,
    gate_pass_prefix_after  text);

  -- ================================================ 4. the three sites =====
  --    Keeping the legacy id of the row most orders already point at.
  insert into public.mst_locations (id, name, company_id, modules, active, sort_order)
  select distinct m.survivor_location_id, m.site_name, null::uuid,
         array['order-to-dispatch'], m.survivor_active, m.survivor_sort_order
    from private.phase2_location_map m
   where m.survives;
  get diagnostics v_sites = row_count;

  insert into private.phase2_seeded_locations (id)
    select id from public.mst_locations;

  -- ======================================= 5. which company uses which site =
  --    One pair per legacy (company, location) row, with the region deciding
  --    which of that company's two books it belongs to.
  insert into public.mst_company_locations (company_id, location_id, active, source)
  select distinct cm.book_company_id, lm.survivor_location_id, true, 'order_history'
    from public.fms_dispatch_company_locations l
    join private.phase2_location_map lm on lm.legacy_location_id = l.id
    join private.phase2_company_map  cm on cm.legacy_company_id = l.company_id
                                       and cm.region = lm.region
  on conflict (company_id, location_id) do nothing;
  get diagnostics v_pairs = row_count;

  insert into private.phase2_seeded_company_locations (id)
    select id from public.mst_company_locations;

  -- ============================================== 6. gate-pass prefixes =====
  --
  -- ⚠ THE PREFIX IS HISTORIC DATA, NOT CONFIG. Every issued gp_no is
  --   PREFIX-YYMM-NNN and the counter is keyed 'gatepass:'||prefix||':'||month.
  --   Losing it would restart a live series; changing it would fork one. Both
  --   books of one company deliberately share a prefix, which is exactly why
  --   splitting a company in two is safe here.
  insert into private.phase2_company_prefix_before (company_id, gate_pass_prefix_before, gate_pass_prefix_after)
  select mc.id, mc.gate_pass_prefix, fc.gate_pass_prefix
    from public.mst_companies mc
    join private.phase2_company_map cm on cm.book_company_id = mc.id
    join public.fms_dispatch_companies fc on fc.id = cm.legacy_company_id
   where fc.gate_pass_prefix is not null
     and mc.gate_pass_prefix is distinct from fc.gate_pass_prefix
  on conflict (company_id) do nothing;

  update public.mst_companies mc
     set gate_pass_prefix = b.gate_pass_prefix_after
    from private.phase2_company_prefix_before b
   where b.company_id = mc.id;

  -- ================================ 7. which company may bill / sell what ===
  --
  -- Order history UNION the row's own Tally book. The history half is what
  -- makes every existing order still valid after release 3 turns the filtering
  -- on: the list is built from those very orders.
  insert into public.mst_party_companies (party_id, company_id, source)
  select z.party_id, z.company_id, min(z.source)
    from (
      -- billed under it before
      select o.customer_id as party_id, cm.book_company_id as company_id, 'order_history' as source
        from public.fms_dispatch_orders o
        join private.phase2_location_map lm on lm.legacy_location_id = o.location_id
        join private.phase2_company_map  cm on cm.legacy_company_id = o.company_id
                                           and cm.region = lm.region
      union all
      -- its ledger is filed in that book
      select p.id, p.company_id, 'tally'
        from public.mst_parties p
       where p.modules @> array['order-to-dispatch'] and p.active and p.company_id is not null
      union all
      -- ⚠ A PARTY WITH NO BOOK WOULD BELONG TO NO COMPANY AND VANISH FROM
      --   EVERY ORDER FORM. Nine of them exist - the reconcile decisions still
      --   open, plus two internal Noida entities. Every company, so nothing
      --   disappears; narrow it later on the screen.
      select p.id, mc.id, 'portal'
        from public.mst_parties p
        cross join public.mst_companies mc
       where p.modules @> array['order-to-dispatch'] and p.active and p.company_id is null
         and mc.active
    ) z
   group by z.party_id, z.company_id
  on conflict (party_id, company_id) do nothing;
  get diagnostics v_party_co = row_count;

  insert into private.phase2_seeded_party_companies (id)
    select id from public.mst_party_companies;

  insert into public.mst_item_companies (item_id, company_id, source)
  select z.item_id, z.company_id, min(z.source)
    from (
      select oi.item_id, cm.book_company_id as company_id, 'order_history' as source
        from public.fms_dispatch_order_items oi
        join public.fms_dispatch_orders o on o.id = oi.order_id
        join private.phase2_location_map lm on lm.legacy_location_id = o.location_id
        join private.phase2_company_map  cm on cm.legacy_company_id = o.company_id
                                           and cm.region = lm.region
      union all
      select i.id, i.company_id, 'tally'
        from public.mst_items i
       where i.modules @> array['order-to-dispatch'] and i.active and i.company_id is not null
    ) z
   group by z.item_id, z.company_id
  on conflict (item_id, company_id) do nothing;
  get diagnostics v_item_co = row_count;

  insert into private.phase2_seeded_item_companies (id)
    select id from public.mst_item_companies;

  -- ============================================ 8. repoint the live rows ====
  --
  -- ⚠ CONSTRAINTS OFF FIRST, THEN THE VALUES, THEN THE CONSTRAINTS BACK.
  --   fms_dispatch_orders_company_id_fkey still points at the legacy company
  --   table at this instant, so the very first central id is rejected. The
  --   rollback carries the mirror image of this note for the same reason - and
  --   the dry run is where this was found, not the review.
  alter table public.fms_dispatch_orders      drop constraint if exists fms_dispatch_orders_company_id_fkey;
  alter table public.fms_dispatch_orders      drop constraint if exists fms_dispatch_orders_location_id_fkey;
  alter table public.fms_dispatch_rounds      drop constraint if exists fms_dispatch_rounds_company_id_fkey;
  alter table public.fms_dispatch_rounds      drop constraint if exists fms_dispatch_rounds_location_id_fkey;
  alter table public.fms_dispatch_step_owners drop constraint if exists fms_dispatch_step_owners_location_id_fkey;

  update public.fms_dispatch_orders o
     set company_id  = cm.book_company_id,
         location_id = lm.survivor_location_id
    from private.phase2_location_map lm,
         private.phase2_company_map  cm
   where lm.legacy_location_id = o.location_id
     and cm.legacy_company_id  = o.company_id
     and cm.region = lm.region;

  update public.fms_dispatch_rounds rr
     set company_id  = cm.book_company_id,
         location_id = lm.survivor_location_id
    from private.phase2_location_map lm,
         private.phase2_company_map  cm
   where lm.legacy_location_id = rr.location_id
     and cm.legacy_company_id  = rr.company_id
     and cm.region = lm.region;

  -- ================================================ 9. merge step owners ====
  --
  -- ⚠ DELETE THE DUPLICATE FIRST, THEN MOVE THE REST. The unique index is
  --   (step_key, location_id) where location_id is not null, so updating a
  --   loser onto the survivor's location before deleting it collides.
  --    The department LABELS are unioned into the survivor before its twin is
  --    deleted, so the stepper keeps naming every department it named before.
  create table private.phase2_owner_dept_merges (
    survivor_id uuid primary key, step_key text, site_name text,
    departments_before uuid[], departments_after uuid[]);

  insert into private.phase2_owner_dept_merges
  select keep.id, keep.step_key, m.site_name, keep.department_ids,
         (select coalesce(array_agg(distinct x), '{}'::uuid[])
            from unnest(keep.department_ids || so.department_ids) x)
    from public.fms_dispatch_step_owners so
    join private.phase2_location_map m on m.legacy_location_id = so.location_id
    join public.fms_dispatch_step_owners keep
      on keep.step_key = so.step_key and keep.location_id = m.survivor_location_id
   where not m.survives
     and exists (select 1 from unnest(so.department_ids) d
                  where d <> all(keep.department_ids))
  on conflict (survivor_id) do nothing;

  update public.fms_dispatch_step_owners so
     set department_ids = mrg.departments_after
    from private.phase2_owner_dept_merges mrg
   where mrg.survivor_id = so.id;

  delete from public.fms_dispatch_step_owners so
   using private.phase2_location_map m
   where m.legacy_location_id = so.location_id
     and not m.survives
     and exists (select 1 from public.fms_dispatch_step_owners keep
                  where keep.step_key = so.step_key
                    and keep.location_id = m.survivor_location_id);
  get diagnostics v_owners_dropped = row_count;

  --    Anything left on a retired site had no counterpart, so it simply moves.
  update public.fms_dispatch_step_owners so
     set location_id = m.survivor_location_id
    from private.phase2_location_map m
   where m.legacy_location_id = so.location_id
     and not m.survives;

  -- ================================================= 10. the constraints ====
  --    ON DELETE spelled out on all five. Omitting the clause silently
  --    downgrades RESTRICT to NO ACTION, which is the D5 lesson from Phase 1.
  --    The five DROPs happened in section 8, before the values moved. Only the
  --    ADDs belong here.
  alter table public.fms_dispatch_orders
    add constraint fms_dispatch_orders_company_id_fkey
    foreign key (company_id) references public.mst_companies(id) on delete restrict;
  alter table public.fms_dispatch_orders
    add constraint fms_dispatch_orders_location_id_fkey
    foreign key (location_id) references public.mst_locations(id) on delete restrict;
  alter table public.fms_dispatch_rounds
    add constraint fms_dispatch_rounds_company_id_fkey
    foreign key (company_id) references public.mst_companies(id) on delete restrict;
  alter table public.fms_dispatch_rounds
    add constraint fms_dispatch_rounds_location_id_fkey
    foreign key (location_id) references public.mst_locations(id) on delete restrict;
  --    CASCADE, as it was: a site's owner-sets go with the site.
  alter table public.fms_dispatch_step_owners
    add constraint fms_dispatch_step_owners_location_id_fkey
    foreign key (location_id) references public.mst_locations(id) on delete cascade;

  -- ============================================== 11. repoint the functions =
  --
  -- ⚠ SUBSTITUTION, NOT RETYPING, for the four whose logic does not change.
  --   Phase 1 used the same technique on fms_dispatch_email_payload and for the
  --   same reason: retyping an 80-line SECURITY DEFINER function to change one
  --   table name is how a line goes missing. Every substitution is counted and
  --   asserted, so a miss is an abort rather than a half-repointed function.
  --
  --   The location predicate is replaced by a SUBQUERY WITH THE SAME COLUMN
  --   SHAPE - id, company_id, active - so both call sites work untouched:
  --     l.id = v_location and l.company_id = v_company and l.active
  --     l.company_id = v_company and l.active
  --   `active` is the AND of the site's own flag and the pair's, which is what
  --   "this company can dispatch from there" has to mean.

  for r in select proname, definition from private.phase2_functions_before
            where proname in ('fms_dispatch_submit_order', 'fms_dispatch_update_order')
  loop
    v_def := r.definition;
    v_new := replace(v_def, 'public.fms_dispatch_companies c',
                            'public.mst_companies c');
    if v_new = v_def then
      raise exception 'ABORT: % does not contain the company read it was expected to', r.proname;
    end if;
    v_def := v_new;

    v_hits := (length(v_def) - length(replace(v_def, 'public.fms_dispatch_company_locations l', '')))
              / length('public.fms_dispatch_company_locations l');
    if v_hits <> 2 then
      raise exception 'ABORT: % has % location read(s), expected 2', r.proname, v_hits;
    end if;
    v_def := replace(v_def, 'public.fms_dispatch_company_locations l',
      '(select loc.id, cl.company_id, (loc.active and cl.active) as active'
      || ' from public.mst_locations loc'
      || ' join public.mst_company_locations cl on cl.location_id = loc.id) l');

    execute v_def;
  end loop;

  --    The gate-pass prefix lookup: one table name.
  select definition into v_def from private.phase2_functions_before
   where proname = 'fms_dispatch_gate_pass_no';
  v_new := replace(v_def, 'public.fms_dispatch_companies c', 'public.mst_companies c');
  if v_new = v_def then
    raise exception 'ABORT: fms_dispatch_gate_pass_no does not read the company table as expected';
  end if;
  execute v_new;

  --    The dispatch email: the table, and the NAME IT PRINTS.
  --
  -- ⚠ mst_companies.name is Tally's book name - "ORANGE O TEC PRIVATE LIMITED
  --   (01-04-25TO31-03-27)" - rewritten every April. Printing it in an email
  --   to a customer is worse than the old private list, not better. The alias
  --   is the human's label and no sync ever touches it.
  select definition into v_def from private.phase2_functions_before
   where proname = 'fms_dispatch_email_payload';
  v_new := replace(v_def, 'public.fms_dispatch_companies co', 'public.mst_companies co');
  if v_new = v_def then
    raise exception 'ABORT: fms_dispatch_email_payload does not join the company table as expected';
  end if;
  v_def := v_new;
  v_new := replace(v_def, 'co.name as company_name',
                          'coalesce(nullif(trim(co.alias), ''''), co.name) as company_name');
  if v_new = v_def then
    raise exception 'ABORT: fms_dispatch_email_payload does not select co.name as company_name';
  end if;
  execute v_new;

  -- ================================ 12. approving a master request ==========
  --
  -- Retyped in full rather than substituted, because two arms change MEANING.
  --   company          - retired. Companies are Tally's now; one typed in here
  --                      would have no book, no ledgers and no items.
  --   company_location - a site plus the pair that ties it to the company, so
  --                      an approved request is immediately offerable.
  create or replace function public.fms_dispatch_resolve_master_request(
    p_request_id uuid, p_approve boolean, p_payload jsonb default null, p_note text default null)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
  declare
    v_type text; v_status text; v_payload jsonb; v_new_id uuid; v_name text; v_party text;
    v_company uuid;
  begin
    select master_type, status, proposed_payload
      into v_type, v_status, v_payload
    from public.fms_dispatch_master_requests where id = p_request_id for update;

    if v_type is null then raise exception 'Master request % not found', p_request_id; end if;
    if v_status <> 'pending' then raise exception 'Master request % is already %', p_request_id, v_status; end if;

    if not (public.is_admin(auth.uid()) or public.fms_dispatch_is_master_manager(v_type, auth.uid())) then
      raise exception 'Not authorized to resolve % master requests', v_type;
    end if;

    v_payload := coalesce(p_payload, v_payload);
    v_name    := nullif(trim(v_payload->>'name'), '');

    if p_approve then
      if v_name is null and v_type <> 'customer_item' then
        raise exception 'A name is required to approve a master request';
      end if;

      if v_type = 'company' then
        raise exception 'Companies come from Tally now and cannot be added by hand. Ask for the company to be opened in Tally; it appears here within 15 minutes.';

      elsif v_type = 'customer' then
        insert into public.mst_parties
          (name, code, location, gstin, contact_name, phone, email,
           is_customer, is_vendor, source, modules, created_by)
        values (v_name,
                nullif(trim(v_payload->>'code'),''),
                nullif(trim(v_payload->>'location'),''),
                nullif(trim(v_payload->>'gstin'),''),
                nullif(trim(v_payload->>'contact_name'),''),
                nullif(trim(v_payload->>'phone'),''),
                nullif(trim(v_payload->>'email'),''),
                true, false, 'portal', array['order-to-dispatch'], auth.uid())
        returning id into v_new_id;

        -- A customer nobody has billed yet belongs to no company, and would
        -- therefore appear under none. Offer it to every company; narrow it on
        -- the Customer Companies screen.
        insert into public.mst_party_companies (party_id, company_id, source)
        select v_new_id, mc.id, 'portal' from public.mst_companies mc where mc.active
        on conflict (party_id, company_id) do nothing;

      elsif v_type = 'item' then
        -- No unit: mst_items points at mst_units and the unit is Tally's.
        insert into public.mst_items (name, code, hsn_code, source, modules, created_by)
        values (v_name, nullif(trim(v_payload->>'code'),''), nullif(trim(v_payload->>'hsn_code'),''),
                'portal', array['order-to-dispatch'], auth.uid())
        returning id into v_new_id;

        insert into public.mst_item_companies (item_id, company_id, source)
        select v_new_id, mc.id, 'portal' from public.mst_companies mc where mc.active
        on conflict (item_id, company_id) do nothing;

      elsif v_type = 'customer_item' then
        -- `customer_id` is read as a fallback so requests raised BEFORE the
        -- Phase 1 cutover, still sitting pending, can be approved after it.
        v_party := coalesce(nullif(trim(v_payload->>'party_id'),''),
                            nullif(trim(v_payload->>'customer_id'),''));
        if v_party is null or nullif(trim(v_payload->>'item_id'),'') is null then
          raise exception 'A mapping needs both a customer and an item';
        end if;
        insert into public.mst_party_items (party_id, item_id, source, created_by)
        values (v_party::uuid, (v_payload->>'item_id')::uuid, 'portal', auth.uid())
        on conflict (party_id, item_id) do nothing
        returning id into v_new_id;

      elsif v_type = 'company_location' then
        v_company := nullif(trim(v_payload->>'company_id'),'')::uuid;
        if v_company is null then
          raise exception 'A location needs the company that dispatches from it';
        end if;

        -- The site may already exist under another company - that is the whole
        -- point of a shared site list - so reuse it rather than refusing.
        select id into v_new_id from public.mst_locations
         where lower(name) = lower(v_name) and company_id is null;

        if v_new_id is null then
          insert into public.mst_locations (name, company_id, modules, created_by)
          values (v_name, null, array['order-to-dispatch'], auth.uid())
          returning id into v_new_id;
        end if;

        insert into public.mst_company_locations (company_id, location_id, source, created_by)
        values (v_company, v_new_id, 'portal', auth.uid())
        on conflict (company_id, location_id) do nothing;

      else
        raise exception 'Unknown master type %', v_type;
      end if;

      update public.fms_dispatch_master_requests
         set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
             resolved_master_id = v_new_id, proposed_payload = v_payload
       where id = p_request_id;
    else
      update public.fms_dispatch_master_requests
         set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
       where id = p_request_id;
    end if;

    return v_new_id;
  end $function$;

  -- ======================================================= 13. prove it =====

  if (select count(*) from public.fms_dispatch_orders) <> v_orders_before
     or (select count(*) from public.fms_dispatch_rounds) <> v_rounds_before
     or (select count(*) from public.fms_dispatch_order_items) <> v_lines_before then
    raise exception 'ABORT: an order, dispatch or line count changed during the cutover';
  end if;

  if exists (select 1 from public.fms_dispatch_orders o
              left join public.mst_companies c on c.id = o.company_id
             where o.company_id is not null and c.id is null) then
    raise exception 'ABORT: an order points at a company that does not exist centrally';
  end if;
  if exists (select 1 from public.fms_dispatch_orders o
              left join public.mst_locations l on l.id = o.location_id
             where o.location_id is not null and l.id is null) then
    raise exception 'ABORT: an order points at a site that does not exist centrally';
  end if;
  if exists (select 1 from public.fms_dispatch_rounds rr
              left join public.mst_companies c on c.id = rr.company_id
             where rr.company_id is not null and c.id is null) then
    raise exception 'ABORT: a dispatch points at a company that does not exist centrally';
  end if;
  if exists (select 1 from public.fms_dispatch_rounds rr
              left join public.mst_locations l on l.id = rr.location_id
             where rr.location_id is not null and l.id is null) then
    raise exception 'ABORT: a dispatch points at a site that does not exist centrally';
  end if;

  -- Every order's company must actually be able to dispatch from its site, or
  -- fms_dispatch_update_order would refuse to save an order it just moved.
  if exists (
    select 1 from public.fms_dispatch_orders o
     where o.company_id is not null and o.location_id is not null
       and not exists (select 1 from public.mst_company_locations cl
                        where cl.company_id = o.company_id and cl.location_id = o.location_id)) then
    raise exception 'ABORT: an order names a site its new company does not dispatch from';
  end if;

  -- Every order and dispatch must have MOVED. A row left on a legacy id would
  -- have failed the foreign key, so this catches the subtler case: a company
  -- that mapped to itself because an alias collided.
  if exists (select 1 from public.fms_dispatch_orders o
              join public.fms_dispatch_companies fc on fc.id = o.company_id) then
    raise exception 'ABORT: an order still points at a legacy company row';
  end if;

  -- The owner sets, per step and site, must be exactly what they were.
  if exists (
    select m.survivor_location_id, b.step_key
      from private.phase2_step_owners_before b
      join private.phase2_location_map m on m.legacy_location_id = b.location_id
     group by m.survivor_location_id, b.step_key
    having count(distinct (select array_agg(x order by x)
                             from unnest(b.employee_ids) x)::text) > 1) then
    raise exception 'ABORT: a merged step/site now has more than one owner set';
  end if;
  if exists (
    select 1 from private.phase2_step_owners_before b
      join private.phase2_location_map m on m.legacy_location_id = b.location_id
     where not exists (
       select 1 from public.fms_dispatch_step_owners so
        where so.step_key = b.step_key
          and so.location_id = m.survivor_location_id
          and (select array_agg(x order by x) from unnest(so.employee_ids) x)
              is not distinct from
              (select array_agg(x order by x) from unnest(b.employee_ids) x))) then
    raise exception 'ABORT: a step/site lost its owners in the merge';
  end if;

  -- No gate-pass prefix may have been lost: every company that carried orders
  -- must still resolve to the prefix its issued numbers already use.
  if exists (
    select 1 from private.phase2_company_prefix_before b
      join public.mst_companies mc on mc.id = b.company_id
     where mc.gate_pass_prefix is distinct from b.gate_pass_prefix_after) then
    raise exception 'ABORT: a gate-pass prefix did not carry across';
  end if;

  -- And nothing may still read the retired tables. Comments count, because
  -- pg_get_functiondef returns them - so do not spell those names in a comment
  -- inside one of these five functions.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fms_dispatch_submit_order', 'fms_dispatch_update_order',
                         'fms_dispatch_gate_pass_no', 'fms_dispatch_email_payload',
                         'fms_dispatch_resolve_master_request')
       and (pg_get_functiondef(p.oid) ilike '%fms\_dispatch\_companies%'
         or pg_get_functiondef(p.oid) ilike '%fms\_dispatch\_company\_locations%')) then
    raise exception 'ABORT: a repointed function still reads a retired company or location table';
  end if;

  return format(
    'PHASE 2 CUTOVER OK: %s sites, %s company-site pairs, %s customer-company rows, '
    || '%s item-company rows, %s orders, %s dispatches, %s owner rows merged away (%s -> %s)',
    v_sites, v_pairs, v_party_co, v_item_co, v_orders_before, v_rounds_before,
    v_owners_dropped, v_owners_before, v_owners_before - v_owners_dropped);
end
$phase2$;
