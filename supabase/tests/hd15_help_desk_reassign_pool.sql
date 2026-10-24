-- Putting the five HR people in the reassign pool widens fms_help_can_see, because
-- the general-HR arm of that gate names fms_help_is_reassign_target. The question
-- this asks is whether it widened TOO FAR: a POSH complaint must stay invisible to
-- the very people who can now reassign everything else, since it may be about one
-- of them.
--
-- Run by rehearse.py, so the ticket it creates never exists.

do $t$
declare
  v_ord   uuid;   -- an ordinary category
  v_conf  uuid;   -- a confidential one
  v_t_ord uuid;
  v_t_con uuid;
  v_raiser uuid;
  r        record;
  v_fail   text := '';
begin
  select id into v_ord  from public.fms_help_categories where not confidential and owner_ids <> '{}' order by code limit 1;
  select id into v_conf from public.fms_help_categories where confidential order by code limit 1;
  -- Somebody outside HR raises both, so no arm but the pool can explain a read.
  select p.id into v_raiser
    from public.profiles p
    left join public.departments d on d.id = p.department_id
   where coalesce(d.name,'') <> 'Human Resources'
     and p.email not like 'zz.test%'
     and not public.is_admin(p.id)
   order by p.name limit 1;

  if v_ord is null or v_conf is null or v_raiser is null then
    raise exception 'setup: ordinary=%, confidential=%, raiser=%', v_ord, v_conf, v_raiser;
  end if;

  -- A literal ticket_no, so the probe never touches the FY counter that
  -- decides what HR's first real ticket is called.
  insert into public.fms_help_tickets (ticket_no, category_id, subject, raised_by, current_step, status)
       values ('ZZ-PROBE-1', v_ord,  'ZZ probe ordinary',     v_raiser, 'acknowledge', 'open') returning id into v_t_ord;
  insert into public.fms_help_tickets (ticket_no, category_id, subject, raised_by, current_step, status)
       values ('ZZ-PROBE-2', v_conf, 'ZZ probe confidential', v_raiser, 'acknowledge', 'open') returning id into v_t_con;

  for r in
    select p.id, p.name
      from public.profiles p
     where p.id in ('1b0deef0-fbcf-40eb-b3d4-b00f8a87e3b7','9fbe5bd8-e7b3-4e98-a65f-e32df2df9270',
                    'dc36e3ad-e4c6-4b79-8a76-69f5fbd8bcb6','f8871325-841b-4f8a-98c8-efeb7cbd27ae',
                    'e7d30aca-5518-4322-873d-6d5146536c49')
     order by p.name
  loop
    -- The point of the pool: every one of them must see an ordinary ticket.
    if not public.fms_help_can_see(v_t_ord, r.id) then
      v_fail := v_fail || E'\n  ' || r.name || ' CANNOT see an ordinary ticket, so the pool did nothing';
    end if;

    -- 🔴 The line that must not move. Owning the confidential category is the
    --    only way in, so anyone who is not its owner must be refused.
    if public.fms_help_can_see(v_t_con, r.id)
       and not exists (select 1 from public.fms_help_categories c where c.id = v_conf and r.id = any(c.owner_ids))
       and not public.is_admin(r.id) then
      v_fail := v_fail || E'\n  🔴 ' || r.name || ' CAN READ A CONFIDENTIAL TICKET and does not own that category';
    end if;
  end loop;

  if v_fail <> '' then
    raise exception 'HD-15 FAILED:%', v_fail;
  end if;
  raise notice 'HD-15 PASSED: all five see ordinary tickets, none of them reaches a confidential one they do not own';
end
$t$;
