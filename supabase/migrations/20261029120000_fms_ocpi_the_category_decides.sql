-- OCPI-14 · Phase 1 — the machine CATEGORY decides what is asked, not the machine.
--
-- ADDITIVE ONLY. Nine nullable columns and one config row. NOTHING READS ANY OF
-- THEM YET: the branch rules still live on fms_ocpi_machines.needs_dryer and
-- .opt_external_centering, and the form still keeps its category in local state.
-- Applying this file changes no behaviour whatsoever, which is the point — it is
-- what lets Phase 2 fill the columns and Phase 3 switch over, each on its own.
--
-- ── WHY THE DEAL NEEDS ITS OWN CATEGORY ──────────────────────────────────────
--
-- QuotationForm.tsx keeps the machine category in a `useState` that is
-- deliberately NOT on the draft and NOT on the deal — it only narrows the
-- machine dropdown. But fms_ocpi_write_quotation and fms_ocpi_write_oc null
-- every column their branches hide, on EVERY write, and they can only see the
-- row. Branch on a value the server cannot see and the server erases answers the
-- form is still showing, with no error and nothing in a log. That is this
-- module's defining failure mode (OCPI-7, -10, -11 all hit it), so the category
-- becomes a real column before anything branches on it.
--
-- ── WHY FLAGS AND NOT THE NAME "Direct" ──────────────────────────────────────
--
-- OCPI-8 paid for this lesson with dryer_type = 'Not Applicable': match a
-- category by its literal name and renaming it in Masters switches the branch
-- off silently. fms_ocpi_dryer_types.means_no_dryer was the answer there and the
-- three shows_* flags are the answer here. No code and no SQL in OCPI-14
-- contains the word 'Direct' — only the one-time seed in Phase 2 does.
--
-- ⚠ AND THAT IS ALSO WHY THIS TABLE NEEDS NO RENAME-GUARD TRIGGER, unlike
--   fms_ocpi_dryer_types. A deal points at a category by ID; dryer_type is
--   stored as TEXT. Renaming 'Direct' to something else is therefore harmless
--   here and was not there.

begin;

-- ─── 1 · The deal's own category, and the centering inclusion ────────────────

alter table public.fms_ocpi_deals
  add column if not exists machine_category_id uuid
    references public.fms_ocpi_machine_categories(id),
  add column if not exists incl_centering    boolean,
  add column if not exists centering_details text;

comment on column public.fms_ocpi_deals.machine_category_id is
  'OCPI-14 · The machine category this deal was quoted under — Direct / Sublimation / Other / POD. '
  'THE BRANCH INPUT for the dryer section, the centering inclusion, the three optional extras and the '
  'Shipment & invoice rows. Seeded from the chosen machine and re-snapped whenever the machine changes, '
  'so the two can never disagree; stored rather than derived so the questions can appear the moment a '
  'category is picked, BEFORE any machine has been selected. '
  'Both write RPCs read coalesce(d.machine_category_id, m.category_id) — the fallback is a safety net '
  'for a row created before the form sets it, not the mechanism: Phase 2 back-fills every existing deal.';

comment on column public.fms_ocpi_deals.incl_centering is
  'OCPI-14 · Is a centering device part of this deal? Shaped exactly like incl_spares — Yes reveals one '
  'free-text detail/quantity box, No ends it (there is no subsidized-rate branch for centering). '
  'Asked only on a category whose shows_centering is true. '
  'REPLACES the external_centering tick that used to sit in "Also included" and was gated on the '
  'machine''s opt_external_centering; that column keeps its data but no longer decides anything.';

comment on column public.fms_ocpi_deals.centering_details is
  'OCPI-14 · What centering device, and how many. Free text, exactly like spare_details. '
  'Kept only when incl_centering is true.';

-- ─── 2 · What each category makes the form ask ──────────────────────────────

alter table public.fms_ocpi_machine_categories
  add column if not exists shows_dryer     boolean,
  add column if not exists shows_centering boolean,
  add column if not exists shows_extras    boolean;

