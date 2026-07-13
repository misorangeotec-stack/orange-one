-- ===========================================================================
-- Purchase FMS — master-request hardening.
--
-- Strictly ADDITIVE: two indexes, no table/column/policy/data is changed.
--
-- 1. Dup guard. The Request-a-new-master modal already blocks a name that is
--    already in the master or already sitting in someone's review queue, but
--    two people can race. This makes it impossible to hold two PENDING requests
--    for the same (type, parent, name). Approved/rejected rows are exempt, so
--    re-requesting something after a rejection still works. The client maps the
--    resulting 23505 to "Someone has already requested this — it's awaiting
--    review."
--
-- 2. A lookup index for the "My requests" worklist.
--
-- Pre-check before applying (the unique build aborts if dupes already exist):
--   select master_type, lower(proposed_payload->>'name'), count(*)
--     from public.fms_purchase_master_requests
--    where status = 'pending' group by 1,2 having count(*) > 1;
--   -- verified empty on 2026-07-13 (no pending rows at all)
-- ===========================================================================

create unique index if not exists fms_purchase_master_requests_pending_uniq
  on public.fms_purchase_master_requests (
    master_type,
    coalesce(proposed_payload->>'category_id', proposed_payload->>'item_group_id', ''),
    lower(coalesce(proposed_payload->>'name', ''))
  )
  where status = 'pending';

create index if not exists fms_purchase_master_requests_requested_by_idx
  on public.fms_purchase_master_requests (requested_by, status);
