-- OCPI-36 · Stage 1 — the order-confirmation number changes shape, and is minted
--            one gate earlier.
--
-- ── WHAT CHANGES ───────────────────────────────────────────────────────────
--
--   1. THE FORMAT.  OTPL/OC/2627/0009  →  OTPL/OC/9/26-27
--      Serial first and UNPADDED, financial year last and hyphenated. This is
--      the shape Bushra's filing has always used — every one of the 27 folders
--      in `2026.27 OC&PI` is headed `Performa No. OTPL/OC/<n>/26-27` — so every
--      order confirmation the module has issued carries a number her register
--      does not recognise.
--
--   2. WHEN IT IS MINTED.  At the Directors' approval  →  at Generate.
--      One serial serves the Performa Invoice and the Order Confirmation, which
--      is what folder 127 does: the folder is opened when the PI is raised, and
--      the OC that follows months later carries the same number. Settled with
--      Ritesh Bhai 02-09-2026, including that a deal which never closes still
--      consumes a serial — exactly as a folder that never closes already does.
--
-- ── 🔴 WHAT HAD TO MOVE FIRST, IN THE FRONTEND, BEFORE THIS MIGRATION RUNS ──
--
--    `docHeading()` in lib/format.ts decided whether a paper was headed ORDER
--    QUOTATION or ORDER CONFIRMATION by asking whether `oc_no` existed, and its
--    comment said so: "oc_no is therefore the only test". Minting the number at
--    Generate while that test stood would have made EVERY QUOTATION HEAD ITSELF
--    AS A SIGNED CONTRACT — on both papers — from the moment it was generated.
--
--    So the test is now the APPROVAL STAMP, `oc_at`, which this function does
--    not touch and `fms_ocpi_decide_quotation` still sets. Checked on live data
--    before changing either: of 30 deals, 8 carry `oc_no` and all 8 carry
--    `oc_at`; none carries one without the other. The swap is therefore exactly
--    equivalent today, and stops being equivalent the moment the mint moves —
--    which is the whole reason it lands first.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
--
-- ⚠ NO ROW IS REWRITTEN. `fms_ocpi_deals.oc_no` is not updated anywhere here.
--   The 8 deals already carrying OTPL/OC/2627/0001…0008 keep the number their
--   paper printed; rewriting them would put the record and the customer's copy
--   out of step, on documents that are already signed.
--
-- ⚠ `fms_ocpi_fy_code` STILL RETURNS '2627', and must. That value is the
--   COUNTER SCOPE (`oc:2627`) and `fms_ocpi_set_oc_series` validates it as four
--   digits before it will move a series. The hyphen is a rendering concern and
--   lives in `fms_ocpi_oc_no` alone.
--
-- ⚠ THE APPROVAL STILL MINTS, AS A FALLBACK. Deals generated BEFORE this
--   migration have no `oc_no`, so `fms_ocpi_decide_quotation` keeps its
--   `if p_decision = 'approve' and v_oc is null` branch. Removing it would leave
--   every open quotation on record unable to ever get a number.
--
-- ⚠ lpad(…, 4, '0') GOES. Confirmed first that nothing depends on the fixed
--   width: no SQL function tests `oc_no is null` / `is not null` except the mint
--   guard above, no index or constraint orders on it beyond `UNIQUE (oc_no)`,
--   and the only frontend consumers are the register export column, screen
--   labels, and one preview string in SetupWarnings.tsx (fixed in the same
--   commit — it stripped trailing digits and would have rendered
--   `OTPL/OC/1/26-nnnn`).
--
-- ⚠ THE TWO FORMATS CANNOT COLLIDE UNDER `UNIQUE (oc_no)`. `OTPL/OC/2627/0009`
--   and `OTPL/OC/9/26-27` are different strings, and the series is forward-only,
--   so no new mint can reach a number already issued.
--
-- ⚠ BOTH FUNCTIONS ARE TRANSFORMS OF THE LIVE BODY, NOT RETYPED COPIES. Each
--   reads pg_get_functiondef, asserts its anchor appears exactly once,
--   substitutes and asserts the result. These two have been redefined six or
--   more times and the migration files on disk diverge from what is running; a
--   hand-copied body is precisely how that drift happens. Same discipline as
--   20261103120000.

/* ---------------------------------------------------------------------------
   The number's shape, in ONE place server-side.

   ⚠ ITS TWIN IS `ocNoFor` IN frontend/src/apps/ocpi/lib/format.ts, which exists
     only so Settings can show what the NEXT number will look like before
     anything is minted. This function is the authority. Change one, change both
     — that pairing is this module's defining hazard.
--------------------------------------------------------------------------- */
create or replace function public.fms_ocpi_oc_no(p_seq integer, p_fy text)
returns text
language sql
immutable
as $fn$
  select 'OTPL/OC/' || p_seq::text || '/' || left(p_fy, 2) || '-' || right(p_fy, 2);
$fn$;

comment on function public.fms_ocpi_oc_no(integer, text) is
  'OCPI-36 - an order-confirmation number from its sequence value and financial year: (9, 2627) -> OTPL/OC/9/26-27. Serial unpadded, year hyphenated, matching the paper register.';

