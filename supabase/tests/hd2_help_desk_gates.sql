-- Behavioural test for HD-2's two gates. Runs against the live database inside
-- the caller's transaction, which is rolled back — nothing is kept.
--
-- The question: does a POSH complaint stay invisible to the HR pool, while an
-- ordinary ticket behaves like an ordinary ticket?

do $t$
declare
  v_admin     uuid := (select id from public.profiles where email = 'master@taskflow.app');
  v_riya      uuid := (select id from public.profiles where email = 'riya@orangeotec.com');
  v_khushi    uuid := (select id from public.profiles where email = 'khushi@orangeotec.com');
  -- A plain employee with no HR role at all.
  v_stranger  uuid := (select p.id from public.profiles p
                        left join public.departments d on d.id = p.department_id
                       where coalesce(d.name,'') <> 'Human Resources'
                         and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')
                         and p.email not like 'zz.test%'
                       order by p.name limit 1);
  v_posh_cat  uuid := (select id from public.fms_help_categories where code = 'posh');
  v_pay_cat   uuid := (select id from public.fms_help_categories where code = 'payroll_queries');
  v_posh      uuid;
  v_pay       uuid;
  v_fail      text := '';
begin
  if v_admin is null or v_riya is null or v_khushi is null or v_stranger is null then
    raise exception 'test setup: could not resolve the four people';
  end if;

  -- Two tickets raised by the same ordinary employee: one confidential, one not.
  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-0001', v_posh_cat, v_stranger, 'ZZ TEST posh', 'open', 'acknowledge')
  returning id into v_posh;
  insert into public.fms_help_tickets (ticket_no, category_id, raised_by, subject, status, current_step)
  values ('HD-TEST-0002', v_pay_cat, v_stranger, 'ZZ TEST payroll', 'open', 'acknowledge')
  returning id into v_pay;

  -- ⚠ PUT KHUSHI IN THE GENERAL HR POOL FIRST, or this whole test is vacuous:
  --   with fms_help_step_owners empty she fails that arm anyway and the
  --   confidential flag is never what is being tested. (The first draft of this
  --   file made exactly that mistake, and its negative control passed.)
  insert into public.fms_help_step_owners (step_key, employee_ids)
  values ('resolve', array[v_khushi]), ('acknowledge', array[v_khushi]);
  update public.fms_help_config
     set value = jsonb_build_object('department_ids','[]'::jsonb,'user_ids', to_jsonb(array[v_khushi::text]))
   where key = 'reassign_pool';

  -- Sanity: she must now see an ORDINARY ticket she does not own, or the pool
  -- did not take and everything below is meaningless again.
  if not public.fms_help_can_see(v_pay, v_khushi) then
    raise exception 'test setup: the HR pool did not take — the confidential assertions would be vacuous';
  end if;

  -- ── the confidential one ────────────────────────────────────────────────
  if not public.fms_help_can_see(v_posh, v_stranger) then
    v_fail := v_fail || E'\n  the RAISER cannot see their own POSH complaint';
  end if;
  if not public.fms_help_can_see(v_posh, v_riya) then
    v_fail := v_fail || E'\n  the HR HEAD (its category owner) cannot see the POSH complaint';
  end if;
  if not public.fms_help_can_see(v_posh, v_admin) then
    v_fail := v_fail || E'\n  an ADMIN cannot see the POSH complaint';
  end if;
  -- THE ONE THAT MATTERS: Khushi is HR, but not an owner of this category.
  if public.fms_help_can_see(v_posh, v_khushi) then
    v_fail := v_fail || E'\n  🔴 KHUSHI (HR, not the owner) CAN SEE THE POSH COMPLAINT';
  end if;
  if public.fms_help_can_act('resolve', v_posh, v_khushi) then
    v_fail := v_fail || E'\n  🔴 KHUSHI can ACT on the POSH complaint';
  end if;

  -- Naming somebody as Escalation L2 must not, by itself, open the ticket.
  update public.fms_help_categories set escalation_l2_ids = array[v_khushi] where id = v_posh_cat;
  if public.fms_help_can_see(v_posh, v_khushi) then
    v_fail := v_fail || E'\n  🔴 being NAMED as escalation L2 opened the ticket before it escalated';
  end if;
  -- ...but actually escalating to her must.
  update public.fms_help_tickets set escalated_l2_at = now() where id = v_posh;
  if not public.fms_help_can_see(v_posh, v_khushi) then
    v_fail := v_fail || E'\n  escalating to L2 did NOT open the ticket to her';
  end if;
  if not public.fms_help_can_act('resolve', v_posh, v_khushi) then
    v_fail := v_fail || E'\n  escalated to L2 but cannot act — the notification would be theatre';
  end if;

  -- ── the ordinary one ────────────────────────────────────────────────────
  if not public.fms_help_can_see(v_pay, v_khushi) then
    v_fail := v_fail || E'\n  the payroll ticket''s own OWNER cannot see it';
  end if;
  if not public.fms_help_can_act('acknowledge', v_pay, v_khushi) then
    v_fail := v_fail || E'\n  the payroll ticket''s owner cannot acknowledge it';
  end if;
  if public.fms_help_can_see(v_pay, v_riya) then
    v_fail := v_fail || E'\n  the HR HEAD can see a payroll ticket she does not own and was not escalated';
  end if;

  -- `confirm` belongs to the raiser alone: the desk says "resolved", the
  -- employee says "satisfied".
  if public.fms_help_can_act('confirm', v_pay, v_khushi) then
    v_fail := v_fail || E'\n  🔴 the OWNER can confirm satisfaction on behalf of the employee';
  end if;
  if not public.fms_help_can_act('confirm', v_pay, v_stranger) then
    v_fail := v_fail || E'\n  the raiser cannot confirm their own ticket';
  end if;

  -- A closed ticket is readable but not actionable.
  update public.fms_help_tickets
     set status = 'closed', current_step = null, closed_at = now(), closed_reason = 'confirmed'
   where id = v_pay;
  if not public.fms_help_can_see(v_pay, v_khushi) then
    v_fail := v_fail || E'\n  a CLOSED ticket became unreadable';
  end if;
  if public.fms_help_can_act('resolve', v_pay, v_khushi) then
    v_fail := v_fail || E'\n  a CLOSED ticket is still actionable';
  end if;

  -- Storage paths follow the ticket, not the bucket.
  if public.fms_help_can_add_doc(v_posh::text || '/raise/1-x.pdf', v_riya) then
    v_fail := v_fail || E'\n  the HR Head could upload into the RAISE slot of somebody else''s ticket';
  end if;
  if not public.fms_help_can_add_doc(v_posh::text || '/raise/1-x.pdf', v_stranger) then
    v_fail := v_fail || E'\n  the raiser cannot attach their own evidence';
  end if;

  if v_fail <> '' then
    raise exception 'HD-2 GATE TEST FAILED:%', v_fail;
  end if;

  raise notice 'HD-2 gate test: all assertions passed';
end $t$;

select 'hd2 gate test passed' as result;
