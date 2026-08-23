-- ===========================================================================
-- OCPI FMS — THE DEAL, and its quotation revisions.
--
-- ONE ENTITY FOR BOTH DOCUMENTS. A deal is raised as a quotation and becomes an
-- order confirmation in place. The OC inherits every quotation field by BEING
-- THE SAME ROW — there is no copy step, so the two documents cannot drift, which
-- is the central complaint about the paper process this replaces.
--
-- THE CHAIN (frontend/src/apps/ocpi/lib/steps.ts is the source of truth for the
-- step keys; this table only has to agree with it):
--
--   quotation → quotation_approval → order_confirmation → oc_approval
--     → customer_signoff → management_signoff → closed
--
-- Column prefixes follow the house convention, one per step that records a
-- decision:  qa_* quotation approval · oc_* order-confirmation submission ·
--            oca_* OC approval · cs_* customer sign-off · ms_* management
--            sign-off.  Each carries its own _at and _by.
--
-- ⚠ ALMOST NOTHING IS `not null`, AND THAT IS THE DRAFT DESIGN, NOT SLOPPINESS.
--   A draft is by definition incomplete, so the mandatory fields cannot be
--   NOT NULL. Completeness is enforced instead by a table CHECK that only bites
--   once status is no longer 'draft'. Same reasoning, and the same shape, as
--   20260802120100_add_fms_customer_requests.sql.
--
-- ⚠ quotation_no IS NULL WHILE DRAFT. An abandoned draft must not burn a number
--   from a series customers already hold. It is stamped by the submit RPC and is
--   unique only once stamped.
--
-- ⚠ DRAFTS ARE PRIVATE TO THEIR AUTHOR, including from view-only users. The
--   SELECT policy therefore has a draft clause AND-ed in front of the ordinary
--   visibility arms, rather than folded into them.
--
-- ⚠ THE CUSTOMER'S CONTACT DETAILS LIVE HERE, NOT IN A MODULE-LOCAL MASTER.
--   mst_parties.address, .email and .phone are empty in ALL 7,863 rows (checked
--   live), and .gstin is set on 1,218 — so picking a Tally customer yields a
--   name and little else. The details are captured on the deal and pre-filled
--   from the party's most recent prior deal. A module-local customer table is
--   NOT the answer: fms_dispatch_customers is the cautionary tale, where a
--   customer saved into it was invisible everywhere.
--
-- ⚠ THE DEAL VALUE CARRIES A CURRENCY. A real submission recorded
--   "1.8 lakh dollar" as the total value while the order confirmation prints
--   "Machine Value INR", and the standing terms adjust for dollar exchange when
--   payment runs past 60 days. Treating the quoted figure as rupees would be a
--   two-order-of-magnitude error on a contract.
--
-- ⚠ COMPANY AND LOCATION ARE CARRIED FROM DAY ONE. Order to Dispatch
--   (20260920120000) and Customer Onboarding (20260918120000) both had to
--   retrofit them. 1,878 of the 1,888 customers in mst_parties already carry
--   company_id, so the customer resolves the selling entity and the entity
--   resolves the letterhead, CIN, bank block and Ex-Works city.
--
-- STEP RPCs ARE NOT HERE. They land with the phase that needs them (drafts and
-- submit in phase 2, the approval gates in phases 5 and 7, the signature loop in
-- phase 8), so each arrives with the screen that calls it rather than as dead
-- code. This migration establishes the table, its visibility and its authz.
--
-- Purely ADDITIVE. Two new tables.
--
-- Reversal (reverse order):
--   drop policy if exists fms_ocpi_versions_select on public.fms_ocpi_quotation_versions;
--   drop policy if exists fms_ocpi_deals_select on public.fms_ocpi_deals;
--   drop function if exists public.fms_ocpi_can_act(text, uuid, uuid);
--   drop function if exists public.fms_ocpi_can_see_deal(uuid, uuid, text);
--   drop table if exists public.fms_ocpi_quotation_versions;
--   drop table if exists public.fms_ocpi_deals;
-- ===========================================================================

