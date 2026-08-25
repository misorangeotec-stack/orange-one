-- ===========================================================================
-- OCPI — STAGE A of the revision: the columns the merged form will need.
--
-- WHAT THIS IS FOR
--   OCPI splits one commercial act across two stages: a Quotation, then — via a
--   second form, a second number series and a second approval gate — an Order
--   Confirmation. The revision (WORKLIST OCPI-2, checklist in OCPI.md) folds
--   them into one: both papers generated together from one form, headed ORDER
--   QUOTATION while the price is negotiated, and re-headed ORDER CONFIRMATION
--   when the Directors approve — which is also when OTPL/OC/<fy>/nnnn mints.
--
--   This migration adds ONLY the storage those later stages write into. It
--   changes no behaviour: every column is nullable, no RPC reads them yet, and
--   the one function signature that moves keeps a default so existing callers
--   are untouched. Applying it and stopping here leaves the module exactly as
--   it is today.
--
-- ⚠ ALL PRICING IS PHASE 2. No price master, no per-machine price, no deviation
--   limit, no price-approval gate. `deal_value_amount` stays what it is: a
--   figure the salesperson types. Earlier drafts of the plan specified
--   fms_ocpi_price_* tables; they are withdrawn. Do not add them here.
--
-- WHY THE VERSION ROW GAINS MONEY COLUMNS
--   fms_ocpi_quotation_versions already freezes `field_payload`, so the value a
--   revision carried is technically recoverable by digging into jsonb. That is
--   not good enough for the negotiation strip the client asked for — reading
--   "₹52,00,000 → ₹47,00,000 → ₹44,00,000" out of a jsonb blob at render time
--   means every consumer re-implements the same extraction, and a payload key
--   renamed in the form silently empties the history. The value, its currency
--   and the FX rate it was converted at become real columns.
--
-- WHY THE FX COLUMNS ARE NAMED AFTER IMPORT'S
--   fms_import_* already solved this exact problem (20260716130100) and its
--   lesson is in the names: the rate is FROZEN on the row, never re-derived, so
--   a document keeps the arithmetic it was issued under. Same doctrine as
--   OCPI's own frozen `document_payload`. `import-fx-rate` — the Edge Function
--   behind it — is reused as-is; nothing new is deployed.
--
-- ⚠ NO WRITE POLICY IS ADDED, ANYWHERE. fms_ocpi_deals deliberately has none:
--   every mutation goes through a SECURITY DEFINER RPC, which is the only write
--   door. Adding columns does not change that and must not.
--
-- Purely ADDITIVE: new nullable columns, one widened CHECK, one function whose
-- new parameter has a default.
--
-- Reversal (reverse order):
--   drop function if exists public.fms_ocpi_set_version_pdf(uuid, integer, text, text);
--   -- then re-run 20260929120700's 3-arg fms_ocpi_set_version_pdf verbatim
--   alter table public.fms_ocpi_machines drop constraint if exists fms_ocpi_machines_doc_title_check;
--   alter table public.fms_ocpi_machines add constraint fms_ocpi_machines_doc_title_check
--     check (doc_title in ('ORDER CONFIRMATION', 'OFFER QUOTE'));
--   alter table public.fms_ocpi_deals
--     drop column if exists fr_by, drop column if exists fr_at,
--     drop column if exists fh_by, drop column if exists fh_at,
--     drop column if exists deal_value_inr, drop column if exists fx_rate_overridden,
--     drop column if exists fx_rate_source, drop column if exists fx_rate_at,
--     drop column if exists fx_rate;
--   alter table public.fms_ocpi_quotation_versions
--     drop column if exists oc_document_payload, drop column if exists oc_pdf_path,
--     drop column if exists fx_rate, drop column if exists deal_value_currency,
--     drop column if exists deal_value_amount;
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · The revision record.
--
-- One row per generation already exists. These make the negotiation readable
-- without parsing jsonb, and let a revision keep the conversion it was issued
-- under even after somebody edits the live rate.
-- ---------------------------------------------------------------------------
alter table public.fms_ocpi_quotation_versions
  add column if not exists deal_value_amount   numeric(16,2),
  add column if not exists deal_value_currency text,
  add column if not exists fx_rate             numeric(18,6),
  add column if not exists oc_pdf_path         text,
  add column if not exists oc_document_payload jsonb;

comment on column public.fms_ocpi_quotation_versions.deal_value_amount is
  'What this revision was quoted at. A real column, not a jsonb lookup: the negotiation strip reads it directly, so renaming a form field cannot silently empty the history.';

comment on column public.fms_ocpi_quotation_versions.deal_value_currency is
  'INR or USD, as at this revision. Held beside the amount because a deal can change currency mid-negotiation when the transport terms change.';

comment on column public.fms_ocpi_quotation_versions.fx_rate is
  'The USD to INR rate this revision was issued under — live or hand-overridden. FROZEN, never re-derived: the papers keep the arithmetic they were sent with.';

comment on column public.fms_ocpi_quotation_versions.oc_pdf_path is
  'The DETAILED sheet for this revision. The summary sheet stays in pdf_path. Both papers are now generated together, so a version has two documents.';

comment on column public.fms_ocpi_quotation_versions.oc_document_payload is
  'The resolved detailed sheet — spec rows, composition, section bodies — frozen at generation, exactly as document_payload does for the summary. Re-wording a machine template next month must not rewrite a paper the customer already holds.';

