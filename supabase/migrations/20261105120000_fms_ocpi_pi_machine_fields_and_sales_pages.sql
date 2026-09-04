-- OCPI-36 · Stage 2 — what the Performa Invoice needs from the machine master.
--
-- Nothing here is read by a renderer yet, which is why it lands before the
-- renderer rather than with it: applied on its own it changes no document.
--
-- ── 1 · THREE OPTIONAL COLUMNS ON THE MACHINE ──────────────────────────────
--
-- The PI's description cell can carry an HSN code, a manufacturer and a country
-- of origin. None of the three has ever had a column anywhere in this module.
--
-- 🔴 EMPTY MEANS *OMIT* FOR THESE THREE, WHICH IS THE OPPOSITE OF EVERY OTHER
--    UNANSWERED VALUE IN THIS MODULE. `tokens.ts` renders an unresolved token as
--    a ruled underscore run on purpose, because there the gap is a thing somebody
--    must fill in before the paper goes out. Here the gap is CORRECT: a
--    Surat-built Homer K24 has no country of origin to state, and printing
--    "Country of Origin: ________" on a domestic invoice would be inventing a
--    question nobody asked.
--
--    The live papers say so plainly. Of 34 real PI files in the two source
--    folders, 4 carry an HSN code, 2 a country of origin, 1 a manufacturer, and
--    30 carry none of the three. Every one that does is an IMPORTED machine —
--    the K64 (`HSN CODE: 84433910`, `MFG: HAN GLORY (HONG KONG) LIMITED`,
--    `Country of Origin: HONG KONG , CHINA`) — and never a Surat-built one.
--
--    Write that reason next to the renderer too, or the next person makes it
--    consistent with the rest of the module and puts three blanks on every
--    domestic invoice.
--
-- ── 2 · THE SALES PAGE, STORED PER FAMILY ──────────────────────────────────
--
-- Page 2 of a machine PI is per-machine marketing copy — a heading, a tagline, a
-- paragraph and bulleted advantages. Twelve of these already exist inside the
-- real PIs and are lifted out verbatim in Stage 3; they are NOT authored here.
--
-- ⚠ THE UNIT IS THE FAMILY, NOT THE MACHINE, and that is why this is a table
--   with a foreign key rather than columns on `fms_ocpi_machines`. One
--   `Key Benefits of Alpha II` page serves the 1.8 m, 1.9 m and 2.2 m models;
--   one `KoloRado ALPHA III` page serves the 8-, 16- and 24-head Alpha 3.2s.
--   Copying the same body onto each machine would mean three places to correct
--   when the copy changes, and they would not stay in step.
--
-- ⚠ `blocks` IS AN ORDERED LIST, NOT A FIXED SET OF FIELDS. The twelve real
--   pages do not share one shape: folder 127's Alpha II page is
--   tagline → paragraph → "Advantages" → bullets, while folder 120's K64 page
--   interleaves bullet groups with two prose paragraphs. A rigid
--   {tagline, intro, bullets[]} record would have forced an editor to rewrite
--   the K64 page to fit it — and rewriting is exactly what this task must not do.
--   Each entry is {kind: tagline|para|subhead|bullet, text}.
--
-- ⚠ NULLABLE AND UNMAPPED IS A NORMAL STATE. Seven machines have no page and no
--   answer yet (MP5000, JPK, Mini Lario, Kolorado Alpha 16, Foil Machine, Label
--   Printer, Book Printer), plus Fab Pro 1I / 3I and P8D awaiting confirmation.
--   The PI renders the 2-page form for those, and must never print a blank page.
--
-- ⚠ ADDITIVE ONLY. New nullable columns and one new table; nothing is dropped,
--   mutated or backfilled.

/* ── 1 · the three machine columns ─────────────────────────────────────────── */
alter table public.fms_ocpi_machines
  add column if not exists hsn_code          text,
  add column if not exists manufacturer      text,
  add column if not exists country_of_origin text;

comment on column public.fms_ocpi_machines.hsn_code is
  'OCPI-36 - HSN code, printed on the Performa Invoice description cell. NULL means omit the line entirely: only imported machines carry one (4 of 34 real PIs).';
comment on column public.fms_ocpi_machines.manufacturer is
  'OCPI-36 - OEM name, printed as "MFG: ..." on the Performa Invoice. NULL means omit the line.';
comment on column public.fms_ocpi_machines.country_of_origin is
  'OCPI-36 - printed as "Country of Origin: ..." on the Performa Invoice and in its Terms. NULL means omit; a Surat-built machine has none to state.';

/* ── 2 · the sales pages ───────────────────────────────────────────────────── */
create table if not exists public.fms_ocpi_sales_pages (
  id         uuid primary key default gen_random_uuid(),
  -- The FAMILY this page belongs to, for the picker: "Alpha II", "Homer K24".
  name       text not null,
  -- The heading EXACTLY as the real paper prints it. Eight read "Key Benefits
  -- of ...", four read "Advantages of ..." — keying on the phrase is what made
  -- the first sweep of this entry miss Pengda, Alpha 15 and Fab Pro entirely.
  heading    text not null,
  blocks     jsonb not null default '[]'::jsonb,
  active     boolean not null default true,
  sort_order integer not null default 500,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fms_ocpi_sales_pages is
  'OCPI-36 - page 2 of a machine Performa Invoice, stored per machine FAMILY. Bodies are lifted verbatim from the real PIs, never authored here.';

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.fms_ocpi_sales_pages'::regclass
       and tgname  = 'trg_fms_ocpi_sales_pages_updated'
  ) then
    create trigger trg_fms_ocpi_sales_pages_updated
      before update on public.fms_ocpi_sales_pages
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.fms_ocpi_sales_pages enable row level security;

/*
  ⚠ THE POLICIES MIRROR `fms_ocpi_machines` EXACTLY, because this is part of the
    machine master and is governed by whoever governs machines. Readable by any
    signed-in user (a salesperson's PI preview has to resolve it); written by an
    administrator or the machine master's owner.
*/
drop policy if exists fms_ocpi_sales_pages_select on public.fms_ocpi_sales_pages;
create policy fms_ocpi_sales_pages_select
  on public.fms_ocpi_sales_pages for select
  using (true);

drop policy if exists fms_ocpi_sales_pages_write on public.fms_ocpi_sales_pages;
create policy fms_ocpi_sales_pages_write
  on public.fms_ocpi_sales_pages for all
  using (
    (select public.is_admin((select auth.uid())))
    or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid())))
  )
  with check (
    (select public.is_admin((select auth.uid())))
    or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid())))
  );

/* ── 3 · the machine points at its family's page ───────────────────────────── */
alter table public.fms_ocpi_machines
  add column if not exists sales_page_id uuid references public.fms_ocpi_sales_pages(id);

comment on column public.fms_ocpi_machines.sales_page_id is
  'OCPI-36 - which sales page this machine prints as page 2 of its Performa Invoice. Shared across a family. NULL renders the 2-page PI (cover letter + invoice), which is a correct form, not a failure.';

create index if not exists fms_ocpi_machines_sales_page_idx
  on public.fms_ocpi_machines (sales_page_id);
