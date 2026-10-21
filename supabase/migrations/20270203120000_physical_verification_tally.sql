-- Physical Verification — chosen lines, lot-wise count, review remark, step 4 Post to Tally.
--
-- Asked 17/19-10-2026:
--   1. MASTER LINES — step 1 chooses which items the Master shows, per company, for everyone
--      (pv_master_lines). Nothing chosen = every item, as today.
--   2. COUNT — the verifier no longer sees Tally's closing (the page hides it; the frozen
--      figure is still stored for the review). After the total, they split it by LOT NO.:
--      lot_counts = [{ "lot": text, "qty": number }, …]. Submit only when the lots add up to
--      the total. Tally's lot-wise closing at that moment is frozen beside it (lot_closing).
--   3. REVIEW — matching items (physical = closing) are simply accepted and closed. An item
--      WITH a difference needs a remark to accept, and goes on to step 4. Sending back for a
--      recount always needs a remark.
--   4. POST TO TALLY — the step 4 person adjusts the stock in Tally by hand, then records
--      Tally's voucher no. + date + an attachment (required). That closes the item.
--
--   Step 1 · set dates      scheduler_ids
--   Step 2 · count          verifier_ids
--   Step 3 · review         reviewer_ids
--   Step 4 · post to Tally  tally_ids        ← NEW (empty = the step 3 people post)
--
-- Builds on 20270126120000 + 20270128120000. pv_save_counts and pv_review are re-created with
-- the same signatures. Reversal: the _rollback.sql beside this file.

begin;

-- ------------------------------------------------------------- settings --
alter table public.pv_settings
  add column if not exists tally_ids uuid[] not null default '{}';

comment on table public.pv_settings is
  'Physical Verification: the one settings row — who sets dates (step 1), counts (step 2), reviews (step 3) and posts to Tally (step 4). See 20270126120000, 20270128120000, 20270203120000.';

-- ---------------------------------------------------------------- counts --
alter table public.pv_counts
  add column if not exists lot_counts            jsonb,
  add column if not exists lot_closing           jsonb,
  add column if not exists tally_voucher_no      text,
  add column if not exists tally_voucher_date    date,
  add column if not exists tally_attachment      text,
  add column if not exists tally_attachment_name text,
  add column if not exists tally_posted_by       uuid references auth.users on delete set null,
  add column if not exists tally_posted_at       timestamptz;

comment on column public.pv_counts.lot_counts  is 'Verifier''s count split by lot: [{lot, qty}]; adds up to physical_qty at submit.';
comment on column public.pv_counts.lot_closing is 'Tally''s lot-wise closing frozen at the last count save: [{lot, qty, godown}]. ConnectWave lot balances; not always equal to closing_qty.';

create index if not exists pv_counts_tally_idx on public.pv_counts (status, tally_posted_at);

alter table public.pv_activity drop constraint if exists pv_activity_action_check;
alter table public.pv_activity add constraint pv_activity_action_check
  check (action in ('scheduled', 'rescheduled', 'saved', 'submitted', 'returned', 'accepted',
                    'tally_posted', 'tally_unposted'));

-- ---------------------------------------------------------- master lines --
create table if not exists public.pv_master_lines (
  company_guid text not null,
  stock_item   text not null,
  added_by     uuid references auth.users on delete set null,
  added_at     timestamptz not null default now(),
  primary key (company_guid, stock_item)
);
comment on table public.pv_master_lines is
  'Physical Verification: the items step 1 chose to show on the Master, per company. None for a company = show all. See 20270203120000.';

alter table public.pv_master_lines enable row level security;
drop policy if exists pv_master_lines_select on public.pv_master_lines;
create policy pv_master_lines_select on public.pv_master_lines for select to authenticated
  using ((select public.module_level(auth.uid(), 'physical-verification')) <> 'none');

