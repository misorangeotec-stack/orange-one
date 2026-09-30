-- Behavioural test for HD-5: confirming, reopening, the escalation ladder and
-- auto-close. Runs against the live database inside the caller's transaction,
-- which is ROLLED BACK.
--
-- The questions:
--   · does confirming close the ticket and keep the rating?
--   · does reopen #1 fire level 1, and reopen #2 fire level 2?
--   · do the escalated people actually become able to ACT? (or the alarm is theatre)
--   · does a level naming nobody fall back — and say so when there is no fallback?
--   · does auto-close mark itself 'auto_closed' with NO rating?
--
-- ⚠ READ supabase/tests/hd2_help_desk_gates.sql's HEADER FIRST: its first draft
--   was vacuous and only a negative control caught it.

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
  v_l2       uuid := (select p.id from public.profiles p
                       left join public.departments d on d.id = p.department_id
                      where coalesce(d.name,'') <> 'Human Resources'
                        and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')
                        and p.email not like 'zz.test%'
                      order by p.name offset 1 limit 1);
  v_cat      uuid := (select id from public.fms_help_categories where code = 'payroll_queries');
  v_a uuid; v_b uuid; v_c uuid;
  v_row public.fms_help_tickets%rowtype;
  v_fail text := '';
  v_n int;
