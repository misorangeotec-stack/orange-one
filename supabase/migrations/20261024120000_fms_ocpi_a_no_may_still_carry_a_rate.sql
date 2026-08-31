-- ============================================================================
-- OCPI-7 · A "no" is not the end of the conversation.
--
-- ASKED FOR BY RITESH BHAI, 31-Aug-2026. Section B asks three questions --
-- deal includes ink / spare parts / head -- and today a No ends it. But "not
-- included in the machine price" is not "not being sold": the customer still
-- buys ink and still buys heads, and the rate is agreed at the same table as
-- the machine. Today that agreement lives nowhere and is re-negotiated later
-- from memory.
--
--   Deal includes ink?  -- Yes --> Quantity of ink included   (unchanged)
--                       |- No  --> Offered at a subsidized rate?
--                       |            |- No  --> nothing further
--                       |            +- Yes --> Quantity . Rate . Sub-total
--                       +- null --> nothing at all
--
-- INK AND HEAD ONLY. Spare parts keeps today's behaviour: a No ends it.
-- (Client narrowing, 31-Aug-2026, from the three the work list first proposed.)
--
-- ⚠ THE SUB-TOTAL IS NOT PART OF THE DEAL VALUE AND MUST NEVER BE ADDED TO IT.
--   The reasoning is the branch's own: this question is only ever asked when
--   the item is NOT included in the deal, so its money is not the deal's money.
--   deal_value_amount, deal_value_inr, machine_value_inr, gst_amount_inr,
--   total_inr, dryer_value_inr, dryer_gst_inr and grand_total_inr ALL exclude
--   it by construction, and must keep excluding it. Two sub-totals sitting on
--   the same row as a deal value are an obvious thing for a later "grand total"
--   to sweep up, and a contract that adds an un-ordered consumable into the
--   machine price is a commercial error, not a display bug. There is a machine
--   check for this at the foot of this file -- assertion 3.
--
-- ⚠ IT IS NOT EVEN IN RUPEES, which is the second, independent reason it can
--   never join the INR family. The rate follows the DEAL's currency
--   (deal_value_currency) and is never converted at fx_rate, so adding it to a
--   rupee total would be an ~85x error on a dollar deal. That is also why not
--   one of these columns carries the _inr suffix, which in this module marks
--   "on the money path".
--
-- ⚠ THESE ARE THE FIRST BRANCHES IN THIS MODULE THAT FIRE ON **FALSE**.
--   Every other guard in this function reads "is distinct from true". These
--   read "is distinct from false", which nulls the value for TRUE *and for
--   NULL* -- exactly the set of answers that must show nothing. An unanswered
--   inclusion must not present a rate question as though the system had
--   already decided the answer was No.
--
-- ⚠ ONE WRITER, NOT TWO. Section B is part A, so fms_ocpi_write_quotation owns
--   all eight columns and fms_ocpi_write_oc is deliberately NOT re-issued --
--   the two writers' column separation is what keeps saving one from blanking
--   the other. It is also what makes the exclusion invariant STRUCTURAL:
--   incl_head and the rate columns are set by ONE statement, so head_invoice_*
--   (kept only when incl_head is TRUE) and head_offer_* (kept only when it is
--   FALSE) can never both survive on one row.
--
-- ⚠ NO CROSS-COLUMN CHECK CONSTRAINT ENFORCES THAT INVARIANT, ON PURPOSE.
--   A CHECK is evaluated at end-of-STATEMENT and cannot be deferred. Inside a
--   single fms_ocpi_save_draft that flips a head from Yes to No, this function
--   runs first and a stale head_invoice_qty is still on the row until write_oc
--   runs a statement later. A constraint would fire on that transient state and
--   make every such save fail, with an error no salesperson could act on.
--   The invariant is asserted against the DATA instead -- assertion 4.
--
-- ⚠ fms_ocpi_save_draft NEEDS NO CHANGE. Its sniff array gates only the call to
--   write_oc; write_quotation is called unconditionally, so part-A keys are
--   never sniffed. But the part-A twin of that trap is WORSE and lives in the
--   browser: a part-B key missing from the sniff array is silently never
--   written and the old value survives, whereas a part-A key missing from
--   payloadFromDraft is BLANKED ON EVERY SAVE -- the payload lookup returns
--   NULL, the case stores NULL, and an agreed rate erases itself with no error
--   and nothing in a log. Six keys, in lib/fieldSpec.ts.
--
-- ⚠ THE BROWSER CARRIES A COPY OF EVERY RULE BELOW and it changes in the same
--   commit: lib/branching.ts (six show-on-false rules), lib/fieldSpec.ts
--   (draft, EMPTY_DRAFT, FIELD_LABEL, draftFromDeal, payloadFromDraft,
--   missingForSubmit) and data/ocpiFetch.ts (mapDeal). This file is the
--   authority; branching.ts is the courtesy copy.
--
-- ⚠ THE COMPLETENESS GATE IS TIGHTENED ONLY WHERE IT IS VACUOUS ON EXISTING
--   ROWS. Every new column is null on every deal on record, so
--   "offered is not true or ..." holds everywhere and the constraint cannot
--   fail on apply. Requiring an ANSWER to the rate question instead
--   (incl_ink is not false or ink_offer_agreed is not null) was considered and
--   REJECTED: a CHECK is re-validated on every UPDATE of the row, so it would
--   make every historical deal that answered No un-updatable -- every approval,
--   signature stamp, hold and cancel on those rows would throw. Backfilling
--   false is not an escape either; it asserts a commercial fact nobody stated
--   and would print it on a regenerated paper. Silence means "not discussed".
--
-- ⚠ BASED ON THE LIVE FUNCTION BODY, pulled with pg_get_functiondef on
--   31-Aug-2026, not on a migration file. The writers have been redefined five
--   times and the live body was found to differ from the newest file
--   (20261021140000) in two comments, every executable line identical.
--
-- ADDITIVE ONLY. Eight new nullable columns; one constraint replaced; one
-- function body re-issued. Nothing is altered or dropped.
--
-- ROLLBACK
--   1. the function -- re-run ONLY the fms_ocpi_write_quotation block of
--      20261021140000_fms_ocpi_machine_drives_the_branches.sql (lines 62-149).
--      ⚠ That file defines BOTH writers and its write_oc half is one revision
--        stale -- 20261021160000 superseded it. Re-applying the whole file
--        would silently undo the dryer-GST work.
--   2. the constraint --
--        alter table public.fms_ocpi_deals
--          drop constraint if exists fms_ocpi_complete_when_submitted;
--      then re-run the constraint block of
--      20261021120000_fms_ocpi_require_fx_rate.sql.
--   3. the columns STAY. Nothing else reads them, they are null on every row a
--      rolled-back writer produces, dropping them would lose rates already
--      agreed, and CLAUDE.md forbids it: additive only.
-- ============================================================================

