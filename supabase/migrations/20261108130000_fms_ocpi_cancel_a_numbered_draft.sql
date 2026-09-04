-- ===========================================================================
-- OCPI-40 (re-audit, N-1) · A generated quotation can be CANCELLED instead of
--                           deleted. The feature already existed.
--
-- ── WHAT RITESH BHAI ASKED FOR, 03-09-2026 ─────────────────────────────────
--
--   Shown that deleting a deal takes its contract serial with it for good:
--
--     *"whenever we delete this, ideally we want to add this feature so that it
--      should not be permanently deleted. There should just be an option for the
--      user so that the number can be cancelled. That's it."*
--
-- ── IT IS NOT A NEW FEATURE. IT IS TWO OBSOLETE GUARDS ─────────────────────
--
--   `fms_ocpi_cancel` already does all of it: the row stays, both numbers stay,
--   `status` becomes 'cancelled', a written reason is REQUIRED into
--   `cancel_reason`, and the salesperson is told. It simply refused a draft:
--
--       -- A draft is deleted, not cancelled: it burned no number and nobody
--       -- has seen it.
--       if v_status = 'draft' then
--         raise exception 'This is still a draft - delete it instead. Nothing
--                          has been issued.';
--
--   🔴 BOTH HALVES OF THAT REASON WERE OVERTURNED BY OCPI-36 ON 02-09-2026.
--      Since the mint moved to Generate, a deal KEEPS `status = 'draft'` after
--      it has been given `QT-M####` AND `OTPL/OC/n/26-27`, had its Summary, PI
--      and OC rendered and stored, and — routinely — had them sent to the
--      customer. It has burned a number, and people have seen it.
--
--   So the one state where writing a deal off actually matters was the one
--   state that could not do it. The only escape was DELETE, which discards the
--   serial (`fms_ocpi_counters` is never rewound) and orphans the stored PDFs.
--
-- ── THE FIX: THE HONEST TEST OF "NOTHING HAS BEEN ISSUED" ──────────────────
--
--   `quotation_no is null`, not `status = 'draft'`. A never-generated draft
--   still refuses both verbs and is still deleted — for it the old comment is
--   still exactly right. Anything numbered can now be cancelled or held.
--
--   ⚠ THIS DISPOSES OF U-01a FOR FREE. Nothing is deleted, so no storage object
--     is orphaned, no `fms_ocpi_activity` row is left dangling, and the serial
--     stays on the register with a reason beside it — which is the whole of what
--     was asked for.
--
--   ⚠ THE SERIAL IS STILL NOT GIVEN BACK, deliberately. Returning it is only
--     safe when it was the last one issued; anything else re-issues a number in
--     the middle of a live series, which is the single failure
--     `fms_ocpi_set_oc_series`'s forward-only rule exists to prevent. A gap with
--     a cancelled row beside it is the answer, not a rewind.
--
-- ── HOLD MOVES WITH CANCEL, AND MUST ───────────────────────────────────────
--
--   `LifecyclePanel.tsx` gates both buttons on one predicate and its own header
--   states that what it offers "mirrors fms_ocpi_hold / _cancel EXACTLY". Moving
--   one without the other would put a button on screen that the database
--   refuses. `hold_from_status` records 'draft', so `fms_ocpi_resume` returns it
--   there unchanged.
--
-- ── AND BOTH NAME THE DEAL THE WAY EVERYTHING ELSE NOW DOES ────────────────
--
--   `v_ref` was `coalesce(oc_no, quotation_no, customer_name)`, so a cancelled
--   quotation was announced under a contract number nobody had approved. Same
--   `oc_at` rule as paperNo() on the papers, dealRef() on the screens and
--   fms_ocpi_email_payload (20261108120000).
--
-- ── ⚠ THE BODIES ARE TRANSFORMED, NOT RETYPED ──────────────────────────────
--
--   Read live with `pg_get_functiondef`, every anchor asserted to appear exactly
--   once, substituted, executed, then re-read and proved. Same discipline as
--   20261104120000.
--
-- Additive: two functions redefined. No table, column or row is touched.
--
-- Reversal: swap each v_anchor/v_repl pair and re-run.
-- ===========================================================================

do $mig$
declare
  v_src    text;
  v_anchor text;
  v_repl   text;
  v_hits   int;

  procedure_note text := 'OCPI-40';
begin
  /* ═════ 1 · fms_ocpi_cancel ═════════════════════════════════════════════ */
  v_src := pg_get_functiondef('public.fms_ocpi_cancel(uuid,text)'::regprocedure);

  -- 1a · read the quotation number alongside the rest, and name the deal by the
  --      same rule every other surface now uses.
  v_anchor := $a$  select status, raised_by, coalesce(oc_no, quotation_no, customer_name), cs_doc_path is not null
    into v_status, v_owner, v_ref, v_signed
    from public.fms_ocpi_deals where id = p_deal for update;$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'fms_ocpi_cancel: expected the select-into exactly once, found %', v_hits;
  end if;
  v_repl := $b$  -- OCPI-40 · v_issued is the honest test of "nothing has been issued";
  --   status = 'draft' stopped being it when the mint moved to Generate.
  --   v_ref follows oc_at, so a cancelled quotation is not announced under a
  --   contract number nobody approved.
  select status, raised_by,
         coalesce(case when oc_at is not null then nullif(oc_no, '') end,
                  nullif(quotation_no, ''), nullif(oc_no, ''), customer_name),
         cs_doc_path is not null,
         quotation_no is not null
    into v_status, v_owner, v_ref, v_signed, v_issued
    from public.fms_ocpi_deals where id = p_deal for update;$b$;
  v_src := replace(v_src, v_anchor, v_repl);

  -- 1b · declare it
  v_anchor := $a$  v_signed boolean;
