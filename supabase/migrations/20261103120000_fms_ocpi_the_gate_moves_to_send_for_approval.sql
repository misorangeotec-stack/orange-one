-- OCPI-15 · Nothing is mandatory until Send for approval — and then say plainly
--            what is missing.
--
-- ── WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
--
-- The brief for this change said `fms_ocpi_write_quotation` carried a
-- completeness predicate that had to be relaxed. IT DOES NOT. Read live with
-- pg_get_functiondef it is a plain UPDATE, and the two gates that actually exist
-- are already in the right places:
--
--   Generate          · a six-item list inside fms_ocpi_generate_quotation.
--   Send for approval · the CHECK fms_ocpi_complete_when_submitted, which is
--                       written `status = 'draft' OR (…24 conjuncts…)` and so
--                       fires ONLY once the row leaves draft.
--
-- The CHECK therefore already behaves exactly as OCPI-15 asks — it enforces
-- nothing while a quotation is being worked on and everything the moment it is
-- submitted. Nothing here touches it.
--
-- 🔴 AND NOTHING HERE MAY TOUCH IT. A CHECK is re-validated on every UPDATE, so
--    adding a conjunct makes every deal already on record that fails it
--    un-updatable — every approval, every signature stamp, every status move on
--    26 live deals starts throwing. OCPI-7 and OCPI-14 both proposed tightening
--    this constraint and both rejected it for that reason. The form carries the
--    requirement; the constraint does not.
--
-- So this migration does two small things:
--
--   1. fms_ocpi_generate_quotation gains ONE conjunct — the dollar rate.
--      ⚠ THIS IS A TIGHTENING, NOT A RELAXATION. The client's Generate tier was
--        specified as customer + machine only, which would have needed the
--        opposite; Ritesh Bhai reversed that while it was being planned, on the
--        grounds that "a quotation cannot be generated without the pricing —
--        otherwise we already have the save draft option". The client now
--        demands the same six this function already did, PLUS the dollar rate,
--        because without it the rupee total prints blank on both papers.
--        Checked on live data first: all 5 USD / high-seas deals of 26 already
--        carry an fx_rate, so this refuses nothing that exists.
--
--   2. fms_ocpi_submit_quotation gains a completeness pre-check that NAMES the
--      missing fields. It had none, so any disagreement between the form and the
--      CHECK surfaced as a raw Postgres constraint violation naming nothing —
--      which is the exact failure OCPI-15 exists to end, one layer down.
--      ⚠ IT MIRRORS THE CHECK CONJUNCT FOR CONJUNCT AND IS NEVER STRICTER. A
--        stricter predicate would refuse deals the constraint permits. It stays
--        deliberately LOOSER than the client on the print head and the centering
--        inclusion, neither of which the CHECK has ever carried.
--
-- ⚠ BOTH ARE TRANSFORMS OF THE LIVE BODY, NOT RETYPED COPIES. Each reads
--   pg_get_functiondef, asserts its anchor appears exactly once, substitutes and
--   asserts the result. These two functions have been redefined many times and
--   the migration files diverge from what is running; a hand-copied body is
--   precisely how that drift happens.

do $mig$
declare
  v_src    text;
  v_new    text;
  v_anchor text;
  v_repl   text;
  v_hits   int;
begin
  -- ── 1 · Generate also needs the dollar rate ───────────────────────────────
  v_src := pg_get_functiondef(
    'public.fms_ocpi_generate_quotation(uuid,jsonb,jsonb,jsonb)'::regprocedure);

  v_anchor := $a$      case when v_currency is null then 'the currency' end$a$;

  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'fms_ocpi_generate_quotation: expected the currency conjunct exactly once, found %', v_hits;
  end if;

  v_repl := $b$      case when v_currency is null then 'the currency' end,
      /*
        OCPI-15 · THE DOLLAR RATE IS PART OF THE PRICE.

        Without it deal_value_inr is derived as null in fms_ocpi_write_quotation
        and the RUPEE total prints blank on both papers — the same fault as a
        blank price with one indirection in front of it.

        ⚠ IT TESTS BOTH TERMS, exactly as fms_ocpi_complete_when_submitted does.
          A high seas sale is a dollar deal from the moment the deal type is
          picked, and write_quotation forces the currency to USD on save, so the
          first term is normally sufficient — but a row arriving by any other
          path would slip through on the currency alone.
      */
      case when v_fx is null
                 and ((select coalesce(deal_value_currency, '')
                         from public.fms_ocpi_deals where id = p_deal) = 'USD'
                   or (select coalesce(transport_terms, '')
                         from public.fms_ocpi_deals where id = p_deal) = 'high_seas')
           then 'the USD to INR rate' end$b$;

  v_new := replace(v_src, v_anchor, v_repl);
  if v_new = v_src then
    raise exception 'fms_ocpi_generate_quotation: substitution changed nothing';
  end if;
  execute v_new;

  -- ── 2 · Send for approval says what is missing ────────────────────────────
  v_src := pg_get_functiondef('public.fms_ocpi_submit_quotation(uuid)'::regprocedure);

  -- 2a · two more locals.
  v_anchor := $c$  v_ver    integer;
