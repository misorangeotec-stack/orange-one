-- ===========================================================================
-- PRODUCTION ENTRY FMS — FG TRANSFER TO GODOWN = two Tally-entry confirmations.
--
-- The final step is renamed (UI) "FG Transfer to Godown". It no longer captures a
-- final qty / status / remarks — it is a review + two tick marks confirming the
-- two Tally entries were made:
--   1. Production → Finished Goods
--   2. Finished Goods → Hojiwala
-- Both must be ticked before the card can be saved (closed). The frontend gates
-- the Save button; these RPCs re-check both are true.
--
-- Additive: two boolean columns (default false). final_qty / fg_status / fg_remarks
-- columns are kept (unused). Reversal: drop the two columns and restore the two
-- fg_transfer RPC bodies from 20260725120100 / 20260725120200.
-- ===========================================================================

alter table public.fms_production_requests add column if not exists fg_prod_to_fg  boolean not null default false;
alter table public.fms_production_requests add column if not exists fg_to_hojiwala boolean not null default false;

comment on column public.fms_production_requests.fg_prod_to_fg is
  'FG Transfer step: the "Production → Finished Goods" Tally entry has been made.';
comment on column public.fms_production_requests.fg_to_hojiwala is
  'FG Transfer step: the "Finished Goods → Hojiwala" Tally entry has been made.';

-- ---------------------------------------------------------------------------
-- RECORD (fg_transfer → closed): require BOTH Tally entries confirmed.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_record_fg_transfer(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid(); v_prod boolean; v_hoj boolean;
begin
  select status, req_no, raised_by into v_status, v_no, v_raiser
    from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_fg_transfer' then raise exception 'This job card is not awaiting finished-good transfer (status %)', v_status; end if;
  if not public.fms_production_can_act('fg_transfer', p_req, v_uid) then raise exception 'Not authorized to record the finished-good transfer'; end if;

  v_prod := coalesce((p->>'fg_prod_to_fg')::boolean, false);
  v_hoj  := coalesce((p->>'fg_to_hojiwala')::boolean, false);
  if not (v_prod and v_hoj) then
    raise exception 'Both Tally entries must be confirmed (Production → Finished Goods and Finished Goods → Hojiwala) before closing the card.';
  end if;

  update public.fms_production_requests set
    fg_actual_date = coalesce(nullif(p->>'fg_actual_date','')::date, current_date),
    fg_prod_to_fg  = v_prod,
    fg_to_hojiwala = v_hoj,
    fg_at = coalesce(fg_at, now()), fg_by = coalesce(fg_by, v_uid),
    closed_at = coalesce(closed_at, now()),
    status = 'closed', current_step = 'fg_transfer'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'fg_transfer',
    'FG transfer to godown recorded for ' || coalesce(v_no,'a job card') || ' — job card closed.',
    (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
    jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_fg_transfer(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- UPDATE (editable after close): same two-tick requirement.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_update_fg_transfer(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_prod boolean; v_hoj boolean;
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('fg_transfer', p_req, v_uid) then raise exception 'Not authorized to edit the finished-good transfer'; end if;
  if not public.fms_production_fg_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then raise exception 'This job card is cancelled — its finished-good transfer can no longer be edited.';
    end if;
    raise exception 'No finished-good transfer has been recorded on this job card yet — there is nothing to edit.';
  end if;

  v_prod := coalesce((p->>'fg_prod_to_fg')::boolean, false);
  v_hoj  := coalesce((p->>'fg_to_hojiwala')::boolean, false);
  if not (v_prod and v_hoj) then
    raise exception 'Both Tally entries must be confirmed (Production → Finished Goods and Finished Goods → Hojiwala).';
  end if;

  update public.fms_production_requests set
    fg_actual_date = coalesce(nullif(p->>'fg_actual_date','')::date, fg_actual_date),
    fg_prod_to_fg  = v_prod,
    fg_to_hojiwala = v_hoj,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'fg_transfer_edited',
    format('FG transfer to godown on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_fg_transfer(uuid, jsonb) to authenticated;
