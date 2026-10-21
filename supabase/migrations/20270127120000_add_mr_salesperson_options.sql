-- ===========================================================================
-- MR-1C · mr_salesperson_options(): who can be a machine's salesperson in
--         Machine Resale, with the email the inquiry alert is sent to.
--
-- Machine Resale keeps its data in its own Supabase project (the portal). A
-- machine stores its salesperson as a snapshot: hub user id, name and email. The
-- alert for every website inquiry goes to that email, so the picker in the
-- machine form needs it.
--
-- The hub's people directory cannot give it:
--   · profiles RLS is self + downline + same department, and
--   · list_org_people() / list_org_people_detail() strip phone and email
--     DELIBERATELY, because the phone doubles as the initial login password.
--
-- So this is security definer, like pc_people_contacts(), with two limits:
--   · CALLER: staff who can EDIT Machine Resale (module_level = 'edit'; admins
--     come back as 'edit'). A view-only user cannot pick a salesperson, so has
--     no use for the list.
--   · RESULT: only people who can OPEN Machine Resale (an app_access row, or
--     admin), the same set fms_hr_module_user_ids() uses for New Recruitment.
--     The alert links into the hub, so a salesperson without access would get a
--     link they cannot open. External accounts never appear.
--
-- Returns no phone. Purely ADDITIVE: one new function, nothing else touched.
-- Rollback: 20270127120000_add_mr_salesperson_options_rollback.sql
-- ===========================================================================

create or replace function public.mr_salesperson_options()
returns table (
  user_id     uuid,
  name        text,
  email       text,
  designation text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not public.is_staff(auth.uid())
     or public.module_level(auth.uid(), 'machine-resale') <> 'edit' then
    raise exception 'Only people who can edit Machine Resale can pick a salesperson.';
  end if;

  return query
  select p.id, p.name, p.email, p.designation
    from public.profiles p
   where coalesce(p.is_external, false) = false
     and p.id in (
       select a.user_id from public.app_access a where a.app_id = 'machine-resale'
       union
       select r.user_id from public.user_roles r where r.role = 'admin'
     )
   order by p.name;
end;
$$;

comment on function public.mr_salesperson_options() is
  'People who can open Machine Resale (app_access row or admin), with email, for the '
  'salesperson picker. Callable only by staff with edit on machine-resale. No phone.';

revoke all on function public.mr_salesperson_options() from public;
revoke execute on function public.mr_salesperson_options() from anon;
grant execute on function public.mr_salesperson_options() to authenticated;
