/*
  OCPI-35 · One delivery question instead of two, with the detail each answer
  needs. Asked for by Ritesh Bhai, 02-09-2026.

  ─────────────────────────────────────────────────────────────────────────────
  WHAT THE FORM USED TO ASK TWICE

  Two fields asked the same question with overlapping vocabularies:

      high_seas_via   CIF / EX Factory / FOB          High Seas deals only
      trade_term      Ex-Work Surat / CIF / FOB /     BOTH deal types
                      EX Factory

  They merge into ONE question shown on both deal types, plus the detail each
  answer needs: CIF asks the PORT, EX Factory asks SURAT or NOIDA, and a High
  Seas deal whose cost is borne by the CUSTOMER asks which port the customer's
  own leg starts from. The answer and its detail COMPOSE into trade_term.

  ─────────────────────────────────────────────────────────────────────────────
  🔴 trade_term IS NOT REMOVED, AND COULD NOT BE.

  {{trade_term}} is live in the SALE CONDITIONS OF THE SUPPLY clause of all 21
  templated machines -- exactly once each, under five different headings
  ("Trade Terms:", "Transport Terms:", "Delivery Terms:", ...). An unresolved
  token rules a blank by design (lib/tokens.ts), so retiring the field would
  print

      Transport Terms: ________

  on every contract. This is the {{delivery_days}} trap of OCPI-18, and the
  answer is the same: trade_term REMAINS the stored, printed answer. The merged
  control composes into it. NO TEMPLATE IS TOUCHED AND NO TOKEN CHANGES.

  ─────────────────────────────────────────────────────────────────────────────
  🔴 high_seas_via KEEPS ITS COLUMN **AND KEEPS BEING WRITTEN**.

  The work list describes it as "retained but no longer asked". Only the second
  half is true, and the difference is load-bearing. FOUR live things depend on
  the column being populated:

    1 · fms_ocpi_deals_high_seas_via_check -- it may only ever hold
        'CIF' / 'EX Factory' / 'FOB', so it can never carry 'Ex-Work Surat'.

    2 · fms_ocpi_transport_coherent -- transport_terms is distinct from 'local'
        OR high_seas_via is null. It may not be set AT ALL on an Others deal,
        which is why the merged answer needed a column of its own.

    3 · fms_ocpi_complete_when_submitted -- (transport_terms <> 'high_seas' or
        (high_seas_via is not null and high_seas_cost_by is not null)).
        🔴 STOP WRITING high_seas_via AND NO HIGH SEAS DEAL CAN EVER BE
           SUBMITTED AGAIN -- a raw constraint violation naming no field.

    4 · fms_ocpi_submit_quotation's "Still needed ..." list names it.

  So the FORM stops asking it and the PAYLOAD keeps sending it, derived from the
  merged answer in payloadFromDraft (lib/fieldSpec.ts). Its clearing rule in
  fms_ocpi_write_quotation below is UNTOUCHED, which is what keeps constraint 2
  satisfied on an Others deal.

  ⚠ THE SUBMIT CHECK IS NOT TOUCHED BY THIS FILE. A CHECK is re-validated on
    every UPDATE, so tightening it makes every deal already on record that fails
    it un-updatable. OCPI-7, OCPI-14 and OCPI-15 all considered it and all
    refused. The FORM carries the new requirements; the constraint does not.

  ─────────────────────────────────────────────────────────────────────────────
  WHY FOUR COLUMNS AND NOT THE THREE THE BRIEF LISTS

  The brief asks for the port, the factory city and the delivery scope. A fourth
  -- delivery_via, the base answer itself -- is needed because:

    · constraint 2 above forbids high_seas_via on an Others deal, so the base
      answer has nowhere else to live there; and
    · without it, "FOB" and "not answered yet" are indistinguishable -- both
      leave the port and the city empty.

  ⚠ THE COLUMN IS NAMED delivery_leg, NOT delivery_scope. `delivery_scope` is
    ALREADY a machine-template section key on 20 machines, titled "NOT INCLUDED
    IN OUR DELIVERY SCOPE" -- an exclusions clause. Reusing the name would put
    two unrelated meanings one word apart.

  ─────────────────────────────────────────────────────────────────────────────
  WHAT IS NOT TOUCHED, AND IS ASSERTED SO AT THE END

    · fms_ocpi_write_oc     -- it already writes trade_term unconditionally.
    · fms_ocpi_save_draft   -- the new columns are PART A, and
                               fms_ocpi_write_quotation runs unconditionally, so
                               its part-B key gate needs no new name. (The brief
                               expected all three RPCs to change; only one does.)
    · fms_ocpi_complete_when_submitted, fms_ocpi_transport_coherent.
    · Every machine template, every section body, every token.
    · high_seas_via / trade_term on every existing row, except the two blanks
      filled below.

  ⚠ APPLY THIS BEFORE THE FRONTEND SHIPS. The columns must exist before the form
    reads them. In the window between, the old form does not send the four keys,
    so they write null -- harmless. The one visible effect is that an incomplete
    High Seas submit says "Delivery term" while the old form still shows "High
    seas delivery via": a cosmetic mismatch on an error path, for one deploy.
*/