comment on column public.fms_ocpi_machine_categories.shows_dryer is
  'OCPI-14 · Does a deal in this category carry a dryer? Governs the whole Dryer details card AND the '
  'Dryer row in Shipment & invoice. True on Direct only. '
  'NULL reads as FALSE everywhere, matching coalesce(...,false) in both RPCs and `?? false` in '
  'branching.ts — an unmapped category asks nothing extra rather than asking everything.';

comment on column public.fms_ocpi_machine_categories.shows_centering is
  'OCPI-14 · Does a deal in this category carry a centering device? Governs the Centering device '
  'inclusion in section B AND the Centering row in Shipment & invoice. True on Direct only. '
  '⚠ WIDER THAN THE MACHINE MAPPING IT REPLACES, deliberately: 3 of the 11 Direct machines '
  '(Fab Pro 1I/2I/3I) are mapped opt_external_centering = no and will now be asked anyway. '
  'Ritesh Bhai, 01-Sep-2026 — the category decides, not the machine.';

comment on column public.fms_ocpi_machine_categories.shows_extras is
  'OCPI-14 · Does a deal in this category ask the three optional extras — air blade, ink dust exhauster, '
  'chilling system? True on Direct only, because the client''s sheet maps them against Direct machines '
  'alone and reads "no" for every Sublimation, Other and POD model. '
  '⚠ WHERE THIS IS FALSE THE THREE ARE STORED AS **false**, NOT NULL. The client asked for a definite '
  '"No", not an unanswered question, so this is the one place in the module where a hidden boolean does '
  'not clear to null. branching.ts carries the matching exception in clearHidden.';

-- ─── 3 · Warranty stops being one global number ─────────────────────────────
--
-- fms_ocpi_config.warranty_periods holds {machine_months: 12, head_months: 18}
-- and is applied to every machine alike. The client's sheet gives all three per
-- machine, and HEAD WARRANTY READS "NA" ON 15 OF THE 28 — so the single global
-- 18 months is, today, quoting a head warranty on fifteen models that carry none.
--
-- ⚠ NOT A PER-CATEGORY RULE, and that is why warranty lives on the machine
--   rather than beside the three shows_* flags. 10 of the 12 sublimation models
--   have no head warranty but P8S and P8D have 18 months, so the category cannot
--   answer it.

alter table public.fms_ocpi_machines
  add column if not exists machine_warranty text,
  add column if not exists head_warranty    text,
  add column if not exists dryer_warranty   text;

comment on column public.fms_ocpi_machines.machine_warranty is
  'OCPI-14 · This model''s machine warranty as it should print — e.g. "12 Months". '
  'NULL MEANS NOT APPLICABLE: the question is not asked on the form and no line is printed on either '
  'paper. It does not mean "unknown" and it does not fall through to a default.';

comment on column public.fms_ocpi_machines.head_warranty is
  'OCPI-14 · This model''s print-head warranty — e.g. "18 Months". NULL = not applicable, not asked, '
  'not printed. ⚠ NULL ON 15 OF THE 28 MACHINES — 10 of the 12 sublimation models (P8S and P8D DO '
  'carry 18 months, which is why this is not a per-category rule), all 3 Pengda and both POD printers. '
  'Exactly why warranty moved off the global setting: fms_ocpi_config.warranty_periods was quoting '
  '18 months for heads on fifteen models that carry none.';

comment on column public.fms_ocpi_machines.dryer_warranty is
  'OCPI-14 · This model''s dryer warranty — e.g. "12 Months". NULL = not applicable, not asked, not '
  'printed. Non-null only on machines that take a dryer. '
  '⚠ NOT THE SAME COLUMN as fms_ocpi_deals.dryer_warranty, which is the answer FROZEN ONTO ONE DEAL. '
  'This is the master default that prefills it. The deal column has existed since the beginning and was '
  'orphaned when OCPI-3 stage D took the question off the form; OCPI-14 puts it back.';

-- ⚠ NO SPARE-PARTS WARRANTY COLUMN, and that is a finding rather than an
--   omission. Column S of the sheet reads "NA" on all 28 rows, so there is
--   nothing to store, nothing to ask and nothing to print. Recorded here so the
--   next reader does not "notice the gap" and add it.

