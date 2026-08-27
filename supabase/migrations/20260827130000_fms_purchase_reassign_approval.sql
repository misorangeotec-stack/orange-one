-- ===========================================================================
-- Purchase RM (Domestic) FMS — an approver may HAND A REQUISITION to someone else.
--
-- The port of 20260827120000_fms_import_reassign_approval.sql to Purchase. Read
-- that file first; this header records only what is DIFFERENT here, because the
-- two modules route approvals differently and the differences are load-bearing.
--
-- WHAT A HANDOVER MEANS (unchanged from Import)
-- ONE REQUISITION AT A TIME, and it MOVES. Once handed over, the requisition
-- leaves the band's queue and only the holder (or an admin) may decide it. It is
-- not a standing "stand-in for everything while I am away"; that was considered
-- and set aside — see PD-1 in WORKLIST.md.
--
-- ⚠ DIFFERENCE 1 — THERE IS NO fms_purchase_is_approver, AND THERE CANNOT BE.
-- Import routes to a flat list of configured approvers, so a one-argument helper
-- can answer "may this person approve?". Purchase routes by AMOUNT BAND
-- (fms_purchase_approval_matrix, `order by sort_order, min_amount limit 1`), so
-- the answer depends on the requisition. Every rule below therefore resolves the
-- band inline into v_approvers, exactly as the approval RPCs already do, rather
-- than calling a helper. Do not add one: a helper that ignored the amount would
-- be wrong in the only way that matters.
--
-- ⚠ DIFFERENCE 2 — FOUR RPCs CARRY THE HOLDER RULE, NOT THREE.
--   * fms_purchase_decide_approval_request  (request-scoped, what the UI calls)
--   * fms_purchase_update_approval_request  (request-scoped revise, before the PO)
--   * fms_purchase_decide_approval          (LEGACY per-line)
--   * fms_purchase_update_approval          (LEGACY per-line revise)
-- All four already carried `is_admin OR band member OR assigned_approver_id =
-- auth.uid()`. As an OR that is a SHARE, not a move: a band member could still
-- decide a requisition handed to somebody else, and it would stay in his queue.
-- Sections 3-6 replace it with a holder rule in all four.
-- The two per-line RPCs are unreachable from the UI (`decideApproval` /
-- `updateApproval` exist in the store with no page calling them — the FIX-4
-- orphan class) but both are granted to `authenticated`, so leaving them alone
-- would leave the bypass open. This is the same shape of hole the Import audit
-- found, though NOT the same cause: Purchase's line_value is a real figure, so
-- its band lookup is at least meaningful. It is still per-LINE, which means a
-- band that covers one cheap line is enough to reach it.
--
-- ⚠ DIFFERENCE 3 — TEN CLEAR-SITES, SPLIT 8 STOP / 2 KEEP.
-- assigned_approver_id was nulled at every terminal decision. Cleared, the holder
-- can approve but then cannot REVISE her own decision before the PO, because
-- fms_purchase_update_approval_request reads that column on approved_pending_po
-- lines and would find nothing. So it now SURVIVES the decision — which also
-- keeps the trail readable — at eight of the ten sites:
--
--   STOP clearing (8):  decide_approval_request  approve, override→approved, reject
--                       update_approval_request  reject
--                       decide_approval (line)   approve, override, reject
--                       update_approval (line)   reject
--
--   KEEP clearing (2):  decide_approval_request  BLOCK+RE-ROUTE arm
--                       update_approval_request  BLOCK+RE-ROUTE arm
--
-- The two kept sites are the arms where an override or an edit pushed the total
-- into a DIFFERENT band. A re-route genuinely voids the handover: the requisition
-- now belongs to a different set of people, and the person it was handed to has
-- no standing over the new band's work. Clearing there is what lets every member
-- of the new band pick it up.
--
-- ⚠ DIFFERENCE 4 — THE OVERRIDE ARM HAD TO LEARN ABOUT THE HOLDER.
-- After an override, both request-scoped RPCs re-derive the band and ask "may the
-- caller approve at the NEW band?" — `is_admin or auth.uid() = any(v_approvers)`.
-- A holder is by definition NOT a band member, so an override by the holder would
-- have re-routed even when the band did not change, silently undoing the handover
-- she was in the middle of acting on. The test now also passes for the holder
-- WHEN THE BAND IS THE SAME ROW (v_band1 is not distinct from v_band0). If the
-- band actually changed, the re-route stands and the holder is cleared — which is
-- the whole point of the two kept clear-sites above.
--
-- ADDITIVE, per the repo rule:
--   * No table, column or function is dropped. assigned_approver_id already
--     exists on fms_purchase_request_items (20260630160000).
--   * Every create-or-replace keeps its EXACT current argument list. Changing a
--     signature would create a PostgREST OVERLOAD, not a replacement.
--   * The pool is a row in the existing fms_purchase_config key/value singleton
--     (key 'reassign_pool'), not a new table.
--
-- NO SERVER-SIDE ANNOUNCE HERE, DELIBERATELY. fms_purchase_announce builds the
-- email_outbox payload straight from p_meta, and every key send-email renders is
-- authored in the app's lib/emailMeta.ts. A `perform fms_purchase_announce` inside
-- this RPC would mail the receiver a blank-looking card. The store raises it
-- client-side instead. The reason text travels with that announce, which is why
-- there is no p_note parameter here.
--
-- REVERSAL — REHEARSED ON LIVE DATA 2026-08-27, run for real against
-- icutjkrqkbzwvmnfbzpr inside a transaction that was then rolled back, with a
-- handover deliberately IN FLIGHT so the recipe met the state it would actually
-- meet. 8 of 8 checks passed, and both claims this header makes about the recipe
-- were tested rather than asserted:
--
--   * THE DROP ORDER IS NOT ENFORCED — confirmed. Dropping
--     fms_purchase_can_receive_reassignment while fms_purchase_reassign_request
--     still referenced it was ACCEPTED, and the breakage appeared only at call
--     time ('function ... does not exist'). Same finding as the Import rehearsal.
--   * STEP 4 IS OPTIONAL — confirmed. With assigned_approver_id back to all NULL,
--     the four new bodies behave exactly like the pre-migration ones: an outsider
--     still gets 'Not authorized to approve this requisition' (and 'Not authorized
--     to approve this line' from the per-line RPC), a band member still passes.
--
-- The recipe, in the order to run it:
--   1. drop function public.fms_purchase_reassign_request(uuid, uuid);
--      drop function public.fms_purchase_can_receive_reassignment(uuid);
--      (helper LAST, so no call can land mid-window. Note that Postgres does NOT
--       enforce this order — a reference from inside a string-quoted function
--       body is not dependency-tracked, as the Import rehearsal proved — so the
--       order is about keeping the broken window short, not about being refused.)
--   2. update public.fms_purchase_request_items set assigned_approver_id = null
--       where assigned_approver_id is not null;
--   3. delete from public.fms_purchase_config where key = 'reassign_pool';
--   4. (optional, and only to make the source match the files) re-run the four
--      function bodies from
--        20260725130000_fms_purchase_approval_line_overrides.sql  (sections for
--          fms_purchase_decide_approval_request, fms_purchase_update_approval_request)
--        20260720160000_fms_purchase_multi_approver_bands.sql     (sections for
--          fms_purchase_decide_approval, fms_purchase_update_approval)
--      Once assigned_approver_id is back to all NULL (step 2) the holder branches
--      are unreachable and the new bodies behave exactly like the old ones, so
--      nothing observable depends on this step.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Who may RECEIVE a handover.
--
-- Backed by fms_purchase_config key 'reassign_pool':
--     { "department_ids": [...], "user_ids": [...] }
--
-- ⚠ AUTHORIZATION COMES SOLELY FROM user_ids. department_ids is a UI filter for
--   CHOOSING people in Setup and grants nothing — the same rule every FMS
--   step-owner table follows (20261005120000_add_fms_travel_foundations.sql).
--   Do not start reading department_ids here.
--
-- Shape mirrors fms_purchase_is_coordinator
-- (20260630160000_add_fms_purchase_activity_notifications.sql).
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_can_receive_reassignment(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_purchase_config c
     where c.key = 'reassign_pool'
       and p_uid::text in (
         select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
       )
  );
$$;

comment on function public.fms_purchase_can_receive_reassignment(uuid) is
  'Is this user on the configured list of people who may be handed a Purchase approval? Reads ONLY fms_purchase_config.reassign_pool -> user_ids; department_ids in that same row is a Setup picker filter and grants nothing.';

grant execute on function public.fms_purchase_can_receive_reassignment(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Hand a requisition over (or take it back).
--
-- p_approver_id NULL = return it to the band. That is the "take it back" path,
-- and it is why this is one RPC rather than two.
--
-- WHO MAY CALL IT is deliberately BROADER than who may decide: a member of the
-- current band keeps the right to pull a requisition back after handing it over,
-- which the holder rule in sections 3-6 would otherwise deny him. Same shape as
-- fms_hr_reassign_interview — whoever owes the work may pass it on, and work
-- already done cannot be handed over at all.
--
-- WHO MAY RECEIVE is the pool OR a member of the current band. The second arm is
-- what lets a requisition be handed BACK to a specific approver without an admin
-- having to also list every band member in the pool.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_reassign_request(
  p_request_id  uuid,
  p_approver_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_ids       uuid[];
  v_count     integer;
  v_total     numeric(16,2);
  v_approvers uuid[];
  v_is_holder boolean;
begin
  perform 1 from public.fms_purchase_request_items
   where request_id = p_request_id and status in ('approval','on_hold')
   for update;

  select array_agg(id), count(*), coalesce(sum(line_value),0),
         bool_or(assigned_approver_id = v_uid)
    into v_ids, v_count, v_total, v_is_holder
    from public.fms_purchase_request_items
   where request_id = p_request_id and status in ('approval','on_hold');

  if coalesce(v_count, 0) = 0 then
    raise exception 'Nothing on this requisition is awaiting approval — it can no longer be reassigned';
  end if;

  -- The CURRENT band, resolved exactly the way the approval RPCs resolve it, so
  -- the two can never disagree about who owns this requisition.
  select approver_user_ids into v_approvers
    from public.fms_purchase_approval_matrix
   where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(v_uid)
          or v_uid = any(coalesce(v_approvers, '{}'::uuid[]))
          or coalesce(v_is_holder, false)) then
    raise exception 'Not authorized to reassign this requisition';
  end if;

  if p_approver_id is not null then
    if p_approver_id = v_uid then
      raise exception 'Pick someone else — a requisition cannot be reassigned to yourself';
    end if;
    if not (public.fms_purchase_can_receive_reassignment(p_approver_id)
            or p_approver_id = any(coalesce(v_approvers, '{}'::uuid[]))) then
      raise exception 'That person may not receive an approval. Add them in Setup, under the approval matrix, first.';
    end if;
  end if;

  -- ⚠ status is NOT touched. A line the approver put on hold stays on hold;
  --   forcing status='approval' here would silently RESUME a held line as a side
  --   effect of handing it over, which is what Import's removed reassign_line did.
  update public.fms_purchase_request_items
     set assigned_approver_id = p_approver_id
   where id = any(v_ids);
end $$;

comment on function public.fms_purchase_reassign_request(uuid, uuid) is
  'Hand one Purchase requisition awaiting approval to another person, or pass NULL to return it to the amount band. Callable by an admin, any member of the requisition''s current band, or the current holder. Does not announce - the store raises the notification client-side so the email renders with content.';

grant execute on function public.fms_purchase_reassign_request(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. decide_approval_request — the holder rule.
--    Base body = 20260725130000_fms_purchase_approval_line_overrides.sql.
--    Deltas, and ONLY these four:
--      * the three-arm OR becomes a holder rule (a handover MOVES the work);
--      * assigned_approver_id is no longer cleared on approve / override-approved
--        / reject — but IS still cleared on the BLOCK+RE-ROUTE arm;
--      * the band row id is captured before and after an override, so the holder
--        may approve when the band did not change (see DIFFERENCE 4 above);
--      * v_handed / v_is_holder / v_band0 / v_band1 declared.
--    Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_decide_approval_request(
  p_request_id         uuid,
  p_decision           text,
  p_override_vendor_id uuid default null,
  p_reason             text default '',
  p_lines              jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids       uuid[];
  v_total     numeric(16,2);
  v_count     integer;
  v_approvers uuid[];
  v_tier      text;
  v_line      record;
  v_elem      jsonb;
  v_vendor    uuid;
  v_qty       numeric(14,3);
  v_qrate     numeric(14,2);
  v_qgst      numeric(6,2);
  v_lead      integer;
  v_qrate2    numeric(14,2);
  v_qgst2     numeric(6,2);
  v_lead2     integer;
  v_result    text := 'ok';
  v_handed    boolean;
  v_is_holder boolean;
  v_band0     uuid;
  v_band1     uuid;
begin
  perform 1 from public.fms_purchase_request_items
   where request_id = p_request_id and status in ('approval','on_hold')
   for update;

  select array_agg(ri.id), count(*), coalesce(sum(ri.line_value),0)
    into v_ids, v_count, v_total
    from public.fms_purchase_request_items ri
   where ri.request_id = p_request_id and ri.status in ('approval','on_hold');

  if coalesce(v_count,0) = 0 then
    raise exception 'No items on this requisition are awaiting approval';
  end if;

  -- Authorisation against the CURRENT band.
  select id, approver_user_ids, tier_label into v_band0, v_approvers, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
   order by sort_order, min_amount limit 1;

  -- A HANDOVER MOVES THE WORK. While assigned_approver_id is set, the holder is
  -- the only non-admin who may decide — this is deliberately NOT an OR against
  -- band membership, or the handover would merely SHARE the requisition and it
  -- would stay in the band's queue too.
  select bool_or(assigned_approver_id is not null),
         bool_or(assigned_approver_id = auth.uid())
    into v_handed, v_is_holder
    from public.fms_purchase_request_items
   where id = any(v_ids);

  if public.is_admin(auth.uid()) then
    null;
  elsif coalesce(v_handed, false) then
    if not coalesce(v_is_holder, false) then
      raise exception 'This requisition has been reassigned — only the person holding it may decide it';
    end if;
  elsif not (auth.uid() = any(coalesce(v_approvers, '{}'::uuid[]))) then
    raise exception 'Not authorized to approve this requisition';
  end if;

  if p_decision = 'approve' then
    update public.fms_purchase_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, approved_at = now()
     where id = any(v_ids);

  elsif p_decision = 'override' then
    -- Vendor is OPTIONAL: an override may change only qty/rate/gst and keep the
    -- sourced vendor. But an override with neither a vendor nor line edits is a
    -- no-op we reject, to keep the old "needs a vendor" guarantee meaningful.
    if p_override_vendor_id is null and p_lines is null then
      raise exception 'Override needs a vendor or item changes';
    end if;
    if p_override_vendor_id is not null then
      if not (
        exists (select 1 from public.fms_purchase_request_vendors
                 where request_id = p_request_id and vendor_id = p_override_vendor_id)
        or exists (select 1 from public.fms_purchase_quotations q
                     join public.fms_purchase_request_items ri on ri.id = q.request_item_id
                    where ri.request_id = p_request_id and q.vendor_id = p_override_vendor_id)
      ) then
        raise exception 'The override vendor must be one of the shortlisted vendors';
      end if;
    end if;

    for v_line in
      select id, final_qty, final_rate, gst_pct, lead_time_days, final_vendor_id
        from public.fms_purchase_request_items where id = any(v_ids)
    loop
      v_vendor := coalesce(p_override_vendor_id, v_line.final_vendor_id);
      v_qty    := v_line.final_qty;
      v_qrate  := v_line.final_rate;
      v_qgst   := v_line.gst_pct;
      v_lead   := v_line.lead_time_days;

      select e into v_elem
        from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
       where (e->>'request_item_id')::uuid = v_line.id
       limit 1;

      if v_elem is not null then
        if nullif(v_elem->>'final_qty','')  is not null then v_qty   := (v_elem->>'final_qty')::numeric;  end if;
        if nullif(v_elem->>'final_rate','') is not null then v_qrate := (v_elem->>'final_rate')::numeric; end if;
        v_qgst := nullif(v_elem->>'gst_pct','')::numeric;   -- explicit clear allowed
        if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be greater than 0'; end if;
        if v_qrate is null or v_qrate < 0 then raise exception 'Enter a rate of 0 or more for every item'; end if;
      elsif p_override_vendor_id is not null then
        -- Vendor changed but this line was not hand-edited: keep the old flow and
        -- adopt the new vendor's quoted price when it has one.
        select rate, gst_pct, lead_time_days into v_qrate2, v_qgst2, v_lead2
          from public.fms_purchase_quotations
         where request_item_id = v_line.id and vendor_id = p_override_vendor_id limit 1;
        if v_qrate2 is not null then v_qrate := v_qrate2; v_qgst := v_qgst2; v_lead := v_lead2; end if;
      end if;

      update public.fms_purchase_request_items
         set final_vendor_id = v_vendor,
             final_qty       = v_qty,
             final_rate      = v_qrate,
             gst_pct         = v_qgst,
             lead_time_days  = v_lead,
             line_value      = round(v_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2)
       where id = v_line.id;

      -- Keep quotations consistent with the decided price for the effective vendor.
      if v_vendor is not null then
        delete from public.fms_purchase_quotations where request_item_id = v_line.id;
        insert into public.fms_purchase_quotations
          (request_item_id, vendor_id, rate, gst_pct, lead_time_days, is_recommended)
        values (v_line.id, v_vendor, v_qrate, v_qgst, v_lead, true);
      end if;
    end loop;

    -- Re-derive the band from the NEW total.
    select coalesce(sum(line_value),0) into v_total
      from public.fms_purchase_request_items where id = any(v_ids);
    select id, approver_user_ids, tier_label into v_band1, v_approvers, v_tier
      from public.fms_purchase_approval_matrix
     where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
     order by sort_order, min_amount limit 1;

    if p_override_vendor_id is not null then
      update public.fms_purchase_request_vendors
         set is_recommended = (vendor_id = p_override_vendor_id)
       where request_id = p_request_id;
    end if;

    -- ⚠ The holder counts here ONLY while the band is unchanged. A holder is by
    --   definition not a band member, so without this arm her own override would
    --   re-route the requisition away from her and silently undo the handover she
    --   was in the middle of acting on.
    if public.is_admin(auth.uid())
       or auth.uid() = any(coalesce(v_approvers, '{}'::uuid[]))
       or (coalesce(v_is_holder, false) and v_band1 is not distinct from v_band0) then
      update public.fms_purchase_request_items
         set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
             reject_reason = null, approved_at = now()
       where id = any(v_ids);
      v_result := 'approved';
    else
      -- BLOCK + RE-ROUTE: keep the new numbers, send it back to the band that now
      -- owns the raised total. ⚠ assigned_approver_id IS cleared here, and this is
      -- one of only two places that still clears it: the requisition has changed
      -- band, so the handover is void and every member of the NEW band picks it up.
      update public.fms_purchase_request_items
         set status = 'approval', approval_tier = v_tier, assigned_approver_id = null, approved_at = null
       where id = any(v_ids);
      perform public.fms_purchase_announce('request', p_request_id, 'approval_rerouted',
        format('An override raised this requisition to %s (%s) — routed for approval.',
               coalesce(v_tier,'a higher tier'), v_total),
        coalesce(v_approvers, '{}'::uuid[]),
        jsonb_build_object('tier', v_tier, 'total', v_total));
      return 'rerouted';
    end if;

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_purchase_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason
     where id = any(v_ids);

  elsif p_decision = 'hold' then
    update public.fms_purchase_request_items set status = 'on_hold' where id = any(v_ids);

  elsif p_decision = 'resume' then
    update public.fms_purchase_request_items set status = 'approval', approved_at = null
     where id = any(v_ids);

  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  perform public.fms_purchase_announce('request', p_request_id, 'approval_' || p_decision,
    format('Approval decision on the requisition (%s), %s item(s), %s', p_decision, v_count, v_total),
    '{}'::uuid[], jsonb_build_object('decision', p_decision, 'lines', v_count, 'total', v_total));

  return v_result;
end $$;


-- ---------------------------------------------------------------------------
-- 4. update_approval_request — the same deltas as (3).
--
--    This is the REVISE path: it runs on approved_pending_po lines, before the
--    PO exists. It is the reason assigned_approver_id must survive the decision
--    at all — it reads that column, and if section 3 had gone on clearing it the
--    holder could approve and then be locked out of changing her own decision.
--    Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_update_approval_request(
  p_request_id         uuid,
  p_decision           text,
  p_override_vendor_id uuid default null,
  p_reason             text default '',
  p_lines              jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids       uuid[];
  v_total     numeric(16,2);
  v_count     integer;
  v_bad       integer;
  v_approvers uuid[];
  v_tier      text;
  v_line      record;
  v_elem      jsonb;
  v_vendor    uuid;
  v_qty       numeric(14,3);
  v_qrate     numeric(14,2);
  v_qgst      numeric(6,2);
  v_lead      integer;
  v_qrate2    numeric(14,2);
  v_qgst2     numeric(6,2);
  v_lead2     integer;
  v_result    text := 'ok';
  v_handed    boolean;
  v_is_holder boolean;
  v_band0     uuid;
  v_band1     uuid;
begin
  select count(*) into v_bad from public.fms_purchase_request_items
   where request_id = p_request_id and status = 'po';
  if v_bad > 0 then
    raise exception 'A PO has already been generated for this requisition — the approval can no longer be changed.';
  end if;

  perform 1 from public.fms_purchase_request_items
   where request_id = p_request_id and status = 'approved_pending_po'
   for update;

  select array_agg(ri.id), count(*), coalesce(sum(ri.line_value),0)
    into v_ids, v_count, v_total
    from public.fms_purchase_request_items ri
   where ri.request_id = p_request_id and ri.status = 'approved_pending_po';

  if coalesce(v_count,0) = 0 then
    raise exception 'This requisition has no approved decision awaiting a PO.';
  end if;

  select id, approver_user_ids, tier_label into v_band0, v_approvers, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
   order by sort_order, min_amount limit 1;

  select bool_or(assigned_approver_id is not null),
         bool_or(assigned_approver_id = auth.uid())
    into v_handed, v_is_holder
    from public.fms_purchase_request_items
   where id = any(v_ids);

  if public.is_admin(auth.uid()) then
    null;
  elsif coalesce(v_handed, false) then
    if not coalesce(v_is_holder, false) then
      raise exception 'This requisition has been reassigned — only the person holding it may change this approval';
    end if;
  elsif not (auth.uid() = any(coalesce(v_approvers, '{}'::uuid[]))) then
    raise exception 'Not authorized to change this approval';
  end if;

  if p_decision = 'approve' then
    update public.fms_purchase_request_items
       set approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
           edited_at = now(), edited_by = auth.uid()
     where id = any(v_ids);

  elsif p_decision = 'override' then
    if p_override_vendor_id is null and p_lines is null then
      raise exception 'Override needs a vendor or item changes';
    end if;
    if p_override_vendor_id is not null then
      if not (
        exists (select 1 from public.fms_purchase_request_vendors
                 where request_id = p_request_id and vendor_id = p_override_vendor_id)
        or exists (select 1 from public.fms_purchase_quotations q
                     join public.fms_purchase_request_items ri on ri.id = q.request_item_id
                    where ri.request_id = p_request_id and q.vendor_id = p_override_vendor_id)
      ) then
        raise exception 'The override vendor must be one of the shortlisted vendors';
      end if;
    end if;

    for v_line in
      select id, final_qty, final_rate, gst_pct, lead_time_days, final_vendor_id
        from public.fms_purchase_request_items where id = any(v_ids)
    loop
      v_vendor := coalesce(p_override_vendor_id, v_line.final_vendor_id);
      v_qty    := v_line.final_qty;
      v_qrate  := v_line.final_rate;
      v_qgst   := v_line.gst_pct;
      v_lead   := v_line.lead_time_days;

      select e into v_elem
        from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
       where (e->>'request_item_id')::uuid = v_line.id
       limit 1;

      if v_elem is not null then
        if nullif(v_elem->>'final_qty','')  is not null then v_qty   := (v_elem->>'final_qty')::numeric;  end if;
        if nullif(v_elem->>'final_rate','') is not null then v_qrate := (v_elem->>'final_rate')::numeric; end if;
        v_qgst := nullif(v_elem->>'gst_pct','')::numeric;
        if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be greater than 0'; end if;
        if v_qrate is null or v_qrate < 0 then raise exception 'Enter a rate of 0 or more for every item'; end if;
      elsif p_override_vendor_id is not null then
        select rate, gst_pct, lead_time_days into v_qrate2, v_qgst2, v_lead2
          from public.fms_purchase_quotations
         where request_item_id = v_line.id and vendor_id = p_override_vendor_id limit 1;
        if v_qrate2 is not null then v_qrate := v_qrate2; v_qgst := v_qgst2; v_lead := v_lead2; end if;
      end if;

      update public.fms_purchase_request_items
         set final_vendor_id = v_vendor,
             final_qty       = v_qty,
             final_rate      = v_qrate,
             gst_pct         = v_qgst,
             lead_time_days  = v_lead,
             line_value      = round(v_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
             edited_at       = now(),
             edited_by       = auth.uid()
       where id = v_line.id;

      if v_vendor is not null then
        delete from public.fms_purchase_quotations where request_item_id = v_line.id;
        insert into public.fms_purchase_quotations
          (request_item_id, vendor_id, rate, gst_pct, lead_time_days, is_recommended)
        values (v_line.id, v_vendor, v_qrate, v_qgst, v_lead, true);
      end if;
    end loop;

    select coalesce(sum(line_value),0) into v_total
      from public.fms_purchase_request_items where id = any(v_ids);
    select id, approver_user_ids, tier_label into v_band1, v_approvers, v_tier
      from public.fms_purchase_approval_matrix
     where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
     order by sort_order, min_amount limit 1;

    if p_override_vendor_id is not null then
      update public.fms_purchase_request_vendors
         set is_recommended = (vendor_id = p_override_vendor_id)
       where request_id = p_request_id;
    end if;

    -- Holder counts only while the band is unchanged — see section 3.
    if public.is_admin(auth.uid())
       or auth.uid() = any(coalesce(v_approvers, '{}'::uuid[]))
       or (coalesce(v_is_holder, false) and v_band1 is not distinct from v_band0) then
      update public.fms_purchase_request_items
         set approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
             edited_at = now(), edited_by = auth.uid()
       where id = any(v_ids);
      v_result := 'approved';
    else
      -- BLOCK + RE-ROUTE: move it back to `approval` under the new band.
      -- ⚠ The second and last place assigned_approver_id is still cleared.
      update public.fms_purchase_request_items
         set status = 'approval', approval_tier = v_tier, assigned_approver_id = null,
             approved_at = null, edited_at = now(), edited_by = auth.uid()
       where id = any(v_ids);
      perform public.fms_purchase_announce('request', p_request_id, 'approval_rerouted',
        format('An edit raised this requisition to %s (%s) — routed for approval.',
               coalesce(v_tier,'a higher tier'), v_total),
        coalesce(v_approvers, '{}'::uuid[]),
        jsonb_build_object('tier', v_tier, 'total', v_total));
      return 'rerouted';
    end if;

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_purchase_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           approved_at = null,
           edited_at = now(), edited_by = auth.uid()
     where id = any(v_ids);

  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  perform public.fms_purchase_announce('request', p_request_id, 'approval_edited',
    format('Approval decision changed (%s)', p_decision), '{}'::uuid[],
    jsonb_build_object('decision', p_decision, 'lines', v_count));

  return v_result;
end $$;


-- ---------------------------------------------------------------------------
-- 5. decide_approval — the LEGACY per-line RPC. Closing the bypass.
--
--    No page calls it (the store's `decideApproval` is an orphan trigger-less
--    method, the FIX-4 class) but it is granted to `authenticated`, and its band
--    lookup is per-LINE: a band that covers one cheap line of a big requisition
--    is enough to reach it. Without the holder rule a band member could decide a
--    handed-over line straight through PostgREST.
--    Base body = 20260720160000_fms_purchase_multi_approver_bands.sql.
--    Deltas: holder rule; stop clearing on approve / override / reject.
--    Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_decide_approval(
  p_request_item_id    uuid,
  p_decision           text,
  p_override_vendor_id uuid default null,
  p_reason             text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_value     numeric(16,2);
  v_approvers uuid[];
  v_tier      text;
  v_qrate     numeric(14,2);
  v_qgst      numeric(6,2);
  v_assigned  uuid;
begin
  select status, line_value, assigned_approver_id
    into v_status, v_value, v_assigned
    from public.fms_purchase_request_items where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if v_status not in ('approval','on_hold') then
    raise exception 'This line is not awaiting approval (status %)', v_status;
  end if;

  select approver_user_ids, tier_label into v_approvers, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_value >= min_amount and (max_amount is null or v_value <= max_amount)
   order by sort_order, min_amount limit 1;

  -- The holder rule, as a REPLACEMENT for the old three-arm OR.
  if public.is_admin(auth.uid()) then
    null;
  elsif v_assigned is not null then
    if v_assigned <> auth.uid() then
      raise exception 'This line has been reassigned — only the person holding it may decide it';
    end if;
  elsif not (auth.uid() = any(coalesce(v_approvers, '{}'::uuid[]))) then
    raise exception 'Not authorized to approve this line';
  end if;

  if p_decision = 'approve' then
    update public.fms_purchase_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, approved_at = now()
     where id = p_request_item_id;

  elsif p_decision = 'override' then
    if p_override_vendor_id is null then raise exception 'Override needs a vendor'; end if;
    select rate, gst_pct into v_qrate, v_qgst from public.fms_purchase_quotations
      where request_item_id = p_request_item_id and vendor_id = p_override_vendor_id limit 1;
    if v_qrate is null then raise exception 'Override vendor must be one of the quoted vendors'; end if;
    update public.fms_purchase_quotations set is_recommended = (vendor_id = p_override_vendor_id)
      where request_item_id = p_request_item_id;
    update public.fms_purchase_request_items
       set final_vendor_id = p_override_vendor_id, final_rate = v_qrate, gst_pct = v_qgst,
           line_value = round(final_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
           status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, approved_at = now()
     where id = p_request_item_id;

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_purchase_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason
     where id = p_request_item_id;

  elsif p_decision = 'hold' then
    update public.fms_purchase_request_items set status = 'on_hold' where id = p_request_item_id;

  elsif p_decision = 'resume' then
    update public.fms_purchase_request_items set status = 'approval', approved_at = null
     where id = p_request_item_id;

  else
    raise exception 'Unknown decision %', p_decision;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 6. update_approval — the LEGACY per-line revise. Same treatment as (5).
--    Deltas: holder rule; stop clearing on reject. Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_update_approval(
  p_line_id            uuid,
  p_decision           text,
  p_override_vendor_id uuid default null,
  p_reason             text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_value numeric(16,2); v_approvers uuid[]; v_tier text;
  v_qrate numeric(14,2); v_qgst numeric(6,2); v_assigned uuid;
begin
  select status, line_value, assigned_approver_id into v_status, v_value, v_assigned
    from public.fms_purchase_request_items where id = p_line_id for update;
  if v_status is null then raise exception 'Line not found'; end if;

  if not public.fms_purchase_approval_editable(p_line_id) then
    if v_status = 'po' then
      raise exception 'The PO has already been generated for this line — the approval can no longer be changed.';
    elsif v_status in ('rejected','cancelled') then
      raise exception 'This line is % — its approval can no longer be changed.', v_status;
    end if;
    raise exception 'This line is not an approved decision awaiting its PO (status %).', v_status;
  end if;

  select approver_user_ids, tier_label into v_approvers, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_value >= min_amount and (max_amount is null or v_value <= max_amount)
   order by sort_order, min_amount limit 1;

  if public.is_admin(auth.uid()) then
    null;
  elsif v_assigned is not null then
    if v_assigned <> auth.uid() then
      raise exception 'This line has been reassigned — only the person holding it may change this approval';
    end if;
  elsif not (auth.uid() = any(coalesce(v_approvers, '{}'::uuid[]))) then
    raise exception 'Not authorized to change this approval';
  end if;

  if p_decision = 'approve' then
    update public.fms_purchase_request_items
       set approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
           edited_at = now(), edited_by = auth.uid()
     where id = p_line_id;

  elsif p_decision = 'override' then
    if p_override_vendor_id is null then raise exception 'Override needs a vendor'; end if;
    select rate, gst_pct into v_qrate, v_qgst from public.fms_purchase_quotations
      where request_item_id = p_line_id and vendor_id = p_override_vendor_id limit 1;
    if v_qrate is null then raise exception 'Override vendor must be one of the quoted vendors'; end if;
    update public.fms_purchase_quotations set is_recommended = (vendor_id = p_override_vendor_id)
      where request_item_id = p_line_id;
    update public.fms_purchase_request_items
       set final_vendor_id = p_override_vendor_id, final_rate = v_qrate, gst_pct = v_qgst,
           line_value = round(final_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
           approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
           edited_at = now(), edited_by = auth.uid()
     where id = p_line_id;

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_purchase_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           approved_at = null,
           edited_at = now(), edited_by = auth.uid()
     where id = p_line_id;
  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  perform public.fms_purchase_announce('line', p_line_id, 'approval_edited',
    format('Approval decision changed (%s)', p_decision), '{}'::uuid[],
    jsonb_build_object('decision', p_decision));
end $$;

commit;