begin;

create table if not exists public.fms_ocpi_deals (
  id                      uuid primary key default gen_random_uuid(),

  -- ---- identity ---------------------------------------------------------
  quotation_no            text unique,          -- QT-M0024 … null while draft
  oc_no                   text unique,          -- OTPL/OC/2627/0001
  raised_by               uuid references auth.users on delete set null,

  -- The TALLY salesperson name, which is NOT the portal user. Customer
  -- Onboarding documents the same deliberate split in 20260918120100: the two
  -- are independent, and collapsing them loses one of the answers.
  salesperson_name        text,

  -- ---- customer ---------------------------------------------------------
  customer_id             uuid references public.mst_parties on delete restrict,
  customer_name           text,                 -- always stored, so a new lead works
  customer_address        text,
  customer_attn           text,                 -- the PERSON; the form's address
                                                -- field is routinely misused for this
  customer_email          text,
  customer_mobile         text,
  gst_available           boolean,
  gst_no                  text,

  -- ---- selling entity ---------------------------------------------------
  company_id              uuid references public.mst_companies on delete restrict,
  location_id             uuid references public.mst_locations on delete restrict,

  -- ---- part A · machine -------------------------------------------------
  machine_count           integer check (machine_count is null or machine_count > 0),
  machine_id              uuid references public.fms_ocpi_machines on delete restrict,
  head_type               text,
  head_count              integer check (head_count is null or head_count >= 0),
  ink_type                text,
  ink_price               text,                 -- free text in practice ("N/A")
  ink_credit_terms        text,

  -- ---- part A · deal inclusions ----------------------------------------
  incl_ink                boolean,
  ink_qty_included        text,
  incl_spares             boolean,
  spare_details           text,
  incl_head               boolean,
  heads_included          integer check (heads_included is null or heads_included >= 0),
  dryer_type              text,

  -- ---- part A · commercial ---------------------------------------------
  deal_value_currency     text check (deal_value_currency is null
                            or deal_value_currency in ('INR', 'USD')),
  deal_value_amount       numeric(16, 2),
  payment_type            text check (payment_type is null
                            or payment_type in ('advance', 'credit')),
  payment_terms           text,
  delivery_date           date,
  transport_terms         text check (transport_terms is null
                            or transport_terms in ('high_seas', 'local')),
  high_seas_via           text check (high_seas_via is null
                            or high_seas_via in ('CIF', 'EX Factory', 'FOB')),
  high_seas_cost_by       text check (high_seas_cost_by is null
                            or high_seas_cost_by in ('customer', 'company')),
  local_cost_by           text check (local_cost_by is null
                            or local_cost_by in ('customer', 'company')),
  remarks                 text,
  dollar_clause_agreed    boolean,

  -- ---- part B · head shipment ------------------------------------------
  head_ship_mode          text check (head_ship_mode is null
                            or head_ship_mode in ('with_machine', 'separate')),
  head_ship_via           text check (head_ship_via is null
                            or head_ship_via in ('directly', 'hss', 'local_sales')),
  head_balance_remarks    text,
  head_separate_invoice   boolean,

  -- ---- part B · dryer ---------------------------------------------------
  dryer_chambers          text,
  heating_mode            text,
  platter_details         text,
  dryer_warranty          text,

  -- ---- part B · options -------------------------------------------------
  air_blade               boolean,
  external_centering      boolean,
  ink_dust_exhauster      boolean,
  chilling_system         boolean,

  -- ---- part B · warranty & commitments ---------------------------------
  other_commitments       text,
  printer_warranty        text,
  head_warranty           text,
  insurance_clause_agreed boolean,

  -- ---- part B · order-confirmation only --------------------------------
  ref_no                  text,
  delivery_days           text,
  trade_term              text,                 -- 'Ex-Work Surat', 'CIF', 'FOB'
  gst_rate                numeric(5, 2),
  machine_value_inr       numeric(16, 2),       -- the INR figure the OC prints,
                                                -- distinct from the quoted value
  gst_amount_inr          numeric(16, 2),
  total_inr               numeric(16, 2),
  post_warranty_head_price numeric(16, 2),
  consumables_supplier    text,
  machine_model_no        text,
  prepared_by             text,
  approved_by             text,

  -- ---- workflow ---------------------------------------------------------
  status                  text not null default 'draft' check (status in (
                            'draft',
                            'awaiting_quotation_approval',
                            'awaiting_order_confirmation',
                            'awaiting_oc_approval',
                            'awaiting_customer_sign',
                            'awaiting_management_sign',
                            'closed', 'rework', 'on_hold', 'cancelled')),
  current_step            text,
  hold_from_status        text,

  quotation_version_no    integer not null default 0,

  qa_decision             text check (qa_decision is null
                            or qa_decision in ('approve', 'reject', 'rework')),
  qa_note                 text,
  qa_at                   timestamptz,
  qa_by                   uuid references auth.users on delete set null,

  oc_at                   timestamptz,
  oc_by                   uuid references auth.users on delete set null,

  oca_decision            text check (oca_decision is null
                            or oca_decision in ('approve', 'reject', 'rework')),
  oca_note                text,
  oca_at                  timestamptz,
  oca_by                  uuid references auth.users on delete set null,

  cs_doc_path             text,                 -- customer-signed scan
  cs_at                   timestamptz,
  cs_by                   uuid references auth.users on delete set null,

  ms_doc_path             text,                 -- countersigned scan
  ms_at                   timestamptz,
  ms_by                   uuid references auth.users on delete set null,

  rejected_at             timestamptz,
  reject_stage            text,
  reject_reason           text,
  rework_at               timestamptz,
  rework_stage            text,
  rework_reason           text,
  rework_count            integer not null default 0,
  hold_at                 timestamptz,
  hold_reason             text,
  cancelled_at            timestamptz,
  cancel_reason           text,

  -- ⚠ edited_*, NOT updated_*. updated_at is maintained by a trigger that fires
  --   on EVERY row touch, including the workflow's own writes. edited_* is
  --   written only by the update_* RPCs, so "edited by X at edited_at" is always
  --   a true statement. The reasoning is set out at length in
  --   20260718120000_add_fms_purchase_stage_edits.sql.
  edited_at               timestamptz,
  edited_by               uuid references auth.users on delete set null,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- A draft may be anything; a submitted deal may not.
  constraint fms_ocpi_complete_when_submitted check (
    status = 'draft' or (
          nullif(btrim(customer_name), '') is not null
      and nullif(btrim(coalesce(salesperson_name, '')), '') is not null
      and machine_id is not null
      and machine_count is not null
      and deal_value_amount is not null
      and deal_value_currency is not null
    )
  ),

  -- High seas and local delivery ask different follow-ups; neither may carry the
  -- other's answer, or the printed terms would contradict the chosen route.
  constraint fms_ocpi_transport_coherent check (
    transport_terms is distinct from 'local' or high_seas_via is null
  )
);