begin;

-- 1 -------------------------------------------------------------- the columns

alter table public.fms_ocpi_deals
  -- ink, the NO branch
  add column if not exists ink_offer_agreed    boolean,
  add column if not exists ink_offer_qty       numeric(12, 3) check (ink_offer_qty       is null or ink_offer_qty       >= 0),
  add column if not exists ink_offer_rate      numeric(16, 2) check (ink_offer_rate      is null or ink_offer_rate      >= 0),
  add column if not exists ink_offer_subtotal  numeric(16, 2) check (ink_offer_subtotal  is null or ink_offer_subtotal  >= 0),
  -- head, the NO branch
  add column if not exists head_offer_agreed   boolean,
  add column if not exists head_offer_qty      integer        check (head_offer_qty      is null or head_offer_qty      >= 0),
  add column if not exists head_offer_rate     numeric(16, 2) check (head_offer_rate     is null or head_offer_rate     >= 0),
  add column if not exists head_offer_subtotal numeric(16, 2) check (head_offer_subtotal is null or head_offer_subtotal >= 0);

-- 2 ------------------------------------------------------- what they all mean

comment on column public.fms_ocpi_deals.ink_offer_agreed is
  'Section B, the NO branch: ink is NOT part of the deal - is it nevertheless offered at a subsidized rate? Set only when incl_ink is FALSE; a Yes to incl_ink nulls it. NULL means the question was never answered, which is a real third state and is NOT the same as No.';

