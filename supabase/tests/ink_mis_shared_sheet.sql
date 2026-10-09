-- Ink IMS shared sheet — proved THROUGH RLS, as real signed-in users.
-- Runs inside the caller's transaction, which is ROLLED BACK. Nothing is kept.
--
-- ⚠ WHY THE ROLE SWITCHING MATTERS, AND WHY A SIMPLER TEST WOULD BE A LIE.
--   A plain `do $$ ... $$` block runs as the migration role, which BYPASSES row
--   level security. Asserting "the viewer cannot write" from there would pass
--   even if the policy were missing, misspelled, or pointed at the wrong app id.
--   So the setup runs as the owner, and every assertion runs after
--   `set local role authenticated` with a JWT claim — which is what a browser
--   session looks like to Postgres. See hd13_help_desk_rls_as_real_users.sql,
--   which this follows.
--
-- ⚠ AND IT NEVER TESTS AS AN ADMIN. module_level() resolves an admin to 'edit'
--   whatever app_access says, so an admin session proves nothing about the gate.
--
-- The questions:
--   1. Does an EDIT grant let someone save?                        (must: yes)
--   2. Is updated_by stamped from the session, not from the client?(must: yes)
--   3. Can a VIEW-ONLY grant read the sheet?                       (must: yes)
--   4. Can a VIEW-ONLY grant change it?                            (must: no)
--   5. Does someone with NO grant see anything at all?             (must: no)

begin;

-- ══ setup, as the owner ═════════════════════════════════════════════════════
do $t$
declare
  v_editor uuid;
  v_viewer uuid;
  v_nobody uuid;
begin
  -- Three ordinary, non-admin staff logins.
  select p.id into v_editor
    from public.profiles p
   where not exists (select 1 from public.user_roles r
                      where r.user_id = p.id and r.role = 'admin')
     and p.email not like 'zz.test%'
   order by p.name limit 1;

  select p.id into v_viewer
    from public.profiles p
   where p.id <> v_editor
     and not exists (select 1 from public.user_roles r
                      where r.user_id = p.id and r.role = 'admin')
     and p.email not like 'zz.test%'
   order by p.name limit 1;

  select p.id into v_nobody
    from public.profiles p
   where p.id not in (v_editor, v_viewer)
     and not exists (select 1 from public.user_roles r
                      where r.user_id = p.id and r.role = 'admin')
     and p.email not like 'zz.test%'
   order by p.name limit 1;

  if v_editor is null or v_viewer is null or v_nobody is null then
    raise exception 'test setup: need three non-admin profiles';
  end if;

  delete from public.app_access
   where app_id = 'ink-mis' and user_id in (v_editor, v_viewer, v_nobody);
  insert into public.app_access (user_id, app_id, access_level)
  values (v_editor, 'ink-mis', 'edit'),
         (v_viewer, 'ink-mis', 'view');
  -- v_nobody deliberately gets no row at all.

  -- The helpers themselves, before RLS is involved. If these are wrong the
  -- policy assertions below would be failing for the wrong reason.
  if public.module_level(v_nobody, 'ink-mis') <> 'none' then
    raise exception 'FAIL: no grant did not resolve to "none"';
  end if;
  if public.module_level(v_viewer, 'ink-mis') <> 'view' then
    raise exception 'FAIL: a view grant did not resolve to "view"';
  end if;
  if public.module_can_edit(v_viewer, 'ink-mis') then
    raise exception 'FAIL: module_can_edit said yes to a view-only grant';
  end if;
  if not public.module_can_edit(v_editor, 'ink-mis') then
    raise exception 'FAIL: module_can_edit said no to an edit grant';
  end if;

  -- Stash the ids where blocks running as `authenticated` can read them:
  -- `set local role` cannot see plpgsql variables from a later block.
  create temp table if not exists _inkmis (k text primary key, v uuid) on commit drop;
  delete from _inkmis;
  insert into _inkmis values ('editor', v_editor), ('viewer', v_viewer), ('nobody', v_nobody);
  -- The blocks below run AS authenticated, so they need to be able to read it.
  grant select on _inkmis to authenticated;
end
$t$;

-- ══ as the EDITOR ═══════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';

do $t$
declare
  v_editor uuid := (select v from _inkmis where k = 'editor');
  v_rows   int;
  v_by     uuid;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('role', 'authenticated', 'sub', v_editor)::text, true);

  perform public.ink_mis_save('ink-mis:test:v1', '{"1":{"leadTime":3}}'::jsonb);

  select count(*), max(updated_by) into v_rows, v_by
    from public.ink_mis_state where key = 'ink-mis:test:v1';

  if v_rows <> 1 then
    raise exception 'FAIL 1: an edit grant could not save through RLS (% rows)', v_rows;
  end if;
  if v_by is distinct from v_editor then
    raise exception 'FAIL 2: updated_by is %, expected the saving user %', v_by, v_editor;
  end if;
end
$t$;

-- ══ as the VIEWER ═══════════════════════════════════════════════════════════
do $t$
declare
  v_viewer uuid := (select v from _inkmis where k = 'viewer');
  v_rows   int;
  v_denied boolean := false;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('role', 'authenticated', 'sub', v_viewer)::text, true);

  select count(*) into v_rows from public.ink_mis_state where key = 'ink-mis:test:v1';
  if v_rows <> 1 then
    raise exception 'FAIL 3: a view grant could not READ the sheet (% rows)', v_rows;
  end if;

  begin
    perform public.ink_mis_save('ink-mis:test:v1', '{"1":{"leadTime":99}}'::jsonb);
  exception when others then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL 4: a view-only grant was allowed to CHANGE the sheet';
  end if;

  -- And the value it tried to write must not be there.
  select count(*) into v_rows
    from public.ink_mis_state
   where key = 'ink-mis:test:v1' and value -> '1' ->> 'leadTime' = '99';
  if v_rows <> 0 then
    raise exception 'FAIL 5: the view-only write landed anyway';
  end if;
end
$t$;

-- ══ as SOMEONE WITH NO GRANT ════════════════════════════════════════════════
do $t$
declare
  v_nobody uuid := (select v from _inkmis where k = 'nobody');
  v_rows   int;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('role', 'authenticated', 'sub', v_nobody)::text, true);

  select count(*) into v_rows from public.ink_mis_state;
  if v_rows <> 0 then
    raise exception 'FAIL 6: a user with no ink-mis grant read % row(s) of the sheet', v_rows;
  end if;

  raise notice 'ink_mis_shared_sheet: all checks passed';
end
$t$;

reset role;
rollback;
