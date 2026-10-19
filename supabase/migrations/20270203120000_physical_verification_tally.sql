-- Physical Verification — step 4: post the accepted differences to Tally as a Stock Journal.
--
-- Asked 17-10-2026. Once a count is accepted with a difference, it waits in a "Post to Tally"
-- queue. The step 4 person picks the godown and batch for each line (Otec Surat ink is lot
-- tracked, and ConnectWave's lot balances do not tie to the closing for most items, so the app
-- cannot pick the batch on its own), downloads a Tally import file (Stock Journal: short = out,
-- extra = in), imports it in Tally, then types Tally's voucher no. and marks the lines posted.
--
--   Step 1 · set dates      scheduler_ids
--   Step 2 · count          verifier_ids
--   Step 3 · review         reviewer_ids
--   Step 4 · post to Tally  tally_ids        ← NEW (empty = the step 3 people post)
--
-- Additive: one settings column, five nullable pv_counts columns, the activity action list
-- widened, three new functions. Nothing existing changes behaviour. Builds on 20270128120000.
-- Reversal: the _rollback.sql beside this file.

begin;

alter table public.pv_settings
  add column if not exists tally_ids uuid[] not null default '{}';

comment on table public.pv_settings is
  'Physical Verification: the one settings row — who sets dates (step 1), counts (step 2), reviews (step 3) and posts to Tally (step 4). See 20270126120000, 20270128120000, 20270203120000.';

-- Where the difference goes in Tally: [{ "godown": text, "batch": text, "qty": number }, …],
-- quantities positive and adding up to |difference| before the line can be posted.
alter table public.pv_counts
  add column if not exists tally_alloc        jsonb,
  add column if not exists tally_voucher_no   text,
  add column if not exists tally_voucher_date date,
  add column if not exists tally_posted_by    uuid references auth.users on delete set null,
  add column if not exists tally_posted_at    timestamptz;

create index if not exists pv_counts_tally_idx on public.pv_counts (status, tally_posted_at);

alter table public.pv_activity drop constraint if exists pv_activity_action_check;
alter table public.pv_activity add constraint pv_activity_action_check
  check (action in ('scheduled', 'rescheduled', 'saved', 'submitted', 'returned', 'accepted',
                    'tally_saved', 'tally_posted', 'tally_unposted'));

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

-- Save the godown / batch split of lines still to post. p_rows = [{ "id": uuid, "alloc": [...] }].
create or replace function public.pv_tally_save(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_n   integer := 0;
begin
  if not public.pv_can_post(v_uid) then
    raise exception 'You are not allowed to post to Tally.' using errcode = '42501';
  end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if jsonb_typeof(v_row->'alloc') <> 'array' then
      raise exception 'Godown / batch lines must be a list.';
    end if;
    update public.pv_counts
       set tally_alloc = v_row->'alloc'
     where id = (v_row->>'id')::uuid
       and status = 'accepted' and coalesce(difference, 0) <> 0 and tally_posted_at is null;
    if found then
      insert into public.pv_activity (count_id, action, actor) values ((v_row->>'id')::uuid, 'tally_saved', v_uid);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Mark lines posted under one Tally voucher. All or nothing: every line must be accepted, have
-- a difference, not be posted yet, and be fully split into godown + qty adding up to it.
create or replace function public.pv_tally_post(p_ids uuid[], p_voucher_no text, p_voucher_date date)
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
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Pick the lines to mark posted.'; end if;

  select string_agg(c.stock_item, ', ') into v_bad
    from public.pv_counts c
   where c.id = any(p_ids)
     and (c.status <> 'accepted' or coalesce(c.difference, 0) = 0 or c.tally_posted_at is not null
          or jsonb_typeof(c.tally_alloc) is distinct from 'array'
          or jsonb_array_length(c.tally_alloc) = 0
          or exists (select 1 from jsonb_array_elements(c.tally_alloc) a
                      where nullif(btrim(a->>'godown'), '') is null
                         or coalesce(nullif(a->>'qty', '')::numeric, 0) <= 0)
          or abs((select coalesce(sum((a->>'qty')::numeric), 0) from jsonb_array_elements(c.tally_alloc) a)
                 - abs(c.difference)) > 0.0005);
  if v_bad is not null then
    raise exception 'Not ready to post (godown / qty must add up to the difference, or already posted): %', v_bad;
  end if;
  if (select count(*) from public.pv_counts where id = any(p_ids)) <> cardinality(p_ids) then
    raise exception 'Some lines were not found — refresh the page.';
  end if;

  with done as (
    update public.pv_counts
       set tally_voucher_no = v_no, tally_voucher_date = p_voucher_date,
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

-- Admins only: undo a "posted" mark (wrong voucher no., voucher deleted in Tally).
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
    raise exception 'Only admins can undo a posting.' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Say why it is being undone.'; end if;
  with done as (
    update public.pv_counts
       set tally_voucher_no = null, tally_voucher_date = null, tally_posted_by = null, tally_posted_at = null
     where id = any(p_ids) and tally_posted_at is not null
    returning id
  )
  insert into public.pv_activity (count_id, action, remarks, actor)
  select id, 'tally_unposted', btrim(p_reason), v_uid from done;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.pv_can_post(uuid)                    from public, anon;
revoke all on function public.pv_tally_save(jsonb)                 from public, anon;
revoke all on function public.pv_tally_post(uuid[], text, date)    from public, anon;
revoke all on function public.pv_tally_unpost(uuid[], text)        from public, anon;
grant execute on function public.pv_can_post(uuid)                 to authenticated;
grant execute on function public.pv_tally_save(jsonb)              to authenticated;
grant execute on function public.pv_tally_post(uuid[], text, date) to authenticated;
grant execute on function public.pv_tally_unpost(uuid[], text)     to authenticated;

commit;
