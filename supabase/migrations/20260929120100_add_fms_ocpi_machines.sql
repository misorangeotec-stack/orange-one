-- ===========================================================================
-- OCPI FMS — THE MACHINE MASTER, which is also the order-confirmation TEMPLATE.
--
-- WHY ONE TABLE AND NOT TWO
--   The obvious design is "a model dropdown, plus a template keyed on the model
--   name". It does not survive contact with the source material. The Microsoft
--   form offers 25 model options; the folder holds 11 PowerPoint decks; and the
--   two vocabularies do not line up:
--
--     · "Alpha 2 - 8 Heads machine" is ONE form option but THREE decks —
--       KoloRado Alpha II at 1.8 m, at 1.9 m (whose model is actually OT-1908A)
--       and at 2.2 m. The form has no width dimension, so the option is
--       ambiguous and no key can disambiguate it.
--     · "Pengda - 1700XD-800" and "Pengda - 1800XD-800" match NOTHING. The only
--       Pengda deck is PD-1700XD-1000, and `PENGDA 800 DIA.pptx` is an unedited
--       COPY of the 1000 deck — diffing them leaves three differences, all
--       blank-fill artifacts. There are 10 real templates, not 11.
--     · 15 further form options have no deck at all.
--
--   So the master IS the model list: the quotation dropdown reads it, and the
--   template hangs off the same row. The ambiguity disappears by construction,
--   and "Alpha 2 - 8 Heads" becomes three distinct, selectable machines.
--
-- ⚠ SPEC ROWS AND SECTION BODIES CARRY TOKENS, because the template text is not
--   constant. A real submission raised a K32 — whose deck prints "Number of
--   installed printing heads: 32" — with SIXTEEN heads. So a spec row is
--   `{"label":"Number of installed printing heads","value":"{{head_count}}"}`
--   and the deal supplies the number. Tokens resolved at render:
--     {{head_count}} {{machine_warranty_months}} {{head_warranty_months}}
--     {{post_warranty_head_price}} {{dryer_warranty}} {{consumables_supplier}}
--     {{quotation_validity_days}} {{ex_works_city}} {{bank_block}}
--   An UNRESOLVED token must render as a ruled blank, never as literal {{…}}.
--
-- ⚠ SECTIONS ARE OWNED PER MACHINE, NOT SHARED. A single global library keyed on
--   a section key would be wrong: the print-head clause exists in three
--   different wordings (K24/K32 "After 18 months … @ INR ____ plus GST", P8D
--   "19th Month onwards … INR ____ +GST", P8S the same PLUS "+ freight"), the
--   Alpha decks' warranty differs in SUBSTANCE (onsite, "no AMC if the customer
--   uses Orange ink", a named consumables supplier, 20-24 °C against the Homer
--   decks' 22-28 °C), and Pengda has no print-head policy at all. Hence
--   fms_ocpi_machine_sections is a child of the machine.
--
-- ⚠ THE SEED IS A SEPARATE MIGRATION and a separate phase of work. Transcribing
--   ten decks of dense legal boilerplate must be done FROM POWERPOINT — reading
--   the PPTX XML gives shape order, not reading order, and two decks split runs
--   mid-word, which is exactly how an earlier pass wrongly concluded they were
--   abbreviated templates. See OCPI.md phase 3.
--
-- A machine with has_template = false is selectable on a QUOTATION but blocks at
-- the order-confirmation step with a message naming what is missing. That is how
-- the 15 uncovered models surface as a task instead of a crash.
--
-- Purely ADDITIVE. Two new tables.
--
-- Reversal (reverse order):
--   drop table if exists public.fms_ocpi_machine_sections;
--   drop table if exists public.fms_ocpi_machines;
-- ===========================================================================

begin;

