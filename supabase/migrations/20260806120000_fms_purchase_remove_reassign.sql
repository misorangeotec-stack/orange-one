-- ===========================================================================
-- Purchase FMS — remove the approval "Reassign" feature.
--
-- Why: the approval matrix is the single, proven authority on who signs what.
-- A coordinator-side per-line override sat beside it as a second answer, and
-- its picker listed EVERY profile — so an approval could be handed to someone
-- with no approval authority at all. Two sources of truth for one decision is
-- a confusion (and audit) problem, so the override goes and the matrix stands
-- alone.
--
-- What this does:
--   1. drops fms_purchase_reassign_line — nothing can set an override again.
--   2. clears the existing assigned_approver_id values.
--
-- On (2): at the time of writing exactly ONE line carried an override —
-- PR-2627-0013, assigned to Hukumsingh Rathore, who is already the L2 band
-- approver (₹20,000.01–₹2,00,000) that its ₹34,220 total routes to. So the
-- clear is a no-op for that requisition: he keeps the right to decide it via
-- the band. No in-flight approval is stranded by this migration.
--
-- Deliberately NOT done, per the additive-only rule:
--   - the assigned_approver_id COLUMN stays (dropping it would be destructive
--     and it is now inert — no code reads it and no RPC can write it).
--   - fms_purchase_decide_approval_request / _update_approval_request keep
--     their `or exists (... assigned_approver_id = auth.uid())` authz branch.
--     With no writer and no non-null values it can never grant anything; those
--     bodies are ~100 lines each and re-creating them to delete one dead
--     predicate is more risk than the dead code is worth. Strip it the next
--     time either function is edited for a real reason.
--   - the 'reassigned' activity/notification rows stay, so the history on
--     PR-2627-0013 still reads correctly. The UI keeps its label for them.
--
-- Reversal: re-run the fms_purchase_reassign_line block from
-- 20260630160000_add_fms_purchase_activity_notifications.sql.
-- ===========================================================================

drop function if exists public.fms_purchase_reassign_line(uuid, uuid, text);

update public.fms_purchase_request_items
   set assigned_approver_id = null
 where assigned_approver_id is not null;
