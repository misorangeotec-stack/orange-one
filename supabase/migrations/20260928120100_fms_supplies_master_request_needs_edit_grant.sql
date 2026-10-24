-- General Purchase: asking for a new master entry needs an EDIT grant on the module.
--
-- WHY
-- ---
-- "Request new entry" creates a pending row somebody then has to review, and notifies
-- them. It is a write. The INSERT policy only asked `is_staff(auth.uid())`, so it was
-- open to every employee in the company — including someone holding a VIEW-ONLY grant on
-- General Purchase, and including someone with no grant on it at all.
--
-- Found on 28-09-2026: a view-only account pressed "Request new entry" on the Masters
-- screen and the database took the row. The button on that screen is now gated on
-- `canEdit` (apps/office-supplies/pages/masters/Masters.tsx) — the twin button on Master
-- Requests always was — but a hidden button is not access control. This is.
--
-- WHAT CHANGES
-- ------------
-- Only the INSERT policy, and only its author test: `is_staff` becomes "may edit this
-- module". `requested_by = auth.uid()` and `status = 'pending'` are unchanged, so a
-- caller still cannot write a row on somebody else's behalf or pre-approve it. SELECT is
-- deliberately untouched: a view-only reader is supposed to see the queue, and the
-- requester must keep seeing their own row.
--
-- Admins hold no app_access row at all, so `module_can_edit` answers for them directly.
--
-- ⚠ The (select …) wrapping is load-bearing, not style. It lets the planner hoist the
--   call to an InitPlan evaluated once per statement instead of once per row; retyping a
--   policy flat from the catalogue is what turned a 15ms query into 1.4s elsewhere in
--   this schema.

drop policy if exists fms_supplies_master_requests_insert on public.fms_supplies_master_requests;

create policy fms_supplies_master_requests_insert
  on public.fms_supplies_master_requests
  for insert
  with check (
    requested_by = (select auth.uid())
    and status = 'pending'
    and (select public.module_can_edit((select auth.uid()), 'office-supplies'))
  );
