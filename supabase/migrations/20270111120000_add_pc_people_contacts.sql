-- ===========================================================================
-- PC-2 · pc_people_contacts() — every person's phone and email, for the
--        Process Coordinator's Call List.
--
-- The Call List is person-first: "Manisha has 4 overdue steps across Purchase and
-- Dispatch — ring her". pc_step_owner_contacts() already gives the coordinator the
-- phone of every STEP OWNER, but a lot of due work is not a step-owner row:
--   · Purchase approval is a value-band matrix (approver, not a step owner),
--   · HR / Exit / Supplies route approvals to a person's HOD,
--   · Help Desk and L&D hand the REQUESTER their own obligation.
-- None of those people are guaranteed to appear in pc_step_owner_contacts(), so
-- the Call List would show them with no number to ring.
--
-- Same reasoning and same gate as pc_step_owner_contacts():
--   · profiles RLS is self + downline + same-department, and
--   · list_org_people() / list_org_people_detail() strip phone and email
--     DELIBERATELY, because the phone doubles as the initial login password.
-- So this is security definer, and refuses anyone pc_is_coordinator() refuses.
--
-- Returns ONLY id, phone, email. Names, departments and designations already come
-- from list_org_people_detail(); repeating them here would give the screen two
-- sources for the same name.
--
-- Purely ADDITIVE: one new function. No table, column, row or policy touched.
-- Rollback: 20270111120000_add_pc_people_contacts_rollback.sql
-- ===========================================================================

create or replace function public.pc_people_contacts()
returns table (
  user_id uuid,
  phone   text,
  email   text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pc_is_coordinator(auth.uid()) then
    raise exception 'you do not have access to the Process Coordinator dashboard';
  end if;

  return query
  select p.id, p.phone, p.email
  from public.profiles p
  order by p.name;
end;
$$;

comment on function public.pc_people_contacts() is
  'Phone and email of every profile, for the Process Coordinator Call List. Gated by '
  'pc_is_coordinator(). Names come from list_org_people_detail(); this returns contacts only.';

revoke all on function public.pc_people_contacts() from public;
grant execute on function public.pc_people_contacts() to authenticated;
