-- ===========================================================================
-- OCPI-40 (re-audit, N-4) · The approval-request email stops calling a
--                           quotation by its contract number.
--
-- ── WHAT IS WRONG TODAY ────────────────────────────────────────────────────
--
--   `fms_ocpi_email_payload` never consults `oc_at`. Since OCPI-36 moved the
--   mint to Generate, every generated deal carries `oc_no` — so the mail that
--   ASKS the Directors to approve a quotation is subjected:
--
--       Approval needed - quotation OTPL/OC/13/26-27
--
--   and carries a fact row labelled `Order confirmation: OTPL/OC/13/26-27` on a
--   deal nobody has approved. The rejection and send-back mails name the deal
--   the same way — a REJECTED quotation announced under a contract number.
--
--   This is precisely the half-state OCPI-40 removed from the papers
--   (`paperNo`/`docHeading`) and from the screens (`dealRef`). The email builder
--   was the third surface and was missed, because it lives in SQL.
--
-- ── THE RULE, THE SAME ONE IN ALL THREE PLACES ─────────────────────────────
--
--   🔴 `oc_at` IS THE TEST. `oc_no` tests nothing — it is present from Generate
--      on every deal. Approved → the contract number; before that → the
--      quotation number.
--
--   ⚠ THE FALLBACK CHAIN KEEPS `r.oc_no` AT THE BACK, and that is load-bearing
--     rather than defensive. Eight deals raised before OCPI-36 were minted at
--     the approval, and a few older rows carry no `quotation_no`; without the
--     tail they would fall through to the customer name and lose the number
--     they were actually issued under. Same reasoning as `dealRef`.
--
--   ⚠ `quotation_approved` IS UNTOUCHED. It reads `r.oc_no` directly and only
--     ever fires at the approval, so it is correct as it stands.
--
-- ── 🟢 NOTHING IS SENT BY THIS MIGRATION ───────────────────────────────────
--
--   `email_module_settings` for module `ocpi` is `enabled = false`, verified
--   immediately before writing this. The defect is therefore latent — it goes
--   live the moment OCPI email is switched on, which is why it is fixed BEFORE
--   go-live rather than after.
--
-- ── ⚠ THE BODY IS TRANSFORMED, NOT RETYPED ─────────────────────────────────
--
--   This function has been redefined more than once and the migration files on
--   disk diverge from what is running. So the live body is read with
--   `pg_get_functiondef`, each anchor is asserted to appear EXACTLY ONCE,
--   substituted, and the result executed — the same discipline as
--   20261104120000 and 20261101120000. A hand-copied body is precisely how that
--   drift happens.
--
-- Additive: one function redefined, no table or column touched.
--
-- Reversal: re-run the two substitutions in reverse (swap `v_repl` and
--   `v_anchor` in each block), or restore from
--   20261019120600_fms_ocpi_round_out.sql:53.
-- ===========================================================================

do $mig$
declare
  v_src    text;
  v_anchor text;
  v_repl   text;
  v_hits   int;
begin
  v_src := pg_get_functiondef(
    'public.fms_ocpi_email_payload(text,uuid,text,text,jsonb)'::regprocedure);

  /* ── 1 · the reference the whole mail is named by ───────────────────────── */
  v_anchor := $a$  v_ref := coalesce(r.oc_no, r.quotation_no, r.customer_name, 'Deal');$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'fms_ocpi_email_payload: expected the v_ref assignment exactly once, found %', v_hits;
  end if;

  v_repl := $b$  -- OCPI-40 · APPROVED DEALS ARE NAMED BY THE CONTRACT NUMBER, EVERYTHING
  --   ELSE BY THE QUOTATION NUMBER. `oc_no` is present from Generate and tests
  --   nothing; `oc_at` is the approval stamp. Mirrors paperNo() on the papers
  --   and dealRef() on the screens — change one, change all three.
  --   The trailing r.oc_no catches pre-OCPI-36 deals minted at the approval that
  --   carry no quotation_no.
  v_ref := coalesce(
             case when r.oc_at is not null then nullif(r.oc_no, '') end,
             nullif(r.quotation_no, ''),
             nullif(r.oc_no, ''),
             r.customer_name,
             'Deal');$b$;
  v_src := replace(v_src, v_anchor, v_repl);

  /* ── 2 · the fact row's LABEL ───────────────────────────────────────────── */
  v_anchor := $a$  if coalesce(r.oc_no, '') <> '' then
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('label', 'Order confirmation', 'value', r.oc_no));
  end if;$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'fms_ocpi_email_payload: expected the oc_no row exactly once, found %', v_hits;
  end if;

  v_repl := $b$  -- OCPI-40 · THE ROW STAYS, THE LABEL MOVES. The number is worth showing
  --   before approval — it is the serial the deal will be filed under — but
  --   calling it the "Order confirmation" of a deal nobody has approved is the
  --   claim this fixes. Until oc_at is stamped it is only reserved.
  if coalesce(r.oc_no, '') <> '' then
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'label', case when r.oc_at is not null then 'Order confirmation'
                      else 'Reserved for the contract' end,
        'value', r.oc_no));
  end if;$b$;
  v_src := replace(v_src, v_anchor, v_repl);

  execute v_src;

  /* ── 3 · prove the substitutions landed in what is now RUNNING ──────────── */
  v_src := pg_get_functiondef(
    'public.fms_ocpi_email_payload(text,uuid,text,text,jsonb)'::regprocedure);
  if position('case when r.oc_at is not null then nullif(r.oc_no' in v_src) = 0 then
    raise exception 'fms_ocpi_email_payload: the v_ref gate is not in the installed body';
  end if;
  if position('else ''Reserved for the contract'' end' in v_src) = 0 then
    raise exception 'fms_ocpi_email_payload: the row label gate is not in the installed body';
  end if;
end $mig$;

comment on function public.fms_ocpi_email_payload(text, uuid, text, text, jsonb) is
  'OCPI notification mail. OCPI-40 - the deal is named by its CONTRACT number only once oc_at is stamped, and by its quotation number before that; the oc_no fact row is labelled "Reserved for the contract" until then. oc_no exists from Generate and is not a test of approval. Twin of paperNo() on the papers and dealRef() on the screens.';
