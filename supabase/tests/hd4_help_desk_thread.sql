-- Behavioural test for HD-4's thread and question-and-answer loop. Runs against
-- the live database inside the caller's transaction, which is ROLLED BACK.
--
-- The questions:
--   · does asking somebody MOVE the ticket off the desk? (the SLA depends on it)
--   · can the raiser comment on their own ticket while it sits with HR?
--   · does a mention of somebody who cannot see the ticket get dropped, not raise?
--   · does asking a third party on a CONFIDENTIAL ticket grant access AND say so?
--   · does answering bring it back, without revoking that access?
--
-- ⚠ READ supabase/tests/hd2_help_desk_gates.sql's HEADER FIRST. Its first draft
--   was vacuous and only a negative control caught it. Every assertion here has
--   been watched failing.

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
  -- A second outsider, to be dragged into a confidential ticket.
  v_third    uuid := (select p.id from public.profiles p
                       left join public.departments d on d.id = p.department_id
                      where coalesce(d.name,'') <> 'Human Resources'
                        and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')
                        and p.email not like 'zz.test%'
                      order by p.name offset 1 limit 1);
  v_pay_cat  uuid := (select id from public.fms_help_categories where code = 'payroll_queries');
  v_posh_cat uuid := (select id from public.fms_help_categories where code = 'posh');
  v_pay      uuid;
  v_posh     uuid;
  v_fail     text := '';
  v_row      public.fms_help_tickets%rowtype;
  v_n        int;
