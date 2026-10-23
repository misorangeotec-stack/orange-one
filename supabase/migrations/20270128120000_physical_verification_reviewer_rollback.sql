-- Reverses 20270128120000: review goes back to the step 1 people.

begin;

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
  if not public.pv_can_schedule(v_uid) then
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

drop function if exists public.pv_can_review(uuid);
alter table public.pv_settings drop column if exists reviewer_ids;

commit;
