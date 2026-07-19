-- Import FMS: let a requester EDIT or CANCEL their own request, but only while
-- nobody has acted on it.
--
-- Until now a submitted request was final for the person who raised it: at
-- status 'approval' — where every import line is born — the only actions are
-- Approve (approver-only) and Re-source (step-owner-only). A typo in a quantity
-- meant asking an approver to reject it.
--
-- The rule, in one sentence: a request may be edited or cancelled while it is
-- 'open' and EVERY one of its lines is still at approval/on_hold. One approval,
-- one rejection, or one individually-cancelled line locks the whole request.
--
-- Follows the RPC contract set out in 20260719120000_add_fms_import_stage_edits.sql:
-- a stable *_editable() predicate + RPCs that re-check authz AND state
-- SERVER-side (the disabled button is a courtesy, never the gate), take a row
-- lock, stamp edited_at/edited_by, and announce IN THIS TRANSACTION.
--
-- Authz shape is lifted from fms_supplies_cancel_request (20260715170000:495) —
-- the only other requester-owned mutation in the FMS suite — minus coordinators.

begin;

-- ---- 1. columns --------------------------------------------------------------
-- fms_import_requests had none of these. Note edited_* rather than updated_*:
-- the table carries a set_updated_at trigger that fires on every write, so
-- updated_at cannot distinguish "a human corrected this" from any other touch.
-- fms_import_request_items ALREADY has edited_at / edited_by / cancel_reason.

alter table public.fms_import_requests
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references auth.users on delete set null,
  add column if not exists edited_at     timestamptz,
  add column if not exists edited_by     uuid references auth.users on delete set null;

comment on column public.fms_import_requests.cancel_reason is
  'Why the requester (or an admin) cancelled this request. Required by '
  'fms_import_cancel_request. The request is KEPT — import requests are never '
  'hard-deleted, so the approver who already saw it keeps a record of it.';

-- ---- 2. the predicate --------------------------------------------------------
-- ONE predicate, deliberately shared by Edit and Cancel: the two verbs unlock
-- and lock together, so there is a single rule to reason about.

create or replace function public.fms_import_request_editable(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_import_requests r
     where r.id = p_request_id
       and r.status = 'open'
       -- A request with no lines would pass the NOT EXISTS below vacuously.
       -- submit_request requires >= 1 line so it cannot occur, but the predicate
       -- should not lean on that.
       and exists (
         select 1 from public.fms_import_request_items ri where ri.request_id = r.id
       )
       -- THE RULE. 'rejected' and 'cancelled' count as decisions too: someone
       -- authorised has already acted, and an edit would otherwise resurrect a
       -- line an approver deliberately turned down.
       and not exists (
         select 1 from public.fms_import_request_items ri
          where ri.request_id = r.id
            and ri.status not in ('approval','on_hold')
       )
       -- Defence in depth. fms_import_po_items.request_item_id is ON DELETE
       -- RESTRICT, so removing a line that reached a PO would surface a raw
       -- 23503 instead of a sentence a human can read. The status test above
       -- already excludes that; this makes it impossible rather than unlikely.
       and not exists (
         select 1
           from public.fms_import_po_items pit
           join public.fms_import_request_items ri on ri.id = pit.request_item_id
          where ri.request_id = r.id
       )
  );
$$;
grant execute on function public.fms_import_request_editable(uuid) to authenticated;

comment on function public.fms_import_request_editable(uuid) is
  'True while a request may still be edited OR cancelled by its requester: open, '
  'has lines, and EVERY line is still at approval/on_hold with no PO item. One '
  'approval, rejection or line-cancellation anywhere locks the whole request.';

