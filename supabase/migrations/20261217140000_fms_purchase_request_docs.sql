-- ===========================================================================
-- Purchase (Domestic): optional attachments on a NEW PURCHASE REQUEST.
--
-- WHY
--   The requester often has the thing that explains the request best - a photo
--   of the worn part, the old invoice, a drawing, a sample label - and had
--   nowhere to put it. It went by WhatsApp and never reached the buyer or the
--   approver. Now the requester can attach any files when raising (or editing)
--   the request, and every later step shows them in its reference block.
--
-- Same shape and storage as the sourcing attachments (20260903120000): one row
-- per file, the files in the existing 'fms-purchase-docs' bucket under a
-- 'requests/' prefix, so the existing bucket policies and signed-URL helper
-- apply unchanged. A separate table, not a flag on the sourcing one, because
-- the two answer to different people: the sourcing save REPLACES its whole
-- list, and must never be able to wipe what the requester attached.
--
-- ADDITIVE ONLY: one new table, one new function. Nothing existing changes.
--
-- Reversal:
--   drop function if exists public.fms_purchase_save_request_docs(uuid, jsonb);
--   drop table if exists public.fms_purchase_request_docs;
--   ⚠ Dropping the table ORPHANS the uploaded objects - the rows are the only
--     record of their paths. Drop only the function to stop new uploads.
-- ===========================================================================

create table if not exists public.fms_purchase_request_docs (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.fms_purchase_requests on delete cascade,
  path         text not null,
  name         text not null,
  mime_type    text,
  size_bytes   bigint,
  sort_order   integer not null default 0,
  uploaded_by  uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  unique (request_id, path)
);

comment on table public.fms_purchase_request_docs is
  'Files the requester attached when raising / editing a Purchase Domestic requisition. Optional, many per requisition. path points into the fms-purchase-docs bucket under requests/. Written only by fms_purchase_save_request_docs.';

create index if not exists fms_purchase_request_docs_request_idx
  on public.fms_purchase_request_docs (request_id, sort_order);

-- Everyone reads (every later step shows them); only an admin writes directly,
-- every real write goes through the SECURITY DEFINER function below.
alter table public.fms_purchase_request_docs enable row level security;
drop policy if exists fms_purchase_request_docs_select on public.fms_purchase_request_docs;
create policy fms_purchase_request_docs_select on public.fms_purchase_request_docs
  for select to authenticated using (true);
drop policy if exists fms_purchase_request_docs_write on public.fms_purchase_request_docs;
create policy fms_purchase_request_docs_write on public.fms_purchase_request_docs
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- REPLACE-ALL: the form hands over the full list every time, so a file removed
-- in the form is removed here. It does NOT delete the storage object.
create or replace function public.fms_purchase_save_request_docs(
  p_request_id uuid,
  p_docs       jsonb
)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_req public.fms_purchase_requests%rowtype;
begin
  select * into v_req from public.fms_purchase_requests
   where id = p_request_id for update;
  if v_req.id is null then raise exception 'Requisition not found'; end if;

  if not (public.is_admin(auth.uid()) or v_req.requester_id = auth.uid()) then
    raise exception 'Only the person who raised this request can change its attachments';
  end if;

  if v_req.status = 'cancelled' then
    raise exception 'This request is cancelled; its attachments can no longer change';
  end if;

  if coalesce(jsonb_array_length(p_docs), 0) > 10 then
    raise exception 'At most 10 files can be attached to a request';
  end if;

  delete from public.fms_purchase_request_docs where request_id = p_request_id;

  insert into public.fms_purchase_request_docs
    (request_id, path, name, mime_type, size_bytes, sort_order, uploaded_by)
  select p_request_id,
         e->>'path',
         coalesce(nullif(e->>'name',''), 'Attachment'),
         nullif(e->>'mime_type',''),
         nullif(e->>'size_bytes','')::bigint,
         (ord - 1)::integer,
         auth.uid()
    from jsonb_array_elements(coalesce(p_docs, '[]'::jsonb)) with ordinality as t(e, ord)
   where nullif(e->>'path','') is not null;
end;
$function$;

revoke all on function public.fms_purchase_save_request_docs(uuid, jsonb) from public, anon;
grant execute on function public.fms_purchase_save_request_docs(uuid, jsonb) to authenticated;