-- ═══════════════════════════════════════ 0 · Capture what must not move

/*
  ⚠ THE "NOTHING ELSE MOVED" GUARDS COMPARE BEFORE WITH AFTER, THEY DO NOT
    ASSERT A NUMBER I TYPED. The first draft of this file hard-coded "20 deals
    read Ex-Work Surat" and the apply refused: another session had raised a
    deal while this was being written, and the real figure was 17. The count is
    a fact about the world, not about this change -- and the only rows this file
    touches are two whose trade_term is NULL, which cannot alter any of these
    figures. So the correct assertion is that they are UNCHANGED.

  The whole migration is one transaction, so this table is visible to every
  block below and disappears with the session either way.
*/
create temp table _ocpi35_before on commit drop as
select
  (select count(*) from public.fms_ocpi_deals where trade_term = 'Ex-Work Surat')  as ex_work_surat,
  (select count(*) from public.fms_ocpi_deals where trade_term = 'CIF Jebel Ali')  as cif_jebel_ali,
  (select count(*) from public.fms_ocpi_machine_sections
    where body like '%{{trade_term}}%')                                            as sections_with_token,
  (select count(*) from public.fms_ocpi_machine_sections)                          as sections_total,
  (select coalesce(sum(length(body)), 0) from public.fms_ocpi_machine_sections)     as sections_bytes,
  md5(pg_get_functiondef('public.fms_ocpi_write_oc(uuid,jsonb)'::regprocedure))    as write_oc_md5,
  md5(pg_get_functiondef('public.fms_ocpi_save_draft(jsonb,uuid)'::regprocedure))  as save_draft_md5;

-- ═══════════════════════════════════════════════════════ 1 · The four columns

alter table public.fms_ocpi_deals
  add column if not exists delivery_via          text,
  add column if not exists delivery_port         text,
  add column if not exists delivery_factory_city text,
  add column if not exists delivery_leg          text;

/*
  ⚠ ONLY delivery_leg IS CONSTRAINED, and the asymmetry is deliberate.

  delivery_leg is a CLOSED ENUM the code knows the meaning of -- each value maps
  to a sentence that prints -- exactly like high_seas_cost_by.

  The other three are NOT constrained, for the same reason trade_term never has
  been: they must be able to hold what a deal already says. delivery_via
  hydrates from a deal's stored trade_term when nothing else is available, so a
  deal quoted as 'Ex-Work Surat' -- 17 of them on record -- carries that value,
  and ChoiceButtons feeds it back as a retired option rather than losing it.
*/
do $c$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.fms_ocpi_deals'::regclass
       and conname  = 'fms_ocpi_deals_delivery_leg_check'
  ) then
    alter table public.fms_ocpi_deals
      add constraint fms_ocpi_deals_delivery_leg_check
      check (delivery_leg is null or delivery_leg in ('manufacturer_port', 'indian_port'));
  end if;
end $c$;

comment on column public.fms_ocpi_deals.delivery_via is
  'OCPI-35 · The one delivery question, asked on BOTH deal types: CIF / EX Factory / FOB. Composes into trade_term together with the detail columns below. May also hold a retired value (e.g. Ex-Work Surat) hydrated from an older deal''s own trade_term, which is why it carries no CHECK. On a High Seas deal it is mirrored into high_seas_via, which several constraints still require.';

