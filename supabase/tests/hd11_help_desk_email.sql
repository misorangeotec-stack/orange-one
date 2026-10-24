-- Behavioural test for HD-11's email arm. Runs inside the caller's transaction,
-- which is ROLLED BACK — no mail is ever queued for real.
--
-- The questions:
--   · with the gate OFF, is nothing queued at all?
--   · with it ON, is there one row PER RECIPIENT (the mailer has no Cc)?
--   · does a CONFIDENTIAL ticket keep its subject out of the mail?
--   · are comments and access-grant lines bell-only?
--
-- ⚠ IT TURNS THE GATE ON INSIDE THE TRANSACTION AND ROLLS IT BACK. Nothing is
--   delivered because the outbox rows never commit, so the AFTER INSERT dispatch
--   trigger never fires on a committed row. Do not lift these inserts out of a
--   rolled-back transaction to "check it properly" — that sends real mail to
--   real people.

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
  v_a uuid; v_c uuid;
  v_n int;
  v_fail text := '';
  v_row public.email_outbox%rowtype;
begin
  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-11A', v_pay, v_stranger, 'ZZ TEST ordinary subject', 'open', 'acknowledge') returning id into v_a;
  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-11C', v_posh, v_stranger, 'ZZ TEST secret subject', 'open', 'acknowledge') returning id into v_c;

  perform set_config('request.jwt.claims', json_build_object('sub', v_khushi)::text, true);

  -- 1. ⚠ GATE OFF — the state this ships in. Nothing may be queued.
  perform public.fms_help_announce('ticket', v_a, 'help_ticket_resolved', 'x',
                                   array[v_stranger, v_riya], '{}'::jsonb);
  select count(*) into v_n from public.email_outbox where entity_id = v_a;
  if v_n <> 0 then
    v_fail := v_fail || E'\n  🔴 mail was queued with the module gate OFF (' || v_n || ' rows)';
  end if;

  -- ── turn it on, inside this doomed transaction ─────────────────────────
  update public.email_module_settings set enabled = true where module_id = 'help-desk';

  -- 2. ONE ROW PER RECIPIENT. The mailer composes To / Reply-To only; there is
  --    no Cc column on email_outbox, so two recipients must be two rows.
  perform public.fms_help_announce('ticket', v_a, 'help_ticket_reopened', 'sent back',
                                   array[v_stranger, v_riya], '{}'::jsonb);
  select count(*) into v_n from public.email_outbox
   where entity_id = v_a and kind = 'help-desk_help_ticket_reopened';
  if v_n <> 2 then
    v_fail := v_fail || E'\n  🔴 expected one outbox row per recipient, got ' || v_n;
  end if;

  -- 3. The kind carries the module prefix the mailer matches on.
  select * into v_row from public.email_outbox
   where entity_id = v_a and kind like 'help-desk\_%' limit 1;
  if v_row.kind is null then
    v_fail := v_fail || E'\n  🔴 the outbox kind has no `help-desk_` prefix — the mailer would skip it silently';
  end if;
  if v_row.to_email is null then
    v_fail := v_fail || E'\n  an outbox row was queued with no address';
  end if;

  -- 4. ⚠⚠ A CONFIDENTIAL TICKET NEVER MAILS ITS SUBJECT. An inbox is the least
  --    controlled place in the company, and decision D4 is that a grievance is
  --    readable only in the hub, by named people.
  perform public.fms_help_announce('ticket', v_c, 'help_ticket_resolved', 'ZZ TEST secret subject',
                                   array[v_stranger], '{}'::jsonb);
  select count(*) into v_n from public.email_outbox
   where entity_id = v_c and payload::text ilike '%secret subject%';
  if v_n <> 0 then
    v_fail := v_fail || E'\n  🔴 A CONFIDENTIAL TICKET''S SUBJECT WAS PUT IN AN EMAIL';
  end if;
  select count(*) into v_n from public.email_outbox
   where entity_id = v_c and (payload->>'confidential')::boolean;
  if v_n <> 1 then
    v_fail := v_fail || E'\n  the confidential mail was not flagged as such for the renderer';
  end if;
  -- ...but it still tells them to go and look.
  select count(*) into v_n from public.email_outbox
   where entity_id = v_c and payload->>'text' ilike '%HD-TEST-11C%';
  if v_n <> 1 then
    v_fail := v_fail || E'\n  the confidential mail does not name the ticket to open';
  end if;

  -- 5. Comments are bell-only: mailing every note turns the desk into a mailing
  --    list nobody reads.
  perform public.fms_help_announce('ticket', v_a, 'comment', 'just a note',
                                   array[v_riya], '{}'::jsonb);
  select count(*) into v_n from public.email_outbox where entity_id = v_a and kind like '%comment';
  if v_n <> 0 then
    v_fail := v_fail || E'\n  a plain comment queued an email';
  end if;

  -- 6. The actor is never mailed about their own action.
  --
  -- ⚠ SCOPED TO THIS TEST'S OWN TICKETS. The first draft counted every row in
  --   public.email_outbox for that person and failed immediately — on rows other
  --   modules had queued for her long before this test ran. An assertion over a
  --   LIVE shared table has to name its own rows or it reports somebody else's
  --   history as this code's bug.
  select count(*) into v_n from public.email_outbox
   where to_user_id = v_khushi and entity_id in (v_a, v_c);
  if v_n <> 0 then
    v_fail := v_fail || E'\n  🔴 the person who did the thing was emailed about it';
  end if;

  if v_fail <> '' then
    raise exception 'HD-11 EMAIL TEST FAILED:%', v_fail;
  end if;
  raise notice 'HD-11 email test: all assertions passed';
end $t$;

select 'hd11 email test passed' as result;
