-- HD-13 — the confidential gate, proved THROUGH RLS as a real signed-in user.
-- Runs inside the caller's transaction, which is ROLLED BACK.
--
-- ⚠⚠ THIS IS A DIFFERENT TEST FROM hd2_help_desk_gates.sql, AND THE DIFFERENCE IS
--    THE WHOLE POINT.
--
--    That one calls `fms_help_can_see(...)` directly and asserts what it returns.
--    It proves the FUNCTION is right. It does NOT prove the POLICY is — those
--    tests run as the migration role, which BYPASSES row-level security
--    entirely, so a table whose policy was missing, misspelled or pointed at the
--    wrong column would pass every one of them.
--
--    This file does `set local role authenticated` and sets a JWT claim, which
--    is what a real browser session looks like to Postgres. Every SELECT below
--    therefore goes through the actual policy.
--
-- ⚠ AND IT NEVER TESTS AS AN ADMIN. Admins bypass every module gate in this hub,
--   so an admin session proves nothing at all about who can see what.

do $t$
declare
  v_khushi   uuid := (select id from public.profiles where email = 'khushi@orangeotec.com');
  v_riya     uuid := (select id from public.profiles where email = 'riya@orangeotec.com');
  v_stranger uuid := (select p.id from public.profiles p
                       left join public.departments d on d.id = p.department_id
                      where coalesce(d.name,'') <> 'Human Resources'
                        and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')
                        and p.email not like 'zz.test%'
                      order by p.name limit 1);
  v_pay  uuid := (select id from public.fms_help_categories where code = 'payroll_queries');
  v_posh uuid := (select id from public.fms_help_categories where code = 'posh');
  v_a uuid; v_p uuid;
begin
  if v_khushi is null or v_riya is null or v_stranger is null then
    raise exception 'test setup: could not resolve the people';
  end if;

  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-13A', v_pay, v_stranger, 'ZZ TEST ordinary', 'open', 'acknowledge') returning id into v_a;
  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-13P', v_posh, v_stranger, 'ZZ TEST the complaint itself', 'open', 'acknowledge') returning id into v_p;

  -- Put Khushi squarely in the general HR pool, so the ONLY thing standing
  -- between her and the POSH ticket is the confidential flag. (hd2's first draft
  -- forgot this and was vacuous; see its header.)
  insert into public.fms_help_step_owners (step_key, employee_ids)
  values ('resolve', array[v_khushi]), ('acknowledge', array[v_khushi])
  on conflict (step_key) do update set employee_ids = excluded.employee_ids;
  update public.fms_help_config
     set value = jsonb_build_object('department_ids','[]'::jsonb,'user_ids', to_jsonb(array[v_khushi::text]))
   where key = 'reassign_pool';

  -- Stash the ids where the assertions below can read them without a local
  -- variable — `set local role` cannot see plpgsql variables from a later block.
  create temp table if not exists _hd13 (k text primary key, v uuid) on commit drop;
  delete from _hd13;
  insert into _hd13 values ('ordinary', v_a), ('posh', v_p),
                           ('khushi', v_khushi), ('riya', v_riya), ('stranger', v_stranger);
  -- ⚠ THE SCRATCH TABLE HAS TO BE READABLE BY `authenticated`, because the blocks
  --   below run AS that role — which is the whole point of this file. Without the
  --   grant the test fails with "permission denied for table _hd13", which looks
  --   alarming and means nothing about the gate.
  grant select on _hd13 to authenticated;
end $t$;

-- ══ as KHUSHI — HR, in the pool, but NOT an owner of the POSH category ═══════
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';

do $t$
declare
  v_khushi uuid := (select v from _hd13 where k = 'khushi');
  v_posh   uuid := (select v from _hd13 where k = 'posh');
  v_ord    uuid := (select v from _hd13 where k = 'ordinary');
  v_n int;
  v_fail text := '';
begin
  perform set_config('request.jwt.claims',
                     json_build_object('role', 'authenticated', 'sub', v_khushi)::text, true);

  -- She is in the pool, so the ORDINARY ticket must come back — otherwise the
  -- POSH assertion below is vacuous for a reason that has nothing to do with
  -- confidentiality.
  select count(*) into v_n from public.fms_help_tickets where id = v_ord;
  if v_n <> 1 then
    raise exception 'test setup: the HR pool did not take through RLS — the POSH assertion would be vacuous';
  end if;

  -- ⚠ THE ONE THAT MATTERS, THROUGH THE POLICY.
  select count(*) into v_n from public.fms_help_tickets where id = v_posh;
  if v_n <> 0 then
    v_fail := v_fail || E'\n  🔴 RLS RETURNED A POSH TICKET TO AN ORDINARY HR USER';
  end if;

  -- Its timeline must be just as unreadable — the complaint is IN the thread.
  select count(*) into v_n from public.fms_help_activity where entity_id = v_posh;
  if v_n <> 0 then
    v_fail := v_fail || E'\n  🔴 RLS RETURNED A POSH TICKET''S HISTORY to an ordinary HR user';
  end if;

  -- And she cannot write round it: every workflow write is a definer RPC, and
  -- the table itself is admin-only.
  begin
    update public.fms_help_tickets set subject = 'tampered' where id = v_ord;
    if found then
      v_fail := v_fail || E'\n  🔴 a non-admin UPDATED a ticket row directly, going round the RPCs';
    end if;
  exception when others then null;
  end;

  if v_fail <> '' then
    raise exception 'HD-13 RLS TEST FAILED:%', v_fail;
  end if;
end $t$;

-- ══ as the HR HEAD, who owns the POSH category ══════════════════════════════
do $t$
declare
  v_riya uuid := (select v from _hd13 where k = 'riya');
  v_posh uuid := (select v from _hd13 where k = 'posh');
  v_n int;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('role', 'authenticated', 'sub', v_riya)::text, true);
  select count(*) into v_n from public.fms_help_tickets where id = v_posh;
  if v_n <> 1 then
    raise exception 'HD-13 RLS TEST FAILED: the HR HEAD cannot read the POSH ticket she owns';
  end if;
end $t$;

-- ══ as the employee who raised it ═══════════════════════════════════════════
do $t$
declare
  v_stranger uuid := (select v from _hd13 where k = 'stranger');
  v_posh uuid := (select v from _hd13 where k = 'posh');
  v_n int;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('role', 'authenticated', 'sub', v_stranger)::text, true);
  select count(*) into v_n from public.fms_help_tickets where id = v_posh;
  if v_n <> 1 then
    raise exception 'HD-13 RLS TEST FAILED: the person who RAISED the complaint cannot read it';
  end if;

  -- ...and nothing else. An ordinary employee sees their own tickets, not the desk's.
  select count(*) into v_n from public.fms_help_tickets t
    where t.raised_by is distinct from v_stranger;
  if v_n > 0 then
    raise exception 'HD-13 RLS TEST FAILED: an ordinary employee can read % ticket(s) that are not theirs', v_n;
  end if;
end $t$;

reset role;
select 'hd13 rls test passed' as result;
