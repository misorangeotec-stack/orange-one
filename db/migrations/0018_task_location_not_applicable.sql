-- Task Management — per-location "Not Applicable" on the task checklist.
--
-- Some days a tagged location genuinely has no work for the task (e.g. one of
-- five companies had nothing to track that day). Previously the doer had to tick
-- EVERY location to complete the task, so such a location blocked completion.
--
-- This adds a per-location N/A state alongside "done": a location row is now
-- RESOLVED when it is either completed_at-set OR na_at-set. The completion gate
-- (and the UI) treat N/A exactly like done — three companies done + two marked
-- N/A => the task can be marked complete.
--
-- N/A and done are mutually exclusive per row: setting one clears the other (the
-- write layer enforces this; this migration only widens the gate + adds columns).
--
-- Purely ADDITIVE: two new nullable columns + a redefinition of the existing
-- gate function. No existing column/row is mutated. Apply in the Orange One
-- Supabase project (ref coshondiqdhorwvibrwu) BEFORE the frontend goes live.
--
-- Reversal:
--   -- restore the original gate (treats only completed_at as resolved):
--   create or replace function public.enforce_task_locations_complete() ... (see 20260602090000_add_task_locations.sql)
--   alter table public.task_locations drop column if exists na_at;
--   alter table public.task_locations drop column if exists na_by;

-- ---------------------------------------------------------------------------
-- 1. New columns on the per-task checklist
-- ---------------------------------------------------------------------------
alter table public.task_locations
  add column if not exists na_at timestamptz,
  add column if not exists na_by uuid references auth.users on delete set null;

comment on column public.task_locations.na_at is
  'Set when this location was marked Not Applicable for the task. Mutually exclusive with completed_at; a row with either set counts as resolved for the completion gate.';

-- ---------------------------------------------------------------------------
-- 2. Widen the completion gate — a location is resolved if done OR N/A.
-- ---------------------------------------------------------------------------
-- BEFORE UPDATE on tasks: when status transitions INTO 'completed', reject the
-- change only if some location is still pending — i.e. neither completed nor
-- marked N/A. Tasks with zero task_locations rows are never blocked.
create or replace function public.enforce_task_locations_complete()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if exists (
      select 1 from public.task_locations
      where task_id = new.id and completed_at is null and na_at is null
    ) then
      raise exception 'Every location must be completed or marked Not Applicable before this task can be marked complete';
    end if;
  end if;
  return new;
end $$;

-- Trigger definition is unchanged (still BEFORE UPDATE on tasks); the function
-- body above replaces in place, so no DROP/CREATE of the trigger is needed.
