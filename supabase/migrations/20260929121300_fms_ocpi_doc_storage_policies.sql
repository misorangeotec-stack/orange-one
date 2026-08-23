-- ===========================================================================
-- OCPI attachments: put the deal's own visibility rule on the bucket, not just
-- on the screen.
--
-- 20260929120000 created `fms-ocpi-docs` with four placeholder rules that said
-- only
--
--     bucket_id = 'fms-ocpi-docs'
--
-- i.e. "is this file in the OCPI bucket?". No question about who is asking. Its
-- own header called that a baseline and said, in as many words, do not ship the
-- signature loop on it. This is that migration.
--
-- What was actually exposed: every generated quotation, every order
-- confirmation, and — from the phase this replaces — every CUSTOMER-SIGNED
-- CONTRACT, readable, overwritable and deletable by any authenticated user of
-- the portal. Any app, any site, no OCPI access at all. The app never offered
-- them the deal; the app was the only thing that did not.
--
-- The fix reuses `fms_ocpi_can_see_deal` rather than restating it. The object's
-- first path segment IS the deal id
--
--     <deal-id>/<slot>/<file>          slot ∈ quotation | oc
--                                             | customer-signed | management-signed
--
-- (ocpiWrites.ts, and the RPCs refuse a path that starts anywhere else), so a
-- file can always name its own deal. One rule, two surfaces; they cannot drift.
--
-- ⚠ WRITING IS KEYED ON THE SLOT, not merely on "may this person touch the
--   deal". Countersigning is the other half of a two-party signature, so the
--   salesperson who raised the deal can file the quotation, the order
--   confirmation and the customer-signed copy — and is refused the
--   management-signed folder, exactly as fms_ocpi_record_management_sign
--   refuses them. A boundary that holds in the RPC and leaks in Storage is not
--   a boundary.
--
-- ⚠ UPDATE IS AS WIDE AS INSERT HERE, unlike the dispatch equivalent. OCPI
--   uploads with `upsert: true` and re-uses one path per order confirmation, so
--   re-submitting after management sends it back OVERWRITES rather than adds. A
--   narrower UPDATE would refuse the correction to the person whose job the
--   correction is, and would do it as "not found", which reads like data loss.
--
-- ⚠ ORPHANS BECOME ADMIN-ONLY. A file whose deal has been deleted stops
--   resolving and is refused to everyone but an admin. That is the correct
--   answer for a file nothing references; it is not a migration failure.
--
-- ⚠ THE `security_definer_function_executable` ADVISORY ON THE HELPERS CANNOT
--   BE CLEARED. Revoking EXECUTE from `public` was measured on the dispatch pair
--   (20260821120000) and the policies stop working — a policy expression is
--   evaluated with the querying role's privileges. The helpers must stay
--   callable. What that leaks is a boolean about a path the caller must already
--   know; never a file, a customer or a price. Do not "fix" it by revoking.
--
-- Reversal (reverse order):
--   -- restores the placeholder rules from 20260929120000
--   create policy "fms ocpi docs read"   on storage.objects for select to authenticated using (bucket_id = 'fms-ocpi-docs');
--   create policy "fms ocpi docs insert" on storage.objects for insert to authenticated with check (bucket_id = 'fms-ocpi-docs');
--   create policy "fms ocpi docs update" on storage.objects for update to authenticated using (bucket_id = 'fms-ocpi-docs') with check (bucket_id = 'fms-ocpi-docs');
--   create policy "fms ocpi docs delete" on storage.objects for delete to authenticated using (bucket_id = 'fms-ocpi-docs');
--   drop function if exists public.fms_ocpi_can_add_doc(text, uuid);
--   drop function if exists public.fms_ocpi_can_see_doc(text, uuid);
--   drop function if exists public.fms_ocpi_doc_deal(text);
-- ===========================================================================

begin;

/* ---------------------------------------------------------------- helpers -- */

/**
 * The deal a stored document belongs to, or null when the path names none.
 *
 * Guarded by the uuid shape because `split_part(...)::uuid` on a stray path
 * would raise, and an exception inside a policy is a 500, not a denial.
 */
create or replace function public.fms_ocpi_doc_deal(p_name text)
returns uuid
language sql
immutable
-- Empty is safe: split_part, the regex operator and the uuid cast all live in
-- pg_catalog, which stays on the path regardless. A mutable search_path on a
-- function a POLICY consults invites shadowing `split_part` from a role-local
-- schema, which would hand back whatever deal id the caller fancied.
set search_path = ''
as $fn$
  select case
           when split_part(p_name, '/', 1) ~
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           then split_part(p_name, '/', 1)::uuid
         end;
$fn$;

comment on function public.fms_ocpi_doc_deal(text) is
  'Deal id from a fms-ocpi-docs object path (<deal-id>/<slot>/<file>). Null when the path names no deal.';

