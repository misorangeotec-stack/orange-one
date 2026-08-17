-- ===========================================================================
-- CENTRAL MASTERS — an item belongs to a company.
--
-- WHY
--   Items are managed per company: Colorix, Enterprise and O-tec do not carry
--   the same catalogue, and "which company is this item for?" is the first
--   question anyone asks of the item list. mst_parties already answers it —
--   mst_items did not, so the Items tab showed 14,000 rows with no way to tell
--   whose they were.
--
--   Nothing needs to be fetched to fix it. Every synced item already carries
--   tally_tenant ("acct_orange::<company_guid>"), which IS the company. This
--   adds the FK and backfills it from the tenant already on the row.
--
--   Same shape and same reasoning as mst_parties.company_id, deliberately: an
--   item, like a ledger, is a per-company object in Tally, so the same stock
--   item existing under three companies is three rows — not a duplicate to be
--   merged.
--
-- Additive: one nullable column. No row is created or deleted.
--
-- Reversal:
--   alter table public.mst_items drop column if exists company_id;
-- ===========================================================================

alter table public.mst_items
  add column if not exists company_id uuid references public.mst_companies on delete set null;

comment on column public.mst_items.company_id is
  'Which of our companies this item belongs to, derived from the Tally tenant the item was synced from. Refreshed by every sync - an item cannot move between Tally companies, so this is safe to overwrite.';

create index if not exists mst_items_company_idx on public.mst_items (company_id);

-- Backfill from the tenant already stored on each row. split_part twice:
-- "acct_orange::<guid>" and "acct_orange::<guid>~20240401" are the same company,
-- the suffix being a prior-financial-year snapshot.
update public.mst_items i
   set company_id = c.id
  from public.mst_companies c
 where i.company_id is null
   and i.tally_tenant is not null
   and c.tally_guid = split_part(split_part(i.tally_tenant, '::', 2), '~', 1);


do $check$
declare
  v_unlinked bigint;
  v_total    bigint;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='mst_items' and column_name='company_id') then
    raise exception 'item company: the column was not added';
  end if;

  select count(*) filter (where company_id is null and tally_tenant is not null), count(*)
    into v_unlinked, v_total
    from public.mst_items;

  -- Not fatal - a company Tally has but mst_companies does not would leave rows
  -- unlinked, and that is worth SAYING rather than failing the migration over.
  if v_unlinked > 0 then
    raise warning 'item company: % of % Tally-sourced items could not be linked to a company', v_unlinked, v_total;
  end if;
end $check$;
