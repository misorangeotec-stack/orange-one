-- Purchase FMS — remove all demo data seeded by fms_purchase_demo_seed.sql.
-- Workflow rows (requests/POs/etc., added in later phases) are removed first so
-- master deletes aren't blocked by FKs. Master managers/requests are left alone.
-- Safe to run even if some tables don't exist yet (guards with to_regclass).

do $$
begin
  -- Cross-cutting (Phase 5) — clear first; no FK from these into the rest.
  if to_regclass('public.fms_purchase_notifications') is not null then delete from public.fms_purchase_notifications; end if;
  if to_regclass('public.fms_purchase_activity') is not null then delete from public.fms_purchase_activity; end if;

  -- Later-phase workflow tables (no-op until they exist).
  if to_regclass('public.fms_purchase_payments') is not null then delete from public.fms_purchase_payments; end if;
  if to_regclass('public.fms_purchase_grn_items') is not null then delete from public.fms_purchase_grn_items; end if;
  if to_regclass('public.fms_purchase_grns') is not null then delete from public.fms_purchase_grns; end if;
  if to_regclass('public.fms_purchase_pi_items') is not null then delete from public.fms_purchase_pi_items; end if;
  if to_regclass('public.fms_purchase_pis') is not null then delete from public.fms_purchase_pis; end if;
  if to_regclass('public.fms_purchase_tally_bookings') is not null then delete from public.fms_purchase_tally_bookings; end if;
  if to_regclass('public.fms_purchase_po_items') is not null then delete from public.fms_purchase_po_items; end if;
  if to_regclass('public.fms_purchase_pos') is not null then delete from public.fms_purchase_pos; end if;
  if to_regclass('public.fms_purchase_quotations') is not null then delete from public.fms_purchase_quotations; end if;
  if to_regclass('public.fms_purchase_request_items') is not null then delete from public.fms_purchase_request_items; end if;
  if to_regclass('public.fms_purchase_requests') is not null then delete from public.fms_purchase_requests; end if;

  -- Masters.
  delete from public.fms_purchase_items;
  delete from public.fms_purchase_item_groups;
  delete from public.fms_purchase_categories;
  delete from public.fms_purchase_vendors;
  delete from public.fms_purchase_companies;

  -- Demo config (approval bands + the amount_basis key seeded above). Leaves any
  -- admin-set process_coordinators / step owners untouched.
  if to_regclass('public.fms_purchase_approval_matrix') is not null then delete from public.fms_purchase_approval_matrix; end if;
  if to_regclass('public.fms_purchase_config') is not null then delete from public.fms_purchase_config where key = 'amount_basis'; end if;
end $$;
