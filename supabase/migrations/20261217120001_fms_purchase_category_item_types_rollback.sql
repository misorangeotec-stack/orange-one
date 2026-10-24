-- ===========================================================================
-- ROLLBACK for 20261217120000_fms_purchase_category_item_types.sql
--
-- ⚠ RUN supabase/purchase-central/00_rollback.sql FIRST if the Purchase
--   central-masters cutover has been applied. The cutover's portal-item step
--   and the replaced fms_purchase_resolve_master_request both read this column.
-- ===========================================================================

do $guard$
begin
  if to_regclass('private.pcm_company_map') is not null then
    raise exception 'ABORT: the Purchase central-masters cutover is still applied - run private.purchase_central_rollback() first';
  end if;
end
$guard$;

alter table public.fms_purchase_categories drop column if exists item_types;