-- ===========================================================================
-- fms_ocpi_machines — the model list AND the document template.
-- Carries the MasterCrud contract columns: id / name / active / sort_order.
-- Nothing is hard-deleted; rows are deactivated, so a historic deal's machine
-- can never be orphaned (hence `on delete restrict` from fms_ocpi_deals).
-- ===========================================================================
create table if not exists public.fms_ocpi_machines (
  id                  uuid primary key default gen_random_uuid(),

  -- What the quotation dropdown shows, e.g. 'KoloRado Alpha II - 2.2 m, 8 heads'.
  name                text not null unique,

  -- The heading the order confirmation prints. P8D genuinely says OFFER QUOTE.
  doc_title           text not null default 'ORDER CONFIRMATION'
                        check (doc_title in ('ORDER CONFIRMATION', 'OFFER QUOTE')),

  -- 'Following up your kind order, we are glad to confirm the supply of …'
  intro_text          text,

  -- The manufacturer's code printed against the supply line, e.g. HM1800B-TK24.
  machine_model_no    text,

  -- The one priced line: 'LARGE FORMAT INKJET PRINTER WITH STANDARD ACCESSORIES
  -- WITH {{head_count}} PRINT HEADS AND CHINESE DRYER'. Verified across all ten
  -- decks: there is never a multi-line price table, only this line plus
  -- Machine Value / +GST / Total.
  supply_description  text,

  -- Ordered [{label, value}] for the page-1 specification table. Labels differ
  -- per family ('Max. Fabric width' vs 'Max. Media width' vs 'Drum Diameter').
  spec_rows           jsonb not null default '[]'::jsonb,

  -- Ordered strings for 'THE MACHINE IS COMPOSED AS FOLLOWS'.
  composition         jsonb not null default '[]'::jsonb,

  -- Which of Attn / Date / Ref / Address the header prints. K24 has no Ref.
  header_fields       jsonb not null default '["attn","date","ref","address"]'::jsonb,

  -- The Alpha decks close 'PREPARED By / CHECKED By'; Homer and P8 close
  -- 'Prepared By / Approved By'. Whether that is a real distinction or drift is
  -- an open question for Bushra (OCPI.md); until answered, it is data.
  signoff_style       text not null default 'approved_by'
                        check (signoff_style in ('approved_by', 'checked_by')),

  -- False ⇒ quotable, but the order-confirmation step is blocked.
  has_template        boolean not null default false,

  active              boolean not null default true,
  sort_order          integer not null default 0,
  created_by          uuid references auth.users on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.fms_ocpi_machines is
  'Every printing machine OCPI can quote, and the order-confirmation template for it. This IS the model dropdown: the Microsoft form''s 25 options and the 10 real PowerPoint templates are different vocabularies, so nothing else can be the key. See the migration header.';

comment on column public.fms_ocpi_machines.spec_rows is
  'Ordered [{"label":"…","value":"…"}] for the page-1 spec table. Values may carry tokens — {{head_count}} in particular, because a K32 can be sold with 16 heads.';
comment on column public.fms_ocpi_machines.has_template is
  'False ⇒ this model may be quoted but has no order-confirmation template yet; the OC step blocks and names it. 15 of the form''s models are in this state.';

create index if not exists fms_ocpi_machines_active_idx on public.fms_ocpi_machines (active, sort_order);

drop trigger if exists trg_fms_ocpi_machines_updated on public.fms_ocpi_machines;
create trigger trg_fms_ocpi_machines_updated
  before update on public.fms_ocpi_machines
  for each row execute function public.set_updated_at();

alter table public.fms_ocpi_machines enable row level security;

-- Select = every signed-in user (dropdown fodder). Write = admin.
drop policy if exists fms_ocpi_machines_select on public.fms_ocpi_machines;
create policy fms_ocpi_machines_select on public.fms_ocpi_machines
  for select to authenticated using (true);

drop policy if exists fms_ocpi_machines_write on public.fms_ocpi_machines;
create policy fms_ocpi_machines_write on public.fms_ocpi_machines
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

-- ===========================================================================
-- fms_ocpi_machine_sections — the ordered boilerplate for ONE machine.
--
-- `key` is a stable handle for the same clause across machines (so a reader can
-- compare 'print_head_policy' between K24 and P8S) but it is NOT unique on its
-- own — the body belongs to the machine, and that is the whole point.
-- ===========================================================================
create table if not exists public.fms_ocpi_machine_sections (
  id          uuid primary key default gen_random_uuid(),
  machine_id  uuid not null references public.fms_ocpi_machines on delete cascade,

  -- e.g. 'installation', 'not_included', 'delivery_scope', 'pc_spec',
  --      'machine_warranty', 'print_head_policy', 'customer_care',
  --      'cancellation', 'delivery_terms', 'bank_details'.
  key         text not null,
  title       text not null,
  body        text not null default '',
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (machine_id, key)
);

comment on table public.fms_ocpi_machine_sections is
  'The order-confirmation boilerplate for one machine, in print order. Owned per machine because the wording genuinely differs — see the fms_ocpi_machines migration header.';

create index if not exists fms_ocpi_machine_sections_machine_idx
  on public.fms_ocpi_machine_sections (machine_id, sort_order);

drop trigger if exists trg_fms_ocpi_machine_sections_updated on public.fms_ocpi_machine_sections;
create trigger trg_fms_ocpi_machine_sections_updated
  before update on public.fms_ocpi_machine_sections
  for each row execute function public.set_updated_at();

alter table public.fms_ocpi_machine_sections enable row level security;

drop policy if exists fms_ocpi_machine_sections_select on public.fms_ocpi_machine_sections;
create policy fms_ocpi_machine_sections_select on public.fms_ocpi_machine_sections
  for select to authenticated using (true);

drop policy if exists fms_ocpi_machine_sections_write on public.fms_ocpi_machine_sections;
create policy fms_ocpi_machine_sections_write on public.fms_ocpi_machine_sections
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

commit;
