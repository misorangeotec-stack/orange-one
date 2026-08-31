-- ===========================================================================
-- THE COLLABORATION THREAD.
--
-- A comment is an `fms_travel_activity` row of `type = 'comment'` — NOT a
-- comments table. That is the house pattern (`fms_hr_post_comment`), and the
-- reason is that a trip's conversation and its history are one thing: "the
-- Director asked why economy was not available" and "the Director approved it"
-- belong on the same timeline, in order, or the reader has to interleave two
-- lists by hand to understand what happened.
--
-- ⚠ MENTIONS AND ATTACHMENTS RIDE IN `meta`. hr-recruitment's CandidateTimeline
--   is the model for rendering, and it has NO ATTACHMENT SUPPORT — that part is
--   new here. A travel argument is almost always about a document: the hotel's
--   "no rooms available" mail that justifies §7.3, the airline's cancellation
--   notice, the corrected invoice. A thread that cannot carry one sends the
--   conversation to WhatsApp, where the evidence is lost.
--
-- ⚠ A MENTION IS THE ONLY THING THAT NOTIFIES. Commenting is not an event that
--   pages the whole trip — a coordinator noting "customer moved the meeting"
--   should not mail four people. `@`-mentioning somebody is the deliberate act
--   that says "you, specifically". So the recipient list is exactly the mentions,
--   and a comment with none reaches nobody's inbox while still being on the
--   record for ever.
--
-- ⚠ THE ATTACHMENT IS A PATH IN THE SAME BUCKET, UNDER THE SAME CONTRACT.
--   `<trip-id>/<slot>/<epoch>-<name>` with slot `receipt` or `approval`, so the
--   four storage policies from 20261005121600 govern it unchanged. A comment
--   cannot smuggle a file into a trip the author cannot see, because the policy
--   derives the owning trip from segment 1 of the path.
-- ===========================================================================
begin;

create or replace function public.fms_travel_post_comment(
  p_trip        uuid,
  p_text        text,
  p_mentions    uuid[] default '{}',
  p_attachments jsonb  default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  t       record;
  v_body  text := nullif(btrim(coalesce(p_text, '')), '');
  v_id    uuid;
  v_ment  uuid[] := '{}';
  u       uuid;
  a       jsonb;
  v_path  text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip;
  if t.id is null then raise exception 'Trip not found'; end if;

  /* ⚠ READ ACCESS IS THE TEST, NOT EDIT. Commenting is how somebody who can see
     a trip asks a question about it — a Director querying a claim, HR chasing a
     booking. Requiring `can_act` would mean only the person whose desk it is
     could speak, which is the opposite of a thread. */
  if not public.fms_travel_can_see_trip(v_uid, t.raised_by, t.traveller_id, t.status, t.approver_manager_ids) then
    raise exception 'You are not authorized to see this trip';
  end if;

  if v_body is null and coalesce(jsonb_array_length(p_attachments), 0) = 0 then
    raise exception 'Say something, or attach something. An empty comment is a row nobody can read.';
  end if;

  -- ---- the attachments ---------------------------------------------------
  /* Every path is checked against the SAME predicate the storage policies use,
     so a comment cannot reference a file on another trip. `can_see_doc` reads
     the owning trip out of segment 1 and returns FALSE — never raises — on a
     malformed path, which is exactly what makes this safe to loop over. */
  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    v_path := nullif(btrim(coalesce(a->>'path', '')), '');
    if v_path is null then continue; end if;
    if public.fms_travel_doc_trip(v_path) is distinct from p_trip then
      raise exception 'That attachment does not belong to this trip.';
    end if;
    if not public.fms_travel_can_see_doc(v_path, v_uid) then
      raise exception 'You are not authorized to attach that file.';
    end if;
  end loop;

  -- ---- the mentions ------------------------------------------------------
  /* ⚠ A MENTION OF SOMEBODY WHO CANNOT SEE THE TRIP IS DROPPED, SILENTLY AND
     DELIBERATELY. Raising would let an author probe who can see what by watching
     which names error; notifying anyway would mail somebody a link to a page
     that hands them Access Denied — defect (C) of 20260905120000. Dropping is
     the only option that does neither. */
  if p_mentions is not null then
    foreach u in array p_mentions loop
      if u is null or u = any(v_ment) or u = v_uid then continue; end if;
      if public.fms_travel_can_see_trip(u,
           t.raised_by, t.traveller_id, t.status, t.approver_manager_ids) then
        v_ment := v_ment || u;
      end if;
    end loop;
  end if;

  perform public.fms_travel_announce(
    'trip', p_trip, 'comment',
    coalesce(v_body, 'shared a file'),
    v_ment,
    jsonb_build_object(
      'mentions',    to_jsonb(v_ment),
      'attachments', coalesce(p_attachments, '[]'::jsonb)));

  select id into v_id from public.fms_travel_activity
   where entity_id = p_trip and type = 'comment' and actor_id = v_uid
   order by created_at desc limit 1;

  return v_id;
end $$;

comment on function public.fms_travel_post_comment(uuid, text, uuid[], jsonb) is
  'Post one comment on a trip. It is an activity row of type=comment, so the conversation and the history are ONE timeline. Only a MENTION notifies - commenting does not page the whole trip. Attachments are checked against the same storage predicate the bucket policies use, and a mention of somebody who cannot see the trip is dropped rather than raised or delivered.';
grant execute on function public.fms_travel_post_comment(uuid, text, uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertion: the predicates this leans on still exist with the shapes used.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.fms_travel_doc_trip(text)') is null then
    raise exception 'fms_travel_doc_trip(text) is missing - the attachment guard cannot work';
  end if;
  if to_regprocedure('public.fms_travel_can_see_doc(text, uuid)') is null then
    raise exception 'fms_travel_can_see_doc(text, uuid) is missing - the attachment guard cannot work';
  end if;
  raise notice 'Comment thread installed; attachment guards resolve.';
end $$;

commit;
