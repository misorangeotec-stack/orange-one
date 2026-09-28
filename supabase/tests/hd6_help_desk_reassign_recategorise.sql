-- Behavioural test for HD-6: reassigning, and re-filing under the right
-- category. Runs inside the caller's transaction, which is ROLLED BACK.
--
-- The questions:
--   · can a ticket be handed only to somebody set up to receive one?
--   · does re-filing move the OWNER and the DEADLINE together?
--   · is a confidential ticket refused in BOTH directions?
--   · does handing on a confidential ticket record who was let in?
--
-- ⚠ READ supabase/tests/hd2_help_desk_gates.sql's HEADER FIRST: its first draft
--   was vacuous and only a negative control caught it.

do $t$
declare
  v_khushi   uuid := (select id from public.profiles where email = 'khushi@orangeotec.com');
  v_riya     uuid := (select id from public.profiles where email = 'riya@orangeotec.com');
  v_saloni   uuid := (select id from public.profiles where email = 'recruitment@orangeotec.com');
  v_stranger uuid := (select p.id from public.profiles p
                       left join public.departments d on d.id = p.department_id
                      where coalesce(d.name,'') <> 'Human Resources'
                        and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')
                        and p.email not like 'zz.test%'
                      order by p.name limit 1);
  v_pay   uuid := (select id from public.fms_help_categories where code = 'payroll_queries');
  v_att   uuid := (select id from public.fms_help_categories where code = 'attendance_corrections');
  v_posh  uuid := (select id from public.fms_help_categories where code = 'posh');
  v_gen   uuid := (select id from public.fms_help_categories where code = 'general_hr_query');
  v_a uuid; v_p uuid;
  v_row public.fms_help_tickets%rowtype;
  v_fail text := '';
  v_n int;