begin$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'fms_ocpi_cancel: expected the declare tail exactly once, found %', v_hits;
  end if;
  v_repl := $b$  v_signed boolean;
  v_issued boolean;
begin$b$;
  v_src := replace(v_src, v_anchor, v_repl);

  -- 1c · the guard itself
  v_anchor := $a$  -- A draft is deleted, not cancelled: it burned no number and nobody has seen it.
  if v_status = 'draft' then
    raise exception 'This is still a draft — delete it instead. Nothing has been issued.';
  end if;$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'fms_ocpi_cancel: expected the draft guard exactly once, found %', v_hits;
  end if;
  v_repl := $b$  -- OCPI-40 · AN UNGENERATED DRAFT IS DELETED, NOT CANCELLED — it burned no
  --   number and nobody has seen it, and for THAT case this has always been
  --   right. A generated one has both serials and papers the customer may
  --   already hold, so it is written off like any other deal and keeps its
  --   number on the register with a reason beside it.
  if not v_issued then
    raise exception 'This draft has never been generated — delete it instead. No number has been issued.';
  end if;$b$;
  v_src := replace(v_src, v_anchor, v_repl);
  execute v_src;

  /* ═════ 2 · fms_ocpi_hold ═══════════════════════════════════════════════ */
  v_src := pg_get_functiondef('public.fms_ocpi_hold(uuid,text)'::regprocedure);

  v_anchor := $a$  select status, raised_by, coalesce(oc_no, quotation_no, customer_name)
    into v_status, v_owner, v_ref
    from public.fms_ocpi_deals where id = p_deal for update;$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'fms_ocpi_hold: expected the select-into exactly once, found %', v_hits;
  end if;
  v_repl := $b$  -- OCPI-40 · see fms_ocpi_cancel; these two move together.
  select status, raised_by,
         coalesce(case when oc_at is not null then nullif(oc_no, '') end,
                  nullif(quotation_no, ''), nullif(oc_no, ''), customer_name),
         quotation_no is not null
    into v_status, v_owner, v_ref, v_issued
    from public.fms_ocpi_deals where id = p_deal for update;$b$;
  v_src := replace(v_src, v_anchor, v_repl);

  v_anchor := $a$  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'fms_ocpi_hold: expected the declare tail exactly once, found %', v_hits;
  end if;
  v_repl := $b$  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_issued boolean;
begin$b$;
  v_src := replace(v_src, v_anchor, v_repl);

  v_anchor := $a$  -- A draft is already private and owes nobody; holding one would be a state
  -- with no observable difference. The terminal statuses are terminal.
  if v_status in ('draft', 'closed', 'cancelled', 'rejected') then
    raise exception 'A % deal cannot be put on hold', replace(v_status, '_', ' ');
  end if;$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'fms_ocpi_hold: expected the status guard exactly once, found %', v_hits;
  end if;
  v_repl := $b$  -- OCPI-40 · AN UNGENERATED DRAFT IS ALREADY PRIVATE AND OWES NOBODY, so
  --   holding one is a state with no observable difference. A GENERATED one is
  --   out with a customer and parking it is exactly the point.
  --   `hold_from_status` records 'draft', so fms_ocpi_resume returns it there.
  if v_status = 'draft' and not v_issued then
    raise exception 'This draft has never been generated — there is nothing to put on hold.';
  end if;
  if v_status in ('closed', 'cancelled', 'rejected') then
    raise exception 'A % deal cannot be put on hold', replace(v_status, '_', ' ');
  end if;$b$;
  v_src := replace(v_src, v_anchor, v_repl);
  execute v_src;

  /* ═════ 3 · prove both landed in what is RUNNING ════════════════════════ */
  if position('if not v_issued then'
              in pg_get_functiondef('public.fms_ocpi_cancel(uuid,text)'::regprocedure)) = 0 then
    raise exception 'fms_ocpi_cancel: the v_issued guard is not in the installed body';
  end if;
  if position('v_status = ''draft'' and not v_issued'
              in pg_get_functiondef('public.fms_ocpi_hold(uuid,text)'::regprocedure)) = 0 then
    raise exception 'fms_ocpi_hold: the v_issued guard is not in the installed body';
  end if;
  raise notice '% · cancel and hold now turn on quotation_no, not on status', procedure_note;
end $mig$;

comment on function public.fms_ocpi_cancel(uuid, text) is
  'Write a deal off, keeping the row, both numbers and every document. OCPI-40 - refuses only a draft that was NEVER GENERATED (quotation_no is null); a generated one is cancelled rather than deleted, so its contract serial stays on the register with a reason instead of vanishing. The serial is deliberately not returned to the counter.';

comment on function public.fms_ocpi_hold(uuid, text) is
  'Park a deal, reversibly. OCPI-40 - refuses only a draft that was never generated; a generated quotation whose customer has gone quiet can be held, and fms_ocpi_resume returns it to draft.';
