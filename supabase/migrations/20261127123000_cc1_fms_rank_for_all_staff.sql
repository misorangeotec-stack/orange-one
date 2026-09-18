-- CC-1 · The ranking is for every member of staff, on the home screen.
--
-- Decided by the user on 18-09-2026, after seeing it: the ranking sits on the home
-- screen (My Work Today) — a dial in the greeting banner and a Ranking tab — so every
-- employee sees where they stand. Everyone already has the home screen, so the board no
-- longer asks for the FMS Control Center module; that page, with its org-wide process
-- counts, stays with the people granted it.
--
-- Staff only: a customer login (profiles.is_external — OD-13) is still refused, and what
-- a viewer may see is unchanged (fms_rank_board / fms_rank_my_steps decide that).
-- Rollback: the _rollback.sql beside this restores the Control Center requirement.

create or replace function public.fms_rank_can_view(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null and public.is_staff(p_uid);
$$;