begin
  if v_khushi is null or v_riya is null or v_saloni is null or v_stranger is null then
    raise exception 'test setup: could not resolve the people';
  end if;

  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-6001', v_pay, v_stranger, 'ZZ TEST reassign', 'open', 'acknowledge') returning id into v_a;
  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-6002', v_posh, v_stranger, 'ZZ TEST posh move', 'open', 'acknowledge') returning id into v_p;

  -- ══ as Khushi, who owns the payroll category ═════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_khushi)::text, true);

  -- 1. A ticket cannot be handed to somebody outside the desk.
  begin
    perform public.fms_help_reassign(v_a, v_stranger, 'take this');
    v_fail := v_fail || E'\n  🔴 a ticket was handed to somebody with no Help Desk role at all';
  exception when others then null;
  end;

  -- 2. It CAN be handed to another category owner — the default that keeps the
  --    feature from being inert while reassign_pool is empty.
  perform public.fms_help_reassign(v_a, v_saloni, 'Saloni is covering payroll this week');
  select * into v_row from public.fms_help_tickets where id = v_a;
  if v_row.assignee_id <> v_saloni then
    v_fail := v_fail || E'\n  reassign did not record the new holder';
  end if;

  -- 3. The assignee REPLACES the category owners: Khushi must be out.
  if public.fms_help_can_act('resolve', v_a, v_khushi) then
    v_fail := v_fail || E'\n  🔴 the previous owner can still act after handing the ticket on';
  end if;
  if not public.fms_help_can_act('resolve', v_a, v_saloni) then
    v_fail := v_fail || E'\n  the new holder cannot act on the ticket they were given';
  end if;

  -- ══ re-filing ════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_saloni)::text, true);

  -- 4. Re-filing moves the OWNER and clears the assignee.
  perform public.fms_help_recategorise(v_a, v_att, 'This is an attendance correction');
  select * into v_row from public.fms_help_tickets where id = v_a;
  if v_row.category_id <> v_att then
    v_fail := v_fail || E'\n  re-filing did not change the category';
  end if;
  if v_row.assignee_id is not null then
    v_fail := v_fail || E'\n  re-filing left the old assignee holding a ticket that is no longer theirs';
  end if;
  if v_row.recategorised_from <> v_pay then
    v_fail := v_fail || E'\n  re-filing did not record what it was filed as';
  end if;
  -- Attendance is Khushi's too, so she is back in.
  if not public.fms_help_can_act('resolve', v_a, v_khushi) then
    v_fail := v_fail || E'\n  the new category''s owner cannot act on the re-filed ticket';
  end if;

  -- 5. ⚠ THE DEADLINE MOVED WITH IT. Payroll is 2 working days, attendance is 1
  --    — the timeline has to carry both so a reader can see why the due date
  --    jumped.
  select count(*) into v_n from public.fms_help_activity
   where entity_id = v_a and type = 'help_ticket_recategorised'
     and (meta->>'from_tat_days')::int = 2 and (meta->>'to_tat_days')::int = 1;
  if v_n <> 1 then
    v_fail := v_fail || E'\n  🔴 re-filing did not record that the TAT changed from 2 days to 1';
  end if;

  -- ══ the confidential refusals ════════════════════════════════════════════
  -- 6. You cannot move an ordinary ticket INTO a confidential category: the
  --    people who have already read it would stay able to.
  begin
    perform public.fms_help_recategorise(v_a, v_posh, 'actually a complaint');
    v_fail := v_fail || E'\n  🔴 an ordinary ticket was moved INTO a confidential category';
  exception when others then null;
  end;

  -- 7. ⚠ AND YOU CANNOT MOVE ONE OUT. This is the worse of the two: it would
  --    hand a POSH complaint''s whole history to the HR pool in one click.
  perform set_config('request.jwt.claims', json_build_object('sub', v_riya)::text, true);
  begin
    perform public.fms_help_recategorise(v_p, v_gen, 'reclassify');
    v_fail := v_fail || E'\n  🔴 A CONFIDENTIAL TICKET WAS RE-FILED AS AN ORDINARY ONE';
  exception when others then null;
  end;
  select * into v_row from public.fms_help_tickets where id = v_p;
  if v_row.category_id <> v_posh then
    v_fail := v_fail || E'\n  🔴 the confidential ticket''s category changed despite the refusal';
  end if;

  -- ⚠ REPORT WHAT HAS ALREADY FAILED BEFORE ANY FURTHER `raise`. A hard setup
  --   guard below this point would abort with its own message and SWALLOW every
  --   finding collected so far — which is exactly what happened the first time
  --   this file was run against a build with the move-OUT refusal removed: the
  --   leak was detected, and the output said "test setup" instead.
  if v_fail <> '' then
    raise exception 'HD-6 TEST FAILED:%', v_fail;
  end if;

  -- 8. Handing a confidential ticket on grants access, and says so.
  if public.fms_help_can_see(v_p, v_saloni) then
    raise exception 'test setup: Saloni can already see the POSH ticket';
  end if;
  perform public.fms_help_reassign(v_p, v_saloni, 'Saloni is on the panel');
  if not public.fms_help_can_see(v_p, v_saloni) then
    v_fail := v_fail || E'\n  the person handed a confidential ticket cannot read it';
  end if;
  select count(*) into v_n from public.fms_help_activity
   where entity_id = v_p and type = 'help_ticket_access_granted'
     and (meta->>'user_id')::uuid = v_saloni;
  if v_n <> 1 then
    v_fail := v_fail || E'\n  🔴 somebody was handed a CONFIDENTIAL ticket with no entry naming them';
  end if;

  -- 9. The raiser cannot hand their own ticket around.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  begin
    perform public.fms_help_reassign(v_a, v_saloni, 'you do it');
    v_fail := v_fail || E'\n  🔴 the RAISER reassigned their own ticket';
  exception when others then null;
  end;

  if v_fail <> '' then
    raise exception 'HD-6 TEST FAILED:%', v_fail;
  end if;
  raise notice 'HD-6 test: all assertions passed';
end $t$;

select 'hd6 test passed' as result;
