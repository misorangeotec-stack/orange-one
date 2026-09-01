/*
  OCPI-18 · The delivery DATE replaces the delivery DAYS, on the form and on the
  contract — and the two are one edit, not two.

  ─────────────────────────────────────────────────────────────────────────────
  WHY THIS FILE EXISTS AT ALL

  The client asked for two fields to be dropped from the commercial-terms block
  ("Type of payment" and "Delivery days") and for the machine delivery date to
  appear on the contract with the condition it is given under.

  🔴 "Delivery days" COULD NOT SIMPLY BE DELETED. `{{delivery_days}}` was a LIVE
     template token in the SALE CONDITIONS OF THE SUPPLY clause of 21 of the 28
     machine decks — the contract's own delivery terms. Removing the form field
     on its own would have printed

         Delivery Days: ________

     in the delivery clause of a document customers sign. An unresolved token
     rules a blank by design (see lib/tokens.ts), so the failure would have been
     silent and on paper.

  🟢 So the removal and the addition are the SAME EDIT. Every one of the 21
     sections has its delivery line replaced by the date and its condition:

         Tentative Machine Delivery Date: {{delivery_date}}
         Applicable from the date of signing of this contract.

     which removes the token AND delivers what was asked for, with no blank left
     behind.

  ⚠ `{{delivery_date}}` MUST ALREADY RESOLVE BEFORE THIS FILE IS APPLIED. It was
    added to `tokensFor` and to `TOKEN_HELP` in lib/tokens.ts in the same change.
    Applying this against an older frontend lands a token nothing fills and
    prints the exact blank the file was written to prevent.

  ─────────────────────────────────────────────────────────────────────────────
  🔴 THE BRIEF SAID ONE HEADING. THE DATABASE HAS FIVE.

  The instruction described all 21 lines as reading `Delivery Days:
  {{delivery_days}}` and asked for a guard matching that literal text. Checked
  against the live table, that would have rewritten FOURTEEN and failed the
  assertion, because the heading is not uniform:

      Delivery Days:   14   Homer K24/K32, K64, P8D, P8S, Pengda,
                            Kolorado Alpha 15/16, KoloRado Alpha II x3,
                            Alpha 3 - 12 heads, Alpha 3.2 - 8/24 heads
      Delivery Terms:   3   Fab Pro 1I / 2I / 3I
      Delivery:         2   JPK, Rocket
      Shipment Terms:   1   Position Printer
      Shipment:         1   MP5000

  All five say the same thing, and all 21 are normalised to the agreed wording —
  confirmed with the client before this was written. That also corrects the three
  Fab Pro decks, which label delivery DAYS as "Delivery Terms", a heading their
  own `{{trade_term}}` line already uses six words earlier on the same page.

  ⚠ THE MATCH IS THEREFORE ON THE TOKEN, NEVER ON THE HEADING. Anchoring on
    prose is what would have missed a third of the contracts.

  ─────────────────────────────────────────────────────────────────────────────
  WHAT IS NOT TOUCHED

  · `delivery_days` and `payment_type` COLUMNS both stay. Additive-only: the 19
    deals that recorded delivery days and the 23 that recorded a payment type
    keep what they answered, and their frozen papers still print it.
  · `fms_ocpi_write_quotation`, `fms_ocpi_write_oc` and `fms_ocpi_save_draft` are
    left exactly as they are. The form still round-trips both values, and
    write_quotation already coerces '' to NULL, so nothing new can violate
    `fms_ocpi_deals_payment_type_check`.
  · `fms_ocpi_submit_oc` still raises "Still needed on the order confirmation:
    the delivery days". That reads like a blocker and is not one: the
    order-confirmation wrappers were retired at revision stage F, nothing in the
    app calls it, and no deal is parked at that step. It is what historical rows
    at the retired step were written by, so it is left alone deliberately rather
    than overlooked.
  · `delivery_date is not null` STAYS in the submit check. OCPI-15 owns any
    change to what is mandatory; this file only removes `payment_type`.
*/

