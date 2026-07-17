-- ===========================================================================
-- Purchase FMS — close the re-share hole in fms_purchase_share_po.
--
-- THE BUG (live until this migration)
-- share_po has never guarded against being run twice. Its UPDATE is
-- unconditional on the PO id, so a second call silently overwrites
-- document_path / document_name / tally_po_no / share_remarks / payment_terms /
-- dispatch_date — at ANY point in the PO's life. After the PI is collected.
-- After the advance is paid. After the goods have landed. Nothing stopped it.
--
-- Only `shared_at` was protected (`coalesce(shared_at, now())`), which made the
-- damage worse rather than better: the PO's terms could change while its
-- "shared on" stamp still pointed at the original moment, so the record looked
-- untouched.
--
-- No UI reaches this today — both callers gate on `current_stage = 'share_po'`
-- (PoDetail's action bar and the Share PO queue's poInSharePo predicate) — so
-- this was reachable via a direct RPC call or a stale client. That is exactly
-- the kind of hole that stays harmless right up until it isn't.
--
-- THE FIX
-- share_po becomes what its name says: the STEP, performable once. Corrections
-- go through fms_purchase_update_share_po (20260718120000), which refuses once
-- the next step is done. The two now have a clean split:
--   • share_po        — do the step. Once.
--   • update_share_po — amend it, while amending is still safe.
--
-- Also adds the `for update` this function never had: without it, two owners
-- sharing the same PO at once could both pass the new guard.
--
-- Replace-only: one function body. No table, column or row is touched.
-- Verified before writing: 0 POs sit at `share_po` with a `shared_at` already
-- set, so no legitimate first share is blocked by this.
-- ===========================================================================

create or replace function public.fms_purchase_share_po(
  p_po_id uuid,
  p_document_path text default null,
  p_document_name text default null,
  p_tally_po_no text default null,
  p_remarks text default null,
  p_payment_terms text default null,
  p_dispatch_date date default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_shared_at timestamptz;
  v_stage     text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to share this PO';
  end if;

  -- Lock first: the guard below is a check-then-write, so without this two
  -- concurrent shares could both read a null shared_at and both proceed.
  select shared_at, current_stage into v_shared_at, v_stage
    from public.fms_purchase_pos where id = p_po_id for update;
  if v_stage is null then raise exception 'PO not found'; end if;

  if v_stage in ('closed','cancelled') then
    raise exception 'This PO is % — it can no longer be shared.', v_stage;
  end if;

  -- THE GUARD. Sharing is a one-time step; changing what was recorded is an edit.
  if v_shared_at is not null then
    raise exception 'This PO has already been shared. Use Edit on the Share PO stage to correct its details.';
  end if;

  if nullif(p_document_path,'') is null then
    raise exception 'The PO PDF is required to mark the PO shared';
  end if;
  if nullif(p_tally_po_no,'') is null then
    raise exception 'The Tally PO number is required to mark the PO shared';
  end if;
  if p_dispatch_date is null then
    raise exception 'The expected dispatch date is required to mark the PO shared';
  end if;
  if nullif(p_payment_terms,'') is not null
     and p_payment_terms not in ('full_advance','partial_advance','credit','on_delivery') then
    raise exception 'Invalid payment terms';
  end if;

  update public.fms_purchase_pos
     set status        = case when status = 'generated' then 'shared' else status end,
         current_stage = case when current_stage = 'share_po' then 'collect_pi' else current_stage end,
         document_path = nullif(p_document_path,''),
         document_name = nullif(p_document_name,''),
         tally_po_no   = nullif(p_tally_po_no,''),
         share_remarks = nullif(p_remarks,''),
         payment_terms = coalesce(nullif(p_payment_terms,''), payment_terms),
         dispatch_date = p_dispatch_date,
         -- Kept as coalesce rather than a bare now()/auth.uid(): the guard above
         -- already makes this the first share, so the two are equivalent — but if
         -- the guard is ever relaxed, these must still not steal attribution.
         shared_at     = coalesce(shared_at, now()),
         shared_by     = coalesce(shared_by, auth.uid())
   where id = p_po_id;
end $$;
grant execute on function public.fms_purchase_share_po(uuid, text, text, text, text, text, date) to authenticated;