comment on column public.fms_ocpi_deals.ink_offer_qty is
  'How much ink is offered at that rate, IN LITRES - hence numeric, not the free text ink_qty_included uses two rows up. Those two measure the same substance and belong to OPPOSITE branches: ink_qty_included is what a Yes includes, this is what a No is offered.';

comment on column public.fms_ocpi_deals.ink_offer_rate is
  'The agreed subsidized rate PER LITRE, in the DEAL own currency (deal_value_currency). There is no separate currency column and it is never converted at fx_rate. Not ink_price, which is the general ink selling price in Section A.';

comment on column public.fms_ocpi_deals.ink_offer_subtotal is
  'DERIVED in fms_ocpi_write_quotation, never read from the payload: round(ink_offer_qty * ink_offer_rate, 2), in the deal own currency. THIS IS NOT PART OF THE DEAL VALUE AND MUST NEVER BE ADDED TO IT. The question is only ever asked when ink is NOT included in the deal, so its money is not the deal money: deal_value_amount, deal_value_inr, machine_value_inr, gst_amount_inr, total_inr, dryer_value_inr, dryer_gst_inr and grand_total_inr all exclude it BY CONSTRUCTION and must keep excluding it. It is not even in rupees. Settled by the client 31-Aug-2026. Adding it to any total puts an un-ordered consumable inside a machine contract price - a commercial error, not a display bug.';

comment on column public.fms_ocpi_deals.head_offer_agreed is
  'Section B, the NO branch: the deal includes no head - is one nevertheless offered at a subsidized rate? Set only when incl_head is FALSE. NULL means never answered, which is not No.';

comment on column public.fms_ocpi_deals.head_offer_qty is
  'How many heads are offered at the subsidized rate, when the deal does NOT include one. NOT head_invoice_qty, which is its exact opposite: a head that IS included but is billed on a separate invoice. head_invoice_* survives only when incl_head is TRUE and head_offer_* only when it is FALSE, so the two can never both be set on one row.';

comment on column public.fms_ocpi_deals.head_offer_rate is
  'The agreed subsidized rate PER HEAD, in the DEAL own currency (deal_value_currency). Never converted at fx_rate.';

comment on column public.fms_ocpi_deals.head_offer_subtotal is
  'DERIVED in fms_ocpi_write_quotation, never read from the payload: round(head_offer_qty * head_offer_rate, 2), in the deal own currency. THIS IS NOT PART OF THE DEAL VALUE AND MUST NEVER BE ADDED TO IT - see ink_offer_subtotal for the full reasoning and the list of columns that exclude it.';

-- The same sentence pointed the other way, on the two columns most likely to be
-- confused with the new ones. They carry no comment today.
comment on column public.fms_ocpi_deals.head_invoice_qty is
  'Quantity on the SEPARATE INVOICE for a head that IS included in the deal. NOT head_offer_qty, which is its opposite: a head the deal does not include, offered at a subsidized rate. Kept only when incl_head is TRUE.';

comment on column public.fms_ocpi_deals.head_invoice_amount is
  'Amount on the SEPARATE INVOICE for a head that IS included in the deal, excluding tax. NOT head_offer_subtotal, which is its opposite - see head_invoice_qty.';