begin;

do $check$
declare
  v_before_days      int;
  v_before_sale      int;
  v_before_machines  int;
  v_before_once      int;
  v_before_headings  int;
  v_before_date      int;
  v_before_elsewhere int;
  v_before_trade     int;
  v_before_lines     bigint;
  v_after_lines      bigint;
  v_rows             int;
  v_n                int;
begin
  ------------------------------------------------------------------ pre-flight
  -- 1 · Exactly 21 sections carry the token, and every one of them is the
  --     active SALE CONDITIONS section of a distinct machine. If a 22nd deck
  --     gained the token since this was written, the apply must stop and be
  --     re-read rather than quietly rewriting something nobody checked.
  select count(*), count(distinct machine_id)
    into v_before_days, v_before_machines
    from public.fms_ocpi_machine_sections
   where body like '%{{delivery_days}}%';
  if v_before_days <> 21 then
    raise exception 'OCPI-18 pre 1: expected 21 sections using the delivery_days token, found %', v_before_days;
  end if;
  if v_before_machines <> 21 then
    raise exception 'OCPI-18 pre 1b: expected 21 distinct machines, found %', v_before_machines;
  end if;

  select count(*) into v_before_sale
    from public.fms_ocpi_machine_sections
   where body like '%{{delivery_days}}%' and key = 'sale_conditions' and active is true;
  if v_before_sale <> 21 then
    raise exception 'OCPI-18 pre 2: expected all 21 to be active sale_conditions, found %', v_before_sale;
  end if;

  -- 2 · The token appears exactly ONCE in each of the 21 bodies. A body holding
  --     it twice would come out of the rewrite with two delivery-date lines.
  select count(*) into v_before_once
    from public.fms_ocpi_machine_sections
   where body like '%{{delivery_days}}%'
     and (length(body) - length(replace(body, '{{delivery_days}}', ''))) / length('{{delivery_days}}') = 1;
  if v_before_once <> 21 then
    raise exception 'OCPI-18 pre 3: expected 21 bodies holding the token exactly once, found %', v_before_once;
  end if;

  -- 3 · Every occurrence sits on a line of the shape "<Heading>: {{token}}" and
  --     matches one of the five headings on record. A sixth shape — the token
  --     mid-sentence, say — would be destroyed by a whole-line replacement, so
  --     it must fail here instead.
  select count(*) into v_before_headings
    from public.fms_ocpi_machine_sections
   where body like '%{{delivery_days}}%'
     and (   body like '%Delivery Days: {{delivery_days}}%'
          or body like '%Delivery Terms: {{delivery_days}}%'
          or body like '%Delivery: {{delivery_days}}%'
          or body like '%Shipment Terms: {{delivery_days}}%'
          or body like '%Shipment: {{delivery_days}}%');
  if v_before_headings <> 21 then
    raise exception 'OCPI-18 pre 4: an unrecognised delivery_days line shape exists (% of 21 matched the five known headings)', v_before_headings;
  end if;

  -- 4 · The token is not hiding anywhere else in the machine master. Only
  --     section bodies are rewritten below, so an occurrence in a spec row or
  --     the supply description would survive and print a blank.
  select (select count(*) from public.fms_ocpi_machines where coalesce(intro_text,'') like '%delivery_days%')
       + (select count(*) from public.fms_ocpi_machines where coalesce(supply_description,'') like '%delivery_days%')
       + (select count(*) from public.fms_ocpi_machines where coalesce(spec_rows::text,'') like '%delivery_days%')
       + (select count(*) from public.fms_ocpi_machines where coalesce(composition::text,'') like '%delivery_days%')
       + (select count(*) from public.fms_ocpi_machines where coalesce(header_fields::text,'') like '%delivery_days%')
    into v_before_elsewhere;
  if v_before_elsewhere <> 0 then
    raise exception 'OCPI-18 pre 5: the delivery_days token also appears outside section bodies, in % place(s)', v_before_elsewhere;
  end if;

  -- 5 · Nothing uses the new token yet, so the post-flight count of 21 can only
  --     have come from this file.
  select count(*) into v_before_date
    from public.fms_ocpi_machine_sections where body like '%{{delivery_date}}%';
  if v_before_date <> 0 then
    raise exception 'OCPI-18 pre 6: the delivery_date token is already in use in % section(s) — this file has run before', v_before_date;
  end if;

  -- 6 · Baselines for the two "nothing else moved" checks below.
  select count(*) into v_before_trade
    from public.fms_ocpi_machine_sections where body like '%{{trade_term}}%';
  select coalesce(sum(length(body) - length(replace(body, E'\n', ''))), 0)
    into v_before_lines from public.fms_ocpi_machine_sections;

  ---------------------------------------------------------------- the rewrite
  -- ⚠ MATCHED ON THE TOKEN, NOT THE HEADING — see the note at the top. `(?n)`
  --   makes ^ and $ line anchors and stops `.` crossing a newline, so exactly
  --   the one delivery line is replaced and the trade term, payment terms and
  --   bank block lines around it are untouched.
  update public.fms_ocpi_machine_sections
     set body = regexp_replace(
                  body,
                  '(?n)^.*\{\{delivery_days\}\}.*$',
                  'Tentative Machine Delivery Date: {{delivery_date}}' || E'\n' ||
                  'Applicable from the date of signing of this contract.',
                  'g'),
         updated_at = now()
   where body like '%{{delivery_days}}%';
  get diagnostics v_rows = row_count;
  if v_rows <> 21 then
    raise exception 'OCPI-18: expected to rewrite 21 sections, rewrote %', v_rows;
  end if;

  ----------------------------------------------------------------- post-flight
  -- 7 · The token is gone from the whole master, not merely from the 21.
  select count(*) into v_n
    from public.fms_ocpi_machine_sections where body like '%delivery_days%';
  if v_n <> 0 then
    raise exception 'OCPI-18 post 1: delivery_days still appears in % section(s)', v_n;
  end if;

  -- 8 · All 21 carry the new line, verbatim, exactly once.
  select count(*) into v_n
    from public.fms_ocpi_machine_sections
   where body like '%Tentative Machine Delivery Date: {{delivery_date}}%'
     and (length(body) - length(replace(body, '{{delivery_date}}', ''))) / length('{{delivery_date}}') = 1;
  if v_n <> 21 then
    raise exception 'OCPI-18 post 2: expected 21 sections with one delivery-date line, found %', v_n;
  end if;

  -- 9 · And all 21 carry the condition beneath it, exactly once. THIS SENTENCE
  --     IS ALSO SHOWN ON THE FORM, from DELIVERY_DATE_REMARK in lib/fieldSpec.ts.
  --     SQL cannot import it, so this is a second copy on purpose; change one
  --     and change the other, or the form and the contract will state the same
  --     condition in two slightly different ways.
  select count(*) into v_n
    from public.fms_ocpi_machine_sections
   where body like '%Applicable from the date of signing of this contract.%'
     and (length(body) - length(replace(body, 'Applicable from the date of signing of this contract.', '')))
         / length('Applicable from the date of signing of this contract.') = 1;
  if v_n <> 21 then
    raise exception 'OCPI-18 post 3: expected 21 sections with one condition line, found %', v_n;
  end if;

  -- 10 · Nothing else in any body moved: the delivery term is still on all the
  --      sections that had it, and the master gained exactly 21 lines — one per
  --      rewritten section — which is only true if each replacement turned one
  --      line into two and touched nothing around it.
  select count(*) into v_n
    from public.fms_ocpi_machine_sections where body like '%{{trade_term}}%';
  if v_n <> v_before_trade then
    raise exception 'OCPI-18 post 4: the trade term went from % sections to %', v_before_trade, v_n;
  end if;

  select coalesce(sum(length(body) - length(replace(body, E'\n', ''))), 0)
    into v_after_lines from public.fms_ocpi_machine_sections;
  if v_after_lines - v_before_lines <> 21 then
    raise exception 'OCPI-18 post 5: expected the master to gain exactly 21 lines, it gained %', v_after_lines - v_before_lines;
  end if;
