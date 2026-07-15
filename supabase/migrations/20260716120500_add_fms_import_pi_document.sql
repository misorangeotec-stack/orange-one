-- ===========================================================================
-- Purchase FMS — attach a Vendor PI document (PDF / any file) to a PI.
-- Additive only: two new nullable columns on fms_import_pis, one private
-- storage bucket for the files, and two extra trailing params on the
-- fms_import_add_pi RPC so the uploaded file can be linked at insert time.
-- ===========================================================================

-- 1. Columns -----------------------------------------------------------------
alter table public.fms_import_pis
  add column if not exists document_path text,   -- storage object path in fms-import-docs
  add column if not exists document_name text;   -- original filename for display

-- 2. Private storage bucket for PI documents ---------------------------------
insert into storage.buckets (id, name, public)
values ('fms-import-docs', 'fms-import-docs', false)
on conflict (id) do nothing;

-- Any authenticated portal user may read/write PI docs (mirrors the module's
-- "signed-in user under RLS" model; the bucket is private so links are signed).
drop policy if exists "fms import docs read"   on storage.objects;
drop policy if exists "fms import docs insert" on storage.objects;
drop policy if exists "fms import docs update" on storage.objects;
drop policy if exists "fms import docs delete" on storage.objects;

create policy "fms import docs read" on storage.objects
  for select to authenticated using (bucket_id = 'fms-import-docs');
create policy "fms import docs insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'fms-import-docs');
create policy "fms import docs update" on storage.objects
  for update to authenticated using (bucket_id = 'fms-import-docs') with check (bucket_id = 'fms-import-docs');
create policy "fms import docs delete" on storage.objects
  for delete to authenticated using (bucket_id = 'fms-import-docs');

-- 3. Recreate the add-PI RPC with the document params ------------------------
drop function if exists public.fms_import_add_pi(uuid, text, jsonb, text, numeric, date);
create or replace function public.fms_import_add_pi(
  p_po_id uuid,
  p_vendor_pi_no text,
  p_items jsonb,           -- [{po_item_id, qty}]
  p_payment_terms text default 'on_delivery',
  p_pi_value numeric default 0,
  p_dispatch_date date default null,
  p_document_path text default null,
  p_document_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pi_id uuid; v_elem jsonb;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to add PIs';
  end if;
  if nullif(p_vendor_pi_no,'') is null then raise exception 'Vendor PI number is required'; end if;

  insert into public.fms_import_pis (po_id, vendor_pi_no, payment_terms, pi_value, dispatch_date, document_path, document_name, created_by)
  values (p_po_id, p_vendor_pi_no, coalesce(nullif(p_payment_terms,''),'on_delivery'), coalesce(p_pi_value,0), p_dispatch_date,
          nullif(p_document_path,''), nullif(p_document_name,''), auth.uid())
  returning id into v_pi_id;

  if p_items is not null then
    for v_elem in select * from jsonb_array_elements(p_items) loop
      if coalesce((v_elem->>'qty')::numeric,0) > 0 then
        insert into public.fms_import_pi_items (pi_id, po_item_id, qty)
        values (v_pi_id, (v_elem->>'po_item_id')::uuid, (v_elem->>'qty')::numeric);
      end if;
    end loop;
  end if;

  update public.fms_import_pos set status = case when status='generated' then 'shared' else status end where id = p_po_id;
  return v_pi_id;
end $$;
grant execute on function public.fms_import_add_pi(uuid, text, jsonb, text, numeric, date, text, text) to authenticated;
