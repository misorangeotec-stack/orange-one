-- R8 (part three) · The HSN becomes a CHOICE ON THE DEAL, not a fact about the
--                    machine — because the client uses both headings case by case.
--
-- WHY THE MACHINE-LEVEL ANSWER WAS NEVER GOING TO BE ENOUGH
--   R8 assumed one heading per machine. The evidence says otherwise and the
--   client has confirmed it: the same machine ships under `84433250` on one
--   invoice and `84433910` on another, and which applies is decided per
--   consignment — the export terms, the licence, the destination. Tally shows it
--   plainly: nine P8D lines under `HM1800R-P8D-A1` read 84433250 while seven
--   older lines read 84433910, and the K32 and K64 disagree between the signed
--   papers (84433910) and what was actually filed (84433250).
--
--   That disagreement was never a data error to be resolved. It is two correct
--   answers to a question nobody was being asked. So the question gets asked.
--
-- WHAT CHANGES
--   `fms_ocpi_deals.hsn_code` is added, nullable. The salesperson picks one on
--   the quotation; the papers print the DEAL's choice, falling back to the
--   machine master's when it is blank.
--
-- 🟢 EVERY MACHINE-LEVEL HEADING KEEPS ITS MEANING — it becomes the DEFAULT
--    rather than the verdict. The 15 filled by 20261114120007 / _120008 are what
--    the picker offers first, so none of that work is wasted, and a deal that
--    never touches the field prints exactly what it prints today.
--
-- ⚠ THIS IS THE `machine_model_no` PATTERN, DELIBERATELY, DOWN TO THE LINE THEY
--   SHARE ON THE PAPER. `fms_ocpi_deals.machine_model_no` has always been a
--   deal-level override of the machine master's model number, resolved in
--   `ocPdf.ts:424` as `deal.machineModelNo || machine.machineModelNo`. The two
--   values print on ONE line — `(HM1800B-TK64-A1)  HSN CODE: 84433910` — so they
--   must be overridable the same way or the pair goes out half-overridden.
--
-- ⚠ BLANK IS THE CORRECT NORMAL STATE, and pre-filling would be wrong. The
--   `machine_model_no` field carries a long note recording why: copying the
--   master's value onto the deal freezes it into the revision, so a later
--   correction to the master never reaches deals already raised, and a
--   deliberate blank becomes indistinguishable from an unanswered one. The same
--   reasoning applies here exactly.
--
-- 🔴 NO CHECK CONSTRAINT, AND NO REQUIRED-FIELD GATE. A domestic machine has no
--    customs heading to state, and 30 of 34 real Performa Invoices carry none at
--    all. Making this mandatory would put a heading on every domestic paper this
--    company issues. The form warns; the database does not refuse.
--
-- ⚠ THE VOCABULARY IS NOT STORED HERE. The picker's options are derived in the
--   frontend from the distinct `hsn_code` values on `fms_ocpi_machines`, so a new
--   heading becomes selectable the moment an admin sets it on any machine — no
--   migration, no new master screen, no deploy. The trade-off is stated in
--   `QuotationForm.tsx`: a typo on the Machines master would appear in the list.
--   That screen is admin-only, and the alternative was a second master to keep
--   in step with the first.
--
-- TWO FUNCTION BODIES ARE TRANSFORMED, both from `pg_get_functiondef` and never
-- retyped, each asserting it changed something:
--
--   fms_ocpi_write_oc     gains `hsn_code = nullif(btrim(p->>'hsn_code'), '')`
--                         beside machine_model_no.
--   fms_ocpi_save_draft   gains 'hsn_code' to the `p ?| array[…]` list that
--                         decides whether write_oc runs at all.
--
-- 🔴 THE SAVE_DRAFT LIST IS THE EASIEST THING IN THIS MODULE TO MISS, and its
--    own comment says so: a part-B key left off it is never written — no error,
--    no warning, the value simply never lands. QT-M0037 is what that looks like
--    from outside. Adding the column without adding the key would ship a picker
--    that silently discards every answer.

begin;

alter table public.fms_ocpi_deals add column if not exists hsn_code text;

comment on column public.fms_ocpi_deals.hsn_code is
  'The customs heading chosen FOR THIS DEAL, overriding fms_ocpi_machines.hsn_code. NULL means "use the machine master''s", which is the normal state — the same contract as machine_model_no, with which it shares a line on both papers. Both 84433250 and 84433910 are in live use; which applies is a per-consignment decision the export team confirms.';

do $assert$
declare v_n int;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='fms_ocpi_deals' and column_name='machine_model_no';
  if v_n <> 1 then raise exception 'R8c pre 1: machine_model_no is missing — this migration mirrors it and cannot'; end if;

  select count(*) into v_n from public.fms_ocpi_deals where hsn_code is not null;
  if v_n <> 0 then raise exception 'R8c pre 2: % deal(s) already carry an hsn_code — this has run before', v_n; end if;
end $assert$;

do $fn$
declare v_src text; v_new text;
begin
  ------------------------------------------------------------------ write_oc
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_oc';

  -- Anchored on the machine_model_no assignment, which is the line this one
  -- shares a printed line with. Matching on prose would be the trap
  -- 20261102120000 recorded.
  v_new := replace(v_src,
    E'    machine_model_no  = nullif(btrim(p->>''machine_model_no''), ''''),\n',
    E'    machine_model_no  = nullif(btrim(p->>''machine_model_no''), ''''),\n'
    || E'    hsn_code          = nullif(btrim(p->>''hsn_code''), ''''),\n');
  if v_new = v_src then raise exception 'R8c: write_oc did not match on machine_model_no'; end if;
  execute v_new;

  ---------------------------------------------------------------- save_draft
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_save_draft';

  v_new := replace(v_src,
    E'''ref_no'', ''delivery_days'', ''trade_term'', ''machine_model_no'',',
    E'''ref_no'', ''delivery_days'', ''trade_term'', ''machine_model_no'', ''hsn_code'',');
  if v_new = v_src then raise exception 'R8c: save_draft trigger list did not match'; end if;
  execute v_new;
end $fn$;

do $post$
declare v_n int;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='fms_ocpi_deals' and column_name='hsn_code';
  if v_n <> 1 then raise exception 'R8c post 1: the column was not added'; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='fms_ocpi_write_oc' and p.prosrc like '%hsn_code%';
  if v_n <> 1 then raise exception 'R8c post 2: write_oc does not write hsn_code'; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='fms_ocpi_save_draft' and p.prosrc like '%''hsn_code''%';
  if v_n <> 1 then raise exception 'R8c post 3: save_draft would discard the answer'; end if;

  -- The machine master is untouched: 15 headings must survive intact.
  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 15 then raise exception 'R8c post 4: the machine headings moved — found %', v_n; end if;

  -- And no deal has been given one by this file.
  select count(*) into v_n from public.fms_ocpi_deals where hsn_code is not null;
  if v_n <> 0 then raise exception 'R8c post 5: % deal(s) were written — this file backfills nothing', v_n; end if;
end $post$;

commit;