comment on table public.fms_ocpi_deals is
  'One OCPI deal, from the first quotation draft to the countersigned order confirmation. The OC inherits the quotation by being the same row. See the migration header for the draft, currency, company and contact-detail decisions.';

comment on column public.fms_ocpi_deals.salesperson_name is
  'The TALLY salesperson name, independent of raised_by (the portal user). Sourced from ext_ledger_tags via fetchSalespersonNames() and defaulted from profiles.receivables_salespersons.';
comment on column public.fms_ocpi_deals.machine_value_inr is
  'The rupee figure printed on the order confirmation. Deliberately separate from deal_value_amount, which may be quoted in USD.';

create index if not exists fms_ocpi_deals_status_idx     on public.fms_ocpi_deals (status);
create index if not exists fms_ocpi_deals_raised_by_idx  on public.fms_ocpi_deals (raised_by);
create index if not exists fms_ocpi_deals_customer_idx   on public.fms_ocpi_deals (customer_id);
create index if not exists fms_ocpi_deals_created_idx    on public.fms_ocpi_deals (created_at);
-- Serves the "prefill contacts from this party's last deal" lookup.
create index if not exists fms_ocpi_deals_customer_recent_idx
  on public.fms_ocpi_deals (customer_id, created_at desc);

drop trigger if exists trg_fms_ocpi_deals_updated on public.fms_ocpi_deals;
create trigger trg_fms_ocpi_deals_updated
  before update on public.fms_ocpi_deals
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_ocpi_quotation_versions — one immutable row per generated quotation.
--
-- ⚠ document_payload FREEZES THE RESOLVED DOCUMENT, NOT ONLY THE FIELD VALUES.
--   The machine's spec rows and section bodies as they were at generation time
--   are stored with the version. Freezing only the field values would mean that
--   editing a section's wording next month silently rewrites version 1 of a
--   quotation the customer already holds. This is the same lesson
--   fms_customer_requests records by freezing dir_threshold_at_decision onto
--   each approved row: a rule change must never rewrite history.
--
-- ⚠ THE PDF IS STORED TOO, for finalised versions. Previews render on the fly.
--   A customer-signed order confirmation is a contract, and the signed scan has
--   to sit beside the exact bytes that were printed.
-- ===========================================================================
create table if not exists public.fms_ocpi_quotation_versions (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references public.fms_ocpi_deals on delete cascade,
  version_no       integer not null,
  field_payload    jsonb not null default '{}'::jsonb,
  document_payload jsonb not null default '{}'::jsonb,
  pdf_path         text,
  generated_at     timestamptz not null default now(),
  generated_by     uuid references auth.users on delete set null,

  unique (deal_id, version_no)
);

