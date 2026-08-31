-- ============================================================================
-- OCPI-7 follow-up · A subsidized rate is ALWAYS in rupees.
--
-- CLIENT, 31-Aug-2026, revising the answer given the same day. The subsidized
-- rate first followed the deal's own `deal_value_currency`. It does not: a
-- machine may be sold in dollars, but ink and heads are bought here and are
-- rated in rupees regardless. So a High Seas sheet now carries a dollar machine
-- price and a rupee ink price on one page, each printing its own symbol.
--
-- ⚠ COMMENTS ONLY. No column is added, altered or dropped, and no function
--   changes: the stored figures were never converted in the first place, so
--   `round(qty * rate, 2)` is already right and every existing value is already
--   the number the salesperson typed. Only the DESCRIPTION of these columns was
--   wrong, and a wrong comment on a money column is worth a migration of its own
--   — it is what the next person reads before deciding whether to sum it.
--
-- ⚠ ONE LINE OF DEFENCE IS GONE, AND THAT IS THE REAL POINT OF THIS FILE.
--   The original comments argued the sub-total could never join `total_inr`
--   partly BECAUSE it was not in rupees — adding it would have been an ~85x
--   error on a dollar deal, which is the kind of mistake that shows up
--   immediately. Now it IS rupees, in the same unit as every figure on the money
--   path, so that protection no longer exists and a wrong sum would look
--   plausible. What still holds:
--     · the column comments below, which say so outright;
--     · the names, which deliberately carry NO `_inr` suffix — in this module
--       that suffix marks the derived money path (machine_value_inr,
--       gst_amount_inr, total_inr, dryer_value_inr, grand_total_inr), and these
--       are rupees but are NOT on it;
--     · the assertion in 20261024120000, which FAILS THE DEPLOY if
--       fms_ocpi_write_oc ever so much as mentions an offer column.
--   That third one is now the load-bearing guard. Do not weaken it.
--
-- ⚠ fx_rate IS STILL NEVER CONSULTED for these columns, by either the writer or
--   the renderer. Nothing here can move when an exchange rate moves.
--
-- ADDITIVE ONLY. Comments only.
--
-- ROLLBACK: re-run the `comment on column` block of 20261024120000. Nothing
--   else is touched, and no data is affected either way.
-- ============================================================================

begin;

comment on column public.fms_ocpi_deals.ink_offer_rate is
  'The agreed subsidized rate PER LITRE, ALWAYS IN RUPEES - never the deal own currency, and never converted at fx_rate (client, 31-Aug-2026). A dollar machine and a rupee ink rate can therefore appear on one quotation, each stating its own symbol. Not ink_price, which is the general ink selling price in Section A and a different figure entirely.';

comment on column public.fms_ocpi_deals.ink_offer_subtotal is
  'DERIVED in fms_ocpi_write_quotation, never read from the payload: round(ink_offer_qty * ink_offer_rate, 2), ALWAYS IN RUPEES. THIS IS NOT PART OF THE DEAL VALUE AND MUST NEVER BE ADDED TO IT. The question is only ever asked when ink is NOT included in the deal, so its money is not the deal money: deal_value_amount, deal_value_inr, machine_value_inr, gst_amount_inr, total_inr, dryer_value_inr, dryer_gst_inr and grand_total_inr all exclude it BY CONSTRUCTION and must keep excluding it. It carries no _inr suffix on purpose: in this module that suffix marks the DERIVED MONEY PATH, and this is rupees but is not on that path. Adding it to any total puts an un-ordered consumable inside a machine contract price - a commercial error, not a display bug.';

comment on column public.fms_ocpi_deals.head_offer_rate is
  'The agreed subsidized rate PER HEAD, ALWAYS IN RUPEES - never the deal own currency, and never converted at fx_rate.';

comment on column public.fms_ocpi_deals.head_offer_subtotal is
  'DERIVED in fms_ocpi_write_quotation, never read from the payload: round(head_offer_qty * head_offer_rate, 2), ALWAYS IN RUPEES. THIS IS NOT PART OF THE DEAL VALUE AND MUST NEVER BE ADDED TO IT - see ink_offer_subtotal for the full reasoning and the list of columns that exclude it.';

-- The rate is bounded by the quantity it was agreed for, and the quotation now
-- prints a sentence saying so. The sentence is composed at render time from the
-- quantity column, so there is nothing to store.
comment on column public.fms_ocpi_deals.ink_offer_qty is
  'How much ink is offered at that rate, IN LITRES - hence numeric, not the free text ink_qty_included uses two rows up. Those two measure the same substance and belong to OPPOSITE branches: ink_qty_included is what a Yes includes, this is what a No is offered. It is also printed inside the subsidized-rate note on the quotation, which bounds the rate to this quantity - a rate on a signed quotation with no quantity beside it is an open-ended commitment.';

comment on column public.fms_ocpi_deals.head_offer_qty is
  'How many heads are offered at the subsidized rate, when the deal does NOT include one. NOT head_invoice_qty, which is its exact opposite: a head that IS included but is billed on a separate invoice. head_invoice_* survives only when incl_head is TRUE and head_offer_* only when it is FALSE, so the two can never both be set on one row. Also printed inside the subsidized-rate note, which bounds the rate to this quantity.';

commit;
