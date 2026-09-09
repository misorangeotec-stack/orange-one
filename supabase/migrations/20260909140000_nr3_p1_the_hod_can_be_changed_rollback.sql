-- ROLLBACK for 20260909140000_nr3_p1_the_hod_can_be_changed.sql (NR-3 Part A).
--
-- Drops the four functions the migration created. NOTHING ELSE REFERENCES THEM: no
-- RLS policy, no other function, and - deliberately - fms_hr_can_read_requisition was
-- NOT rewritten to delegate to the simulator. That single design decision is what
-- makes this rollback four lines instead of an outage: the ten RLS policies that call
-- the live read gate are untouched by this migration and untouched by its removal.
--
-- !! ROLL THE FRONTEND BACK FIRST. If the Change HOD control is still rendered, every
--    press returns PGRST202 "Could not find the function" - a loud failure on a screen
--    that looks perfectly fine until somebody uses it.
--
-- !! IT DOES NOT UNDO WRITES ALREADY MADE. Any vacancy already re-mapped stays
--    re-mapped, and any fms_hr_step_assignees row already cleared is GONE from that
--    table. List what was done before deciding anything:
--
--      select a.created_at, r.mrf_no, a.actor_id, a.note, a.meta
--        from public.fms_hr_activity a
--        join public.fms_hr_requisitions r on r.id = a.entity_id
--       where a.entity_type = 'requisition' and a.type = 'hiring_managers_changed'
--       order by a.created_at;
--
--    To put ONE requisition back, as postgres in the SQL editor - the table's only
--    non-SELECT policy is is_admin, so a PostgREST patch is refused for everyone else:
--
--      update public.fms_hr_requisitions
--         set hiring_manager_ids =
--               (select array_agg(x::uuid)
--                  from jsonb_array_elements_text('<meta.before>'::jsonb) x),
--             reporting_to_ids =
--               coalesce((select array_agg(x::uuid)
--                           from jsonb_array_elements_text('<meta.reporting_before>'::jsonb) x),
--                        reporting_to_ids)
--       where id = '<requisition id>';
--
--    And the cleared handovers, from meta->'cleared_step_assignees' - which is the ONLY
--    record they ever existed, and the entire reason that key is written:
--
--      insert into public.fms_hr_step_assignees
--             (requisition_id, step_key, assigned_to, assigned_by, note)
--      select '<requisition id>', e->>'step_key', (e->>'assigned_to')::uuid,
--             (e->>'assigned_by')::uuid, e->>'note'
--        from jsonb_array_elements('<meta.cleared_step_assignees>'::jsonb) e
--      on conflict (requisition_id, step_key) do nothing;
--
-- !! IT DOES NOT UN-READ the hod_shortlist_pending digests the RPC marked read. They
--    are cosmetic, and fms_hr_notify_hod_pending rebuilds them on the next board move.
--
-- Safe to run where the migration was never applied: all four drops are IF EXISTS.
-- Dropped in dependency order - the preview and the write both call
-- fms_hr_may_set_hiring_managers, and the preview also calls the simulator.

begin;

drop function if exists public.fms_hr_preview_hiring_managers(uuid, uuid[], uuid[]);
drop function if exists public.fms_hr_set_hiring_managers(uuid, uuid[], text, uuid[]);
drop function if exists public.fms_hr_would_read_requisition(uuid, uuid, uuid[], uuid[], uuid[]);
drop function if exists public.fms_hr_may_set_hiring_managers(uuid, uuid);

commit;
