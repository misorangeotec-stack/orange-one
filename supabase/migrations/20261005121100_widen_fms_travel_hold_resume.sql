-- ===========================================================================
-- Travel Desk FMS — hold and resume reach the traveller (Phase 4, corrective).
--
-- 20261005121000 shipped hold/resume as coordinator-and-step-owner only, while
-- `fms_travel_cancel_trip` already accepted the raiser and the traveller.
--
-- ⚠ THAT MADE THE DESTRUCTIVE ACTION THE EASY ONE. A traveller whose customer
--   moved a meeting by a fortnight could KILL the trip — losing its number, its
--   approvals and its history — but could not simply park it. When the safe
--   action is harder to reach than the unsafe one, people learn to use the
--   unsafe one, and the module would have accumulated cancelled-and-re-raised
--   trips where a hold was meant.
--
--   Found by trying to hold a trip as its own traveller during the phase-4
--   verification, which is the only reason it was found before go-live.
--
-- Resume is widened to the same list. Letting somebody park a trip they then
-- cannot un-park would leave them chasing the desk to undo their own caution.
--
-- Purely a widening: nobody loses an ability. Reversal is 20261005121000's
-- definitions of the same two functions.
-- ===========================================================================

begin;

create or replace function public.fms_travel_hold_trip(p_trip uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  t      record;
  v_why  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if v_why is null then raise exception 'Say why this trip is being put on hold'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status in ('draft', 'on_hold', 'closed', 'cancelled', 'rejected') then
    raise exception 'A trip that is % cannot be put on hold', replace(t.status, '_', ' ');
  end if;
  -- The same list that may CANCEL, plus whoever currently owes the step.
  if not (t.raised_by = v_uid or t.traveller_id = v_uid
          or public.fms_travel_is_coordinator(v_uid) or public.is_admin(v_uid)
          or public.fms_travel_can_act(coalesce(t.current_step, 'request'), p_trip, v_uid)) then
    raise exception 'You are not authorized to hold this trip';
  end if;

  update public.fms_travel_trips
     set status = 'on_hold', hold_at = now(), hold_reason = v_why, hold_from_status = t.status
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'trip_held',
    coalesce(t.trip_no, 'The trip') || ' was put on hold — ' || v_why,
    array_remove(array[t.raised_by, t.traveller_id], null));
end $$;
grant execute on function public.fms_travel_hold_trip(uuid, text) to authenticated;

create or replace function public.fms_travel_resume_trip(p_trip uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  t      record;
  v_next record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status <> 'on_hold' then
    raise exception 'This trip is not on hold';
  end if;
  if not (t.raised_by = v_uid or t.traveller_id = v_uid
          or public.fms_travel_is_coordinator(v_uid) or public.is_admin(v_uid)) then
    raise exception 'You are not authorized to take this trip off hold';
  end if;

  -- ⚠ THE ROUTER, NOT hold_from_status REPLAYED. Defect (F) of 20260905120000 is
  --   a resume that reroutes to a step the record had SKIPPED;
  --   fms_travel_next_stop reads the skip flags and the decision stamps, so it
  --   gives the same answer it gave on the way in and cannot invent a step that
  --   never applied to this trip.
  select n.next_status, n.next_step into v_next
    from public.fms_travel_next_stop(p_trip, 'resume') n;

  update public.fms_travel_trips
     set status = v_next.next_status, current_step = v_next.next_step,
         hold_at = null, hold_reason = null, hold_from_status = null
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'trip_resumed',
    coalesce(t.trip_no, 'The trip') || ' came off hold and is ' || replace(v_next.next_status, '_', ' '),
    public.fms_travel_step_owner_ids(v_next.next_step)
      || array_remove(array[t.raised_by, t.traveller_id], null));

  return v_next.next_status;
end $$;
grant execute on function public.fms_travel_resume_trip(uuid) to authenticated;

commit;
