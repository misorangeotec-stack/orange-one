-- ===========================================================================
-- Import FMS — remove the approval "Reassign" feature.
--
-- The same removal already applied to Purchase in
-- 20260806120000_fms_purchase_remove_reassign.sql, for the same reason: the
-- configured approvers are the single authority on who signs a requisition,
-- and a coordinator-side per-line override sat beside them as a second answer
-- (with a picker that listed EVERY profile, so an approval could be handed to
-- someone with no approval authority at all).
--
-- What this does:
--   1. drops fms_import_reassign_line — nothing can set an override again.
--   2. clears any assigned_approver_id values.
--
-- On (2): at the time of writing NO line in fms_import_request_items carried
-- an override — the feature was never used in Import. The update is a safety
-- net, not a correction, and strands no in-flight approval.
--
-- Deliberately NOT done, per the additive-only rule:
--   - the assigned_approver_id COLUMN stays (dropping it would be destructive
--     and it is now inert — no code reads it and no RPC can write it).
--   - the Import approval RPCs keep any `assigned_approver_id = auth.uid()`
--     authz branch they carry. With no writer and no non-null values it can
--     never grant anything; strip it the next time one is edited for a real
--     reason.
--   - 'reassigned' activity/notification rows stay, and the UI keeps its label
--     for them, so any history still reads correctly.
--
-- Reversal: re-run the fms_import_reassign_line block from
-- 20260716120400_add_fms_import_activity_notifications.sql.
-- ===========================================================================

drop function if exists public.fms_import_reassign_line(uuid, uuid, text);

update public.fms_import_request_items
   set assigned_approver_id = null
 where assigned_approver_id is not null;
