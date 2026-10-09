-- ===========================================================================
-- Travel Desk · "Can raise for" — the people a coordinator may file a trip for.
--
-- WHY
-- ---
-- A coordinator is allowed to raise a trip on somebody's behalf, and the SQL has
-- always agreed (fms_travel_save_draft / fms_travel_submit_trip accept any
-- traveller from a coordinator). The BROWSER did not: the Traveller picker is
-- built from the directory, and `profiles` is RLS'd to self + downline + same
-- department. A coordinator who is not an admin therefore saw only her own team,
-- and the senior people she actually raises for never reached the page.
--
-- WHAT
-- ----
--   * config key 'raise_for' → {"user_ids": [...]}, set by an admin on
--     Settings → Setup. Plain fms_travel_config row; its existing admin-only
--     write policy is the authority, nothing new to guard.
--   * fms_travel_raise_for_people() — the travel fields of exactly those people
--     (band, manager links, employee code, and the passenger details an airline
--     needs), for a COORDINATOR only. Anybody else gets zero rows, not an error:
--     it feeds a picker, and an empty picker is right for them.
--
-- ⚠ THE PEOPLE ON THE LIST NEED NO TRAVEL DESK ACCESS. They are travellers, not
--   users of the module; submit freezes their band and routes to THEIR managers
--   server-side, exactly as before.
--
-- ⚠ phone IS RETURNED, and phone doubles as the initial login password. That is
--   why this is not list_org_people: the rows go only to a coordinator, only for
--   the named people, and the passenger row needs a mobile for the ticket.
--
-- Additive only: one config row (inserted empty, never overwritten) and one new
-- function. Rollback: 20261231120000_fms_travel_raise_for_list_rollback.sql.
-- ===========================================================================

begin;

insert into public.fms_travel_config (key, value)
values ('raise_for', '{"user_ids": []}'::jsonb)
on conflict (key) do nothing;

create or replace function public.fms_travel_raise_for_people()
returns table (
  id             uuid,
  name           text,
  designation    text,
  department_id  uuid,
  band_id        uuid,
  employee_code  text,
  gender         text,
  date_of_birth  date,
  phone          text,
  email          text,
  hod_ids        uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.designation,
    p.department_id,
    p.band_id,
    p.employee_code,
    p.gender,
    p.date_of_birth,
    p.phone,
    p.email,
    coalesce(
      (select array_agg(h.hod_id) from public.user_hods h where h.employee_id = p.id),
      '{}'::uuid[]
    ) as hod_ids
  from public.profiles p
  where auth.uid() is not null
    and public.fms_travel_is_coordinator(auth.uid())
    and coalesce(p.is_external, false) = false
    and p.id::text in (
      select jsonb_array_elements_text(coalesce(c.value->'user_ids', '[]'::jsonb))
      from public.fms_travel_config c
      where c.key = 'raise_for'
    )
  order by p.name;
$$;

comment on function public.fms_travel_raise_for_people() is
  'Travel fields of the people on the ''raise_for'' list, for a Travel Desk coordinator only (empty for anyone else). Lets a non-admin coordinator pick a traveller outside her own department.';

-- PUBLIC holds EXECUTE by default, and anon inherits it through PUBLIC (see
-- od13_p0c): revoke there, then grant to signed-in users only.
revoke execute on function public.fms_travel_raise_for_people() from public;
revoke execute on function public.fms_travel_raise_for_people() from anon;
grant  execute on function public.fms_travel_raise_for_people() to authenticated;

commit;