begin
  if v_khushi is null or v_riya is null or v_stranger is null or v_l2 is null then
    raise exception 'test setup: could not resolve four distinct people';
  end if;

  -- Payroll's ladder as the sheet seeds it: L1 = HR Head, L2 = label only.
  -- Give L2 a real person for the test, so "did level 2 fire" is answerable.
  update public.fms_help_categories set escalation_l2_ids = array[v_l2] where id = v_cat;

  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-5001', v_cat, v_stranger, 'ZZ TEST confirm', 'open', 'acknowledge') returning id into v_a;
  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-5002', v_cat, v_stranger, 'ZZ TEST reopen', 'open', 'acknowledge') returning id into v_b;

  -- ══ HR answers both ══════════════════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_khushi)::text, true);
  perform public.fms_help_resolve(v_a, 'Sorted.');
  perform public.fms_help_resolve(v_b, 'Sorted.');

  -- 1. The DESK cannot confirm on the employee's behalf.
  begin
    perform public.fms_help_confirm(v_a, 5, null);
    v_fail := v_fail || E'\n  🔴 the DESK confirmed satisfaction on the employee''s behalf';
  exception when others then null;
  end;

  -- ══ the employee ═════════════════════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);

  -- 2. A rating outside 1-5 is refused.
  begin
    perform public.fms_help_confirm(v_a, 9, null);
    v_fail := v_fail || E'\n  a rating of 9 was accepted';
  exception when others then null;
  end;

  -- 3. Confirming closes it and keeps the rating.
  perform public.fms_help_confirm(v_a, 4, 'Quick, thanks.');
  select * into v_row from public.fms_help_tickets where id = v_a;
  if v_row.status <> 'closed' or v_row.closed_reason <> 'confirmed' or v_row.current_step is not null then
    v_fail := v_fail || E'\n  confirming did not close the ticket as ''confirmed''';
  end if;
  if coalesce(v_row.csat_rating, 0) <> 4 then
    v_fail := v_fail || E'\n  the satisfaction rating was not kept';
  end if;

  -- 4. A reason is mandatory on a reopen.
  begin
    perform public.fms_help_reopen(v_b, '   ');
    v_fail := v_fail || E'\n  a reopen with no reason was accepted';
  exception when others then null;
  end;

  -- 5. ⚠ REOPEN #1 FIRES LEVEL 1 AND NOT LEVEL 2.
  perform public.fms_help_reopen(v_b, 'Still the wrong month.');
  select * into v_row from public.fms_help_tickets where id = v_b;
  if v_row.reopen_count <> 1 then
    v_fail := v_fail || E'\n  reopen did not count (got ' || v_row.reopen_count || ')';
  end if;
  if v_row.status <> 'open' or v_row.current_step <> 'resolve' then
    v_fail := v_fail || E'\n  reopen did not send the ticket back to the desk';
  end if;
  if v_row.escalated_l1_at is null then
    v_fail := v_fail || E'\n  🔴 reopen #1 did NOT fire escalation level 1';
  end if;
  if v_row.escalated_l2_at is not null then
    v_fail := v_fail || E'\n  🔴 reopen #1 fired level 2 as well — the ladder skipped a rung';
  end if;
  -- The old resolution is cleared so the next one replaces it, but the argument
  -- survives on the timeline.
  if v_row.resolution is not null then
    v_fail := v_fail || E'\n  reopen left the old resolution in place';
  end if;
  select count(*) into v_n from public.fms_help_activity
   where entity_id = v_b and type = 'help_ticket_resolved';
  if v_n < 1 then
    v_fail := v_fail || E'\n  the superseded resolution is not on the timeline';
  end if;

  -- 6. The HR Head (level 1) can now ACT on it. An escalation that notifies
  --    somebody who cannot act is theatre.
  if not public.fms_help_can_act('resolve', v_b, v_riya) then
    v_fail := v_fail || E'\n  🔴 escalation level 1 was notified but cannot act on the ticket';
  end if;
  -- ...and level 2 is NOT in yet.
  if public.fms_help_can_act('resolve', v_b, v_l2) then
    v_fail := v_fail || E'\n  🔴 escalation level 2 can act after only one reopen';
  end if;

  -- 7. ⚠ REOPEN #2 FIRES LEVEL 2.
  perform set_config('request.jwt.claims', json_build_object('sub', v_khushi)::text, true);
  perform public.fms_help_resolve(v_b, 'Try again.');
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  perform public.fms_help_reopen(v_b, 'Still wrong.');
  select * into v_row from public.fms_help_tickets where id = v_b;
  if v_row.reopen_count <> 2 then
    v_fail := v_fail || E'\n  the second reopen did not count';
  end if;
  if v_row.escalated_l2_at is null then
    v_fail := v_fail || E'\n  🔴 reopen #2 did NOT fire escalation level 2';
  end if;
  if not public.fms_help_can_act('resolve', v_b, v_l2) then
    v_fail := v_fail || E'\n  🔴 escalation level 2 was notified but cannot act';
  end if;

  -- 8. A level naming NOBODY, with no fallback set, records the escalation and
  --    notifies nobody — the state every Level 2 is in today.
  update public.fms_help_categories set escalation_l1_ids = '{}', escalation_l2_ids = '{}' where id = v_cat;
  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-5003', v_cat, v_stranger, 'ZZ TEST no ladder', 'open', 'acknowledge') returning id into v_c;
  perform set_config('request.jwt.claims', json_build_object('sub', v_khushi)::text, true);
  perform public.fms_help_resolve(v_c, 'Done.');
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  perform public.fms_help_reopen(v_c, 'No.');
  select count(*) into v_n from public.fms_help_activity
   where entity_id = v_c and type = 'help_ticket_reopened' and (meta->>'notified_anyone')::boolean = false;
  if v_n <> 1 then
    v_fail := v_fail || E'\n  an escalation with nobody behind it did not record that it reached nobody';
  end if;

  -- 9. AUTO-CLOSE marks itself, and never invents a rating.
  update public.fms_help_config
     set value = jsonb_set(value, '{auto_close_enabled}', 'true'::jsonb) where key = 'policy';
  insert into public.fms_help_tickets
    (ticket_no, category_id, raised_by, subject, status, current_step, acknowledged_at, resolved_at, resolved_by, resolution)
  values ('HD-TEST-5004', v_cat, v_stranger, 'ZZ TEST ignored', 'resolved', 'confirm',
          now() - interval '40 days', now() - interval '30 days', v_khushi, 'Answered ages ago');
  perform public.fms_help_auto_close();
  select * into v_row from public.fms_help_tickets where ticket_no = 'HD-TEST-5004';
  if v_row.status <> 'closed' or v_row.closed_reason <> 'auto_closed' then
    v_fail := v_fail || E'\n  🔴 auto-close did not close an ignored ticket as ''auto_closed''';
  end if;
  if v_row.csat_rating is not null then
    v_fail := v_fail || E'\n  🔴 auto-close INVENTED a satisfaction rating';
  end if;
  -- ...and it leaves a freshly resolved one alone.
  select * into v_row from public.fms_help_tickets where id = v_c;
  if v_row.status = 'closed' and v_row.closed_reason = 'auto_closed' then
    v_fail := v_fail || E'\n  auto-close swept a ticket that is still inside its window';
  end if;

  if v_fail <> '' then
    raise exception 'HD-5 TEST FAILED:%', v_fail;
  end if;
  raise notice 'HD-5 test: all assertions passed';
end $t$;

select 'hd5 test passed' as result;
