-- ===========================================================================
-- Purchase RM Domestic + Purchase RM Import — an ITEM now hangs off a CATEGORY.
--
-- Both apps modelled masters in three levels: Category -> Item Group -> Item.
-- The middle level never earned its keep:
--
--   * The New Request grid only ever asked for Category -> Item. Item Group
--     appears NOWHERE in the request -> PO -> GRN -> QC -> Tally flow; it lived
--     only on the Masters page.
--   * Because of that, "Request a new item" had to FAKE a group: the frontend
--     filed the new item under whichever group happened to be first in the
--     chosen category, and hard-blocked ("Pick a category with at least one item
--     group first") when the category had none.
--   * Yet the request modal still asked the requester to pick an Item Group — a
--     level they never see anywhere else.
--
-- So: items get their own category_id, and the Item Group master is retired
-- from the UI. Both fms_*_item_groups tables and every row in them are LEFT
-- ALONE (additive-only, per the repo rule), and the resolve RPCs keep their
-- 'item_group' branch so any legacy pending request still approves cleanly.
--
-- ⚠ THE ONE DESTRUCTIVE TRAP THIS MIGRATION DEFUSES
--   fms_*_items.item_group_id was declared
--       references fms_*_item_groups ON DELETE CASCADE
--   With Item Groups retired, the natural next step is to clear that master —
--   which would silently CASCADE-DELETE EVERY ITEM, and with them every
--   vendor-item price. Section 3 re-points that FK to ON DELETE SET NULL before
--   anyone can do that. No row is modified; only the constraint changes.
--
-- ⚠ WIRE CONTRACT (section 6)
--   fms_*_master_requests.proposed_payload is a jsonb blob whose keys come from
--   the frontend's lib/masterFields.ts, and the resolve RPCs are the ONLY thing
--   that reads them. The 'item' descriptor changes its parent key from
--   item_group_id -> category_id in the same commit as this migration; if the
--   two ever drift, an approved item lands with a null parent and NO error is
--   raised anywhere.
--
-- NOT changed, deliberately:
--   * fms_*_master_requests_pending_uniq — already coalesces category_id FIRST
--     (proposed_payload->>'category_id', ->>'item_group_id', ->>'vendor_id'),
--     so an item payload keyed on category_id slots straight in. Asserted at the
--     tail rather than rebuilt.
--   * RLS on fms_*_items — its write policy gates on is_master_manager('item'),
--     never on 'item_group'. Untouched.
--   * fms_*_items_group_idx and the unique (item_group_id, name) constraint —
--     both stay valid; with NULL group ids the unique is simply inert.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The new parent column
-- ---------------------------------------------------------------------------
alter table public.fms_purchase_items
  add column if not exists category_id uuid references public.fms_purchase_categories on delete cascade;

alter table public.fms_import_items
  add column if not exists category_id uuid references public.fms_import_categories on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. Backfill from the group each item currently sits in
-- ---------------------------------------------------------------------------
update public.fms_purchase_items i
   set category_id = g.category_id
  from public.fms_purchase_item_groups g
 where g.id = i.item_group_id
   and i.category_id is null;

update public.fms_import_items i
   set category_id = g.category_id
  from public.fms_import_item_groups g
 where g.id = i.item_group_id
   and i.category_id is null;

-- ---------------------------------------------------------------------------
-- 3. Defuse the cascade, then let the old parent go null
--
-- Constraint-only change: dropping and re-adding the FK with a different
-- ON DELETE action rewrites no data. Every existing item_group_id value stays
-- exactly as it is. New items simply never set it.
-- ---------------------------------------------------------------------------
alter table public.fms_purchase_items
  drop constraint if exists fms_purchase_items_item_group_id_fkey;
alter table public.fms_purchase_items
  add  constraint fms_purchase_items_item_group_id_fkey
       foreign key (item_group_id) references public.fms_purchase_item_groups on delete set null;
alter table public.fms_purchase_items
  alter column item_group_id drop not null;

alter table public.fms_import_items
  drop constraint if exists fms_import_items_item_group_id_fkey;
alter table public.fms_import_items
  add  constraint fms_import_items_item_group_id_fkey
       foreign key (item_group_id) references public.fms_import_item_groups on delete set null;
alter table public.fms_import_items
  alter column item_group_id drop not null;

-- ---------------------------------------------------------------------------
-- 3b. De-collide the DEACTIVATED leftovers
--
-- Two groups inside one category could each hold an item of the same name —
-- legal under unique (item_group_id, name), illegal under the new
-- unique (category_id, name). On the live DB this hit exactly two pairs, both in
-- the purchase INK category:
--
--   REACTIVE INK H-SERIES BLACK      | Hanglory INK (off, 10-07) vs REACTIVE H SERIES (on, 11-07)
--   REACTIVE INK H-SERIES H6K BLACK  | Hanglory INK (off, 10-07) vs REACTIVE H SERIES (on, 11-07)
--
-- i.e. the same ink entered twice, the older copy already switched off and used
-- by zero requests and zero vendor rates. Rather than delete anything, the
-- DEACTIVATED side of a collision keeps its row and takes its old group name as
-- a suffix. Approved by the user for exactly this case.
--
-- Deliberately narrow: `active = false` only. Two ACTIVE rows colliding is not
-- something to resolve silently — section 4 still aborts loudly on that.
-- Idempotent: once renamed, the row no longer matches the exists() clause.
-- ---------------------------------------------------------------------------
update public.fms_purchase_items i
   set name = i.name || ' (' || g.name || ')'
  from public.fms_purchase_item_groups g
 where g.id = i.item_group_id
   and i.active = false
   and exists (
     select 1 from public.fms_purchase_items o
      where o.category_id = i.category_id and o.name = i.name and o.id <> i.id
   );

update public.fms_import_items i
   set name = i.name || ' (' || g.name || ')'
  from public.fms_import_item_groups g
 where g.id = i.item_group_id
   and i.active = false
   and exists (
     select 1 from public.fms_import_items o
      where o.category_id = i.category_id and o.name = i.name and o.id <> i.id
   );

-- ---------------------------------------------------------------------------
-- 4. Guard BEFORE constraining
--
-- Two groups inside one category could each hold an item of the same name —
-- legal under unique (item_group_id, name), illegal under the new
-- unique (category_id, name). Rather than silently merging or dropping either
-- row, name the offenders and abort the whole migration so a human renames them
-- in Masters and re-runs. Same for anything that failed to backfill.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- 4a. items that could not resolve a category (an orphaned group id)
  select string_agg(format('%s (id %s)', name, id), ', ')
    into v_bad
  from public.fms_purchase_items where category_id is null;
  if v_bad is not null then
    raise exception 'fms_purchase_items: % could not be matched to a category. Fix or delete these, then re-run.', v_bad;
  end if;

  select string_agg(format('%s (id %s)', name, id), ', ')
    into v_bad
  from public.fms_import_items where category_id is null;
  if v_bad is not null then
    raise exception 'fms_import_items: % could not be matched to a category. Fix or delete these, then re-run.', v_bad;
  end if;

  -- 4b. names that would collide once the group level is gone
  select string_agg(format('%s -> "%s" (x%s)', cat, nm, n), '; ')
    into v_bad
  from (
    select c.name as cat, i.name as nm, count(*) as n
      from public.fms_purchase_items i
      join public.fms_purchase_categories c on c.id = i.category_id
     group by c.name, i.name
    having count(*) > 1
  ) d;
  if v_bad is not null then
    raise exception 'fms_purchase_items: these item names repeat inside one category — %. Rename them in Masters, then re-run.', v_bad;
  end if;

  select string_agg(format('%s -> "%s" (x%s)', cat, nm, n), '; ')
    into v_bad
  from (
    select c.name as cat, i.name as nm, count(*) as n
      from public.fms_import_items i
      join public.fms_import_categories c on c.id = i.category_id
     group by c.name, i.name
    having count(*) > 1
  ) d;
  if v_bad is not null then
    raise exception 'fms_import_items: these item names repeat inside one category — %. Rename them in Masters, then re-run.', v_bad;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Now constrain + index, mirroring what item_group_id had
-- ---------------------------------------------------------------------------
alter table public.fms_purchase_items alter column category_id set not null;
alter table public.fms_import_items   alter column category_id set not null;

create unique index if not exists fms_purchase_items_cat_name_uniq
  on public.fms_purchase_items (category_id, name);
create unique index if not exists fms_import_items_cat_name_uniq
  on public.fms_import_items (category_id, name);

create index if not exists fms_purchase_items_cat_idx
  on public.fms_purchase_items (category_id);
create index if not exists fms_import_items_cat_idx
  on public.fms_import_items (category_id);

-- ---------------------------------------------------------------------------
-- 6. Resolve RPCs — the 'item' branch inserts category_id
--
-- Both bodies are carried forward VERBATIM from their live definitions
-- (purchase: 20260720120000; import: 20260719120000). The ONLY edit in each is
-- the elsif v_type = 'item' branch. The 'item_group' branch is deliberately
-- kept — legacy pending item_group requests must still resolve.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_type      text;
  v_status    text;
  v_payload   jsonb;
  v_new_id    uuid;
begin
  -- Lock the request; capture its type + current status.
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_purchase_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;

  -- Authorization: admin or the assigned manager of this master type.
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  -- Use the (optionally edited) payload provided by the approver, else the original.
  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    if v_type = 'vendor' then
      insert into public.fms_purchase_vendors (name, gstin, contact_name, phone, email, address, created_by)
      values (
        nullif(v_payload->>'name',''), v_payload->>'gstin', v_payload->>'contact_name',
        v_payload->>'phone', v_payload->>'email', v_payload->>'address', auth.uid()
      )
      returning id into v_new_id;
    elsif v_type = 'category' then
      insert into public.fms_purchase_categories (name, created_by)
      values (nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item_group' then
      -- Retired from the UI, kept here so legacy pending requests still resolve.
      insert into public.fms_purchase_item_groups (category_id, name, created_by)
      values ((v_payload->>'category_id')::uuid, nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item' then
      -- CHANGED: an item hangs off a category now, not an item group.
      insert into public.fms_purchase_items (category_id, name, unit, created_by)
      values ((v_payload->>'category_id')::uuid, nullif(v_payload->>'name',''), coalesce(v_payload->>'unit',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'company' then
      insert into public.fms_purchase_companies (name, location, created_by)
      values (nullif(v_payload->>'name',''), v_payload->>'location', auth.uid())
      returning id into v_new_id;
    elsif v_type = 'vendor_item_price' then
      insert into public.fms_purchase_vendor_item_prices (vendor_id, item_id, rate, gst_pct, lead_time_days, created_by)
      values (
        (v_payload->>'vendor_id')::uuid,
        (v_payload->>'item_id')::uuid,
        coalesce(nullif(v_payload->>'rate','')::numeric, 0),
        nullif(v_payload->>'gst_pct','')::numeric,
        nullif(v_payload->>'lead_time_days','')::integer,
        auth.uid()
      )
      returning id into v_new_id;
    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_purchase_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_purchase_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $function$;

grant execute on function public.fms_purchase_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

create or replace function public.fms_import_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null::jsonb,
  p_note       text  default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_new_id  uuid;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_import_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;
  if not (public.is_admin(auth.uid()) or public.fms_import_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    if v_type = 'vendor' then
      insert into public.fms_import_vendors (name, gstin, contact_name, phone, email, address, default_currency, created_by)
      values (
        nullif(v_payload->>'name',''), null, v_payload->>'contact_name',
        v_payload->>'phone', v_payload->>'email', v_payload->>'address',
        nullif(v_payload->>'default_currency',''), auth.uid()
      )
      returning id into v_new_id;
    elsif v_type = 'category' then
      insert into public.fms_import_categories (name, created_by)
      values (nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item_group' then
      -- Retired from the UI, kept here so legacy pending requests still resolve.
      insert into public.fms_import_item_groups (category_id, name, created_by)
      values ((v_payload->>'category_id')::uuid, nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item' then
      -- CHANGED: an item hangs off a category now, not an item group.
      insert into public.fms_import_items (category_id, name, unit, created_by)
      values ((v_payload->>'category_id')::uuid, nullif(v_payload->>'name',''), coalesce(v_payload->>'unit',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'company' then
      insert into public.fms_import_companies (name, location, created_by)
      values (nullif(v_payload->>'name',''), v_payload->>'location', auth.uid())
      returning id into v_new_id;
    elsif v_type = 'vendor_item_price' then
      -- Upsert, so approving a price for an already-priced pair re-prices it
      -- instead of raising 23505. sort_order is deliberately left alone.
      insert into public.fms_import_vendor_item_prices (vendor_id, item_id, currency, rate, gst_pct, created_by)
      values (
        (v_payload->>'vendor_id')::uuid,
        (v_payload->>'item_id')::uuid,
        coalesce(nullif(v_payload->>'currency',''), 'USD'),
        coalesce((v_payload->>'rate')::numeric, 0),
        null,
        auth.uid()
      )
      on conflict (vendor_id, item_id) do update
        set currency = excluded.currency,
            rate     = excluded.rate,
            active   = true
      returning id into v_new_id;
    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_import_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_import_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $function$;

grant execute on function public.fms_import_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Assertions — fail loudly rather than ship a half-applied change
-- ---------------------------------------------------------------------------
do $$
begin
  -- The dup guards must survive untouched: an item request now keys on
  -- category_id, which those indexes already coalesce FIRST.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'fms_purchase_master_requests_pending_uniq'
  ) then
    raise exception 'fms_purchase_master_requests_pending_uniq is missing — the pending dup guard is gone.';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'fms_import_master_requests_pending_uniq'
  ) then
    raise exception 'fms_import_master_requests_pending_uniq is missing — the pending dup guard is gone.';
  end if;

  -- The cascade must be gone, or clearing Item Groups still wipes every item.
  if exists (
    select 1 from pg_constraint
     where conname in ('fms_purchase_items_item_group_id_fkey', 'fms_import_items_item_group_id_fkey')
       and confdeltype <> 'n'          -- 'n' = SET NULL, 'c' = CASCADE
  ) then
    raise exception 'items.item_group_id still cascades on delete — clearing Item Groups would delete every item.';
  end if;
end $$;

commit;