-- ---- 3. update_request -------------------------------------------------------
-- Line diff strategy: UPSERT BY ID, never replace-all. Replace-all would
-- silently destroy four things:
--   * fms_import_activity / _notifications key entities by a BARE uuid with no
--     FK, so recreated line ids orphan their own history — and RequestDetail
--     renders the timeline by matching those ids;
--   * assigned_approver_id, a coordinator's manual routing;
--   * sourced_at, which anchors the SLA — resetting it makes an overdue request
--     look freshly raised in the Control Center;
--   * it would make the po_items RESTRICT load-bearing for data integrity
--     rather than merely for policy.

create or replace function public.fms_import_update_request(
  p_request_id uuid,
  p_note       text,
  p_fx_rate    numeric,
  p_items      jsonb   -- [{id?, item_id, category_id, quantity, unit, rate, line_remark}]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid;
  v_status    text;
  v_vendor    uuid;
  v_ccy       text;
  v_no        text;
  v_uid       uuid := auth.uid();
  v_fx        numeric(18,6);
  v_elem      jsonb;
  v_id        uuid;
  v_qty       numeric(14,3);
  v_rate      numeric(16,4);
  v_cat       uuid;
  v_val_fx    numeric(16,2);
  v_val_inr   numeric(16,2);
  v_keep      uuid[] := '{}';
  v_hdr_cat   uuid;
  v_old_total numeric(16,2);
  v_new_total numeric(16,2);
  v_old_appr  uuid[];
  v_new_appr  uuid[];
  v_cleared   int := 0;
  v_removed   int := 0;
begin
  select requester_id, status, vendor_id, currency, request_no
    into v_requester, v_status, v_vendor, v_ccy, v_no
    from public.fms_import_requests where id = p_request_id for update;
  if v_status is null then raise exception 'Request not found'; end if;

  if not (v_requester = v_uid or public.is_admin(v_uid)) then
    raise exception 'Only the requester or an admin can edit this request';
  end if;

  -- Re-check state server-side. The hidden button is a courtesy, never the gate.
  if not public.fms_import_request_editable(p_request_id) then
    if v_status = 'cancelled' then
      raise exception 'This request has been cancelled — it can no longer be edited.';
    end if;
    raise exception 'This request can no longer be edited: a decision has already been recorded on at least one of its lines.';
  end if;

  v_fx := coalesce(p_fx_rate, 0);
  if v_fx <= 0 then raise exception 'A valid exchange rate is required'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item line is required';
  end if;

  -- Who owns these lines TODAY, before the write. A coordinator's override wins
  -- over the matrix band, exactly as decide_approval treats it.
  select coalesce(array_agg(distinct a) filter (where a is not null), '{}')
    into v_old_appr
    from (
      select coalesce(ri.assigned_approver_id,
             (select m.approver_user_id from public.fms_import_approval_matrix m
               where m.active and ri.line_value >= m.min_amount
                 and (m.max_amount is null or ri.line_value <= m.max_amount)
               order by m.sort_order, m.min_amount limit 1)) as a
        from public.fms_import_request_items ri where ri.request_id = p_request_id
    ) t;
  select coalesce(sum(line_value), 0) into v_old_total
    from public.fms_import_request_items where request_id = p_request_id;

  -- ---- upsert the lines ------------------------------------------------------
  for v_elem in select * from jsonb_array_elements(p_items) loop
    v_id   := nullif(v_elem->>'id','')::uuid;
    v_qty  := coalesce((v_elem->>'quantity')::numeric, 0);
    v_rate := coalesce((v_elem->>'rate')::numeric, 0);
    v_cat  := nullif(v_elem->>'category_id','')::uuid;
    if v_qty <= 0 then raise exception 'Each item needs a quantity greater than 0'; end if;
    if v_rate < 0 then raise exception 'Rate cannot be negative'; end if;
    if v_cat is null then raise exception 'Every line needs a category'; end if;

    -- Mirrors submit_request's math exactly — no GST on an import line.
    v_val_fx  := round(v_qty * v_rate, 2);
    v_val_inr := round(v_val_fx * v_fx, 2);

    if v_id is not null then
      -- EXISTING LINE. status / approver_id / approval_tier / assigned_approver_id
      -- / sourced_at / created_at are deliberately untouched: identity and
      -- history survive an edit.
      update public.fms_import_request_items
         set item_id            = (v_elem->>'item_id')::uuid,
             category_id        = v_cat,
             quantity           = v_qty,
             unit               = coalesce(v_elem->>'unit',''),
             line_remark        = nullif(v_elem->>'line_remark',''),
             final_qty          = v_qty,
             final_rate         = v_rate,
             currency           = v_ccy,
             fx_rate_at_request = v_fx,
             line_value_fx      = v_val_fx,
             line_value         = v_val_inr,
             edited_at          = now(),
             edited_by          = v_uid
       -- Scoped to the request, so a forged id cannot reach another request's line.
       where id = v_id and request_id = p_request_id;
      if not found then
        raise exception 'Line % does not belong to this request', v_id;
      end if;
    else
      -- NEW LINE, born exactly as submit_request births one.
      insert into public.fms_import_request_items (
        request_id, item_id, category_id, quantity, unit, line_remark,
        final_vendor_id, final_qty, final_rate, gst_pct, currency,
        fx_rate_at_request, line_value_fx, line_value, status, sourced_at
      ) values (
        p_request_id, (v_elem->>'item_id')::uuid, v_cat, v_qty,
        coalesce(v_elem->>'unit',''), nullif(v_elem->>'line_remark',''),
        v_vendor, v_qty, v_rate, null, v_ccy,
        v_fx, v_val_fx, v_val_inr, 'approval', now()
      )
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  -- Drop the lines the user removed. Safe: the predicate proved no po_item
  -- (ON DELETE RESTRICT) exists, and quotations cascade. Activity keyed to a
  -- REMOVED line is knowingly orphaned — that is the cost of removal, not of
  -- editing.
  delete from public.fms_import_request_items
   where request_id = p_request_id and not (id = any(v_keep));
  get diagnostics v_removed = row_count;

  -- ---- header ----------------------------------------------------------------
  -- requests.category_id is NOT NULL and holds the FIRST line's category, so an
  -- edit that dropped line 1 must re-derive it.
  select category_id into v_hdr_cat
    from public.fms_import_request_items
   where request_id = p_request_id and category_id is not null
   order by created_at, id
   limit 1;
  if v_hdr_cat is null then raise exception 'Every line needs a category'; end if;

  update public.fms_import_requests
     set note        = nullif(p_note,''),
         category_id = v_hdr_cat,
         edited_at   = now(),
         edited_by   = v_uid
   where id = p_request_id;

  -- ---- re-route --------------------------------------------------------------
  select coalesce(sum(line_value), 0) into v_new_total
    from public.fms_import_request_items where request_id = p_request_id;

  -- A coordinator's manual reassignment was a decision about the OLD amount. If
  -- the matrix band has moved, keeping it would make "edit the qty" a way to
  -- park a large line with a junior approver. Cleared ONLY where the band
  -- actually changed — an untouched line keeps its override.
  with banded as (
    select ri.id, ri.assigned_approver_id,
           (select m.approver_user_id from public.fms_import_approval_matrix m
             where m.active and ri.line_value >= m.min_amount
               and (m.max_amount is null or ri.line_value <= m.max_amount)
             order by m.sort_order, m.min_amount limit 1) as band_approver
      from public.fms_import_request_items ri
     where ri.request_id = p_request_id
  )
  update public.fms_import_request_items ri
     set assigned_approver_id = null
    from banded b
   where ri.id = b.id
     and b.assigned_approver_id is not null
     and b.band_approver is distinct from b.assigned_approver_id;
  get diagnostics v_cleared = row_count;

  select coalesce(array_agg(distinct a) filter (where a is not null), '{}')
    into v_new_appr
    from (
      select coalesce(ri.assigned_approver_id,
             (select m.approver_user_id from public.fms_import_approval_matrix m
               where m.active and ri.line_value >= m.min_amount
                 and (m.max_amount is null or ri.line_value <= m.max_amount)
               order by m.sort_order, m.min_amount limit 1)) as a
        from public.fms_import_request_items ri where ri.request_id = p_request_id
    ) t;

  -- In-transaction audit + fan-out. ONE announce to the UNION of the old and new
  -- approvers: the previous owner learns it left their queue, the new one learns
  -- it arrived. announce already dedupes and skips the actor, so the raw union is
  -- safe. One call, not two — two would write two activity rows for one edit.
  perform public.fms_import_announce(
    'request', p_request_id, 'request_edited',
    format('Request %s was edited by the requester — please re-check before approving',
           coalesce(v_no, '')),
    v_old_appr || v_new_appr,
    jsonb_build_object(
      'total_from', v_old_total,
      'total_to',   v_new_total,
      'fx_rate_to', v_fx,
      'lines_to',   jsonb_array_length(p_items),
      'lines_removed', v_removed,
      'band_changed', (v_old_appr is distinct from v_new_appr),
      'reassignments_cleared', v_cleared
    )
  );
end $$;
grant execute on function public.fms_import_update_request(uuid, text, numeric, jsonb) to authenticated;

-- ---- 4. cancel_request -------------------------------------------------------

create or replace function public.fms_import_cancel_request(
  p_request_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid;
  v_status    text;
  v_no        text;
  v_uid       uuid := auth.uid();
  v_appr      uuid[];
  v_lines     int;
begin
  select requester_id, status, request_no
    into v_requester, v_status, v_no
    from public.fms_import_requests where id = p_request_id for update;
  if v_status is null then raise exception 'Request not found'; end if;

  if not (v_requester = v_uid or public.is_admin(v_uid)) then
    raise exception 'Only the requester or an admin can cancel this request';
  end if;
  if v_status = 'cancelled' then
    raise exception 'This request is already cancelled';
  end if;
  if not public.fms_import_request_editable(p_request_id) then
    raise exception 'This request can no longer be cancelled: a decision has already been recorded on at least one of its lines. Cancel the individual lines instead.';
  end if;
  -- A reason is required, mirroring fms_supplies_cancel_request.
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to cancel';
  end if;

  select coalesce(array_agg(distinct a) filter (where a is not null), '{}')
    into v_appr
    from (
      select coalesce(ri.assigned_approver_id,
             (select m.approver_user_id from public.fms_import_approval_matrix m
               where m.active and ri.line_value >= m.min_amount
                 and (m.max_amount is null or ri.line_value <= m.max_amount)
               order by m.sort_order, m.min_amount limit 1)) as a
        from public.fms_import_request_items ri where ri.request_id = p_request_id
    ) t;

  update public.fms_import_requests
     set status        = 'cancelled',
         cancel_reason = trim(p_reason),
         cancelled_at  = now(),
         cancelled_by  = v_uid
   where id = p_request_id;

  -- LOAD-BEARING, and the easiest thing in this feature to forget. Every queue
  -- and the list rollup read LINE status, never requests.status. Cancelling only
  -- the header would leave the request in the approver's queue forever, with its
  -- SLA clock still ticking in the Control Center.
  update public.fms_import_request_items
     set status        = 'cancelled',
         cancel_reason = trim(p_reason),
         edited_at     = now(),
         edited_by     = v_uid
   where request_id = p_request_id
     and status in ('approval','on_hold');
  get diagnostics v_lines = row_count;

  perform public.fms_import_announce(
    'request', p_request_id, 'request_cancelled',
    format('Request %s was cancelled by the requester — %s',
           coalesce(v_no, ''), trim(p_reason)),
    v_appr,
    jsonb_build_object(
      'status_from', v_status,
      'status_to',   'cancelled',
      'reason',      trim(p_reason),
      'lines_cancelled', v_lines
    )
  );
end $$;
grant execute on function public.fms_import_cancel_request(uuid, text) to authenticated;

commit;
