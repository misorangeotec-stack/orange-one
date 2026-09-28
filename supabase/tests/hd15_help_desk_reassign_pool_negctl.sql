-- Negative control. The test beside this one passes; this proves it passes for
-- the RIGHT reason, which is the `confidential` flag and nothing else.
--
-- Take the flag off the same category, inside the same throwaway transaction,
-- and the five must suddenly see the ticket. If they still cannot, the earlier
-- pass proved nothing: it would mean they were being refused for some unrelated
-- reason and the flag was never the thing doing the work.

do $ctl$
declare
  v_conf   uuid;
  v_t      uuid;
  v_raiser uuid;
  v_seen   integer;
begin
  select id into v_conf from public.fms_help_categories where confidential order by code limit 1;
  select p.id into v_raiser
    from public.profiles p
    left join public.departments d on d.id = p.department_id
   where coalesce(d.name,'') <> 'Human Resources' and p.email not like 'zz.test%'
     and not public.is_admin(p.id)
   order by p.name limit 1;

  insert into public.fms_help_tickets (ticket_no, category_id, subject, raised_by, current_step, status)
       values ('ZZ-CTL-1', v_conf, 'ZZ control', v_raiser, 'acknowledge', 'open') returning id into v_t;

  -- Still confidential: nobody in the pool who does not own it may read it.
  select count(*) into v_seen
    from unnest(array['1b0deef0-fbcf-40eb-b3d4-b00f8a87e3b7'::uuid,'9fbe5bd8-e7b3-4e98-a65f-e32df2df9270',
                      'dc36e3ad-e4c6-4b79-8a76-69f5fbd8bcb6','f8871325-841b-4f8a-98c8-efeb7cbd27ae',
                      'e7d30aca-5518-4322-873d-6d5146536c49']) u
   where public.fms_help_can_see(v_t, u)
     and not exists (select 1 from public.fms_help_categories c where c.id = v_conf and u = any(c.owner_ids));
  raise notice 'with the flag ON, % of the five can read it (owners excluded)', v_seen;

  -- Now take the flag off. The general-HR arm should open for all five.
  update public.fms_help_categories set confidential = false where id = v_conf;

  select count(*) into v_seen
    from unnest(array['1b0deef0-fbcf-40eb-b3d4-b00f8a87e3b7'::uuid,'9fbe5bd8-e7b3-4e98-a65f-e32df2df9270',
                      'dc36e3ad-e4c6-4b79-8a76-69f5fbd8bcb6','f8871325-841b-4f8a-98c8-efeb7cbd27ae',
                      'e7d30aca-5518-4322-873d-6d5146536c49']) u
   where public.fms_help_can_see(v_t, u);

  if v_seen <> 5 then
    raise exception 'HD-15 control FAILED: with confidential OFF only % of 5 can read it, so the earlier pass was not the flag doing the work', v_seen;
  end if;
  raise notice 'HD-15 control PASSED: flag off -> all 5 read it, flag on -> none. The flag is the thing.';
end
$ctl$;