-- ─── 4 · The line that has to appear beside every warranty ──────────────────

insert into public.fms_ocpi_config (key, value)
values ('warranty_note',
        jsonb_build_object('text', 'Warranty is applicable from the date of dispatch from the manufacturer.'))
on conflict (key) do nothing;

-- Editable in Settings rather than compiled in: it is a clause on a customer's
-- contract, and rewording one should not need a deploy. Same reasoning that put
-- warranty_periods and quotation_validity_days in this table.

-- ─── Assertions ─────────────────────────────────────────────────────────────

do $check$
declare
  v_n integer;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'fms_ocpi_deals'
     and column_name in ('machine_category_id', 'incl_centering', 'centering_details');
  if v_n <> 3 then raise exception 'OCPI-14 assertion 1: expected 3 new deal columns, found %', v_n; end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'fms_ocpi_machine_categories'
     and column_name in ('shows_dryer', 'shows_centering', 'shows_extras');
  if v_n <> 3 then raise exception 'OCPI-14 assertion 2: expected 3 category flags, found %', v_n; end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'fms_ocpi_machines'
     and column_name in ('machine_warranty', 'head_warranty', 'dryer_warranty');
  if v_n <> 3 then raise exception 'OCPI-14 assertion 3: expected 3 machine warranties, found %', v_n; end if;

  -- Assertion 4 · NOTHING IS REQUIRED YET. Every new column must be nullable, or
  -- applying this file to a table with 20 rows in it would fail outright.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public'
     and (table_name, column_name) in (
       ('fms_ocpi_deals','machine_category_id'), ('fms_ocpi_deals','incl_centering'),
       ('fms_ocpi_deals','centering_details'),
       ('fms_ocpi_machine_categories','shows_dryer'), ('fms_ocpi_machine_categories','shows_centering'),
       ('fms_ocpi_machine_categories','shows_extras'),
       ('fms_ocpi_machines','machine_warranty'), ('fms_ocpi_machines','head_warranty'),
       ('fms_ocpi_machines','dryer_warranty'))
     and is_nullable = 'YES';
  if v_n <> 9 then raise exception 'OCPI-14 assertion 4: expected 9 nullable new columns, found %', v_n; end if;

  -- Assertion 5 · THE SUBMIT CHECK IS UNTOUCHED, and must stay that way.
  -- A CHECK is re-validated on every UPDATE, so a conjunct requiring
  -- incl_centering would make all 20 deals already on record un-updatable and
  -- every approval or signature stamp on them would throw. OCPI-7 hit exactly
  -- this and rejected it. The form carries the requirement instead
  -- (missingForSubmit), and only when the question is actually shown.
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname = 'fms_ocpi_complete_when_submitted'
     and pg_get_constraintdef(oid) not like '%incl_centering%'
     and pg_get_constraintdef(oid) not like '%machine_category_id%';
  if v_n <> 1 then raise exception 'OCPI-14 assertion 5: the submit CHECK was modified'; end if;

  -- Assertion 6 · the warranty note landed and reads as a sentence.
  select count(*) into v_n from public.fms_ocpi_config
   where key = 'warranty_note' and length(value->>'text') > 20;
  if v_n <> 1 then raise exception 'OCPI-14 assertion 6: warranty_note missing or empty'; end if;

  -- Assertion 7 · NOTHING READS THE NEW COLUMNS YET. If a write RPC already
  -- mentioned one, this file would not be additive and Phase 2 could not be
  -- applied on its own.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fms_ocpi_write_quotation', 'fms_ocpi_write_oc', 'fms_ocpi_save_draft')
     and (pg_get_functiondef(p.oid) like '%machine_category_id%'
       or pg_get_functiondef(p.oid) like '%shows_dryer%'
       or pg_get_functiondef(p.oid) like '%incl_centering%');
  if v_n <> 0 then raise exception 'OCPI-14 assertion 7: a write RPC already reads a Phase 1 column'; end if;
end $check$;

commit;
