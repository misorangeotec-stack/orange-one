-- Reverses 20270203120000: no chosen lines, no lots, review remark optional again, no step 4.
-- ⚠ Drops lot counts, chosen lines, voucher numbers and the attachment bucket's policies
--   (files already uploaded stay in storage, unreadable by path).

begin;

-- pv_save_counts as in 20270126120000
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
  v_n     integer := 0;
begin
  if not v_admin and not public.module_can_edit(v_uid, 'physical-verification') then
    raise exception 'You do not have edit access to Physical Verification.' using errcode = '42501';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into v_c from public.pv_counts where id = (v_row->>'id')::uuid for update;
    if v_c.id is null then raise exception 'Item not found.'; end if;
    -- IS DISTINCT FROM, not <>: a row whose verifier was deleted (null) is nobody's to count.
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

    update public.pv_counts
       set physical_qty     = v_qty,
           closing_qty      = coalesce(nullif(v_row->>'closing_qty', '')::numeric, closing_qty),
           closing_rate     = coalesce(nullif(v_row->>'closing_rate', '')::numeric, closing_rate),
           tally_as_at      = coalesce(nullif(v_row->>'tally_as_at', '')::timestamptz, tally_as_at),
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

-- pv_review as in 20270128120000
create or replace function public.pv_review(p_ids uuid[], p_action text, p_remarks text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_remarks text := nullif(btrim(p_remarks), '');
  v_new     text;
  v_n       integer;
begin
  if not public.pv_can_review(v_uid) then
    raise exception 'You are not allowed to review counts.' using errcode = '42501';
  end if;
  if p_action not in ('accept', 'recount') then
    raise exception 'Action must be accept or recount.';
  end if;
  if p_action = 'recount' and v_remarks is null then
    raise exception 'Say why it needs a recount.';
  end if;
  v_new := case p_action when 'accept' then 'accepted' else 'returned' end;

  with done as (
    update public.pv_counts
       set status = v_new, review_remarks = v_remarks, reviewed_by = v_uid, reviewed_at = now()
     where id = any(p_ids) and status = 'submitted'
    returning id, physical_qty, closing_qty
  )
  insert into public.pv_activity (count_id, action, physical_qty, closing_qty, remarks, actor)
  select id, v_new, physical_qty, closing_qty, v_remarks, v_uid from done;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Storage policies first: they call pv_can_post.
drop policy if exists "pv tally docs read"   on storage.objects;
drop policy if exists "pv tally docs insert" on storage.objects;
drop policy if exists "pv tally docs update" on storage.objects;
drop policy if exists "pv tally docs delete" on storage.objects;

drop function if exists public.pv_review_rows(jsonb, text);
drop function if exists public.pv_tally_unpost(uuid[], text);
drop function if exists public.pv_tally_post(uuid[], text, date, text, text);
drop function if exists public.pv_can_post(uuid);
drop function if exists public.pv_set_lines(text, text[]);
drop table if exists public.pv_master_lines;

delete from public.pv_activity where action in ('tally_posted', 'tally_unposted');
alter table public.pv_activity drop constraint if exists pv_activity_action_check;
alter table public.pv_activity add constraint pv_activity_action_check
  check (action in ('scheduled', 'rescheduled', 'saved', 'submitted', 'returned', 'accepted'));

drop index if exists public.pv_counts_tally_idx;
alter table public.pv_counts
  drop column if exists tally_posted_at,
  drop column if exists tally_posted_by,
  drop column if exists tally_attachment_name,
  drop column if exists tally_attachment,
  drop column if exists tally_voucher_date,
  drop column if exists tally_voucher_no,
  drop column if exists lot_closing,
  drop column if exists lot_counts;

alter table public.pv_settings drop column if exists tally_ids;

commit;
