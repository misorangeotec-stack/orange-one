-- Task Management — personal (self-tracking) tasks.
--
-- Regular users (especially the employee role) previously could not create ANY
-- task: the only creation flow requires picking an assignee from your team, and
-- an employee has no team. This adds "personal" tasks — a private scratch list a
-- user keeps to track their own work.
--
-- HARD RULE: a personal task must never affect any score, scorecard, RYG, or
-- performance metric. The frontend selectors exclude is_personal everywhere they
-- already exclude not_applicable, so a personal task is invisible to every count.
-- Personal tasks stay visible to the creator AND their managers/admin in list
-- views (badged "Personal"); they just never enter a calculation.
--
-- Purely ADDITIVE: one new non-null column (default false) + one narrow DELETE
-- policy so a user can remove their OWN personal tasks (the tasks table has no
-- other client DELETE policy, so RLS denies all other deletes by default). No
-- existing column/row/policy is mutated. Apply in the Orange One Supabase project
-- (ref coshondiqdhorwvibrwu) BEFORE the frontend goes live.
--
-- Reversal:
--   drop policy if exists tasks_delete_personal on public.tasks;
--   alter table public.tasks drop column if exists is_personal;

-- ---------------------------------------------------------------------------
-- 1. New column on tasks
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists is_personal boolean not null default false;

comment on column public.tasks.is_personal is
  'True for a user-created personal (self-tracking) task. Self-assigned (assigned_to = created_by) and EXCLUDED from every score/RYG/dashboard metric, exactly like not_applicable. Visible to creator + managers in list views only.';

-- ---------------------------------------------------------------------------
-- 2. Narrow DELETE policy — a user may delete only their OWN personal tasks.
-- ---------------------------------------------------------------------------
-- Standard (assigned) tasks remain non-deletable from the client (no DELETE
-- policy => RLS denies). This policy lets the personal-task owner discard items
-- from their scratch list.
drop policy if exists tasks_delete_personal on public.tasks;
create policy tasks_delete_personal on public.tasks
  for delete using (created_by = auth.uid() and is_personal = true);
