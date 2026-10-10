-- =============================================================================
--  Gate pass · a lot's EXPIRY DATE, typed where Tally has none
-- =============================================================================
--
--  The gate pass now prints PARTICULARS | LOT NO. | EXPIRY DATE | QTY. The lot is
--  already on every dispatch line (OD-15). The expiry is read from Tally first
--  (ConnectWave `rpt_batch_line.batch_expiry_raw`), but Tally carries one on only
--  a small share of lots, so the store keeper may type it at Check Material Status.
--
--  ⚠ KEYED BY ITEM + LOT, NOT BY SHIPMENT. An expiry belongs to the lot: the same
--    lot shipped on three orders has one expiry, typed once. That is also why no
--    existing lot RPC (apply_ship_lines / archive_round / amend_round) is touched —
--    the gate pass joins this table at print time.
--
--  ⚠ TALLY STILL WINS. The print uses Tally's date when Tally has one; a row here
--    only fills the gap. Correcting Tally is the accountant's job, not this table's.
-- =============================================================================

begin;

create table if not exists public.fms_dispatch_lot_expiry (
  item_id     uuid not null,
  -- Stored as typed (trimmed); matched case-insensitively through lot_key.
  lot_no      text not null,
  lot_key     text generated always as (lower(trim(lot_no))) stored,
  expiry_date date not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid(),
  primary key (item_id, lot_key)
);

alter table public.fms_dispatch_lot_expiry enable row level security;

-- A lot's expiry is not sensitive; anyone signed in may read it, which is what
-- lets every person who can reprint a gate pass get the same slip.
drop policy if exists fms_dispatch_lot_expiry_select on public.fms_dispatch_lot_expiry;
create policy fms_dispatch_lot_expiry_select
  on public.fms_dispatch_lot_expiry for select to authenticated using (true);

-- Writes go through the function below only (no insert/update policy).

-- -----------------------------------------------------------------------------
--  Save / clear expiries for one order's lots.
--
--  p_rows = [{ "item_id": uuid, "lot_no": text, "expiry": "YYYY-MM-DD" | null }]
--  A null expiry clears the typed date. Allowed for whoever may act on Check
--  Material Status or Gate Outward for THIS order (fms_dispatch_can_act already
--  lets admins and coordinators through).
-- -----------------------------------------------------------------------------
create or replace function public.fms_dispatch_set_lot_expiry(p_order uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r jsonb;
  v_lot text;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;
  if not (public.fms_dispatch_can_act('material_status', p_order, v_uid)
          or public.fms_dispatch_can_act('gate_out', p_order, v_uid)) then
    raise exception 'Only an owner of Check Material Status or Gate Outward can record a lot''s expiry.';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_lot := trim(coalesce(r->>'lot_no', ''));
    continue when v_lot = '' or (r->>'item_id') is null;

    -- Only items that are actually on this order — the check above is per order,
    -- so it must not become a licence to write any item's lots.
    if not exists (select 1 from public.fms_dispatch_order_items li
                    where li.order_id = p_order and li.item_id = (r->>'item_id')::uuid) then
      raise exception 'Item % is not on this order.', r->>'item_id';
    end if;

    if nullif(r->>'expiry', '') is null then
      delete from public.fms_dispatch_lot_expiry
       where item_id = (r->>'item_id')::uuid and lot_key = lower(v_lot);
    else
      insert into public.fms_dispatch_lot_expiry (item_id, lot_no, expiry_date, updated_at, updated_by)
      values ((r->>'item_id')::uuid, v_lot, (r->>'expiry')::date, now(), v_uid)
      on conflict (item_id, lot_key) do update
        set lot_no = excluded.lot_no,
            expiry_date = excluded.expiry_date,
            updated_at = now(),
            updated_by = v_uid;
    end if;
  end loop;
end $$;

revoke all on function public.fms_dispatch_set_lot_expiry(uuid, jsonb) from public;
grant execute on function public.fms_dispatch_set_lot_expiry(uuid, jsonb) to authenticated;

commit;