do $mig$
declare
  v_src    text;
  v_anchor text;
  v_repl   text;
  v_hits   int;
begin
  /* ── 1 · decide_quotation mints through the helper ───────────────────────── */
  v_src := pg_get_functiondef(
    'public.fms_ocpi_decide_quotation(uuid,text,text)'::regprocedure);

  v_anchor := $a$    v_oc := 'OTPL/OC/' || v_fy || '/' || lpad(public.fms_ocpi_next_seq('oc:' || v_fy)::text, 4, '0');$a$;

  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'fms_ocpi_decide_quotation: expected the mint expression exactly once, found %', v_hits;
  end if;

  v_repl := $b$    -- OCPI-36 · the shape lives in fms_ocpi_oc_no now, shared with Generate.
    --   ⚠ STILL REACHED, AND STILL NEEDED. From OCPI-36 the number is normally
    --     minted at Generate, so v_oc is already set and this branch is skipped.
    --     It remains for every deal generated BEFORE that change, which has no
    --     number and would otherwise never get one.
    v_oc := public.fms_ocpi_oc_no(public.fms_ocpi_next_seq('oc:' || v_fy), v_fy);$b$;

  v_src := replace(v_src, v_anchor, v_repl);
  execute v_src;

  /* ── 2 · generate_quotation mints the OC number beside the quotation number ─ */
  v_src := pg_get_functiondef(
    'public.fms_ocpi_generate_quotation(uuid,jsonb,jsonb,jsonb)'::regprocedure);

  -- 2a · two more locals
  v_anchor := $a$  v_fx       numeric;
begin$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'fms_ocpi_generate_quotation: expected the declare tail exactly once, found %', v_hits;
  end if;
  v_repl := $b$  v_fx       numeric;
  v_oc       text;
  v_fy       text;
begin$b$;
  v_src := replace(v_src, v_anchor, v_repl);

  -- 2b · read the existing number, so a revision cannot mint a second one
  v_anchor := $a$         deal_value_amount, deal_value_currency, fx_rate
    into v_status, v_owner, v_no, v_version,
         v_amount, v_currency, v_fx$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'fms_ocpi_generate_quotation: expected the select-into exactly once, found %', v_hits;
  end if;
  v_repl := $b$         deal_value_amount, deal_value_currency, fx_rate, oc_no
    into v_status, v_owner, v_no, v_version,
         v_amount, v_currency, v_fx, v_oc$b$;
  v_src := replace(v_src, v_anchor, v_repl);

  -- 2c · the mint itself, beside the quotation number's
  v_anchor := $a$  if v_no is null then
    v_no := 'QT-M' || lpad(public.fms_ocpi_next_seq('quotation')::text, 4, '0');
  end if;$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'fms_ocpi_generate_quotation: expected the quotation mint exactly once, found %', v_hits;
  end if;
  v_repl := $b$  if v_no is null then
    v_no := 'QT-M' || lpad(public.fms_ocpi_next_seq('quotation')::text, 4, '0');
  end if;

  /*
    OCPI-36 · THE ORDER-CONFIRMATION NUMBER IS MINTED HERE, NOT AT THE APPROVAL.

    One serial serves the Performa Invoice and the Order Confirmation, exactly as
    folder 127 does — the folder is opened when the PI is raised, and the OC that
    follows carries the same number. All three papers print it and nothing else;
    QT-M#### stays internal, for the deal screen, the register and search.

    ⚠ GUARDED ON v_oc, SO A REVISION OR A REWORK NEVER BURNS A SECOND SERIAL.
      Generate is re-run on every revision and after every send-back; only the
      first one through here allocates.

    ⚠ IT DOES NOT SET oc_at, AND MUST NOT. `oc_at` is the APPROVAL stamp and is
      now the only test for whether a paper is headed ORDER QUOTATION or ORDER
      CONFIRMATION (see docHeading in lib/format.ts). Stamping it here would head
      every quotation as a signed contract — the exact failure this stage was
      sequenced to avoid.

    ⚠ A DEAL THAT NEVER CLOSES STILL CONSUMES A SERIAL. Accepted by Ritesh Bhai
      02-09-2026: a paper folder that never closes already does the same.
  */
  if v_oc is null then
    v_fy := public.fms_ocpi_fy_code(current_date);
    v_oc := public.fms_ocpi_oc_no(public.fms_ocpi_next_seq('oc:' || v_fy), v_fy);
  end if;$b$;
  v_src := replace(v_src, v_anchor, v_repl);

  -- 2d · write it onto the deal
  v_anchor := $a$     set quotation_no         = v_no,
         quotation_version_no = v_version,$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'fms_ocpi_generate_quotation: expected the deal update exactly once, found %', v_hits;
  end if;
  v_repl := $b$     set quotation_no         = v_no,
         oc_no                = coalesce(v_oc, oc_no),
         quotation_version_no = v_version,$b$;
  v_src := replace(v_src, v_anchor, v_repl);

  execute v_src;
end $mig$;
