-- ===========================================================================
-- Complaint (RM/FG) FMS — LOT INDEX, CONFLICT KEY FIX (Phase 10a).
--
-- 20261110120900 gave the lot index this unique index:
--
--   create unique index ... on public.fms_complaint_lot_index
--     (tally_company, voucher_no, item_name, batch_name, coalesce(godown, ''));
--
-- which is correct as a CONSTRAINT and useless as an UPSERT TARGET. PostgREST
-- resolves `?on_conflict=a,b,c` against a unique constraint over PLAIN COLUMNS;
-- an expression index does not match, and the extractor fails with
--
--   42P10: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- Caught on the first real run, before any row was written.
--
-- THE FIX: make `godown` NOT NULL DEFAULT '' and key on plain columns. Empty
-- string rather than null is what the index was already pretending with
-- coalesce, so this changes no semantics — it just says it in the column
-- definition where a constraint can use it.
--
-- ⚠ WHY godown IS IN THE KEY AT ALL: one voucher can ship the same item from the
--   same batch out of TWO godowns, as two lines. Dropping it from the key would
--   silently collapse those into one row and lose a shipment.
--
-- The table is minutes old and empty, so there is nothing to migrate.
--
-- Reversal:
--   drop index if exists public.fms_complaint_lot_index_natural_key;
--   alter table public.fms_complaint_lot_index alter column godown drop not null,
--                                              alter column godown drop default;
--   create unique index fms_complaint_lot_index_natural_key
--     on public.fms_complaint_lot_index
--        (tally_company, voucher_no, item_name, batch_name, coalesce(godown, ''));
-- ===========================================================================

begin;

-- Any row that slipped in before the fix (there should be none).
update public.fms_complaint_lot_index set godown = '' where godown is null;

alter table public.fms_complaint_lot_index
  alter column godown set default '',
  alter column godown set not null;

comment on column public.fms_complaint_lot_index.godown is
  'Tally godown for this batch allocation. NOT NULL DEFAULT '''' so it can sit in the plain-column unique key an upsert targets; empty string means Tally named none.';

drop index if exists public.fms_complaint_lot_index_natural_key;

create unique index fms_complaint_lot_index_natural_key
  on public.fms_complaint_lot_index
     (tally_company, voucher_no, item_name, batch_name, godown);

do $mig$
begin
  -- The upsert target must be a plain-column unique index, or the extractor 42P10s.
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where c.relname = 'fms_complaint_lot_index_natural_key'
       and i.indisunique
       and i.indexprs is null      -- ⚠ THE WHOLE POINT: no expressions
  ) then
    raise exception 'Complaint: the lot index natural key is not a plain-column unique index';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'fms_complaint_lot_index'
       and column_name = 'godown' and is_nullable = 'YES'
  ) then
    raise exception 'Complaint: lot_index.godown must be NOT NULL to sit in the conflict key';
  end if;
end $mig$;

commit;
