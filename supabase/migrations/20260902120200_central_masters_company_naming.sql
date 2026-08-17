-- ===========================================================================
-- CENTRAL MASTERS — the company name is PORTAL-owned, not Tally-owned.
--
-- WHY (discovered by reading the live mirror, not assumed)
--
--   1. TALLY COMPANY NAMES ARE UNUSABLE IN A PICKER. They carry the financial
--      year and the date range in the name itself:
--        "ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27)"
--        "ORANGE O TEC ENTERPRISES PRIVATE LIMITED-NOIDA -FY 26-27"
--      20260902120000 marked mst_companies.name as Tally-owned and overwritten
--      on every sync. That would put those strings into every company dropdown
--      in the portal, and change them at the turn of each financial year.
--
--   2. v_company HAS 7 ROWS BUT ONLY 5 DISTINCT company_guid. Tally opens a new
--      company FILE per financial year, so the same company appears once per FY
--      under one guid. mst_companies.tally_guid is unique, so a naive sync would
--      upsert the same row twice per pull and the name would flip-flop between
--      the FY variants forever.
--
--   3. THE CLEAN NAMES ALREADY EXIST, CURATED BY HAND. The mirror carries
--      ext_company_map: company_guid -> (company, location), every row
--      checked = true — Colorix/Surat, Enterprise/Surat, Enterprise/Noida,
--      O-tec/Surat, O-tec/Noida. The receivables app already reads it through
--      lib/companyMap.ts. There is no reason to invent a second naming scheme.
--
--   Hence: `name` becomes portal-owned and is seeded from ext_company_map;
--   `location` joins it (the same name+location shape fms_purchase_companies and
--   fms_import_companies already use, and what distinguishes Noida from Surat);
--   and the raw Tally string is kept in `tally_name` for traceability, so a
--   human can always see which Tally company file a row came from.
--
-- Additive only: two new nullable columns on a table that is still EMPTY. No
-- existing table, column or row is touched.
--
-- Reversal:
--   alter table public.mst_companies drop column if exists tally_name;
--   alter table public.mst_companies drop column if exists location;
--   comment on column public.mst_companies.name is null;
-- ===========================================================================

alter table public.mst_companies
  add column if not exists tally_name text;

alter table public.mst_companies
  add column if not exists location text;

comment on column public.mst_companies.name is
  'PORTAL-OWNED. The clean name a human picked (Colorix, Enterprise, O-tec) - seeded from the mirror''s curated ext_company_map, NOT from Tally. Tally names carry the financial year ("... -FY 26-27") and would rewrite every dropdown each April.';

comment on column public.mst_companies.tally_name is
  'TALLY-OWNED, INFORMATIONAL ONLY. The raw company name of the Tally file this row was last synced from, kept so a human can trace a row back to its source. Never shown in a picker.';

comment on column public.mst_companies.location is
  'PORTAL-OWNED. Surat / Noida. Tally models the same legal entity as separate company files per site, and ext_company_map already curates the split. Same name+location shape fms_purchase_companies and fms_import_companies use.';

-- A company is one (name, location) pair. Enterprise-Surat and Enterprise-Noida
-- are two rows and must stay two rows; two rows for Enterprise-Surat are a bug.
create unique index if not exists mst_companies_name_location_key
  on public.mst_companies (lower(name), lower(coalesce(location, '')));


-- ============================================================== asserts ====

do $check$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='mst_companies'
                    and column_name='tally_name') then
    raise exception 'central masters: mst_companies.tally_name was not added';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='mst_companies'
                    and column_name='location') then
    raise exception 'central masters: mst_companies.location was not added';
  end if;
  if to_regclass('public.mst_companies_name_location_key') is null then
    raise exception 'central masters: the (name, location) uniqueness was not created';
  end if;
  -- tally_guid stays unique: it is still what the sync upserts on, AFTER
  -- deduplicating v_company's per-financial-year rows down to one per guid.
  if not exists (select 1 from pg_constraint c
                  where c.conrelid='public.mst_companies'::regclass and c.contype='u'
                    and pg_get_constraintdef(c.oid)='UNIQUE (tally_guid)') then
    raise exception 'central masters: mst_companies lost its unique tally_guid';
  end if;
end $check$;
