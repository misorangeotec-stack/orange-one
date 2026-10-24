-- Behavioural test for HD-8's hand-off. Runs inside the caller's transaction,
-- which is ROLLED BACK.
--
-- The questions:
--   · is a reference that matches NOTHING refused?
--   · does a real one resolve to the right row's id?
--   · is a hand-off refused on a category that has no target module?
--   · can a wrong reference be cleared again?
--
-- ⚠ IT CREATES A REAL TRAVEL TRIP to have something to point at, and rolls it
--   back with everything else. That is the only honest way to test "verified,
--   not trusted" — a test that stubs the lookup proves the stub works.

do $t$
declare
  v_khushi   uuid := (select id from public.profiles where email = 'khushi@orangeotec.com');
  v_tanisha  uuid := (select id from public.profiles where email = 'travel@orangeotec.com');
  v_stranger uuid := (select p.id from public.profiles p
                       left join public.departments d on d.id = p.department_id
                      where coalesce(d.name,'') <> 'Human Resources'
                        and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')
                        and p.email not like 'zz.test%'
                      order by p.name limit 1);
  v_travel_cat uuid := (select id from public.fms_help_categories where code = 'travel_booking');
  v_pay_cat    uuid := (select id from public.fms_help_categories where code = 'payroll_queries');
  v_trip uuid;
  v_tkt  uuid;
  v_pay  uuid;
  v_row  public.fms_help_tickets%rowtype;
  v_fail text := '';
begin
  if v_khushi is null or v_tanisha is null or v_stranger is null then
    raise exception 'test setup: could not resolve the people';
  end if;

  -- Something real to point at.
  insert into public.fms_travel_trips (trip_no, raised_by, traveller_id, status)
  values ('ZZ-TEST-TRIP-1', v_stranger, v_stranger, 'draft')
  returning id into v_trip;

  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-8001', v_travel_cat, v_stranger, 'ZZ TEST need a flight', 'open', 'acknowledge')
  returning id into v_tkt;
  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-8002', v_pay_cat, v_stranger, 'ZZ TEST payroll', 'open', 'acknowledge')
  returning id into v_pay;

  -- ══ as Tanisha, who owns the travel categories ═══════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_tanisha)::text, true);

  -- 1. ⚠ A REFERENCE THAT MATCHES NOTHING IS REFUSED. A wrong one points the
  --    employee at something that does not exist and nobody ever checks it.
  begin
    perform public.fms_help_record_handoff(v_tkt, 'TRV-9999-9999');
    v_fail := v_fail || E'\n  🔴 a reference matching NOTHING was recorded';
  exception when others then null;
  end;

  -- 2. A real one is accepted and resolves to the right row.
  perform public.fms_help_record_handoff(v_tkt, 'zz-test-trip-1', 'Booked as asked');
  select * into v_row from public.fms_help_tickets where id = v_tkt;
  if v_row.handoff_entity_id is distinct from v_trip then
    v_fail := v_fail || E'\n  🔴 the recorded reference did not resolve to the real trip';
  end if;
  if v_row.handoff_app_id <> 'travel-desk' then
    v_fail := v_fail || E'\n  the hand-off did not record which module it went to';
  end if;
  -- Case and spaces are forgiven — people paste out of mail.
  if v_row.handoff_ref <> 'ZZ-TEST-TRIP-1' then
    v_fail := v_fail || E'\n  the reference was not normalised (got ' || coalesce(v_row.handoff_ref,'null') || ')';
  end if;

  -- 3. A category with no target module refuses the whole idea.
  perform set_config('request.jwt.claims', json_build_object('sub', v_khushi)::text, true);
  begin
    perform public.fms_help_record_handoff(v_pay, 'ZZ-TEST-TRIP-1');
    v_fail := v_fail || E'\n  a hand-off was recorded on a category answered in Help Desk itself';
  exception when others then null;
  end;

  -- 4. ⚠ A WRONG REFERENCE CAN BE CLEARED. A stamp with no way back is the FIX-4
  --    trap — a control whose absence is invisible until somebody needs it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_tanisha)::text, true);
  perform public.fms_help_clear_handoff(v_tkt, 'wrong trip');
  select * into v_row from public.fms_help_tickets where id = v_tkt;
  if v_row.handoff_ref is not null or v_row.handoff_entity_id is not null then
    v_fail := v_fail || E'\n  🔴 clearing the reference left it in place';
  end if;
  -- ...and clearing twice says so rather than silently doing nothing.
  begin
    perform public.fms_help_clear_handoff(v_tkt, null);
    v_fail := v_fail || E'\n  clearing a reference that was not there was accepted';
  exception when others then null;
  end;

  -- 5. The RAISER cannot record where their own ticket went.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  begin
    perform public.fms_help_record_handoff(v_tkt, 'ZZ-TEST-TRIP-1');
    v_fail := v_fail || E'\n  🔴 the RAISER recorded a hand-off on their own ticket';
  exception when others then null;
  end;

  if v_fail <> '' then
    raise exception 'HD-8 TEST FAILED:%', v_fail;
  end if;
  raise notice 'HD-8 test: all assertions passed';
end $t$;

select 'hd8 test passed' as result;
