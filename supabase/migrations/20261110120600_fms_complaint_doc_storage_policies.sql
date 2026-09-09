-- ===========================================================================
-- Complaint (RM/FG) FMS — DOCUMENT STORAGE POLICIES (Phase 7).
--
-- Replaces the four baseline bucket-id-only policies from phase 1 with ones that
-- derive the owning complaint from the object path and reuse the complaint's own
-- visibility rule.
--
-- ⚠ WHY THIS IS NOT OPTIONAL, AND WHY IT SHIPS BEFORE THE FIRST UPLOAD.
--   A policy of `bucket_id = 'fms-complaint-docs'` lets ANY authenticated user
--   mint a signed URL for ANY object in the bucket. That was discovered on the
--   dispatch bucket (20260821120000) and fixed the same way. It matters more
--   here: a complaint photograph carries a named customer's grievance and a
--   named vendor's failure, and the lab report carries our own analysis of why
--   our product failed.
--
-- Path contract: <complaint-id>/<slot>/<epoch>-<filename>
--   The FIRST SEGMENT is the complaint id. That is what makes this work, and it
--   is why data/complaintWrites.ts builds the path rather than the caller.
--
-- ⚠ Policy names are GLOBAL on storage.objects — these four keep the exact names
--   phase 1 created, so this migration REPLACES them rather than adding a second
--   overlapping set. (Postgres ORs multiple permissive policies together, so a
--   leftover baseline policy would silently defeat the whole hardening.)
--
-- Reversal: drop these four and re-create the phase-1 bucket-id-only versions.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- The complaint id from an object path. Null when the path names no complaint.
--
-- ⚠ `set search_path = ''` IS DELIBERATE AND LOAD-BEARING. split_part, the regex
--   operator and the uuid cast all live in pg_catalog, which stays on the path
--   regardless. A mutable search_path on a function that a POLICY consults
--   invites shadowing `split_part` from a role-local schema, which would hand
--   back whatever complaint id the caller fancied.
--
-- ⚠ THE UUID SHAPE IS CHECKED BEFORE THE CAST. An invalid cast raises, and an
--   exception inside a policy is a 500 to the client, not a denial.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_doc_request(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
           when split_part(p_name, '/', 1) ~
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           then split_part(p_name, '/', 1)::uuid
         end;
$$;

comment on function public.fms_complaint_doc_request(text) is
  'Complaint id from a fms-complaint-docs object path (<complaint-id>/<slot>/<file>). Null when the path names no complaint.';


-- ---------------------------------------------------------------------------
-- May this user READ this object? Exactly the complaint's own visibility rule.
--
-- `security definer` so the lookup is not itself filtered by the requests
-- policy: the answer must be the same whether or not the caller can select the
-- row, and a policy that depends on another policy is a trap for the next reader.
--
-- ⚠ `is_admin` is hoisted OUT of the EXISTS on purpose. Inside it, an ORPHANED
--   file (its complaint deleted) resolves to no complaint and the whole clause
--   goes false — which would leave an admin able to DELETE a stray attachment
--   but not to look at it first. Admins see everything in this product; that has
--   to hold when the complaint is gone too.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_can_see_doc(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_complaint_can_see_request(public.fms_complaint_doc_request(p_name), p_uid);
$$;
grant execute on function public.fms_complaint_can_see_doc(text, uuid) to authenticated;

-- May this user ADD or REMOVE an object here? Seeing it is not enough — a
-- view-only grant reads every screen in this module and must not be able to
-- attach evidence to somebody else's complaint.
create or replace function public.fms_complaint_can_write_doc(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.module_can_edit(p_uid, 'complaint')
     and public.fms_complaint_can_see_request(public.fms_complaint_doc_request(p_name), p_uid);
$$;
grant execute on function public.fms_complaint_can_write_doc(text, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- The four policies, replacing phase 1's baseline by the same names.
-- ---------------------------------------------------------------------------
drop policy if exists "fms complaint docs read"   on storage.objects;
drop policy if exists "fms complaint docs insert" on storage.objects;
drop policy if exists "fms complaint docs update" on storage.objects;
drop policy if exists "fms complaint docs delete" on storage.objects;

create policy "fms complaint docs read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-complaint-docs'
    and (select public.fms_complaint_can_see_doc(name, (select auth.uid())))
  );

create policy "fms complaint docs insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fms-complaint-docs'
    and (select public.fms_complaint_can_write_doc(name, (select auth.uid())))
  );

create policy "fms complaint docs update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fms-complaint-docs'
    and (select public.fms_complaint_can_write_doc(name, (select auth.uid())))
  )
  with check (
    bucket_id = 'fms-complaint-docs'
    and (select public.fms_complaint_can_write_doc(name, (select auth.uid())))
  );

create policy "fms complaint docs delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fms-complaint-docs'
    and (select public.fms_complaint_can_write_doc(name, (select auth.uid())))
  );


do $mig$
begin
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'fms complaint docs %') <> 4 then
    raise exception 'Complaint: expected exactly 4 fms-complaint-docs storage policies';
  end if;

  -- The hardening actually landed: every one of the four must consult the
  -- path-derived helper, not merely the bucket id.
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'fms complaint docs %'
       and coalesce(qual, '') || coalesce(with_check, '') not like '%fms_complaint_can_%_doc%'
  ) then
    raise exception 'Complaint: a storage policy is still bucket-id-only — any user could read any complaint document';
  end if;

  -- A malformed path must yield null, never an exception inside a policy.
  if public.fms_complaint_doc_request('not-a-uuid/evidence/1.jpg') is not null then
    raise exception 'Complaint: doc_request should return null for a non-uuid first segment';
  end if;
end $mig$;

commit;