comment on column public.fms_ocpi_deals.delivery_port is
  'OCPI-35 · Free text, asked only when delivery_via = CIF. Composes into trade_term as "CIF <port>" - which is exactly what one deal had already been typed by hand as "CIF Jebel Ali". Free text by decision (Ritesh Bhai, 02-09-2026): only one port has ever been used, so there is no list to seed.';

comment on column public.fms_ocpi_deals.delivery_factory_city is
  'OCPI-35 · Surat or Noida, asked only when delivery_via = EX Factory. Composes into trade_term as "Ex Factory <city>". The pair is hardcoded in lib/fieldSpec.ts and is the SAME pair as the company branches in OCPI-25; that entry is where the two lists reconcile once it is unblocked.';

comment on column public.fms_ocpi_deals.delivery_leg is
  'OCPI-35 · Where the customer''s own delivery leg starts, asked ONLY on a High Seas deal whose cost is borne by the CUSTOMER (Ritesh Bhai: "when we select a company, we don''t have to ask this thing"). Both wordings end at the customer premises; only the starting port differs. Appended to trade_term, so it reaches all 21 contracts with no template change. Dead on a Company-borne deal, and nulled there by fms_ocpi_write_quotation.';

-- ══════════════════════════════════ 2 · fms_ocpi_write_quotation gains the four

/*
  ⚠ A TRANSFORM OF THE LIVE BODY, NOT A RETYPED COPY. This function has been
    redefined a dozen times and the files in this folder have diverged from what
    is actually installed; a hand-copied body is precisely how that drift
    happens. Read it with pg_get_functiondef, assert the anchor appears exactly
    once, substitute, assert the result changed.

  ⚠ THE FOUR CLEARING RULES MIRROR branching.ts CONJUNCT FOR CONJUNCT. Client
    and server branch rules moving apart is this module's defining hazard, so
    they ship in one change. The client copy is PART_A_VISIBILITY + clearHidden;
    this is the backstop.
*/
do $mig$
declare
  v_src    text;
  v_new    text;
  v_anchor text;
  v_repl   text;
  v_hits   int;
begin
  v_src := pg_get_functiondef('public.fms_ocpi_write_quotation(uuid,jsonb)'::regprocedure);

  -- Pre 1 · idempotency. If the columns are already written, this file has run.
  if position('delivery_via' in v_src) > 0 then
    raise exception 'OCPI-35 pre 1: fms_ocpi_write_quotation already writes delivery_via - this file has run before';
  end if;

  v_anchor := $a$    local_cost_by       = case when v_transport is distinct from 'local' then null
                               else nullif(btrim(p->>'local_cost_by'), '') end,
$a$;

  -- Pre 2 · the anchor is unique. Two hits would duplicate the whole block.
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'OCPI-35 pre 2: expected the local_cost_by clause exactly once, found %', v_hits;
  end if;

  v_repl := v_anchor || $b$
    -- ── OCPI-35 · ONE DELIVERY QUESTION, AND THE DETAIL EACH ANSWER NEEDS ────
    --
    -- ⚠ high_seas_via ABOVE IS THE MIRROR OF delivery_via, NOT A SECOND
    --   QUESTION. The form stopped asking it; payloadFromDraft derives it from
    --   the merged answer on a High Seas deal. Its clearing rule is untouched,
    --   which is what keeps fms_ocpi_transport_coherent satisfied on an Others
    --   deal -- that constraint forbids the column there outright, and is the
    --   reason delivery_via had to be a column of its own.
    --
    -- ⚠ delivery_via ITSELF IS NEVER CLEARED. It is asked on BOTH deal types,
    --   which is the whole point of OCPI-35, so it has no branch to hide behind.
    delivery_via          = nullif(btrim(p->>'delivery_via'), ''),
    delivery_port         = case when nullif(btrim(p->>'delivery_via'), '') is distinct from 'CIF'
                                 then null else nullif(btrim(p->>'delivery_port'), '') end,
    delivery_factory_city = case when nullif(btrim(p->>'delivery_via'), '') is distinct from 'EX Factory'
                                 then null else nullif(btrim(p->>'delivery_factory_city'), '') end,
    -- 🔴 THE ONE WITH TWO CONDITIONS. Both wordings end "to customer premises",
    --    so the question is meaningless once the COMPANY bears the cost -- and
    --    without this line a stale answer would survive a change of bearer and
    --    print a commitment nobody made.
    delivery_leg          = case when v_transport is distinct from 'high_seas'
                                   or nullif(btrim(p->>'high_seas_cost_by'), '') is distinct from 'customer'
                                 then null else nullif(btrim(p->>'delivery_leg'), '') end,