/**
 * May this user READ this document? Exactly the deal's own visibility rule.
 *
 * `security definer` so the lookup is not itself filtered by the deals policy:
 * the answer must be the same whether or not the caller can select the row, and
 * a policy that depends on another policy is a trap for the next reader.
 *
 * ⚠ `is_admin` is hoisted OUT of the EXISTS on purpose. Inside it, an orphaned
 *   file resolves to no deal and the whole clause goes false — which would
 *   leave an admin able to DELETE a stray attachment but not to look at it
 *   first. Admins see everything in this product; that has to hold when the
 *   deal is gone too.
 */
create or replace function public.fms_ocpi_can_see_doc(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin(p_uid)
      or exists (
           select 1
             from public.fms_ocpi_deals d
            where d.id = public.fms_ocpi_doc_deal(p_name)
              and public.fms_ocpi_can_see_deal(p_uid, d.raised_by, d.status)
         );
$fn$;

comment on function public.fms_ocpi_can_see_doc(text, uuid) is
  'Storage read rule for fms-ocpi-docs: can this user see the deal this file hangs off? Drafts stay private to their author, exactly as the deals policy says.';

/**
 * May this user ADD or REPLACE a document here?
 *
 * Stricter than reading, and keyed on the SLOT — see the header. Ownership is
 * checked; the deal's CURRENT STATUS is not, because the RPCs already refuse a
 * step that has moved on, and re-checking it here would refuse a correction
 * to the person whose job the correction is.
 */
create or replace function public.fms_ocpi_can_add_doc(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.fms_ocpi_deals d
     where d.id = public.fms_ocpi_doc_deal(p_name)
       and (
             public.fms_ocpi_is_coordinator(p_uid)   -- admins included
          or public.fms_ocpi_can_act(
               case split_part(p_name, '/', 2)
                 when 'quotation'         then 'quotation'
                 when 'oc'                then 'order_confirmation'
                 when 'customer-signed'   then 'customer_signoff'
                 when 'management-signed' then 'management_signoff'
               end,
               d.id,
               p_uid)
          -- The salesperson who raised the deal files the three documents that
          -- pass through their hands. NOT the countersignature.
          or (d.raised_by = p_uid
              and public.module_can_edit(p_uid, 'ocpi')
              and split_part(p_name, '/', 2) in ('quotation', 'oc', 'customer-signed'))
       )
  );
$fn$;

comment on function public.fms_ocpi_can_add_doc(text, uuid) is
  'Storage write rule for fms-ocpi-docs: owner of the step that produces this slot, a coordinator, or the raiser for everything except the management-signed folder.';

/* --------------------------------------------------------------- policies -- */

-- ⚠ Policy names are GLOBAL on storage.objects. These four are unique to this
--   module — never reuse another module's names, or its `drop policy if exists`
--   would delete this one's, and vice versa.
drop policy if exists "fms ocpi docs read"   on storage.objects;
drop policy if exists "fms ocpi docs insert" on storage.objects;
drop policy if exists "fms ocpi docs update" on storage.objects;
drop policy if exists "fms ocpi docs delete" on storage.objects;

-- Read covers `createSignedUrl` too — a signed link cannot be minted for an
-- object the caller may not select, which is what makes this a real boundary
-- rather than a hidden button.
create policy "fms ocpi docs read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'fms-ocpi-docs'
    and public.fms_ocpi_can_see_doc(name, (select auth.uid()))
  );

create policy "fms ocpi docs insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'fms-ocpi-docs'
    and public.fms_ocpi_can_add_doc(name, (select auth.uid()))
  );

create policy "fms ocpi docs update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'fms-ocpi-docs'
    and public.fms_ocpi_can_add_doc(name, (select auth.uid()))
  )
  with check (
    bucket_id = 'fms-ocpi-docs'
    and public.fms_ocpi_can_add_doc(name, (select auth.uid()))
  );

-- A deleted signed contract is not recoverable and the app offers no delete at
-- all, so this is a floor for cleanup by hand, not a workflow step.
create policy "fms ocpi docs delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'fms-ocpi-docs'
    and (select public.fms_ocpi_is_coordinator((select auth.uid())))
  );

/* ------------------------------------------------------------- assertions -- */

do $$
begin
  -- The path contract this whole migration rests on.
  if public.fms_ocpi_doc_deal('11111111-2222-3333-4444-555555555555/customer-signed/1-a.jpg')
     is distinct from '11111111-2222-3333-4444-555555555555'::uuid then
    raise exception 'fms_ocpi_doc_deal no longer reads the deal id from a document path';
  end if;

  -- A malformed path must answer "no deal", never raise: an exception inside a
  -- policy surfaces as a 500 instead of a clean refusal.
  if public.fms_ocpi_doc_deal('not-a-uuid/oc/1-a.pdf') is not null then
    raise exception 'fms_ocpi_doc_deal accepted a path that names no deal';
  end if;

  -- A path naming no deal can satisfy neither rule, whoever is asking.
  if public.fms_ocpi_can_add_doc('nonsense', '00000000-0000-0000-0000-000000000000') then
    raise exception 'fms_ocpi_can_add_doc accepted a path that names no deal';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'fms ocpi docs%') <> 4 then
    raise exception 'expected exactly four fms-ocpi-docs policies';
  end if;
end $$;

commit;