-- 3 --------------------------------------------------- the completeness gate
--
-- Reproduced VERBATIM from the live definition (20261021120000), with two
-- conjuncts added. Both are vacuous on every existing row -- see the header.

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

      -- Section B, Deal inclusions -- the three questions are answered ...
      and incl_ink is not null
      and incl_spares is not null
      and incl_head is not null
      -- ... and each "Yes" carries its detail.
      and (incl_ink    is not true or nullif(btrim(coalesce(ink_qty_included, '')), '') is not null)
      and (incl_spares is not true or nullif(btrim(coalesce(spare_details,   '')), '') is not null)
      and (incl_head   is not true or heads_included is not null)

      -- NEW (OCPI-7) -- and a "No" that was nevertheless offered at a
      -- subsidized rate carries its numbers. Deliberately NOT "a No must answer
      -- the rate question": that answer is null on every deal ever submitted,
      -- so requiring it would fail this constraint on apply and could only be
      -- satisfied by inventing a commercial fact on a filed contract. Silence
      -- is allowed; a Yes with no figures is not, because it prints a promise
      -- with no number beside it. The sub-total is deliberately absent: it is
      -- round(qty * rate, 2) and is non-null whenever both factors are.
      -- Mirrored sentence for sentence by missingForSubmit in lib/fieldSpec.ts;
      -- if the two disagree the salesperson gets a raw constraint violation
      -- naming no field.
      and (ink_offer_agreed  is not true or (ink_offer_qty  is not null and ink_offer_rate  is not null))
      and (head_offer_agreed is not true or (head_offer_qty is not null and head_offer_rate is not null))

      -- Section C, Commercial terms
      and payment_type is not null
      and nullif(btrim(coalesce(payment_terms, '')), '') is not null
      and delivery_date is not null
      and transport_terms is not null
      and (transport_terms <> 'high_seas' or (high_seas_via is not null and high_seas_cost_by is not null))
      and (transport_terms <> 'local'     or local_cost_by is not null)

      -- A dollar deal carries the rate it was converted at. Without it every
      -- rupee figure on both papers is null. High seas is tested as well as the
      -- currency because the two are the same thing here.
      and (
        (deal_value_currency <> 'USD' and coalesce(transport_terms, '') <> 'high_seas')
        or fx_rate is not null
      )
    ));

-- 4 ------------------------------------------- fms_ocpi_write_quotation
--
-- The LIVE body, unchanged, plus two declarations and eight assignments.