begin$c$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'fms_ocpi_submit_quotation: expected the declare block exactly once, found %', v_hits;
  end if;
  v_repl := $d$  v_ver    integer;
  v_missing text;
  d        public.fms_ocpi_deals%rowtype;
begin$d$;
  v_new := replace(v_src, v_anchor, v_repl);

  -- 2b · the check itself, immediately before the status move.
  v_anchor := $e$  update public.fms_ocpi_deals
     set status = 'awaiting_quotation_approval',$e$;
  v_hits := (length(v_new) - length(replace(v_new, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'fms_ocpi_submit_quotation: expected the status update exactly once, found %', v_hits;
  end if;

  v_repl := $f$  /*
    OCPI-15 · SAY WHAT IS MISSING, IN WORDS.

    Everything below is already enforced by the table CHECK
    fms_ocpi_complete_when_submitted, which fires on this very UPDATE because it
    is written `status = 'draft' OR (…)`. But a CHECK violation names the
    constraint and not the field, so a salesperson who hit it was told
    "new row for relation fms_ocpi_deals violates check constraint" and had
    nothing to act on. This says which answers are missing.

    ⚠ IT MIRRORS THAT CHECK CONJUNCT FOR CONJUNCT AND IS NEVER STRICTER. If this
      list ever asks for more than the constraint does, it refuses deals the
      database would have accepted. It asks for LESS in two places on purpose —
      the print head and the centering inclusion are the form's requirements, not
      the constraint's, and the form refuses those first, by name.

    ⚠ THE NAMES ARE THE FORM'S OWN FIELD LABELS, so a salesperson reading this
      message and a salesperson reading the panel above the form are looking for
      the same words.
  */
  select * into d from public.fms_ocpi_deals where id = p_deal;

  select string_agg(x, ', ') into v_missing from (
    select unnest(array[
      case when nullif(btrim(coalesce(d.customer_name, '')), '') is null
           then 'Customer / party name' end,
      case when nullif(btrim(coalesce(d.salesperson_name, '')), '') is null
           then 'Salesperson' end,
      case when d.machine_id is null    then 'Machine' end,
      case when d.machine_count is null then 'No. of machines' end,

      case when d.incl_ink is null      then 'Deal includes ink' end,
      case when d.incl_ink is true
            and nullif(btrim(coalesce(d.ink_qty_included, '')), '') is null
           then 'Quantity of ink included' end,
      case when d.incl_spares is null   then 'Deal includes spare parts' end,
      case when d.incl_spares is true
            and nullif(btrim(coalesce(d.spare_details, '')), '') is null
           then 'Spare part details and quantity' end,
      case when d.incl_head is null     then 'Deal includes head' end,
      case when d.incl_head is true and d.heads_included is null
           then 'No. of heads included' end,

      case when d.ink_offer_agreed is true and d.ink_offer_qty is null
           then 'Ink — subsidized quantity (litres)' end,
      case when d.ink_offer_agreed is true and d.ink_offer_rate is null
           then 'Ink — subsidized rate (₹ per litre)' end,
      case when d.head_offer_agreed is true and d.head_offer_qty is null
           then 'Head — subsidized quantity (nos.)' end,
      case when d.head_offer_agreed is true and d.head_offer_rate is null
           then 'Head — subsidized rate (₹ per head)' end,

      case when d.transport_terms is null then 'Deal type' end,
      case when d.transport_terms = 'high_seas' and d.high_seas_via is null
           then 'High seas delivery via' end,
      case when d.transport_terms = 'high_seas' and d.high_seas_cost_by is null
           then 'High seas cost borne by' end,
      case when d.transport_terms = 'local' and d.local_cost_by is null
           then 'Local delivery cost borne by' end,

      case when d.deal_value_currency is null then 'Currency' end,
      case when d.deal_value_amount is null   then 'Total deal value (excl. GST)' end,
      case when d.fx_rate is null
            and (d.deal_value_currency = 'USD'
              or coalesce(d.transport_terms, '') = 'high_seas')
           then 'USD to INR rate' end,

      case when nullif(btrim(coalesce(d.payment_terms, '')), '') is null
           then 'Terms of payment' end,
      case when d.delivery_date is null then 'Tentative machine delivery date' end
    ]) as x
  ) t where x is not null;

  if v_missing is not null then
    raise exception 'Still needed before this can be sent for approval: %', v_missing;
  end if;

  update public.fms_ocpi_deals
     set status = 'awaiting_quotation_approval',$f$;

  v_new := replace(v_new, v_anchor, v_repl);
  execute v_new;
end $mig$;

-- ── Assert the result ───────────────────────────────────────────────────────
do $check$
declare
  v_gen text := pg_get_functiondef(
    'public.fms_ocpi_generate_quotation(uuid,jsonb,jsonb,jsonb)'::regprocedure);
  v_sub text := pg_get_functiondef('public.fms_ocpi_submit_quotation(uuid)'::regprocedure);
begin
  if position('the USD to INR rate' in v_gen) = 0 then
    raise exception 'generate_quotation did not gain the fx conjunct';
  end if;
  if position('Still needed before this can be sent for approval' in v_sub) = 0 then
    raise exception 'submit_quotation did not gain the completeness check';
  end if;
  -- The one thing that must NOT have moved.
  if not exists (
    select 1 from pg_constraint
     where conname = 'fms_ocpi_complete_when_submitted'
       and conrelid = 'public.fms_ocpi_deals'::regclass
  ) then
    raise exception 'the completeness CHECK is missing — it must not have been touched';
  end if;
end $check$;

-- ── Rollback ────────────────────────────────────────────────────────────────
--
-- ⚠ REHEARSED ON LIVE DATA, NOT MERELY WRITTEN. Both changes are pure text
--   insertions, so undoing them is the same three literals removed again — no
--   retyped function body, and therefore nothing that can drift from what is
--   actually running.
--
-- The bodies this restores are the ones live immediately before this migration:
--
--     fms_ocpi_generate_quotation  md5 bc2a4161bef19a9cf58a2aa246b3f413  (3623 bytes)
--     fms_ocpi_submit_quotation    md5 d592556d747296f31ab73217b72ff4b8  (1797 bytes)
--
-- The final assertion checks exactly that, so a partial undo cannot pass.
--
-- do $rb$
-- declare
--   v_src text;
--   v_new text;
--   v_cut text;
-- begin
--   -- 1 · take the fx conjunct back out of generate
--   v_src := pg_get_functiondef(
--     'public.fms_ocpi_generate_quotation(uuid,jsonb,jsonb,jsonb)'::regprocedure);
--   v_cut := $x$,
--       /*
--         OCPI-15 · THE DOLLAR RATE IS PART OF THE PRICE.
--
--         Without it deal_value_inr is derived as null in fms_ocpi_write_quotation
--         and the RUPEE total prints blank on both papers — the same fault as a
--         blank price with one indirection in front of it.
--
--         ⚠ IT TESTS BOTH TERMS, exactly as fms_ocpi_complete_when_submitted does.
--           A high seas sale is a dollar deal from the moment the deal type is
--           picked, and write_quotation forces the currency to USD on save, so the
--           first term is normally sufficient — but a row arriving by any other
--           path would slip through on the currency alone.
--       */
--       case when v_fx is null
--                  and ((select coalesce(deal_value_currency, '')
--                          from public.fms_ocpi_deals where id = p_deal) = 'USD'
--                    or (select coalesce(transport_terms, '')
--                          from public.fms_ocpi_deals where id = p_deal) = 'high_seas')
--            then 'the USD to INR rate' end$x$;
--   v_new := replace(v_src, v_cut, '');
--   if v_new = v_src then raise exception 'rollback 1: the fx conjunct was not found'; end if;
--   execute v_new;
--
--   -- 2 · take the completeness check back out of submit
--   v_src := pg_get_functiondef('public.fms_ocpi_submit_quotation(uuid)'::regprocedure);
--   v_cut := $y$  v_missing text;
--   d        public.fms_ocpi_deals%rowtype;
-- $y$;
--   v_new := replace(v_src, v_cut, '');
--   if v_new = v_src then raise exception 'rollback 2a: the locals were not found'; end if;
--
--   -- Everything from the comment down to (but not including) the status update.
--   v_cut := substring(
--     v_new,
--     position('  /*' || chr(10) || '    OCPI-15 · SAY WHAT IS MISSING' in v_new),
--     position('  update public.fms_ocpi_deals' in v_new)
--       - position('  /*' || chr(10) || '    OCPI-15 · SAY WHAT IS MISSING' in v_new));
--   v_src := v_new;
--   v_new := replace(v_new, v_cut, '');
--   if v_new = v_src then raise exception 'rollback 2b: the check block was not found'; end if;
--   execute v_new;
--
--   -- 3 · prove it landed exactly where it started
--   if md5(pg_get_functiondef(
--        'public.fms_ocpi_generate_quotation(uuid,jsonb,jsonb,jsonb)'::regprocedure))
--      <> 'bc2a4161bef19a9cf58a2aa246b3f413' then
--     raise exception 'rollback: generate_quotation did not return to its original body';
--   end if;
--   if md5(pg_get_functiondef('public.fms_ocpi_submit_quotation(uuid)'::regprocedure))
--      <> 'd592556d747296f31ab73217b72ff4b8' then
--     raise exception 'rollback: submit_quotation did not return to its original body';
--   end if;
-- end $rb$;
