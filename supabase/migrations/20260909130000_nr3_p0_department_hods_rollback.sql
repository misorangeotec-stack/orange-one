-- ROLLBACK for 20260909130000_nr3_p0_department_hods.sql (NR-3 Part B).
--
-- !! THE DROP DESTROYS THE MAPPING HR TYPED IN, and nothing else holds it. There is
--    no second copy: the master is not derivable, which is the whole reason the
--    screen exists. CAPTURE IT FIRST and paste the output into the ticket:
--
--      select h.department_id, d.name, h.hod_ids, h.updated_at, h.updated_by
--        from public.fms_hr_department_hods h
--        left join public.departments d on d.id = h.department_id
--       order by d.name;
--
--    To put it back afterwards, as an admin through the app or as postgres here:
--
--      insert into public.fms_hr_department_hods (department_id, hod_ids)
--      values ('<department id>', '{<uuid>,<uuid>}'::uuid[])
--      on conflict (department_id) do update set hod_ids = excluded.hod_ids;
--
-- !! CONSIDER THE PRESERVING FORM INSTEAD. If the Setup screen is merely being pulled
--    and the data is worth keeping, this takes away the reach and keeps the rows:
--
--      revoke all on public.fms_hr_department_hods from authenticated;
--
-- WHY THE DROP IS SAFE FOR LIVE VACANCIES, which is the one thing worth being sure
-- of. Nothing reads this table at write time: no FK from fms_hr_requisitions, no RLS
-- policy, no RPC, no read gate. Removing it removes a form pre-fill and nothing else.
-- Every requisition keeps the hiring managers it has, and every person keeps exactly
-- the access they had. That property is the payoff of the "a master must never
-- retro-write a live requisition" rule, and it is why this rollback is boring.
--
-- !! ROLL THE FRONTEND BACK FIRST, or Setup's Department HODs tab returns
--    "relation does not exist" on load, and the picker's view-only badge call returns
--    PGRST202. fms_hr_module_user_ids() is untouched and keeps its live caller.
--
-- Safe to run where the migration was never applied: every statement is IF EXISTS.

begin;

drop function if exists public.fms_hr_module_edit_user_ids();

drop trigger  if exists trg_fms_hr_department_hods_guard   on public.fms_hr_department_hods;
drop trigger  if exists trg_fms_hr_department_hods_updated on public.fms_hr_department_hods;
drop function if exists public.fms_hr_department_hods_guard();

drop policy if exists fms_hr_department_hods_write  on public.fms_hr_department_hods;
drop policy if exists fms_hr_department_hods_select on public.fms_hr_department_hods;

drop table if exists public.fms_hr_department_hods;

commit;