end $check$;

/*
  ─────────────────────────────────────────────────────────────────────────────
  "Type of payment" stops being required on submit.

  ⚠ THE FORM AND THIS CHECK MUST AGREE IN BOTH DIRECTIONS. The form has stopped
    asking for a payment type; if the constraint still demanded one, the
    salesperson would get a raw Postgres constraint violation naming no field, on
    a quotation the form said was complete — and nothing could be submitted.

  ⚠ REBUILT FROM `pg_get_constraintdef` ON THE LIVE DATABASE, not from any
    migration file. The files in this folder have diverged from what is actually
    installed; this is the installed predicate with one conjunct removed and
    nothing else changed.

  A CHECK is re-validated against every existing row when it is added. This one
  is strictly WEAKER than the constraint it replaces, and the only three rows
  with a null payment_type are drafts, which the predicate short-circuits
  anyway — so the re-validation cannot fail.
*/
alter table public.fms_ocpi_deals
  drop constraint fms_ocpi_complete_when_submitted;

alter table public.fms_ocpi_deals
  add constraint fms_ocpi_complete_when_submitted check (
    status = 'draft'
    or (
      nullif(btrim(customer_name), '') is not null
      and nullif(btrim(coalesce(salesperson_name, '')), '') is not null
      and machine_id is not null
      and machine_count is not null
      and deal_value_amount is not null
      and deal_value_currency is not null
      and incl_ink is not null
      and incl_spares is not null
      and incl_head is not null
      and (incl_ink is not true or nullif(btrim(coalesce(ink_qty_included, '')), '') is not null)
      and (incl_spares is not true or nullif(btrim(coalesce(spare_details, '')), '') is not null)
      and (incl_head is not true or heads_included is not null)
      and (ink_offer_agreed is not true or (ink_offer_qty is not null and ink_offer_rate is not null))
      and (head_offer_agreed is not true or (head_offer_qty is not null and head_offer_rate is not null))
      -- ⚠ `payment_type is not null` WAS HERE (OCPI-18). "Terms of payment" below
      --    is a DIFFERENT field and stays required: it is the free-text box that
      --    carries the real answer and prints on both papers.
      and nullif(btrim(coalesce(payment_terms, '')), '') is not null
      and delivery_date is not null
      and transport_terms is not null
      and (transport_terms <> 'high_seas' or (high_seas_via is not null and high_seas_cost_by is not null))
      and (transport_terms <> 'local' or local_cost_by is not null)
      and ((deal_value_currency <> 'USD' and coalesce(transport_terms, '') <> 'high_seas') or fx_rate is not null)
    )
  );

do $check$
declare v_n int;
begin
  -- 11 · The rebuild kept every other conjunct. Counted rather than eyeballed:
  --      payment_type is gone, and the fields that must still be demanded are
  --      still demanded.
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname = 'fms_ocpi_complete_when_submitted'
     and pg_get_constraintdef(oid) not like '%payment_type%'
     and pg_get_constraintdef(oid) like '%payment_terms%'
     and pg_get_constraintdef(oid) like '%delivery_date%'
     and pg_get_constraintdef(oid) like '%fx_rate%'
     and pg_get_constraintdef(oid) like '%high_seas_via%'
     and pg_get_constraintdef(oid) like '%ink_offer_rate%';
  if v_n <> 1 then
    raise exception 'OCPI-18 post 6: the rebuilt submit CHECK is not the captured predicate minus payment_type';
  end if;

  -- 12 · It is VALIDATED. A NOT VALID constraint would let a future incomplete
  --      row through and only fail on the next update of an unrelated column.
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname = 'fms_ocpi_complete_when_submitted'
     and convalidated;
  if v_n <> 1 then
    raise exception 'OCPI-18 post 7: the submit CHECK is not validated';
  end if;
end $check$;

commit;