$b$;

  v_new := replace(v_src, v_anchor, v_repl);
  if v_new = v_src then
    raise exception 'OCPI-35: the fms_ocpi_write_quotation substitution changed nothing';
  end if;
  execute v_new;
end $mig$;

-- ════════════════════ 3 · fms_ocpi_submit_quotation names a field that exists

/*
  MESSAGE ONLY -- the predicate is not touched, so this stays a mirror of
  fms_ocpi_complete_when_submitted, conjunct for conjunct, and never stricter.
  It still tests high_seas_via, because that is what the CHECK tests; it simply
  reports the failure under the name the form now shows.

  ⚠ THE NEW FIELDS DO NOT JOIN THIS LIST. The CHECK does not carry them, and
    this list may never be stricter than the CHECK. The FORM is deliberately the
    stricter of the two, exactly as OCPI-27 settled for the head count.
*/
do $mig2$
declare
  v_src  text;
  v_new  text;
  v_hits int;
begin
  v_src := pg_get_functiondef('public.fms_ocpi_submit_quotation(uuid)'::regprocedure);

  v_hits := (length(v_src) - length(replace(v_src, $a$then 'High seas delivery via' end,$a$, '')))
            / length($a$then 'High seas delivery via' end,$a$);
  if v_hits <> 1 then
    raise exception 'OCPI-35 pre 3: expected the high-seas-via label exactly once in fms_ocpi_submit_quotation, found %', v_hits;
  end if;

  v_new := replace(v_src,
                   $a$then 'High seas delivery via' end,$a$,
                   $b$then 'Delivery term' end,$b$);
  if v_new = v_src then
    raise exception 'OCPI-35: the fms_ocpi_submit_quotation substitution changed nothing';
  end if;
  execute v_new;
end $mig2$;

-- ══════════════════════ 4 · The two contracts that rule a blank TODAY

/*
  🔴 A LIVE DEFECT THIS CHANGE INHERITS RATHER THAN CREATES. Two High Seas deals
     carry high_seas_via = 'CIF' and trade_term = NULL, so their SALE CONDITIONS
     clause prints "Transport Terms: ________" right now. One of them is a real
     customer (AARNAV FASHIONS), the other is a ZZ TEST seed.

  This FILLS A BLANK FROM AN ANSWER THE DEAL ALREADY CARRIES. It is not a
  back-fill of anybody's answer, so it does not cross the line settled on
  02-09-2026 -- "don't worry about the existing deals" -- which was about the
  deals reading 'Ex-Work Surat'. Those are not touched by anything in this file.

  ⚠ QT-M0037 AND QT-M0046 ARE DELIBERATELY LEFT ALONE. They are `local` deals
    with a blank trade_term, and a local deal has no high_seas_via to derive
    from -- fms_ocpi_transport_coherent forbids the column there. They keep
    their blank until somebody opens the deal and answers the question. Recorded
    in WORKLIST.md rather than guessed at.
*/
do $fix$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_deals
   where transport_terms = 'high_seas' and high_seas_via is not null and trade_term is null;
  if v_n <> 2 then
    raise exception 'OCPI-35 pre 4: expected exactly 2 High Seas deals with a blank trade_term, found % - re-read the data before filling', v_n;
  end if;

  update public.fms_ocpi_deals
     set trade_term = high_seas_via
   where transport_terms = 'high_seas' and high_seas_via is not null and trade_term is null;
  get diagnostics v_n = row_count;
  if v_n <> 2 then
    raise exception 'OCPI-35: expected to fill 2 blank trade terms, filled %', v_n;
  end if;

  select count(*) into v_n from public.fms_ocpi_deals
   where transport_terms = 'high_seas' and trade_term is null;
  if v_n <> 0 then
    raise exception 'OCPI-35 post 1: % High Seas deal(s) still carry a blank trade_term', v_n;
  end if;
