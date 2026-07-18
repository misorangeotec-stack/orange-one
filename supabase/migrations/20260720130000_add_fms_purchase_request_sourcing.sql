-- ===========================================================================
-- Purchase FMS — REQUEST-level sourcing: the vendor shortlist + stamps.
--
-- Sourcing moves from per-LINE to per-REQUEST. The buyer shortlists up to three
-- vendors ONCE for the whole requisition and ticks one as recommended; rate, GST
-- and lead days are then typed per ITEM (one rate, not one rate per vendor).
--
-- WHY A NEW TABLE rather than reusing fms_purchase_quotations:
--   A quotation row asserts "this vendor quoted this price". Under the new model
--   only the recommended vendor has a price — the other two are a shortlist with
--   no rate at all. Writing the winner's rate against the losers would show the
--   approver three identical rates per line, which is visibly false. The honest
--   alternative (null rates) would need `alter column rate drop not null` — a
--   mutation of an existing column, against this project's additive-only rule.
--
--   fms_purchase_quotations is KEPT and still written: save_sourcing_request
--   mirrors ONE row per line for the recommended vendor, so RequestDetail, the
--   approval override path and any quotation-joining report keep working without
--   inventing prices.
--
-- Purely ADDITIVE: one new table, four new nullable columns. Nothing dropped,
-- renamed or altered.
-- ===========================================================================

-- 1. The shortlist -----------------------------------------------------------
create table if not exists public.fms_purchase_request_vendors (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.fms_purchase_requests on delete cascade,
  vendor_id      uuid not null references public.fms_purchase_vendors on delete restrict,
  is_recommended boolean not null default false,
  remark         text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (request_id, vendor_id)
);

comment on table public.fms_purchase_request_vendors is
  'The up-to-3 vendor shortlist captured once per requisition at sourcing. Exactly one row has is_recommended = true; that vendor becomes final_vendor_id on every line of the request. Rates are NOT here — they are per item, on fms_purchase_request_items.';

create index if not exists fms_purchase_request_vendors_request_idx
  on public.fms_purchase_request_vendors (request_id);

-- RLS mirrors the workflow-core tables (20260630140000): everyone reads, only an
-- admin writes directly — every real write goes through a SECURITY DEFINER RPC.
alter table public.fms_purchase_request_vendors enable row level security;
drop policy if exists fms_purchase_request_vendors_select on public.fms_purchase_request_vendors;
create policy fms_purchase_request_vendors_select on public.fms_purchase_request_vendors
  for select to authenticated using (true);
drop policy if exists fms_purchase_request_vendors_write on public.fms_purchase_request_vendors;
create policy fms_purchase_request_vendors_write on public.fms_purchase_request_vendors
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- 2. Lead days, captured per item at sourcing --------------------------------
-- fms_purchase_quotations.lead_time_days is per QUOTE, which no longer carries
-- the number under the new model. The line needs its own home for it.
alter table public.fms_purchase_request_items
  add column if not exists lead_time_days integer;

comment on column public.fms_purchase_request_items.lead_time_days is
  'Lead days agreed at sourcing for this item. Typed per item (with a fill-down shortcut in the form), optionally seeded from the vendor-item rate card.';

-- ...and carried onto the PO so the vendor-facing document can state it.
alter table public.fms_purchase_po_items
  add column if not exists lead_time_days integer;

comment on column public.fms_purchase_po_items.lead_time_days is
  'Copied from fms_purchase_request_items.lead_time_days when the PO is generated.';

-- 3. Request-level sourcing stamps -------------------------------------------
-- The request-scoped Completed tab needs ONE authoritative stamp rather than
-- "whichever line's sourced_at happens to win". Legacy requests have NULL here
-- and fall back to max(line.sourced_at) in lib/queues.ts.
alter table public.fms_purchase_requests
  add column if not exists sourcing_reason text,
  add column if not exists sourced_at      timestamptz,
  add column if not exists sourced_by      uuid references auth.users on delete set null;

comment on column public.fms_purchase_requests.sourcing_reason is
  'Why fewer than three vendors were shortlisted. MANDATORY when the shortlist is under three — enforced in fms_purchase_save_sourcing_request, not just in the UI.';

-- Deliberately NOT added: fms_purchase_requests.total_value. A denormalised
-- total drifts the moment a line is cancelled, and that drift would silently
-- re-route approvals to the wrong band. The total is summed live in
-- fms_purchase_decide_approval_request and in the store.
