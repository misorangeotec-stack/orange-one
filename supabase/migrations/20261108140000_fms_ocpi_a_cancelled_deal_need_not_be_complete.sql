-- ===========================================================================
-- OCPI-40 (re-audit, N-1b) · A written-off deal does not have to be complete.
--
-- ── FOUND BY TESTING 20261108130000, NOT BY READING IT ─────────────────────
--
--   That migration lifted the `status = 'draft'` guard out of `fms_ocpi_cancel`
--   so a GENERATED quotation could be cancelled instead of deleted — what Ritesh
--   Bhai asked for on 03-09-2026. Running it against a real deal (QT-M0057)
--   inside a rolled-back transaction failed on something the guard change could
--   not have revealed:
--
--       new row for relation "fms_ocpi_deals" violates check constraint
--       "fms_ocpi_complete_when_submitted"
--
--   🔴 THE GUARD CHANGE ALONE DOES NOT DELIVER THE FEATURE. The table itself
--      refuses it.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
--   `fms_ocpi_complete_when_submitted` reads `status = 'draft' OR (…20 fields…)`.
--   Its name says "when submitted", but it fires on EVERY status other than
--   draft — so cancelling moves a row out of the one exempt status and the whole
--   completeness test lands on it at once.
--
--   That never mattered before, because the only deals that could be cancelled
--   had already passed the check on their way out of draft. A generated draft is
--   the new case: `fms_ocpi_generate_quotation` does not require completeness
--   (the form warns about blanks, it does not block), so a deal can hold both
--   serials, three rendered papers and a customer's attention while still
--   missing `payment_terms` or `delivery_date`.
--
--   And that is exactly the deal somebody needs to write off — the one that was
--   never finished because the customer went quiet. Demanding it be COMPLETED
--   before it can be ABANDONED is backwards.
--
-- ── THE CHANGE ─────────────────────────────────────────────────────────────
--
--   The exemption becomes `status in ('draft', 'cancelled')`. Nothing else in
--   the predicate moves.
--
--   ⚠ IT ONLY EVER WIDENS. A CHECK made more permissive cannot invalidate a row
--     that already exists, so no data is touched and nothing needs re-validating.
--
--   ⚠ IT IS NOT A BACK DOOR INTO A QUEUE. `fms_ocpi_cancel` nulls `current_step`
--     and 'cancelled' is terminal — `fms_ocpi_resume` only restores a HELD deal,
--     from `hold_from_status`. An incomplete row cannot re-enter the chain this
--     way.
--
--   ⚠ 'on_hold' IS DELIBERATELY NOT ADDED. A held generated draft records
--     `hold_from_status = 'draft'` and resumes to draft, so it never has to
--     satisfy the check either way; adding it would exempt genuinely submitted
--     deals that are merely parked, and those SHOULD stay complete.
--
-- ── ⚠ THE PREDICATE IS TRANSFORMED, NOT RETYPED ────────────────────────────
--
--   Twenty conditions, several of them three-way. Retyping them is how a clause
--   silently goes missing, so the live definition is read with
--   `pg_get_constraintdef`, the anchor asserted to appear exactly once and
--   substituted, then dropped and re-added inside one transaction. Same
--   discipline as the function transforms in 20261104120000.
--
-- Reversal:
--   alter table public.fms_ocpi_deals drop constraint fms_ocpi_complete_when_submitted;
--   -- then re-add with `(status = 'draft'::text) OR` in place of the ANY(ARRAY[…]).
-- ===========================================================================

do $mig$
declare
  v_def    text;
  v_anchor text := $a$CHECK (((status = 'draft'::text) OR $a$;
  v_repl   text := $b$CHECK (((status = ANY (ARRAY['draft'::text, 'cancelled'::text])) OR $b$;
  v_hits   int;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname  = 'fms_ocpi_complete_when_submitted';

  if v_def is null then
    raise exception 'fms_ocpi_complete_when_submitted is not on fms_ocpi_deals';
  end if;

  -- Already widened? Then this migration has run; do nothing.
  if position($q$ARRAY['draft'::text, 'cancelled'::text]$q$ in v_def) > 0 then
    raise notice 'OCPI-40 · already widened, nothing to do';
    return;
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'fms_ocpi_complete_when_submitted: expected the draft exemption exactly once, found %', v_hits;
  end if;

  v_def := replace(v_def, v_anchor, v_repl);

  execute 'alter table public.fms_ocpi_deals drop constraint fms_ocpi_complete_when_submitted';
  execute 'alter table public.fms_ocpi_deals add constraint fms_ocpi_complete_when_submitted ' || v_def;

  -- Prove it is on the table, and still testing the twenty fields.
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname  = 'fms_ocpi_complete_when_submitted';
  if position($q$ARRAY['draft'::text, 'cancelled'::text]$q$ in v_def) = 0 then
    raise exception 'the widened exemption is not on the installed constraint';
  end if;
  if position('delivery_date IS NOT NULL' in v_def) = 0
     or position('payment_terms' in v_def) = 0 then
    raise exception 'the completeness predicate did not survive the transform';
  end if;
end $mig$;
