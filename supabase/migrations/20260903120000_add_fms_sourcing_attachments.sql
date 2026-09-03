-- ===========================================================================
-- Purchase FMS (Domestic + Import) — attachments on the sourcing step.
--
-- The buyer who sources a requisition holds the evidence for what they typed:
-- the vendor's emailed quotation, a photographed rate sheet, the comparison
-- worked out in Excel. None of it had anywhere to go. The approver saw three
-- vendor names, a set of rates and a free-text reason, and had to take all of
-- it on trust — so the paperwork travelled by WhatsApp and the approval record
-- kept none of it.
--
-- MULTIPLE IS THE POINT, NOT A FLOURISH. A shortlist of three vendors is three
-- quotations, and a rate comparison is usually a fourth file. A single-file
-- column would make the buyer choose which one the approver gets to see, which
-- is how the other two end up in a chat thread nobody can find later.
--
-- Two tables because the two apps source at different grains, and always have:
--   • Domestic sources a WHOLE requisition (fms_purchase_save_sourcing_request),
--     so its docs hang off the request.
--   • Import sources ONE LINE at a time (fms_import_save_sourcing), so its docs
--     hang off the request item.
-- Forcing one shape on both would put Import's files on a requisition that was
-- never sourced as a unit, and the next line sourced would appear to inherit
-- the previous line's quotations.
--
-- Purely ADDITIVE: two new tables, two new RPCs. Nothing dropped, renamed or
-- altered, and neither existing save RPC is touched — docs are written by their
-- own call, so a deploy of this SQL alone changes no existing behaviour.
--
-- Storage: no new bucket. The files go to the buckets the two apps already use
-- ('fms-purchase-docs' / 'fms-import-docs') under a 'sourcing/' prefix, so the
-- existing bucket policies and the existing signed-URL helpers apply unchanged.
--
-- Reversal (SQL-only, safe to run while the frontend is live — the UI degrades
-- to "no attachments" rather than erroring, because the fetch tolerates an
-- empty list):
--     drop function if exists public.fms_purchase_save_sourcing_docs(uuid, jsonb);
--     drop function if exists public.fms_import_save_sourcing_docs(uuid, jsonb);
--     drop table if exists public.fms_purchase_sourcing_docs;
--     drop table if exists public.fms_import_sourcing_docs;
--   ⚠ Dropping the tables ORPHANS the uploaded objects in the storage buckets —
--     the rows are the only record of their paths. Keep the tables and drop only
--     the functions if the intent is to stop new uploads.
-- ===========================================================================

