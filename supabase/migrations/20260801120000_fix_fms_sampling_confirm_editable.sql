-- ===========================================================================
-- Sampling FMS — the outward receipt confirmation is editable again.
--
-- REGRESSION being fixed. 20260731140000 took `testing` off the outward path:
-- fms_sampling_record_confirm now sets status='awaiting_result' (it used to set
-- 'awaiting_testing'). But fms_sampling_confirm_editable (20260724120200) still
-- demanded status='awaiting_testing', so from that migration onwards the
-- predicate could NEVER be true again — every outward receipt confirmation was
-- un-editable the instant it was saved, and fms_sampling_update_confirm raised
-- "testing has already been recorded", naming a step the branch no longer has.
--
-- BOTH statuses are accepted here, not just the new one. 'awaiting_testing' costs
-- nothing and covers any outward row that slipped past the stranded-row fix in
-- 20260731140000 A7 (or was mid-flight while it ran).
--
-- Purely CREATE OR REPLACE — no table, column, constraint or data is touched.
-- The client mirror of this rule is confirmLockReason in lib/queues.ts; the two
-- must change together.
-- Clone lineage: 20260724120200 (the stage-edit predicates), 20260731140000.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- confirm_receipt (outward) — editable while confirmed and the result is still
-- outstanding.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_confirm_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.direction = 'outward'
       and r.confirmed_at is not null
       and r.status in ('awaiting_result', 'awaiting_testing')
  );
$$;
grant execute on function public.fms_sampling_confirm_editable(uuid) to authenticated;

create or replace function public.fms_sampling_update_confirm(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('confirm_receipt', p_req, v_uid) then
    raise exception 'Not authorized to edit the receipt confirmation';
  end if;
  if not public.fms_sampling_confirm_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    end if;
    raise exception 'The receipt confirmation can no longer be edited: the result has already been recorded (status %).', v_status;
  end if;

  update public.fms_sampling_requests set
    party_received_date = coalesce(nullif(p->>'party_received_date','')::date, party_received_date),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'confirm_edited',
    format('Receipt confirmation on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_confirm(uuid, jsonb) to authenticated;
