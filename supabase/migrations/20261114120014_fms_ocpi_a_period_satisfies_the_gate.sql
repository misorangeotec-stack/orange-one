-- 🔴 URGENT · A NEW QUOTATION CANNOT BE SENT FOR APPROVAL. This unblocks it.
--
-- WHAT BROKE, AND WHEN
--   R1 (20261114120003, applied 10-Sep-2026) replaced the delivery DATE with a
--   delivery PERIOD. The date control was removed from the form; the draft field
--   survives only so the 37 deals already holding a date round-trip it unchanged
--   (`fieldSpec.ts:139, 392, 1419, 1601`), and its default is `""`.
--
--   `fms_ocpi_complete_when_submitted` was never changed to match. Read off the
--   LIVE database it still carries `AND (delivery_date IS NOT NULL)`, and that
--   clause is inside the branch every non-draft, non-cancelled row must satisfy.
--
--   So a deal raised from now on has `delivery_date = null`, answers the delivery
--   PERIOD instead, and fails this CHECK the moment anybody presses Send for
--   approval — with a raw constraint violation that names no field.
--
-- 🟢 NOBODY HAS HIT IT YET. All five dateless deals predate today (the newest is
--    Growth Saga, 02-Sep) and every non-draft deal was raised before R1, so each
--    carries a date. The damage is entirely ahead of us.
--
-- WHY THIS ACCEPTS EITHER ANSWER RATHER THAN SWAPPING OUTRIGHT
--   The obvious fix — demand `delivery_days` instead — cannot be applied today.
--   A CHECK is re-validated against EVERY EXISTING ROW when it is added, and two
--   non-draft deals hold a date and no period:
--
--       QT-M0037  AARNAV FASHIONS LIMITED   (real)   2026-09-05, no period
--       QT-M0046  ZZ TEST OCPI-15 gate move           2026-12-15, no period
--
--   The swap would abort on both. Accepting EITHER passes on every row that
--   exists (they all have a date) and on every row made from now on (it has a
--   period), so it can be applied immediately and cannot fail.
--
-- ⚠ STEP 2 IS DELIBERATELY NOT IN THIS FILE. Once QT-M0037 and QT-M0046 have
--   been answered THROUGH THE FORM by the people who own them, tighten this to
--   the period alone. 🔴 NOT BY A BACKFILL — a delivery promise is not derivable
--   from a date, and writing one would put words in a salesperson's mouth on a
--   document a customer signs.
--
-- 🔴 REBUILT FROM `pg_get_constraintdef` ON THE LIVE DATABASE, NEVER FROM A FILE.
--    `20261102120000...sql:250` records that the migration files here have
--    diverged from what is actually installed; retyping this constraint from any
--    of them would silently drop whatever the files do not know about.

begin;

do $fix$
declare v_def text; v_new text; v_bad int;
begin
  /*
    ⚠ THE SLOW CHECK RUNS FIRST, BEFORE ANY LOCK IS TAKEN. Per
      [a-migrations-assertion-runs-inside-its-lock] a count placed after the DDL
      is executed while ACCESS EXCLUSIVE is held. This one is trivial at 41 rows,
      but the habit is the point.

    Nothing may already be violating the NEW rule — a non-draft row with neither
    a date nor a period would make the ADD fail with a message about the table
    rather than about the deal, and this names the deal instead.
  */
  select count(*) into v_bad from public.fms_ocpi_deals
   where status not in ('draft', 'cancelled')
     and delivery_date is null
     and nullif(btrim(coalesce(delivery_days, '')), '') is null;
  if v_bad <> 0 then
    raise exception 'R1b pre 1: % non-draft deal(s) have neither a delivery date nor a period — the new constraint would abort. Fill them first.', v_bad;
  end if;

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname = 'fms_ocpi_complete_when_submitted';
  if v_def is null then raise exception 'R1b pre 2: fms_ocpi_complete_when_submitted is not installed'; end if;

  -- Anchored on the rendered clause, which `pg_get_constraintdef` always
  -- parenthesises this way. If it ever stops matching, the migration stops —
  -- it does not guess.
  v_new := replace(
    v_def,
    '(delivery_date IS NOT NULL)',
    '((delivery_date IS NOT NULL) OR (NULLIF(btrim(COALESCE(delivery_days, ''''::text)), ''''::text) IS NOT NULL))'
  );
  if v_new = v_def then
    raise exception 'R1b: the delivery_date clause did not match the live definition — re-read it before changing anything';
  end if;

  execute 'alter table public.fms_ocpi_deals drop constraint fms_ocpi_complete_when_submitted';
  execute 'alter table public.fms_ocpi_deals add constraint fms_ocpi_complete_when_submitted ' || v_new;
end $fix$;

do $post$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname = 'fms_ocpi_complete_when_submitted';

  if v_def is null then raise exception 'R1b post 1: the constraint is gone'; end if;
  if v_def not like '%delivery_days%' then raise exception 'R1b post 2: delivery_days did not land'; end if;
  if v_def not like '%delivery_date%' then raise exception 'R1b post 3: delivery_date was lost — old deals would fail'; end if;

  -- The rest of the gate must be untouched: this file widens ONE clause.
  if v_def not like '%incl_head%' or v_def not like '%transport_terms%'
     or v_def not like '%payment_terms%' or v_def not like '%fx_rate%' then
    raise exception 'R1b post 4: other clauses were lost in the rebuild';
  end if;
end $post$;

commit;
