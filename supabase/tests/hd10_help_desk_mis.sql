-- Behavioural test for HD-10's MIS. Runs inside the caller's transaction, which
-- is ROLLED BACK.
--
-- The questions:
--   · are CONFIDENTIAL tickets kept out of every count, and the omission stated?
--   · is an UNTIMED category kept out of the compliance denominator?
--   · is 'auto_closed' kept apart from 'confirmed'?
--   · can somebody outside the desk read the MIS at all? (no)
--   · can a Setup step owner read the confidential register? (no)
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
  v_pay   uuid := (select id from public.fms_help_categories where code = 'payroll_queries');   -- 2 working days
  v_ff    uuid := (select id from public.fms_help_categories where code = 'full_and_final');    -- UNTIMED
  v_posh  uuid := (select id from public.fms_help_categories where code = 'posh');              -- confidential
  v_from  date := (now() at time zone 'Asia/Kolkata')::date - 20;
  v_to    date := (now() at time zone 'Asia/Kolkata')::date;
  v_mis   jsonb;
  v_reg   jsonb;
  v_fail  text := '';
  v_sla   jsonb;
begin
  if v_khushi is null or v_riya is null or v_stranger is null then
    raise exception 'test setup: could not resolve the people';
  end if;

  -- Three tickets raised 10 days ago: one met, one untimed, one confidential.
  insert into public.fms_help_tickets
    (ticket_no, category_id, raised_by, subject, status, current_step,
     acknowledged_at, acknowledged_by, resolved_at, resolved_by, resolution,
     confirmed_at, csat_rating, closed_at, closed_reason)
  values
    ('HD-TEST-10A', v_pay, v_stranger, 'ZZ TEST met', 'closed', null,
     now() - interval '10 days' + interval '10 min', v_khushi,
     now() - interval '9 days', v_khushi, 'done',
     now() - interval '9 days', 5, now() - interval '9 days', 'confirmed'),
    ('HD-TEST-10B', v_ff, v_stranger, 'ZZ TEST untimed', 'closed', null,
     now() - interval '10 days' + interval '2 hours', v_khushi,
     now() - interval '1 day', v_khushi, 'done eventually',
     null, null, now() - interval '1 day', 'auto_closed'),
    ('HD-TEST-10C', v_posh, v_stranger, 'ZZ TEST confidential', 'open', 'resolve',
     now() - interval '10 days' + interval '30 min', v_riya, null, null, null,
     null, null, null, null);
  update public.fms_help_tickets set raised_at = now() - interval '10 days'
   where ticket_no like 'HD-TEST-10%';

  -- ══ who may read it ══════════════════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  begin
    perform public.fms_help_mis(v_from, v_to);
    v_fail := v_fail || E'\n  🔴 somebody outside the desk read the MIS';
  exception when others then null;
  end;

  -- ══ the six open reports, as Khushi ══════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_khushi)::text, true);
  v_mis := public.fms_help_mis(v_from, v_to);

  -- 1. ⚠ THE CONFIDENTIAL ONE IS NOT COUNTED, and the omission is STATED. A
  --    total that quietly includes grievances tells a reader how many exist.
  if (v_mis->>'raised')::int <> 2 then
    v_fail := v_fail || E'\n  🔴 the MIS counted ' || (v_mis->>'raised')
                     || ' tickets; the confidential one should be excluded (expected 2)';
  end if;
  if (v_mis->>'excluded_confidential')::int < 1 then
    v_fail := v_fail || E'\n  🔴 the MIS did not say how many confidential tickets it left out';
  end if;
  if v_mis::text ilike '%ZZ TEST confidential%' then
    v_fail := v_fail || E'\n  🔴 a confidential ticket''s SUBJECT appears in the MIS';
  end if;

  -- 2. ⚠ THE UNTIMED ONE IS OUT OF THE DENOMINATOR, not scored either way.
  select x into v_sla from jsonb_array_elements(v_mis->'sla_by_category') x
   where x->>'code' = 'full_and_final';
  if v_sla is null then
    v_fail := v_fail || E'\n  the untimed category is missing from the SLA report entirely';
  else
    if (v_sla->>'timed')::int <> 0 then
      v_fail := v_fail || E'\n  🔴 an UNTIMED ticket was counted in the compliance denominator';
    end if;
    if (v_sla->>'untimed')::int <> 1 then
      v_fail := v_fail || E'\n  the untimed ticket was not reported as untimed';
    end if;
  end if;

  -- 3. The timed one was met (raised 10 days ago, resolved the next day).
  select x into v_sla from jsonb_array_elements(v_mis->'sla_by_category') x
   where x->>'code' = 'payroll_queries';
  if (v_sla->>'timed')::int <> 1 or (v_sla->>'within')::int <> 1 then
    v_fail := v_fail || E'\n  a ticket resolved next day was not counted as within its 2-day TAT';
  end if;

  -- 4. ⚠ 'auto_closed' IS NOT 'confirmed'. Counting silence as satisfaction is
  --    how a desk reports 100% CSAT out of nobody replying.
  if (v_mis->'closure'->>'confirmed')::int <> 1
     or (v_mis->'closure'->>'auto_closed')::int <> 1 then
    v_fail := v_fail || E'\n  🔴 confirmed and auto-closed were not counted separately';
  end if;
  -- ...and the auto-closed one carries no rating, so the average is over one.
  if (v_mis->'closure'->>'rated')::int <> 1 then
    v_fail := v_fail || E'\n  the rating count included a ticket that carries none';
  end if;
  if (v_mis->'closure'->>'csat_avg')::numeric <> 5 then
    v_fail := v_fail || E'\n  🔴 the CSAT average was dragged down by an unrated ticket';
  end if;

  -- 5. First response is in MINUTES and counts the one answered in 10.
  if (v_mis->'first_response'->>'within_target')::int < 1 then
    v_fail := v_fail || E'\n  a ticket answered in 10 minutes did not count inside the 30-minute target';
  end if;

  -- ══ the confidential register ════════════════════════════════════════════
  -- 6. Khushi runs the desk but does NOT own a confidential category.
  begin
    perform public.fms_help_confidential_register(v_from, v_to);
    v_fail := v_fail || E'\n  🔴 an ordinary HR person read the CONFIDENTIAL REGISTER';
  exception when others then null;
  end;

  -- 7. The HR Head can, and it carries dates without the complaint.
  perform set_config('request.jwt.claims', json_build_object('sub', v_riya)::text, true);
  v_reg := public.fms_help_confidential_register(v_from, v_to);
  if jsonb_array_length(v_reg) < 1 then
    v_fail := v_fail || E'\n  the confidential register is empty for the HR Head';
  end if;
  if v_reg::text ilike '%ZZ TEST confidential%' then
    v_fail := v_fail || E'\n  🔴 the REGISTER reprinted the complaint''s subject — it should carry dates only';
  end if;
  if (v_reg->0->>'acked_next_day')::boolean is not true then
    v_fail := v_fail || E'\n  a case acknowledged 30 minutes later was not scored as answered next day';
  end if;

  if v_fail <> '' then
    raise exception 'HD-10 TEST FAILED:%', v_fail;
  end if;
  raise notice 'HD-10 test: all assertions passed';
end $t$;

select 'hd10 test passed' as result;