comment on table public.fms_ocpi_quotation_versions is
  'An immutable snapshot per generated quotation revision. field_payload drives the revision diff; document_payload freezes the resolved template so a historic version re-renders unchanged. See the migration header.';

create index if not exists fms_ocpi_versions_deal_idx
  on public.fms_ocpi_quotation_versions (deal_id, version_no desc);

-- ===========================================================================
-- VISIBILITY
--
-- ⚠ TWO COPIES OF THE RULE, AND THEY MOVE TOGETHER. The function is what the
--   storage policy and the notification fan-out call; the policy inlines the
--   same rule so it costs once per query instead of once per row. Order to
--   Dispatch keeps a standing equivalence check over the pair for exactly this
--   reason (20260924120000 / 20260925130000). Change one, change the other.
--
-- ⚠ EVERY NON-ROW-DEPENDENT ARM IS WRAPPED `(select …)`. module_is_viewer and
--   is_admin are SECURITY DEFINER *with SET search_path*, hence NON-INLINABLE —
--   the exact property that made the dispatch policy cost 1,620 ms per read
--   before it was hoisted. Wrapped, each becomes a single InitPlan.
--
-- ⚠ 'view', NOT "has any grant". An EDIT grant must not widen row visibility: an
--   editor still sees what their ownership says. The consequence is an inversion
--   — a viewer sees more than an editor who owns no step — and it is deliberate.
--   Ownership answers "whose work is this"; the grant answers "may this person
--   read the module".
-- ===========================================================================
create or replace function public.fms_ocpi_can_see_deal(
  p_uid uuid, p_raised_by uuid, p_status text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_uid is not null
     -- A draft belongs to the person writing it. Nobody else, viewers included.
     and (p_status is distinct from 'draft'
          or p_raised_by = p_uid
          or public.is_admin(p_uid))
     and (
          public.is_admin(p_uid)
       or public.fms_ocpi_is_coordinator(p_uid)
       or p_raised_by = p_uid
       or public.module_is_viewer(p_uid, 'ocpi')
       or exists (
            select 1 from public.fms_ocpi_step_owners o
             where p_uid = any(o.employee_ids)
          )
     );
$fn$;

comment on function public.fms_ocpi_can_see_deal(uuid, uuid, text) is
  'May this user read this deal? Mirrors the inlined fms_ocpi_deals_select policy — the two must be changed together. Drafts are private to their author.';
grant execute on function public.fms_ocpi_can_see_deal(uuid, uuid, text) to authenticated;

alter table public.fms_ocpi_deals enable row level security;

drop policy if exists fms_ocpi_deals_select on public.fms_ocpi_deals;
create policy fms_ocpi_deals_select
  on public.fms_ocpi_deals
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and (fms_ocpi_deals.status is distinct from 'draft'
         or fms_ocpi_deals.raised_by = (select auth.uid())
         or (select public.is_admin((select auth.uid()))))
    and (
         (select public.is_admin((select auth.uid())))
      or (select public.fms_ocpi_is_coordinator((select auth.uid())))
      or fms_ocpi_deals.raised_by = (select auth.uid())
      or (select public.module_is_viewer((select auth.uid()), 'ocpi'))
      or exists (
           select 1 from public.fms_ocpi_step_owners o
            where (select auth.uid()) = any(o.employee_ids)
         )
    )
  );