-- Replace one company's chosen lines. An empty list = show every item again.
create or replace function public.pv_set_lines(p_company text, p_items text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if not public.pv_can_schedule(v_uid) then
    raise exception 'You are not allowed to choose the Master lines.' using errcode = '42501';
  end if;
  if nullif(btrim(p_company), '') is null then raise exception 'Which company?'; end if;
  delete from public.pv_master_lines
   where company_guid = p_company and not (stock_item = any(coalesce(p_items, '{}')));
  insert into public.pv_master_lines (company_guid, stock_item, added_by)
  select p_company, i, v_uid from unnest(coalesce(p_items, '{}')) i
   where nullif(btrim(i), '') is not null
  on conflict do nothing;
  select count(*) into v_n from public.pv_master_lines where company_guid = p_company;
  return v_n;
end;
$$;

-- ------------------------------------------------------------ the count --
-- Same as 20270126120000, plus lots: each row may carry "lots" [{lot, qty}] and
-- "lot_closing" [{lot, qty, godown}]. Submit needs the lots to add up to the physical total.
create or replace function public.pv_save_counts(p_rows jsonb, p_submit boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean := public.is_admin(v_uid);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_row   jsonb;
  v_c     public.pv_counts%rowtype;
  v_qty   numeric;
  v_lots  jsonb;
  v_sum   numeric;
  v_n     integer := 0;
begin
  if not v_admin and not public.module_can_edit(v_uid, 'physical-verification') then
    raise exception 'You do not have edit access to Physical Verification.' using errcode = '42501';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into v_c from public.pv_counts where id = (v_row->>'id')::uuid for update;
    if v_c.id is null then raise exception 'Item not found.'; end if;
    if v_c.assigned_to is distinct from v_uid and not v_admin then
      raise exception '% is not on your list.', v_c.stock_item using errcode = '42501';
    end if;
    if v_c.status not in ('scheduled', 'returned') then
      raise exception '% is already % — it cannot be changed.', v_c.stock_item, v_c.status;
    end if;
    if v_c.verify_date > v_today then
      raise exception '% is not due until %.', v_c.stock_item, to_char(v_c.verify_date, 'DD-MM-YYYY');
    end if;

    v_qty := nullif(v_row->>'physical_qty', '')::numeric;
    if p_submit and v_qty is null then
      raise exception 'Enter the physical stock for % before submitting.', v_c.stock_item;
    end if;
    if v_qty is not null and v_qty < 0 then
      raise exception 'Physical stock cannot be negative (%).', v_c.stock_item;
    end if;

    -- Lots: keep only lines with something typed; a qty needs a lot no.
    v_lots := coalesce((
      select jsonb_agg(jsonb_build_object('lot', btrim(coalesce(l->>'lot', '')),
                                          'qty', nullif(l->>'qty', '')::numeric))
        from jsonb_array_elements(case when jsonb_typeof(v_row->'lots') = 'array' then v_row->'lots' else '[]'::jsonb end) l
       where btrim(coalesce(l->>'lot', '')) <> '' or nullif(l->>'qty', '') is not null), '[]'::jsonb);
    if exists (select 1 from jsonb_array_elements(v_lots) l
                where (l->>'qty')::numeric < 0) then
      raise exception 'A lot quantity cannot be negative (%).', v_c.stock_item;
    end if;
    if p_submit then
      if exists (select 1 from jsonb_array_elements(v_lots) l
                  where l->>'lot' = '' or l->>'qty' is null) then
        raise exception 'Every lot line needs a lot no. and a quantity (%).', v_c.stock_item;
      end if;
      select coalesce(sum((l->>'qty')::numeric), 0) into v_sum from jsonb_array_elements(v_lots) l;
      if v_qty > 0 and abs(v_sum - v_qty) > 0.0005 then
        raise exception 'The lots of % add up to %, not the physical total %.', v_c.stock_item, v_sum, v_qty;
      end if;
    end if;

    update public.pv_counts
       set physical_qty     = v_qty,
           lot_counts       = v_lots,
           closing_qty      = coalesce(nullif(v_row->>'closing_qty', '')::numeric, closing_qty),
           closing_rate     = coalesce(nullif(v_row->>'closing_rate', '')::numeric, closing_rate),
           tally_as_at      = coalesce(nullif(v_row->>'tally_as_at', '')::timestamptz, tally_as_at),
           lot_closing      = case when jsonb_typeof(v_row->'lot_closing') = 'array' then v_row->'lot_closing' else lot_closing end,
           verifier_remarks = nullif(btrim(v_row->>'remarks'), ''),
           counted_by       = v_uid,
           counted_at       = now(),
           status           = case when p_submit then 'submitted' else status end,
           submitted_at     = case when p_submit then now() else submitted_at end
     where id = v_c.id;

    insert into public.pv_activity (count_id, action, physical_qty, closing_qty, remarks, actor)
    select v_c.id, case when p_submit then 'submitted' else 'saved' end, c.physical_qty, c.closing_qty,
           c.verifier_remarks, v_uid
      from public.pv_counts c where c.id = v_c.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ----------------------------------------------------------- the review --
-- Same as 20270128120000, but through pv_review_rows: accepting an item with a difference
-- needs a remark too (asked 19/20-10-2026).
create or replace function public.pv_review(p_ids uuid[], p_action text, p_remarks text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.pv_review_rows(
    (select coalesce(jsonb_agg(jsonb_build_object('id', i, 'remarks', p_remarks)), '[]'::jsonb) from unnest(p_ids) i),
    p_action);
end;
$$;

-- One remark per item: p_rows = [{ "id": uuid, "remarks": text }, …]. All or nothing.
-- Remark required: every recount, and every accept of an item whose physical ≠ closing.
create or replace function public.pv_review_rows(p_rows jsonb, p_action text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new text;
  v_bad text;
  v_n   integer;
begin
  if not public.pv_can_review(v_uid) then
    raise exception 'You are not allowed to review counts.' using errcode = '42501';
  end if;
  if p_action not in ('accept', 'recount') then
    raise exception 'Action must be accept or recount.';
  end if;
  select string_agg(c.stock_item, ', ') into v_bad
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    join public.pv_counts c on c.id = (r->>'id')::uuid
   where nullif(btrim(r->>'remarks'), '') is null
     and (p_action = 'recount' or coalesce(c.difference, 0) <> 0);
  if v_bad is not null then
    raise exception 'Write a remark for: %', v_bad;
  end if;
  v_new := case p_action when 'accept' then 'accepted' else 'returned' end;

  with r as (
    select (x->>'id')::uuid id, nullif(btrim(x->>'remarks'), '') remarks from jsonb_array_elements(p_rows) x
  ), done as (
    update public.pv_counts c
       set status = v_new, review_remarks = r.remarks, reviewed_by = v_uid, reviewed_at = now()
      from r
     where c.id = r.id and c.status = 'submitted'
    returning c.id, c.physical_qty, c.closing_qty, c.review_remarks
  )
  insert into public.pv_activity (count_id, action, physical_qty, closing_qty, remarks, actor)
  select id, v_new, physical_qty, closing_qty, review_remarks, v_uid from done;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -------------------------------------------------------- post to Tally --
-- Step 4: may this user post to Tally? Empty list = whoever reviews (step 3).
create or replace function public.pv_can_post(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or (public.module_can_edit(p_uid, 'physical-verification')
          and exists (select 1 from public.pv_settings s where p_uid = any(s.tally_ids)))
      or (exists (select 1 from public.pv_settings s where cardinality(s.tally_ids) = 0)
          and public.pv_can_review(p_uid));
$$;

-- Close lines under one Tally voucher: voucher no., date and an attachment are all required.
-- The attachment is uploaded first to pv-tally-docs under '<one of these ids>/…'.
create or replace function public.pv_tally_post(p_ids uuid[], p_voucher_no text, p_voucher_date date,
                                                p_attachment text, p_attachment_name text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_no  text := nullif(btrim(p_voucher_no), '');
  v_bad text;
  v_n   integer;
begin
  if not public.pv_can_post(v_uid) then
    raise exception 'You are not allowed to post to Tally.' using errcode = '42501';
  end if;
  if v_no is null then raise exception 'Type the Tally voucher no.'; end if;
  if p_voucher_date is null then raise exception 'Pick the voucher date.'; end if;
  if nullif(btrim(p_attachment), '') is null then raise exception 'Attach the Tally voucher.'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Pick the lines to close.'; end if;
  if not exists (select 1 from unnest(p_ids) i where p_attachment like i::text || '/%') then
    raise exception 'The attachment does not belong to these lines.';
  end if;
  if (select count(*) from public.pv_counts where id = any(p_ids)) <> cardinality(p_ids) then
    raise exception 'Some lines were not found — refresh the page.';
  end if;
  select string_agg(stock_item, ', ') into v_bad
    from public.pv_counts
   where id = any(p_ids)
     and (status <> 'accepted' or coalesce(difference, 0) = 0 or tally_posted_at is not null);
  if v_bad is not null then
    raise exception 'Not waiting for Tally (already closed, or no difference): %', v_bad;
  end if;
  if (select count(distinct company_guid) from public.pv_counts where id = any(p_ids)) > 1 then
    raise exception 'One Tally voucher is one company — pick lines of one company.';
  end if;

  with done as (
    update public.pv_counts
       set tally_voucher_no = v_no, tally_voucher_date = p_voucher_date,
           tally_attachment = p_attachment, tally_attachment_name = nullif(btrim(p_attachment_name), ''),
           tally_posted_by = v_uid, tally_posted_at = now()
     where id = any(p_ids)
    returning id
  )
  insert into public.pv_activity (count_id, action, remarks, actor)
  select id, 'tally_posted', v_no || ' · ' || to_char(p_voucher_date, 'DD-MM-YYYY'), v_uid from done;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Admins only: reopen a closed line (wrong voucher no., voucher deleted in Tally).
create or replace function public.pv_tally_unpost(p_ids uuid[], p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if not public.is_admin(v_uid) then
    raise exception 'Only admins can reopen a closed line.' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Say why it is being reopened.'; end if;
  with done as (
    update public.pv_counts
       set tally_voucher_no = null, tally_voucher_date = null, tally_attachment = null,
           tally_attachment_name = null, tally_posted_by = null, tally_posted_at = null
     where id = any(p_ids) and tally_posted_at is not null
    returning id
  )
  insert into public.pv_activity (count_id, action, remarks, actor)
  select id, 'tally_unposted', btrim(p_reason), v_uid from done;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- --------------------------------------------------------------- storage --
-- Private bucket; policy names are global on storage.objects, so unique to this module.
insert into storage.buckets (id, name, public)
values ('pv-tally-docs', 'pv-tally-docs', false)
on conflict (id) do nothing;

drop policy if exists "pv tally docs read"   on storage.objects;
drop policy if exists "pv tally docs insert" on storage.objects;
drop policy if exists "pv tally docs update" on storage.objects;
drop policy if exists "pv tally docs delete" on storage.objects;

create policy "pv tally docs read" on storage.objects for select to authenticated
  using (bucket_id = 'pv-tally-docs'
         and (select public.module_level(auth.uid(), 'physical-verification')) <> 'none');

-- Upload only into the folder of a line still waiting for Tally.
create policy "pv tally docs insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'pv-tally-docs'
              and (select public.pv_can_post(auth.uid()))
              and exists (select 1 from public.pv_counts c
                           where c.id::text = (storage.foldername(name))[1]
                             and c.status = 'accepted' and coalesce(c.difference, 0) <> 0
                             and c.tally_posted_at is null));

create policy "pv tally docs update" on storage.objects for update to authenticated
  using (false) with check (false);

create policy "pv tally docs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'pv-tally-docs' and (select public.is_admin(auth.uid())));

-- ----------------------------------------------------------------- grants --
revoke all on function public.pv_set_lines(text, text[])                       from public, anon;
revoke all on function public.pv_review_rows(jsonb, text)                      from public, anon;
revoke all on function public.pv_can_post(uuid)                                from public, anon;
revoke all on function public.pv_tally_post(uuid[], text, date, text, text)    from public, anon;
revoke all on function public.pv_tally_unpost(uuid[], text)                    from public, anon;
grant execute on function public.pv_set_lines(text, text[])                    to authenticated;
grant execute on function public.pv_review_rows(jsonb, text)                   to authenticated;
grant execute on function public.pv_can_post(uuid)                             to authenticated;
grant execute on function public.pv_tally_post(uuid[], text, date, text, text) to authenticated;
grant execute on function public.pv_tally_unpost(uuid[], text)                 to authenticated;

-- ------------------------------------------------------------ assertions --
do $mig$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = 'pv_master_lines' and c.relrowsecurity) then
    raise exception 'RLS is not enabled on pv_master_lines';
  end if;
  if exists (select 1 from storage.buckets where id = 'pv-tally-docs' and public) then
    raise exception 'pv-tally-docs must be a private bucket';
  end if;
end;
$mig$;

commit;