create or replace function public.fms_ocpi_write_quotation(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gst_available boolean := (p->>'gst_available')::boolean;
  v_incl_ink      boolean := (p->>'incl_ink')::boolean;
  v_incl_spares   boolean := (p->>'incl_spares')::boolean;
  v_incl_head     boolean := (p->>'incl_head')::boolean;
  v_transport     text    := nullif(btrim(p->>'transport_terms'), '');
  v_currency      text    := case when nullif(btrim(p->>'transport_terms'), '') = 'high_seas' then 'USD'
                                  else nullif(btrim(p->>'deal_value_currency'), '') end;
  v_amount        numeric := nullif(p->>'deal_value_amount', '')::numeric;
  v_fx            numeric := nullif(p->>'fx_rate', '')::numeric;
  v_machine       uuid    := nullif(p->>'machine_id', '')::uuid;
  v_needs_dryer   boolean;
  -- NEW (OCPI-7): the "not included, but offered at a subsidized rate" branch.
  -- These are the ONLY guards in this module that fire on FALSE rather than on
  -- TRUE, which is why they are declared together and commented here.
  v_ink_offer     boolean := (p->>'ink_offer_agreed')::boolean;
  v_ink_qty       numeric := nullif(p->>'ink_offer_qty', '')::numeric;
  v_ink_rate      numeric := nullif(p->>'ink_offer_rate', '')::numeric;
  v_head_offer    boolean := (p->>'head_offer_agreed')::boolean;
  v_head_qty      integer := nullif(p->>'head_offer_qty', '')::integer;
  v_head_rate     numeric := nullif(p->>'head_offer_rate', '')::numeric;
begin
  -- No machine, or a machine with the flag unset, means no dryer and therefore
  -- no dryer category. The machine is read from the PAYLOAD, not the row: this
  -- statement is what SETS machine_id, so the row still holds the previous one.
  select m.needs_dryer into v_needs_dryer
    from public.fms_ocpi_machines m where m.id = v_machine;

  update public.fms_ocpi_deals set
    salesperson_name   = nullif(btrim(p->>'salesperson_name'), ''),
    customer_id        = nullif(p->>'customer_id', '')::uuid,
    customer_name      = nullif(btrim(p->>'customer_name'), ''),
    customer_address   = nullif(btrim(p->>'customer_address'), ''),
    customer_attn      = nullif(btrim(p->>'customer_attn'), ''),
    customer_email     = nullif(lower(btrim(p->>'customer_email')), ''),
    customer_mobile    = nullif(regexp_replace(
                           regexp_replace(coalesce(p->>'customer_mobile',''), '\D', '', 'g'),
                           '^(91|0)(?=[0-9]{10}$)', ''), ''),
    gst_available      = v_gst_available,
    gst_no             = case when v_gst_available is distinct from true then null
                              else nullif(upper(btrim(p->>'gst_no')), '') end,
    company_id         = nullif(p->>'company_id', '')::uuid,
    location_id        = nullif(p->>'location_id', '')::uuid,
    machine_count      = nullif(p->>'machine_count', '')::integer,
    machine_id         = v_machine,
    head_type          = nullif(btrim(p->>'head_type'), ''),
    head_count         = nullif(p->>'head_count', '')::integer,
    ink_type           = nullif(btrim(p->>'ink_type'), ''),
    ink_price          = nullif(btrim(p->>'ink_price'), ''),
    ink_credit_terms   = nullif(btrim(p->>'ink_credit_terms'), ''),
    incl_ink           = v_incl_ink,
    ink_qty_included   = case when v_incl_ink is distinct from true then null
                              else nullif(btrim(p->>'ink_qty_included'), '') end,
    -- NEW (OCPI-7) -- THE INVERTED GUARD, and the first of its kind here. Every
    -- other branch in this function keeps a value when its owner is not
    -- distinct from TRUE; this one keeps it only when the owner is literally
    -- FALSE. "is distinct from false" is true for TRUE *and for NULL* - exactly
    -- the answers that must store nothing. It is also what stops a rate agreed
    -- while the answer was No from surviving a change to Yes and printing
    -- beside "Inclusive of Ink: Yes".
    ink_offer_agreed   = case when v_incl_ink is distinct from false then null
                              else v_ink_offer end,
    ink_offer_qty      = case when v_incl_ink is distinct from false
                                or v_ink_offer is distinct from true then null
                              else v_ink_qty end,
    ink_offer_rate     = case when v_incl_ink is distinct from false
                                or v_ink_offer is distinct from true then null
                              else v_ink_rate end,
    -- DERIVED here and never read from the payload. A browser-computed twin
    -- would be a second, different answer for one price on a contract - the
    -- mistake `withGst` was deleted for in stage E. It is NOT part of the deal
    -- value; see the column comment.
    ink_offer_subtotal = case when v_incl_ink is distinct from false
                                or v_ink_offer is distinct from true
                                or v_ink_qty is null or v_ink_rate is null then null
                              else round(v_ink_qty * v_ink_rate, 2) end,
    incl_spares        = v_incl_spares,
    spare_details      = case when v_incl_spares is distinct from true then null
                              else nullif(btrim(p->>'spare_details'), '') end,
    incl_head          = v_incl_head,
    heads_included     = case when v_incl_head is distinct from true then null
                              else nullif(p->>'heads_included', '')::integer end,
    -- NEW (OCPI-7) -- the head's inverted guard. See the ink block above.
    head_offer_agreed   = case when v_incl_head is distinct from false then null
                               else v_head_offer end,
    head_offer_qty      = case when v_incl_head is distinct from false
                                 or v_head_offer is distinct from true then null
                               else v_head_qty end,
    head_offer_rate     = case when v_incl_head is distinct from false
                                 or v_head_offer is distinct from true then null
                               else v_head_rate end,
    head_offer_subtotal = case when v_incl_head is distinct from false
                                 or v_head_offer is distinct from true
                                 or v_head_qty is null or v_head_rate is null then null
                               else round(v_head_qty * v_head_rate, 2) end,
    -- CHANGED (stage E): the dryer CATEGORY, kept only for a machine that takes
    -- a dryer. Was stored unconditionally as "Dryer required".
    dryer_type         = case when v_needs_dryer is distinct from true then null
                              else nullif(btrim(p->>'dryer_type'), '') end,
    deal_value_currency = v_currency,
    deal_value_amount   = v_amount,
    fx_rate            = case when v_currency = 'USD' then v_fx else null end,
    fx_rate_at         = case when v_currency = 'USD'
                              then nullif(p->>'fx_rate_at', '')::timestamptz else null end,
    fx_rate_source     = case when v_currency = 'USD'
                              then nullif(btrim(p->>'fx_rate_source'), '') else null end,
    fx_rate_overridden = case when v_currency = 'USD'
                              then (p->>'fx_rate_overridden')::boolean else null end,
    deal_value_inr     = case when v_currency = 'USD' and v_fx is not null and v_amount is not null
                              then round(v_amount * v_fx, 2) else null end,
    payment_type        = nullif(btrim(p->>'payment_type'), ''),
    payment_terms       = nullif(btrim(p->>'payment_terms'), ''),
    delivery_date       = nullif(p->>'delivery_date', '')::date,
    transport_terms     = v_transport,
    high_seas_via       = case when v_transport is distinct from 'high_seas' then null
                               else nullif(btrim(p->>'high_seas_via'), '') end,
    high_seas_cost_by   = case when v_transport is distinct from 'high_seas' then null
                               else nullif(btrim(p->>'high_seas_cost_by'), '') end,
    local_cost_by       = case when v_transport is distinct from 'local' then null
                               else nullif(btrim(p->>'local_cost_by'), '') end,
    remarks              = nullif(btrim(p->>'remarks'), ''),
    dollar_clause_agreed = case when v_currency is distinct from 'USD' then null
                                else (p->>'dollar_clause_agreed')::boolean end
  where id = p_deal;
end $$;

comment on function public.fms_ocpi_write_quotation(uuid, jsonb) is
  'Write the part-A columns from a jsonb bag, nulling whatever the branch rules hide. High Seas forces USD. dryer_type means the dryer CATEGORY and is kept only when the chosen machine needs_dryer flag is true - the machine is read from the PAYLOAD, since this is the statement that sets machine_id. Since OCPI-7 it also owns Section B NO branch: ink_offer_* and head_offer_*, kept only when the inclusion is literally FALSE (an inverted guard, the only one in the module) and the rate question is Yes; their sub-totals are DERIVED here and are NOT part of the deal value. Touches NO part-B column.';

-- 5 ----------------------------------------------------------------- asserts
--
-- MATCH CODE, NOT PROSE. pg_get_functiondef returns the body's comments too, so
-- a "not like" test passes falsely the moment a comment happens to spell the
-- token being looked for. Every token below occurs only in executable SQL in
-- the body written above -- keep that true if the comments are ever edited.

do $check$
declare
  v_def text;
  v_n   bigint;
begin
  -- 1 · the eight columns landed.
  select count(*) into v_n
    from (values ('ink_offer_agreed'), ('ink_offer_qty'), ('ink_offer_rate'), ('ink_offer_subtotal'),
                 ('head_offer_agreed'), ('head_offer_qty'), ('head_offer_rate'), ('head_offer_subtotal')) w(c)
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'fms_ocpi_deals'
                        and column_name = w.c);
  if v_n > 0 then raise exception 'OCPI-7: % offer column(s) did not land on fms_ocpi_deals', v_n; end if;

  -- 2 · their non-negative checks landed too. "add column if not exists"
  --     silently skips the CHECK when the column already exists, so this is
  --     counted rather than assumed.
  --     ⚠ MATCH THE COLUMN NAME AND ">=", NEVER THE LITERAL ">= 0".
  --       pg_get_constraintdef re-renders the bound in the column's own type:
  --       the integer column reads ">= 0" but every numeric one reads
  --       ">= (0)::numeric". A pattern looking for ">= 0" therefore finds one
  --       of the six and aborts the migration -- which is exactly what happened
  --       on the first apply of this file.
  select count(*) into v_n
    from pg_constraint c join pg_class t on t.oid = c.conrelid
   where t.relname = 'fms_ocpi_deals' and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%>=%'
     and (pg_get_constraintdef(c.oid) like '%ink_offer_qty%'
       or pg_get_constraintdef(c.oid) like '%ink_offer_rate%'
       or pg_get_constraintdef(c.oid) like '%ink_offer_subtotal%'
       or pg_get_constraintdef(c.oid) like '%head_offer_qty%'
       or pg_get_constraintdef(c.oid) like '%head_offer_rate%'
       or pg_get_constraintdef(c.oid) like '%head_offer_subtotal%');
  if v_n < 6 then
    raise exception 'OCPI-7: only % of the 6 non-negative offer checks are present', v_n;
  end if;

  -- 3 · write_quotation carries the INVERTED guard and derives both sub-totals.
  --     The guard test is what catches an OLDER function body being silently
  --     restored over four later changes.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_quotation';
  if v_def is null then raise exception 'OCPI-7: fms_ocpi_write_quotation missing after replace'; end if;
  if v_def not like '%v_incl_ink is distinct from false%'
  or v_def not like '%v_incl_head is distinct from false%' then
    raise exception 'OCPI-7: write_quotation is not using the inverted guard - an older body was restored';
  end if;
  if v_def not like '%round(v_ink_qty * v_ink_rate, 2)%'
  or v_def not like '%round(v_head_qty * v_head_rate, 2)%' then
    raise exception 'OCPI-7: write_quotation does not derive both sub-totals';
  end if;

  -- 4 · THE MONEY GUARD, machine-checked. fms_ocpi_write_oc owns every rupee
  --     derivation on this table (machine_value_inr, gst_amount_inr, total_inr,
  --     dryer_value_inr, dryer_gst_inr, grand_total_inr). It must not have
  --     learned about any of the eight. The day somebody sweeps a sub-total
  --     into a grand total, this is the line that objects.
  --     It reads write_oc's own comments too: if a future comment there names
  --     an offer column, delete the COMMENT, not this guard.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_oc';
  if v_def like '%offer_subtotal%' or v_def like '%offer_rate%' or v_def like '%offer_qty%' then
    raise exception 'OCPI-7: fms_ocpi_write_oc mentions an offer column - a deal total must never include one';
  end if;

  -- 5 · THE EXCLUSION INVARIANT, on the data rather than as a CHECK constraint
  --     (a CHECK fires at end-of-statement and cannot be deferred, so it would
  --     break the save that flips a head from Yes to No -- see the header).
  select count(*) into v_n from public.fms_ocpi_deals
   where (head_offer_qty is not null or head_offer_rate is not null)
     and (head_invoice_qty is not null or head_invoice_amount is not null);
  if v_n > 0 then
    raise exception 'OCPI-7: % deal(s) carry BOTH a subsidized rate and a separate-invoice figure for the head', v_n;
  end if;
end $check$;

commit;
