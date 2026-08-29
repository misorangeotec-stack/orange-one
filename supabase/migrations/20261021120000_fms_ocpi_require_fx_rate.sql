-- ===========================================================================
-- OCPI — A DOLLAR DEAL MUST CARRY THE RATE IT WAS CONVERTED AT.
--
-- THE FAULT THIS CLOSES
--   `fms_ocpi_write_quotation` forces deal_value_currency = 'USD' on a high
--   seas deal, but only ON SAVE. The form tested the currency alone to decide
--   whether to show the FX block, so between picking High Seas and saving, the
--   draft still read 'INR' — the currency picker sat disabled showing rupees
--   under a note promising dollars, and the rate box never rendered. There was
--   NO WAY TO ENTER A RATE on the one deal type that is always in dollars.
--
--   Nothing required one either. The deal saved as USD with fx_rate null, so
--   deal_value_inr is null (it is round(amount * rate)), so fms_ocpi_write_oc's
--   v_value is null, so machine_value_inr, gst_amount_inr AND total_inr are all
--   null — and both papers printed a BLANK "Total Value (INR)" on a contract.
--
--   The form half is fixed in lib/fieldSpec.ts (`isUsdDeal`, used by
--   branching.ts and missingForSubmit) and components/QuotationForm.tsx, which
--   now sets the currency the moment High Seas is picked. This is the server
--   half: the same rule the browser cannot be trusted to enforce alone.
--
-- ⚠ THIS TIGHTENS AN EXISTING CHECK, which is the one kind of change that can
--   FAIL ON APPLY — a constraint is validated against every existing row. It
--   was verified first against the live table:
--
--     select count(*) from public.fms_ocpi_deals
--      where status <> 'draft'
--        and (deal_value_currency = 'USD' or transport_terms = 'high_seas')
--        and fx_rate is null;                                   -- returned 0
--
--   RUN THAT AGAIN BEFORE APPLYING. If it returns rows, fill their rate first;
--   do not weaken the clause to let them through.
--
-- ⚠ DRAFTS ARE EXEMPT, as they are from every other clause here. A quotation is
--   built up over several saves and must be allowed to be incomplete until it
--   is submitted. That is the `status = 'draft' or (...)` at the head of the
--   check, and it is why this can be tightened at all.
--
-- The clause is reproduced verbatim from the definition in
-- 20261019120100_fms_ocpi_merged_form_writes.sql, with ONE conjunct added at
-- the foot. Nothing else changes.
--
-- Reversal:
--   alter table public.fms_ocpi_deals
--     drop constraint if exists fms_ocpi_complete_when_submitted;
--   -- then re-run the constraint block from 20261019120100 verbatim.
-- ===========================================================================

begin;

alter table public.fms_ocpi_deals
  drop constraint if exists fms_ocpi_complete_when_submitted;

alter table public.fms_ocpi_deals
  add constraint fms_ocpi_complete_when_submitted check (
    status = 'draft' or (
          nullif(btrim(customer_name), '') is not null
      and nullif(btrim(coalesce(salesperson_name, '')), '') is not null
      and machine_id is not null
      and machine_count is not null
      and deal_value_amount is not null
      and deal_value_currency is not null

      -- Section B · Deal inclusions — the three questions are answered …
      and incl_ink is not null
      and incl_spares is not null
      and incl_head is not null
      -- … and each "Yes" carries its detail.
      and (incl_ink    is not true or nullif(btrim(coalesce(ink_qty_included, '')), '') is not null)
      and (incl_spares is not true or nullif(btrim(coalesce(spare_details,   '')), '') is not null)
      and (incl_head   is not true or heads_included is not null)

      -- Section C · Commercial terms
      and payment_type is not null
      and nullif(btrim(coalesce(payment_terms, '')), '') is not null
      and delivery_date is not null
      and transport_terms is not null
      and (transport_terms <> 'high_seas' or (high_seas_via is not null and high_seas_cost_by is not null))
      and (transport_terms <> 'local'     or local_cost_by is not null)

      -- ⚠ NEW · a dollar deal carries the rate it was converted at. Without it
      --   every rupee figure on both papers is null — see the header. High seas
      --   is tested as well as the currency because the two are the same thing
      --   here: fms_ocpi_write_quotation forces USD on a high-seas deal, and a
      --   row could otherwise be written in the instant before it does.
      and (
        (deal_value_currency <> 'USD' and coalesce(transport_terms, '') <> 'high_seas')
        or fx_rate is not null
      )
    ));

commit;
