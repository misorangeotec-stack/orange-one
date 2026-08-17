-- ===========================================================================
-- CENTRAL MASTERS — the company keeps Tally's real name, and gains an ALIAS.
--
-- WHY THIS REVERSES PART OF 20260902120200
--   That migration made mst_companies.name a curated short label ("O-tec") and
--   pushed Tally's real name into tally_name, on the reasoning that Tally's
--   strings are unusable in a picker. Half right. Hiding the real name also
--   means the Masters screen cannot answer the question an admin actually asks
--   of it — "which Tally company IS this row?" — without opening the edit form.
--
--   Both are wanted, so both get a column of their own:
--
--     name   TALLY'S REAL COMPANY NAME, as it stands in Tally right now.
--            "ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27)".
--            Tally-owned: the sync overwrites it, including in April when the
--            new financial-year book opens and the string changes.
--
--     alias  THE SHORT NAME EVERY FMS SHOWS. "O-tec". Portal-owned; no sync
--            ever touches it. This is what a picker, an order header, a gate
--            pass and a report render.
--
--     location  Surat / Noida. Portal-owned, seeded from the mirror's curated
--            ext_company_map, because Tally models one legal entity as separate
--            company files per site and only encodes the site inside the name.
--
--   The alias is the stable thing. A financial-year rollover rewrites `name`
--   and leaves every screen in the portal reading exactly as it did before.
--
-- THE SWAP
--   The five existing rows already hold the curated label in `name` and the real
--   Tally string in `tally_name`. This moves each to its new home rather than
--   re-deriving anything: alias <- name, name <- tally_name. No row is created or
--   deleted, and no id changes, so mst_parties.company_id and every FK stay valid.
--
-- tally_name is KEPT and now mirrors `name`. Dropping a column that shipped
-- hours ago buys nothing and would break any query already written against it;
-- it is documented as deprecated instead.
--
-- Reversal:
--   update public.mst_companies set name = alias where alias is not null;
--   alter table public.mst_companies drop column if exists alias;
--   drop index if exists public.mst_companies_alias_location_key;
-- ===========================================================================

alter table public.mst_companies
  add column if not exists alias text;

-- ⚠ ORDER MATTERS AND THIS RUNS ONCE. Guarded on alias is null so a re-run
--   cannot swap the columns a second time and leave every alias holding the
--   FY-suffixed Tally string.
update public.mst_companies
   set alias = name,
       name  = coalesce(nullif(trim(tally_name), ''), name)
 where alias is null;

comment on column public.mst_companies.name is
  'TALLY-OWNED. The real company name as it stands in Tally, financial year and all ("ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27)"). Overwritten by every sync. Shown on the Masters screen so an admin can see which Tally book a row is; NOT what the FMS render - that is alias.';

comment on column public.mst_companies.alias is
  'PORTAL-OWNED, AND THE NAME EVERY FMS SHOWS. The short human label ("O-tec", "Colorix"). No sync ever writes it, so an April financial-year rollover rewrites `name` and leaves every picker, order header, gate pass and report reading exactly as before.';

comment on column public.mst_companies.tally_name is
  'DEPRECATED as of 20260902120600 - now duplicates `name`. Kept, not dropped: it shipped the same day and dropping it would break anything already reading it.';

-- Uniqueness moves to the alias, because the alias is now the identifying label
-- a human picks from. Enterprise-Surat and Enterprise-Noida stay two rows;
-- two rows for Enterprise-Surat are a bug.
--
-- Partial, so rows that have not been given an alias yet cannot collide on NULL.
drop index if exists public.mst_companies_name_location_key;
create unique index if not exists mst_companies_alias_location_key
  on public.mst_companies (lower(alias), lower(coalesce(location, '')))
  where alias is not null;


-- ============================================================== asserts ====

do $check$
declare
  v_bad text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='mst_companies' and column_name='alias') then
    raise exception 'company alias: the alias column was not added';
  end if;

  -- Every existing row must have come out of the swap with both halves filled.
  select string_agg(coalesce(alias, '(null alias)') || ' / ' || coalesce(name, '(null name)'), ', ')
    into v_bad
    from public.mst_companies
   where alias is null or name is null;
  if v_bad is not null then
    raise exception 'company alias: row(s) left half-migrated: %', v_bad;
  end if;

  -- The swap must have happened, not been skipped: no alias should still be
  -- carrying an FY-suffixed Tally string, and no name should be a bare label.
  if exists (select 1 from public.mst_companies where alias ilike '%ORANGE O TEC%'
                                                   or alias ilike '%(from %'
                                                   or alias ilike '%F.Y.%') then
    raise exception 'company alias: an alias still holds the raw Tally company name - the swap ran twice or backwards';
  end if;

  if to_regclass('public.mst_companies_alias_location_key') is null then
    raise exception 'company alias: (alias, location) uniqueness was not created';
  end if;
end $check$;
