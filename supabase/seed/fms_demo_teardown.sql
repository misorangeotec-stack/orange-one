-- Purchase FMS demo teardown — removes only the generated demo rows.
-- Stage rows cascade-delete with their entry. Real data (e.g. PO-1045) untouched.
\set ON_ERROR_STOP on
DELETE FROM public.fms_entries
 WHERE workflow_id = (SELECT id FROM public.fms_workflows WHERE key='purchase')
   AND code LIKE 'PO-2%';
