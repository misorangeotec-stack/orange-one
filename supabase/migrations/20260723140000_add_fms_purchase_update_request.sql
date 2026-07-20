-- Domestic Purchase FMS: edit a submitted request, before sourcing begins.
--
-- Pairs with fms_purchase_cancel_request (20260723120000). Both are gated by the
-- same fms_purchase_request_editable predicate: open, and every line still an
-- untouched 'sourcing' line. Lines are matched BY ID so each keeps its identity
-- and history; recreating them would orphan activity/notifications (bare-uuid,
-- no FK) and reset the SLA clock. New lines are inserted born at 'sourcing';
-- removed lines are deleted (safe — the predicate proves no PO item exists).

begin;

create or replace function public.fms_purchase_update_request(
  p_request_id uuid,
  p_note       text,
  p_items      jsonb   -- [{id?, item_id, category_id, quantity, unit, line_remark}]
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_requester uuid;
  v_status    text;
  v_no        text;
  v_uid       uuid := auth.uid();
  v_elem      jsonb;
  v_id        uuid;
  v_cat       uuid;
  v_keep      uuid[] := '{}';
  v_hdr_cat   uuid;
  v_removed   int := 0;
begin
  select requester_id, status, request_no
    into v_requester, v_status, v_no
    from public.fms_purchase_requests where id = p_request_id for update;
  if v_status is null then raise exception 'Request not found'; end if;

  if not (v_requester = v_uid or public.is_admin(v_uid)) then
    raise exception 'Only the requester or an admin can edit this request';
  end if;

  -- Re-check state server-side. The hidden button is a courtesy, never the gate.
  if not public.fms_purchase_request_editable(p_request_id) then
    if v_status = 'cancelled' then
      raise exception 'This request has been cancelled — it can no longer be edited.';
    end if;
    raise exception 'This request can no longer be edited: sourcing has already begun on at least one of its lines.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item line is required';
  end if;

  for v_elem in select * from jsonb_array_elements(p_items) loop
    v_id  := nullif(v_elem->>'id','')::uuid;
    v_cat := nullif(v_elem->>'category_id','')::uuid;
    if coalesce((v_elem->>'quantity')::numeric, 0) <= 0 then
      raise exception 'Each item needs a quantity greater than 0';
    end if;
    if v_cat is null then raise exception 'Every line needs a category'; end if;

    if v_id is not null then
      -- EXISTING LINE. status / sourced_* / final_* left untouched (they are all
      -- null on a sourcing line anyway, but never assume — history survives edits).
      update public.fms_purchase_request_items
         set item_id     = (v_elem->>'item_id')::uuid,
             category_id = v_cat,
             quantity    = (v_elem->>'quantity')::numeric,
             unit        = coalesce(v_elem->>'unit',''),
             line_remark = nullif(v_elem->>'line_remark',''),
             edited_at   = now(),
             edited_by   = v_uid
       where id = v_id and request_id = p_request_id;   -- scoped: no cross-request write
      if not found then
        raise exception 'Line % does not belong to this request', v_id;
      end if;
    else
      insert into public.fms_purchase_request_items (request_id, item_id, category_id, quantity, unit, line_remark)
      values (
        p_request_id, (v_elem->>'item_id')::uuid, v_cat,
        (v_elem->>'quantity')::numeric, coalesce(v_elem->>'unit',''), nullif(v_elem->>'line_remark','')
      )
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  delete from public.fms_purchase_request_items
   where request_id = p_request_id and not (id = any(v_keep));
  get diagnostics v_removed = row_count;

  -- requests.category_id is NOT NULL and holds the first line's category; an edit
  -- that dropped line 1 must re-derive it.
  select category_id into v_hdr_cat
    from public.fms_purchase_request_items
   where request_id = p_request_id and category_id is not null
   order by created_at, id
   limit 1;
  if v_hdr_cat is null then raise exception 'Every line needs a category'; end if;

  update public.fms_purchase_requests
     set note        = nullif(p_note,''),
         category_id = v_hdr_cat,
         edited_at   = now(),
         edited_by   = v_uid
   where id = p_request_id;

  -- In-transaction audit. No approver re-routing here: domestic bands are set at
  -- sourcing (on the request total), which by definition has not happened yet.
  perform public.fms_purchase_announce(
    'request', p_request_id, 'request_edited',
    format('Request %s was edited by the requester before sourcing', coalesce(v_no,'')),
    '{}'::uuid[],
    jsonb_build_object('lines_to', jsonb_array_length(p_items), 'lines_removed', v_removed)
  );
end $function$;
grant execute on function public.fms_purchase_update_request(uuid, text, jsonb) to authenticated;

commit;