end $fix$;

-- ═══════════════════════════════════════════ 5 · Assert what did NOT move

do $assert$
declare
  v_n   int;
  v_big bigint;
  v_def text;
begin
  -- Post 2 · the four columns exist and are nullable.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'fms_ocpi_deals'
     and column_name in ('delivery_via', 'delivery_port', 'delivery_factory_city', 'delivery_leg')
     and is_nullable = 'YES';
  if v_n <> 4 then
    raise exception 'OCPI-35 post 2: expected 4 new nullable columns, found %', v_n;
  end if;

  -- Post 3 · write_quotation carries all four, and high_seas_via's own clearing
  --          rule survived the substitution untouched.
  v_def := pg_get_functiondef('public.fms_ocpi_write_quotation(uuid,jsonb)'::regprocedure);
  if position('delivery_via' in v_def) = 0
     or position('delivery_port' in v_def) = 0
     or position('delivery_factory_city' in v_def) = 0
     or position('delivery_leg' in v_def) = 0 then
    raise exception 'OCPI-35 post 3: fms_ocpi_write_quotation is missing one of the four new columns';
  end if;
  if position($h$high_seas_via       = case when v_transport is distinct from 'high_seas' then null$h$ in v_def) = 0 then
    raise exception 'OCPI-35 post 3b: the high_seas_via clearing rule was disturbed';
  end if;

  -- Post 4 · the two functions this file must NOT change are byte-identical to
  --          the bodies captured in step 0, in this same transaction.
  if md5(pg_get_functiondef('public.fms_ocpi_write_oc(uuid,jsonb)'::regprocedure))
     is distinct from (select write_oc_md5 from _ocpi35_before) then
    raise exception 'OCPI-35 post 4: fms_ocpi_write_oc changed and must not have';
  end if;
  if md5(pg_get_functiondef('public.fms_ocpi_save_draft(jsonb,uuid)'::regprocedure))
     is distinct from (select save_draft_md5 from _ocpi35_before) then
    raise exception 'OCPI-35 post 4b: fms_ocpi_save_draft changed and must not have';
  end if;

  -- Post 5 · both delivery constraints are intact and still VALIDATED. A
  --          NOT VALID constraint would let an incomplete row through and only
  --          fail later, on an unrelated update.
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname in ('fms_ocpi_complete_when_submitted', 'fms_ocpi_transport_coherent')
     and convalidated;
  if v_n <> 2 then
    raise exception 'OCPI-35 post 5: expected both delivery constraints present and validated, found %', v_n;
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.fms_ocpi_deals'::regclass
         and conname = 'fms_ocpi_complete_when_submitted') not like '%high_seas_via%' then
    raise exception 'OCPI-35 post 5b: the submit CHECK no longer demands high_seas_via';
  end if;

  -- Post 6 · NOT ONE TEMPLATE MOVED. Every section body is byte-for-byte where
  --          it was: same count, same total length, same number carrying the
  --          token -- and no new token leaked into any of them.
  select count(*) into v_n from public.fms_ocpi_machine_sections
   where body like '%{{trade_term}}%';
  if v_n is distinct from (select sections_with_token from _ocpi35_before) then
    raise exception 'OCPI-35 post 6: sections carrying {{trade_term}} went from % to %',
      (select sections_with_token from _ocpi35_before), v_n;
  end if;
  select count(*) into v_n from public.fms_ocpi_machine_sections;
  if v_n is distinct from (select sections_total from _ocpi35_before) then
    raise exception 'OCPI-35 post 6b: the section count changed';
  end if;
  select coalesce(sum(length(body)), 0) into v_big from public.fms_ocpi_machine_sections;
  if v_big is distinct from (select sections_bytes from _ocpi35_before) then
    raise exception 'OCPI-35 post 6c: a section body changed length';
  end if;
  select count(*) into v_n from public.fms_ocpi_machine_sections
   where body like '%delivery_via%' or body like '%delivery_leg%' or body like '%delivery_port%';
  if v_n <> 0 then
    raise exception 'OCPI-35 post 6d: a new token leaked into % section body/bodies', v_n;
  end if;

  -- Post 7 · the deals reading 'Ex-Work Surat' are untouched, and so is the one
  --          that had the port typed into it by hand. Compared with step 0, not
  --          with a number typed here -- see the note there.
  select count(*) into v_n from public.fms_ocpi_deals where trade_term = 'Ex-Work Surat';
  if v_n is distinct from (select ex_work_surat from _ocpi35_before) then
    raise exception 'OCPI-35 post 7: deals reading Ex-Work Surat went from % to %',
      (select ex_work_surat from _ocpi35_before), v_n;
  end if;
  select count(*) into v_n from public.fms_ocpi_deals where trade_term = 'CIF Jebel Ali';
  if v_n is distinct from (select cif_jebel_ali from _ocpi35_before) then
    raise exception 'OCPI-35 post 7b: the hand-typed CIF Jebel Ali deal was disturbed';
  end if;

  -- Post 8 · no new column is populated yet. Nothing in this file writes one,
  --          so anything here would mean it ran against input nobody checked.
  select count(*) into v_n from public.fms_ocpi_deals
   where delivery_via is not null or delivery_port is not null
      or delivery_factory_city is not null or delivery_leg is not null;
  if v_n <> 0 then
    raise exception 'OCPI-35 post 8: % row(s) already carry a delivery answer', v_n;
  end if;