-- No write policy, deliberately: every mutation goes through a SECURITY DEFINER
-- RPC, so the RPC is the only write door and the guard cannot be bypassed from
-- the browser. Admin writes go the same way.

alter table public.fms_ocpi_quotation_versions enable row level security;

-- A version is readable exactly when its deal is. Asking nothing but "is my
-- parent visible" means this follows the deals policy for free — the same
-- free-ride shape the dispatch child tables use.
drop policy if exists fms_ocpi_versions_select on public.fms_ocpi_quotation_versions;
create policy fms_ocpi_versions_select
  on public.fms_ocpi_quotation_versions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fms_ocpi_deals d
       where d.id = fms_ocpi_quotation_versions.deal_id
    )
  );

-- ===========================================================================
-- AUTHZ — may this user action this step on this deal?
--
-- ⚠ GATED ON module_can_edit VIA fms_ocpi_is_step_owner, whose body carries the
--   gate. is_coordinator includes admins. See 20260929120000.
-- ===========================================================================
create or replace function public.fms_ocpi_can_act(
  p_step_key text, p_deal uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_uid is not null
     and public.module_can_edit(p_uid, 'ocpi')
     and (
          public.fms_ocpi_is_coordinator(p_uid)
       or public.fms_ocpi_is_step_owner(p_step_key, p_uid)
       -- The origin step is unowned by default: with no owners on `quotation`,
       -- any user holding an edit grant may raise a deal. Owners set ⇒ only them
       -- (plus admins and coordinators, above).
       or (p_step_key = 'quotation'
           and not exists (
             select 1 from public.fms_ocpi_step_owners o
              where o.step_key = 'quotation'
                and array_length(o.employee_ids, 1) > 0))
     );
$fn$;

comment on function public.fms_ocpi_can_act(text, uuid, uuid) is
  'May this user action this OCPI step? Edit grant + (coordinator or step owner), with the origin step open to any editor while it has no owners. p_deal is accepted for signature parity with the other modules and for future per-deal rules.';
grant execute on function public.fms_ocpi_can_act(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ASSERTIONS — fail rather than silently widen access.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_public int;
begin
  select count(*) into v_public
    from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_ocpi_deals', 'fms_ocpi_quotation_versions',
                       'fms_ocpi_activity', 'fms_ocpi_notifications',
                       'fms_ocpi_machines', 'fms_ocpi_machine_sections',
                       'fms_ocpi_step_owners', 'fms_ocpi_config',
                       'fms_ocpi_counters', 'fms_ocpi_company_profiles')
     and roles::text like '%public%';
  if v_public > 0 then
    raise exception 'OCPI: % policy/policies are scoped to {public}; anon holds table grants, so that is an open door', v_public;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'fms_ocpi_deals' and c.relrowsecurity
  ) then
    raise exception 'OCPI: RLS is not enabled on fms_ocpi_deals';
  end if;
end $mig$;

commit;
