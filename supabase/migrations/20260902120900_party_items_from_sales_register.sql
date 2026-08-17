-- ===========================================================================
-- CENTRAL MASTERS — the customer-item catalogue, built from what was actually sold.
--
-- WHY FROM THE SALES REGISTER
--   Order to Dispatch has a customer-item mapping (3,183 rows) maintained by
--   hand — it decides which items appear on a customer's sales order. Rebuilding
--   that by hand for 1,838 customers is not realistic, and a hand list drifts
--   from reality the moment a customer starts buying something new.
--
--   The sales register already knows. 20,121 item lines record who bought what,
--   per company, per voucher. A customer having actually bought an item is the
--   strongest possible evidence that they may order it again — better evidence
--   than anyone's memory of the catalogue.
--
-- ⚠ THE REGISTER IS KEYED BY NAME, NOT BY GUID. rpt_sales_register carries
--   `party` and `particulars` as plain strings — it is a report, built for human
--   reading. So the sync resolves each line to a party and an item BY NAME
--   WITHIN ITS COMPANY. A line whose party or item cannot be resolved is
--   counted and skipped, never guessed at; the sync reports how many.
--
-- WHAT THIS MIGRATION ADDS
--   Provenance on mst_party_items, so a row can say where it came from and
--   whether it is still live trade:
--     source        'sales_register' | 'portal'
--     last_sold_on  the most recent date this pair appears on a voucher
--     sale_count    how many voucher lines back it up
--
--   These are what let an admin tell "they buy this every month" from "they
--   bought it once, three years ago" without leaving the master.
--
-- Additive: three nullable columns on a table that is still EMPTY.
--
-- Reversal:
--   alter table public.mst_party_items drop column if exists source;
--   alter table public.mst_party_items drop column if exists last_sold_on;
--   alter table public.mst_party_items drop column if exists sale_count;
-- ===========================================================================

alter table public.mst_party_items
  add column if not exists source text not null default 'portal'
    check (source in ('portal', 'sales_register'));

alter table public.mst_party_items
  add column if not exists last_sold_on date;

alter table public.mst_party_items
  add column if not exists sale_count integer not null default 0;

comment on column public.mst_party_items.source is
  'sales_register = derived from what this party actually bought; portal = added by hand in Masters. A sync only ever touches its own rows.';
comment on column public.mst_party_items.last_sold_on is
  'Most recent voucher date this party-item pair appears on. Null for a hand-added row. This is what separates a live line from one that was bought once, years ago.';
comment on column public.mst_party_items.sale_count is
  'How many sales-register lines back this pair. Evidence strength, not a quantity.';

create index if not exists mst_party_items_last_sold_idx
  on public.mst_party_items (last_sold_on desc nulls last);


do $check$
declare
  v_missing text;
begin
  select string_agg(x.col, ', ') into v_missing
    from (values ('source'), ('last_sold_on'), ('sale_count')) as x(col)
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'mst_party_items' and column_name = x.col);
  if v_missing is not null then
    raise exception 'party items: missing column(s): %', v_missing;
  end if;

  -- The pair must stay unique, or a re-sync would stack duplicates of the same
  -- customer-item line every time it runs.
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.mst_party_items'::regclass and c.contype = 'u'
                    and pg_get_constraintdef(c.oid) = 'UNIQUE (party_id, item_id)') then
    raise exception 'party items: (party_id, item_id) uniqueness is missing - a re-sync would duplicate every row';
  end if;
end $check$;