end $assert$;

/*
  ─────────────────────────────────────────────────────────────────────────────
  ROLLBACK · ⚠ REHEARSED ON LIVE DATA, NOT MERELY WRITTEN.

  Reverses all four parts. The two function bodies are restored by the inverse
  substitution and verified by md5 against what was captured before this file
  ran:

      fms_ocpi_write_quotation   094460906c85df61115a74435686475f   9820 bytes
      fms_ocpi_submit_quotation  61e045e5605d9baf488030b356a766c7   5727 bytes

  ⚠ THE trade_term FILL IS NOT REVERSED, and that is deliberate. Restoring two
    NULLs would put a ruled blank back on a real customer's contract in order to
    undo a frontend change that never depended on it. If it genuinely must go
    back:
        update public.fms_ocpi_deals set trade_term = null
         where quotation_no in ('QT-M0036', 'QT-M0038');

do $rb$
declare v_src text; v_new text;
begin
  v_src := pg_get_functiondef('public.fms_ocpi_write_quotation(uuid,jsonb)'::regprocedure);
  v_new := regexp_replace(v_src,
             E'\n    -- ── OCPI-35.*?delivery_leg          = case.*?end,\n',
             '', 'gs');
  if v_new = v_src then raise exception 'rollback: nothing removed from write_quotation'; end if;
  execute v_new;

  v_src := pg_get_functiondef('public.fms_ocpi_submit_quotation(uuid)'::regprocedure);
  v_new := replace(v_src, $x$then 'Delivery term' end,$x$, $y$then 'High seas delivery via' end,$y$);
  if v_new = v_src then raise exception 'rollback: nothing changed in submit_quotation'; end if;
  execute v_new;

  alter table public.fms_ocpi_deals drop constraint if exists fms_ocpi_deals_delivery_leg_check;
  alter table public.fms_ocpi_deals
    drop column if exists delivery_via,
    drop column if exists delivery_port,
    drop column if exists delivery_factory_city,
    drop column if exists delivery_leg;

  if md5(pg_get_functiondef('public.fms_ocpi_write_quotation(uuid,jsonb)'::regprocedure))
     <> '094460906c85df61115a74435686475f' then
    raise exception 'rollback: write_quotation does not match its pre-migration md5';
  end if;
  if md5(pg_get_functiondef('public.fms_ocpi_submit_quotation(uuid)'::regprocedure))
     <> '61e045e5605d9baf488030b356a766c7' then
    raise exception 'rollback: submit_quotation does not match its pre-migration md5';
  end if;
end $rb$;
*/