-- 1. Domestic — docs per REQUISITION -----------------------------------------
create table if not exists public.fms_purchase_sourcing_docs (
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

comment on table public.fms_purchase_sourcing_docs is
  'Files attached at sourcing on a Purchase RM Domestic requisition — vendor quotations, rate comparisons, photographed sheets. Many rows per requisition; sort_order is the order the buyer arranged them in. path points into the fms-purchase-docs bucket under sourcing/. Written only by fms_purchase_save_sourcing_docs.';

create index if not exists fms_purchase_sourcing_docs_request_idx
  on public.fms_purchase_sourcing_docs (request_id, sort_order);

-- RLS mirrors fms_purchase_request_vendors (20260720130000): everyone reads —
-- the approver in the next bucket is the whole reason these exist — and only an
-- admin writes directly; every real write goes through the SECURITY DEFINER RPC.
alter table public.fms_purchase_sourcing_docs enable row level security;
drop policy if exists fms_purchase_sourcing_docs_select on public.fms_purchase_sourcing_docs;
create policy fms_purchase_sourcing_docs_select on public.fms_purchase_sourcing_docs
  for select to authenticated using (true);
drop policy if exists fms_purchase_sourcing_docs_write on public.fms_purchase_sourcing_docs;
create policy fms_purchase_sourcing_docs_write on public.fms_purchase_sourcing_docs
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- 2. Import — docs per REQUEST LINE ------------------------------------------
create table if not exists public.fms_import_sourcing_docs (
  id              uuid primary key default gen_random_uuid(),
  request_item_id uuid not null references public.fms_import_request_items on delete cascade,
  path            text not null,
  name            text not null,
  mime_type       text,
  size_bytes      bigint,
  sort_order      integer not null default 0,
  uploaded_by     uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  unique (request_item_id, path)
);

comment on table public.fms_import_sourcing_docs is
  'Files attached at sourcing on a Purchase RM Import request LINE — vendor quotations, rate comparisons, photographed sheets. Per line, not per requisition, because fms_import_save_sourcing sources one line at a time. path points into the fms-import-docs bucket under sourcing/. Written only by fms_import_save_sourcing_docs.';

create index if not exists fms_import_sourcing_docs_item_idx
  on public.fms_import_sourcing_docs (request_item_id, sort_order);

alter table public.fms_import_sourcing_docs enable row level security;
drop policy if exists fms_import_sourcing_docs_select on public.fms_import_sourcing_docs;
create policy fms_import_sourcing_docs_select on public.fms_import_sourcing_docs
  for select to authenticated using (true);
drop policy if exists fms_import_sourcing_docs_write on public.fms_import_sourcing_docs;
create policy fms_import_sourcing_docs_write on public.fms_import_sourcing_docs
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- 3. The writes ---------------------------------------------------------------
-- Deliberately SEPARATE from the two save-sourcing RPCs rather than a new
-- parameter on them. Three reasons:
--   • Those functions are long and are edited often (20260720140000,
--     20260720170000, 20261020140000 are all re-declarations of the same body).
--     Carrying them forward verbatim a fourth time to add one argument is how a
--     validation rule gets silently dropped in the copy.
--   • The upload happens before the save and can fail on its own. A separate
--     call means a dead connection mid-upload leaves the rates saveable.
--   • It keeps this migration additive: deploy the SQL, and nothing that exists
--     today behaves differently until the frontend starts calling the new name.
--
-- REPLACE-ALL, not append: the modal hands over the full list every time, so a
-- file removed in the form is removed here. The delete is scoped to the one
-- parent row and runs in the same transaction as the insert.
-- ⚠ It does NOT delete the storage object. A row removed here leaves the file
--   in the bucket. That is deliberate — these are the evidence behind a price
--   somebody approved, and an accidental removal in the form should not be the
--   thing that destroys them.

create or replace function public.fms_purchase_save_sourcing_docs(
  p_request_id uuid,
  p_docs       jsonb
)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_req_id uuid;
begin
  select id into v_req_id from public.fms_purchase_requests
   where id = p_request_id for update;
  if v_req_id is null then raise exception 'Requisition not found'; end if;

  -- Same gate as fms_purchase_save_sourcing_request. The attachments are part of
  -- the sourcing step, so they answer to the sourcing step's owner.
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('sourcing', auth.uid())) then
    raise exception 'Not authorized to source this requisition';
  end if;

  if coalesce(jsonb_array_length(p_docs), 0) > 10 then
    raise exception 'At most 10 files can be attached to a requisition''s sourcing';
  end if;

  delete from public.fms_purchase_sourcing_docs where request_id = p_request_id;

  insert into public.fms_purchase_sourcing_docs
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

create or replace function public.fms_import_save_sourcing_docs(
  p_request_item_id uuid,
  p_docs            jsonb
)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_item_id uuid;
begin
  select id into v_item_id from public.fms_import_request_items
   where id = p_request_item_id for update;
  if v_item_id is null then raise exception 'Request line not found'; end if;

  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('sourcing', auth.uid())) then
    raise exception 'Not authorized to source this line';
  end if;

  if coalesce(jsonb_array_length(p_docs), 0) > 10 then
    raise exception 'At most 10 files can be attached to a line''s sourcing';
  end if;

  delete from public.fms_import_sourcing_docs where request_item_id = p_request_item_id;

  insert into public.fms_import_sourcing_docs
    (request_item_id, path, name, mime_type, size_bytes, sort_order, uploaded_by)
  select p_request_item_id,
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

grant execute on function public.fms_purchase_save_sourcing_docs(uuid, jsonb) to authenticated;
grant execute on function public.fms_import_save_sourcing_docs(uuid, jsonb) to authenticated;