begin
  if v_khushi is null or v_riya is null or v_stranger is null or v_third is null then
    raise exception 'test setup: could not resolve four distinct people';
  end if;

  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-4001', v_pay_cat, v_stranger, 'ZZ TEST payroll thread', 'open', 'acknowledge')
  returning id into v_pay;
  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-4002', v_posh_cat, v_stranger, 'ZZ TEST posh thread', 'open', 'acknowledge')
  returning id into v_posh;

  -- ══ as the employee who raised it ════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);

  -- 1. The raiser can chase their own ticket even though they own no step.
  --    (Gated on can_SEE, not can_ACT — see the RPC's header.)
  perform public.fms_help_post_comment(v_pay, 'Any update on this?', '{}', '[]'::jsonb);
  select count(*) into v_n from public.fms_help_activity
   where entity_id = v_pay and type = 'comment';
  if v_n <> 1 then
    v_fail := v_fail || E'\n  the raiser could not comment on their own ticket';
  end if;

  -- 2. A mention of somebody who cannot see the ticket is DROPPED, not raised.
  --    Riya owns POSH, not payroll, and is in no pool here.
  perform public.fms_help_post_comment(v_pay, 'Tagging someone who cannot see this', array[v_riya], '[]'::jsonb);
  select count(*) into v_n from public.fms_help_notifications
   where entity_id = v_pay and user_id = v_riya;
  if v_n <> 0 then
    v_fail := v_fail || E'\n  🔴 a mention notified somebody who cannot see the ticket';
  end if;

  -- 3. The raiser cannot MOVE the ticket — reading is not acting.
  begin
    perform public.fms_help_request_info(v_pay, v_khushi, 'answer me');
    v_fail := v_fail || E'\n  🔴 the RAISER parked their own ticket on HR';
  exception when others then null;
  end;

  -- ══ as Khushi, who owns the payroll category ═════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_khushi)::text, true);

  -- 4. Asking MOVES the ticket off the desk. Without this the SLA report
  --    measures how slowly employees answer their own questions.
  perform public.fms_help_request_info(v_pay, v_stranger, 'Which month is this about?');
  select * into v_row from public.fms_help_tickets where id = v_pay;
  if v_row.status <> 'awaiting_info' or v_row.current_step <> 'awaiting_info' then
    v_fail := v_fail || E'\n  🔴 asking did not move the ticket: status=' || v_row.status
                     || ' step=' || coalesce(v_row.current_step, 'null');
  end if;
  if v_row.info_from_user_id <> v_stranger or v_row.info_requested_at is null then
    v_fail := v_fail || E'\n  asking did not record who was asked or when';
  end if;
  if v_row.round_no <> 1 then
    v_fail := v_fail || E'\n  asking did not bump round_no (got ' || v_row.round_no || ')';
  end if;
  -- Asking IS responding, so the FRT clock stops here too.
  if v_row.acknowledged_at is null then
    v_fail := v_fail || E'\n  asking left acknowledged_at NULL — it would vanish from the FRT report';
  end if;

  -- 5. Asking yourself is refused: it would park the ticket on your own desk.
  begin
    perform public.fms_help_request_info(v_posh, v_khushi, 'note to self');
    v_fail := v_fail || E'\n  a person asked THEMSELVES for information';
  exception when others then null;
  end;

  -- ══ as the employee, answering ═══════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);

  perform public.fms_help_answer_info(v_pay, 'August.', '[]'::jsonb);
  select * into v_row from public.fms_help_tickets where id = v_pay;
  if v_row.status <> 'open' or v_row.current_step <> 'resolve' then
    v_fail := v_fail || E'\n  answering did not bring the ticket back to the desk';
  end if;
  if v_row.info_answered_at is null then
    v_fail := v_fail || E'\n  answering did not stamp info_answered_at';
  end if;
  if v_row.info_from_user_id is null then
    v_fail := v_fail || E'\n  answering CLEARED info_from_user_id — the record of who was asked is gone';
  end if;

  -- ══ the confidential path, as the HR Head who owns POSH ══════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_riya)::text, true);

  if public.fms_help_can_see(v_posh, v_third) then
    raise exception 'test setup: the third party can already see the POSH ticket';
  end if;

  perform public.fms_help_request_info(v_posh, v_third, 'Were you present on the 14th?');

  -- 6. They can now read it — they have to, to answer the question.
  if not public.fms_help_can_see(v_posh, v_third) then
    v_fail := v_fail || E'\n  the person asked cannot read the question they were asked';
  end if;

  -- 7. ⚠ AND IT IS SAID OUT LOUD. One click widened the audience of the most
  --    sensitive record in the hub; the timeline must name who was let in.
  select count(*) into v_n from public.fms_help_activity
   where entity_id = v_posh and type = 'help_ticket_access_granted'
     and (meta->>'user_id')::uuid = v_third;
  if v_n <> 1 then
    v_fail := v_fail || E'\n  🔴 a third party was given access to a CONFIDENTIAL ticket with no entry naming them';
  end if;

  -- 8. Asking the RAISER on a confidential ticket grants nothing new, so it must
  --    NOT write that entry — an alarm that fires on nothing gets ignored.
  --
  --    ⚠ The third party has to ANSWER first: a ticket already parked on somebody
  --      cannot be parked on somebody else, and the RPC says so. That refusal is
  --      correct — it is what stops a ticket being passed round three people at
  --      once with nobody owing it — and the first draft of this test tripped
  --      over it, which is how it got written down here.
  perform set_config('request.jwt.claims', json_build_object('sub', v_third)::text, true);
  perform public.fms_help_answer_info(v_posh, 'I was not there.', '[]'::jsonb);
  perform set_config('request.jwt.claims', json_build_object('sub', v_riya)::text, true);

  perform public.fms_help_request_info(v_posh, v_stranger, 'Anything to add?');
  select count(*) into v_n from public.fms_help_activity
   where entity_id = v_posh and type = 'help_ticket_access_granted';
  if v_n <> 1 then
    v_fail := v_fail || E'\n  asking the raiser logged a spurious access grant (' || v_n || ' entries)';
  end if;

  -- 9. A ticket already parked on one person cannot be parked on another.
  begin
    perform public.fms_help_request_info(v_posh, v_third, 'and you?');
    v_fail := v_fail || E'
  🔴 a ticket already awaiting one person was handed to a second';
  exception when others then null;
  end;

  if v_fail <> '' then
    raise exception 'HD-4 THREAD TEST FAILED:%', v_fail;
  end if;
  raise notice 'HD-4 thread test: all assertions passed';
end $t$;

select 'hd4 thread test passed' as result;
