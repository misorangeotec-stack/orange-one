-- ===========================================================================
-- PRODUCTION ENTRY FMS — FG TRANSFER TO GODOWN: multi-select + upload Tally file.
--
-- The final step no longer captures two Tally-entry tick-marks. Instead a user
-- multi-selects the cards ready for transfer, uploads ONE Tally voucher file (the
-- transfer entry), and confirms — closing every selected card and attaching the
-- file to each. The old two-tick single-card record/update RPCs are kept (unused)
-- for reversibility; fg_prod_to_fg / fg_to_hojiwala columns are left in place.
--
-- Additive: fg_attachment_path / fg_attachment_name + the bulk record RPC.
-- ===========================================================================

alter table public.fms_production_requests add column if not exists fg_attachment_path text;
alter table public.fms_production_requests add column if not exists fg_attachment_name text;
comment on column public.fms_production_requests.fg_attachment_path is
  'FG Transfer to Godown: the uploaded Tally voucher/entry file (storage object path in fms-production-docs). Applied per card by the bulk transfer RPC.';

-- Bulk: close the selected cards with the shared Tally voucher file. Skips cards
-- not in awaiting_fg_transfer or that the caller may not act on. Returns count.
create or replace function public.fms_production_record_fg_transfer_bulk(p_reqs uuid[], p_path text, p_name text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_status text; v_no text; v_raiser uuid; v_count int := 0;
begin
  if p_reqs is null or array_length(p_reqs, 1) is null then return 0; end if;
  if coalesce(trim(p_path), '') = '' then raise exception 'A Tally entry file is required'; end if;

  foreach v_id in array p_reqs loop
    select status, req_no, raised_by into v_status, v_no, v_raiser
      from public.fms_production_requests where id = v_id for update;
    if v_status is null or v_status <> 'awaiting_fg_transfer' then continue; end if;
    if not public.fms_production_can_act('fg_transfer', v_id, v_uid) then continue; end if;

    update public.fms_production_requests set
      fg_actual_date     = current_date,
      fg_attachment_path = p_path,
      fg_attachment_name = nullif(trim(p_name), ''),
      fg_at = coalesce(fg_at, now()), fg_by = coalesce(fg_by, v_uid),
      closed_at = coalesce(closed_at, now()),
      status = 'closed', current_step = 'fg_transfer'
    where id = v_id;

    perform public.fms_production_announce('request', v_id, 'fg_transfer',
      'FG transfer to godown recorded for ' || coalesce(v_no,'a job card') || ' — job card closed.',
      (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
      jsonb_build_object('req_no', v_no));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
grant execute on function public.fms_production_record_fg_transfer_bulk(uuid[], text, text) to authenticated;
