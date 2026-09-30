-- Behavioural test for HD-3's two RPCs. Runs against the live database inside
-- the caller's transaction, which is ROLLED BACK — nothing is kept.
--
-- The questions:
--   · does acknowledging move the ticket and stamp the clock the FRT report reads?
--   · does resolving in ONE GO still count as a first response?
--   · is a wordless resolution refused?
--   · can the employee who raised it resolve their own ticket? (no)
--
-- ⚠ RUN IT THE WAY supabase/tests/hd2_help_desk_gates.sql IS RUN, and read that
--   file's header first: its FIRST DRAFT WAS VACUOUS, and the only thing that
--   caught it was a negative control. Every assertion here is written so that
--   breaking the rule it guards makes it fail — do not add one you have not
--   watched fail.
--
-- ⚠ THE RPCs READ auth.uid(), WHICH IS NULL IN A PLAIN SQL SESSION. So they are
--   driven through `set local role` + a request.jwt.claims setting, which is how
--   the caller is impersonated without minting a real session. Without this the
--   whole file would pass while testing nothing — every RPC would fail at "Not
--   signed in" and the `exception when others` arms would swallow it.

do $t$
declare
  v_khushi   uuid := (select id from public.profiles where email = 'khushi@orangeotec.com');
  v_stranger uuid := (select p.id from public.profiles p
                       left join public.departments d on d.id = p.department_id
                      where coalesce(d.name,'') <> 'Human Resources'
                        and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')
                        and p.email not like 'zz.test%'
                      order by p.name limit 1);
  v_pay_cat  uuid := (select id from public.fms_help_categories where code = 'payroll_queries');
  v_a        uuid;   -- acknowledged, then resolved
  v_b        uuid;   -- resolved in one go
  v_fail     text := '';
  v_row      public.fms_help_tickets%rowtype;
  v_msg      text;
begin
  if v_khushi is null or v_stranger is null or v_pay_cat is null then
    raise exception 'test setup: could not resolve the people or the category';
  end if;

  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-3001', v_pay_cat, v_stranger, 'ZZ TEST two-step', 'open', 'acknowledge')
  returning id into v_a;
  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-3002', v_pay_cat, v_stranger, 'ZZ TEST one-shot', 'open', 'acknowledge')
  returning id into v_b;

  -- ── act as Khushi, the payroll category's owner ─────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_khushi)::text, true);

  -- 1. Acknowledge moves it on and starts the FRT clock.
  perform public.fms_help_acknowledge(v_a, 'Looking at it now');
  select * into v_row from public.fms_help_tickets where id = v_a;
  if v_row.current_step <> 'resolve' then
    v_fail := v_fail || E'\n  acknowledge left the ticket at ' || coalesce(v_row.current_step, 'null');
  end if;
  if v_row.acknowledged_at is null or v_row.acknowledged_by <> v_khushi then
    v_fail := v_fail || E'\n  acknowledge did not stamp acknowledged_at/by';
  end if;

  -- 2. Acknowledging twice is refused rather than silently re-stamping.
  begin
    perform public.fms_help_acknowledge(v_a, null);
    v_fail := v_fail || E'\n  a second acknowledge was accepted';
  exception when others then null;
  end;

  -- 3. A wordless resolution is refused.
  begin
    perform public.fms_help_resolve(v_a, '   ');
    v_fail := v_fail || E'\n  🔴 a BLANK resolution was accepted';
  exception when others then null;
  end;

  -- 4. Resolving moves it to the employee.
  perform public.fms_help_resolve(v_a, 'Payslip re-sent to your work address.');
  select * into v_row from public.fms_help_tickets where id = v_a;
  if v_row.status <> 'resolved' or v_row.current_step <> 'confirm' then
    v_fail := v_fail || E'\n  resolve left status=' || v_row.status || ' step=' || coalesce(v_row.current_step,'null');
  end if;
  if v_row.resolution is null or v_row.resolved_by <> v_khushi then
    v_fail := v_fail || E'\n  resolve did not record the answer or its author';
  end if;

  -- 5. ⚠ THE ONE THAT MATTERS: resolving straight from `acknowledge` must
  --    back-fill acknowledged_at, or every one-shot answer drops out of the
  --    First Response Time report — which is to say, the fastest ones do, and
  --    the average gets worse the better the desk performs.
  perform public.fms_help_resolve(v_b, 'Answered on the spot.');
  select * into v_row from public.fms_help_tickets where id = v_b;
  if v_row.acknowledged_at is null then
    v_fail := v_fail || E'\n  🔴 a one-shot resolution left acknowledged_at NULL — it would vanish from the FRT report';
  end if;
  if v_row.acknowledged_by <> v_khushi then
    v_fail := v_fail || E'\n  the back-filled acknowledgement credited the wrong person';
  end if;
  if v_row.current_step <> 'confirm' then
    v_fail := v_fail || E'\n  a one-shot resolution did not reach `confirm`';
  end if;

  -- 6. Resolving a ticket already at `confirm` is refused.
  begin
    perform public.fms_help_resolve(v_b, 'again');
    v_fail := v_fail || E'\n  a ticket at `confirm` was resolved a second time';
  exception when others then null;
  end;

  -- ── act as the employee who raised them ─────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);

  -- 7. The raiser cannot answer their own ticket. "Resolved" is the desk's word.
  declare
    v_c uuid;
  begin
    insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
    values ('HD-TEST-3003', v_pay_cat, v_stranger, 'ZZ TEST self-serve', 'open', 'acknowledge')
    returning id into v_c;
    begin
      perform public.fms_help_resolve(v_c, 'I fixed it myself');
      v_fail := v_fail || E'\n  🔴 the RAISER resolved their own ticket';
    exception when others then null;
    end;
  end;

  if v_fail <> '' then
    raise exception 'HD-3 RPC TEST FAILED:%', v_fail;
  end if;
  raise notice 'HD-3 RPC test: all assertions passed';
end $t$;

select 'hd3 rpc test passed' as result;