-- ---------------------------------------------------------------------------
-- 2 · The deal's live FX position, and the two Finance stamps.
--
-- The FX columns mirror fms_import_* by name on purpose — same problem, same
-- doctrine, and a reader who knows one knows the other.
--
-- fh_* / fr_* are the handover to Finance and Finance's acknowledgement. They
-- follow the module's existing <step>_at / <step>_by convention (qa_*, oc_*,
-- oca_*, cs_*, ms_*), NOT edited_* — which is reserved for the correction RPCs.
-- ---------------------------------------------------------------------------
alter table public.fms_ocpi_deals
  add column if not exists fx_rate            numeric(18,6),
  add column if not exists fx_rate_at         timestamptz,
  add column if not exists fx_rate_source     text,
  add column if not exists fx_rate_overridden boolean,
  add column if not exists deal_value_inr     numeric(16,2),
  add column if not exists fh_at              timestamptz,
  add column if not exists fh_by              uuid references auth.users on delete set null,
  add column if not exists fr_at              timestamptz,
  add column if not exists fr_by              uuid references auth.users on delete set null;

comment on column public.fms_ocpi_deals.fx_rate is
  'USD to INR for this deal. Fetched live via the import-fx-rate Edge Function and always editable by hand — see fx_rate_overridden.';

comment on column public.fms_ocpi_deals.fx_rate_at is
  'When the rate was obtained. Shown beside it so a salesperson can see whether the figure is minutes or weeks old before relying on it.';

comment on column public.fms_ocpi_deals.fx_rate_source is
  'Where the rate came from — xe.com, er-api, frankfurter, cache — or ''manual'' when typed. Provenance, so a disputed conversion can be traced.';

comment on column public.fms_ocpi_deals.fx_rate_overridden is
  'True when a person replaced the fetched rate with the one actually agreed. A deal negotiated at a fixed rate is a normal thing; silently showing the live rate instead would misstate the contract.';

comment on column public.fms_ocpi_deals.deal_value_inr is
  'The rupee figure for a dollar deal. GST cannot be charged on dollars, so the detailed sheet needs a rupee value even when the deal is quoted in USD.';

comment on column public.fms_ocpi_deals.fh_at is
  'When the countersigned contract was handed to the finance team.';

comment on column public.fms_ocpi_deals.fh_by is
  'Who handed it over. A signed contract sitting on somebody''s desk is the gap this records.';

comment on column public.fms_ocpi_deals.fr_at is
  'When the finance team acknowledged receiving the contract.';

comment on column public.fms_ocpi_deals.fr_by is
  'Who at the finance team accepted it. With fh_by, a contract can be traced from the customer''s signature to the desk it reached.';

-- ---------------------------------------------------------------------------
-- 3 · ORDER QUOTATION becomes a legal heading.
--
-- The heading is about to become STAGE-DEPENDENT rather than a stored constant:
-- the same machine template prints ORDER QUOTATION while the price is being
-- negotiated and ORDER CONFIRMATION once the Directors approve. The stored
-- value stays the machine's own default for the confirmation; the CHECK simply
-- has to admit the other one.
--
-- ⚠ P8D genuinely says OFFER QUOTE and that stays legal — its deck has it, and
--   what it should read at each stage is an open question for the client
--   (OCPI.md, "The revision's open items"). Nothing here decides it.
-- ---------------------------------------------------------------------------
alter table public.fms_ocpi_machines
  drop constraint if exists fms_ocpi_machines_doc_title_check;

alter table public.fms_ocpi_machines
  add constraint fms_ocpi_machines_doc_title_check
  check (doc_title in ('ORDER CONFIRMATION', 'OFFER QUOTE', 'ORDER QUOTATION'));

-- ---------------------------------------------------------------------------
-- 4 · A version now has two documents, so the setter needs to say which.
--
-- ⚠ THE NEW PARAMETER HAS A DEFAULT, deliberately. Every existing caller passes
--   three arguments and means the summary sheet; with the default they keep
--   working untouched, and this migration stays behaviour-neutral.
--
-- The deal-folder guard is unchanged and load-bearing: the storage policy
-- derives the owning deal from the first path segment, so a path pointing
-- elsewhere would be readable by the wrong people.
-- ---------------------------------------------------------------------------
-- ⚠ DROP THE OLD SIGNATURE FIRST. `create or replace` with an ADDED parameter
--   creates an OVERLOAD, it does not replace: both the 3-arg and 4-arg forms would
--   exist, a 3-arg call would resolve to the stale one, and PostgREST can refuse it
--   outright as ambiguous. Found by reading the catalogue back after applying.
drop function if exists public.fms_ocpi_set_version_pdf(uuid, integer, text);

create or replace function public.fms_ocpi_set_version_pdf(
  p_deal    uuid,
  p_version integer,
  p_path    text,
  p_slot    text default 'summary'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_ocpi_can_act('quotation', p_deal, v_uid) then
    raise exception 'Not authorized';
  end if;
  if p_slot not in ('summary', 'detail') then
    raise exception 'Unknown document slot: %', p_slot;
  end if;
  -- ⚠ The path must live under this deal's folder. The storage policy derives
  --   the owning deal from the first path segment, so a path pointing elsewhere
  --   would be readable by the wrong people.
  if p_path is null or split_part(p_path, '/', 1) <> p_deal::text then
    raise exception 'A document path must start with its own deal id';
  end if;

  if p_slot = 'summary' then
    update public.fms_ocpi_quotation_versions
       set pdf_path = p_path
     where deal_id = p_deal and version_no = p_version;
  else
    update public.fms_ocpi_quotation_versions
       set oc_pdf_path = p_path
     where deal_id = p_deal and version_no = p_version;
  end if;
end $$;

comment on function public.fms_ocpi_set_version_pdf(uuid, integer, text, text) is
  'Attach a stored PDF to a quotation version. p_slot ''summary'' (default, the one-page sheet) or ''detail'' (the full machine template). The default keeps every pre-revision caller working unchanged.';

commit;
