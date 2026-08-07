-- Order to Dispatch attachments: put the order's own visibility rule on the
-- bucket, not just on the screen.
--
-- 20260820120000 made an order invisible to anyone who does not own a step at
-- its location -- the rows genuinely stop at the database. It left HALF a
-- boundary: the sales invoice and the receiver copy attached to that same order
-- sit in Storage, and the four rules guarding them said only
--
--     bucket_id = 'fms-dispatch-docs'
--
-- i.e. "is this file in the dispatch bucket?". No question about who is asking.
-- Any authenticated user of the portal -- any app, any site, no dispatch access
-- at all -- could mint a signed URL for any invoice or delivery proof, and could
-- upload into and DELETE from the bucket. The app never offered them the order;
-- the app was the only thing that didn't.
--
-- The fix reuses `fms_dispatch_can_see_order` rather than restating it. The
-- object's first path segment IS the order id
--
--     <order-id>/r<n>/invoice|receiver/<epoch>-<filename>
--
-- (`dispatchWrites.ts` -> uploadStepDocument), so a file can always name its own
-- order. One rule, two surfaces; they cannot drift apart.
--
-- ⚠ ORPHANS BECOME ADMIN-ONLY. Every file whose order has been deleted stops
--   resolving and is refused to everyone but an admin. At the time of writing
--   that is all 12 objects in the bucket -- residue of test orders removed weeks
--   ago, with no row anywhere still pointing at them. That is the correct answer
--   for a file nothing references; it is not a migration failure.
--
-- ⚠ THE `security_definer_function_executable` ADVISORY ON THE TWO HELPERS
--   CANNOT BE CLEARED. Revoking EXECUTE from `public` was tried and measured:
--   the policies stop working ("permission denied for function ..."), because a
--   policy expression is evaluated with the querying role's privileges. So the
--   helpers must stay callable, and an authenticated user can ask them "may
--   user X read file Y" over the REST rpc endpoint. That leaks a boolean about
--   a path they must already know -- never a file, a customer or a quantity --
--   and it is the same shape as every other `fms_dispatch_*` predicate,
--   including `fms_dispatch_can_see_order` itself. Do not "fix" it by revoking.

begin;

/* ---------------------------------------------------------------- helpers -- */

/**
 * The order a stored document belongs to, or null when the path cannot name one.
 *
 * Guarded by the uuid shape because `split_part(...)::uuid` on a stray path
 * would raise, and an exception inside a policy is a 500, not a denial.
 */
create or replace function public.fms_dispatch_doc_order(p_name text)
returns uuid
language sql
immutable
-- Empty is safe: split_part, the regex operator and the uuid cast all live in
-- pg_catalog, which stays on the path regardless. A mutable search_path on a
-- function a POLICY consults invites shadowing `split_part` from a role-local
-- schema, which would hand back whatever order id the caller fancied.
set search_path = ''
as $$
  select case
           when split_part(p_name, '/', 1) ~
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           then split_part(p_name, '/', 1)::uuid
         end;
$$;

comment on function public.fms_dispatch_doc_order(text) is
  'Order id from a fms-dispatch-docs object path (<order-id>/r<n>/<folder>/<file>). Null when the path names no order.';

/**
 * May this user READ this document? Exactly the order's own visibility rule.
 *
 * `security definer` so the lookup is not itself filtered by the orders policy:
 * the answer must be the same whether or not the caller can select the row, and
 * a policy that depends on another policy is a trap for the next reader.
 *
 * ⚠ `is_admin` is hoisted OUT of the EXISTS on purpose. Inside it, an orphaned
 *   file resolves to no order and the whole clause goes false -- which left an
 *   admin able to DELETE a stray attachment but not to look at it first. Admins
 *   see everything in this product; that has to hold when the order is gone too.
 */
create or replace function public.fms_dispatch_can_see_doc(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or exists (
           select 1
             from public.fms_dispatch_orders o
            where o.id = public.fms_dispatch_doc_order(p_name)
              and public.fms_dispatch_can_see_order(p_uid, o.location_id, o.raised_by)
         );
$$;

comment on function public.fms_dispatch_can_see_doc(text, uuid) is
  'Storage read rule for fms-dispatch-docs: can this user see the order this file hangs off?';

/**
 * May this user ADD a document here?
 *
 * Stricter than reading, and deliberately keyed on the FOLDER: the invoice is
 * produced by the billing step and the receiver copy by delivery confirmation,
 * so owning gate-out is not a licence to file an invoice.
 *
 * ⚠ Ownership is checked, the order's CURRENT STEP is not. `update_sales_bill`
 *   and `amend_round` both re-upload against an order that has already moved on;
 *   gating on the live step would refuse a correction to the person whose job
 *   the correction is.
 */
create or replace function public.fms_dispatch_can_add_doc(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.fms_dispatch_orders o
     where o.id = public.fms_dispatch_doc_order(p_name)
       and (
             public.is_admin(p_uid)
          or public.fms_dispatch_is_coordinator(p_uid)
          or public.fms_dispatch_is_step_owner(
               case split_part(p_name, '/', 3)
                 when 'invoice'  then 'sales_bill'
                 when 'receiver' then 'dispatch_confirm'
               end,
               p_uid,
               o.location_id)
       )
  );
$$;

comment on function public.fms_dispatch_can_add_doc(text, uuid) is
  'Storage write rule for fms-dispatch-docs: owner of the step that produces this folder, at this order''s location.';

/* ----------------------------------------------------------------- policies -- */

drop policy if exists "fms dispatch docs read"   on storage.objects;
drop policy if exists "fms dispatch docs insert" on storage.objects;
drop policy if exists "fms dispatch docs update" on storage.objects;
drop policy if exists "fms dispatch docs delete" on storage.objects;

-- Read covers `createSignedUrl` too -- a signed link cannot be minted for an
-- object the caller may not select, which is what makes this a real boundary
-- rather than a hidden button.
create policy "fms dispatch docs read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'fms-dispatch-docs'
    and public.fms_dispatch_can_see_doc(name, (select auth.uid()))
  );

create policy "fms dispatch docs insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'fms-dispatch-docs'
    and public.fms_dispatch_can_add_doc(name, (select auth.uid()))
  );

-- The app uploads with `upsert: false` and never moves or renames, so nothing
-- in the product needs UPDATE. Kept narrow rather than dropped: without a
-- policy an overwrite fails as "not found", which reads like data loss.
create policy "fms dispatch docs update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'fms-dispatch-docs'
    and (public.is_admin((select auth.uid()))
         or public.fms_dispatch_is_coordinator((select auth.uid())))
  )
  with check (
    bucket_id = 'fms-dispatch-docs'
    and (public.is_admin((select auth.uid()))
         or public.fms_dispatch_is_coordinator((select auth.uid())))
  );

-- A deleted invoice is not recoverable and the app offers no delete at all, so
-- this is a floor for cleanup by hand, not a workflow step.
create policy "fms dispatch docs delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'fms-dispatch-docs'
    and (public.is_admin((select auth.uid()))
         or public.fms_dispatch_is_coordinator((select auth.uid())))
  );

/* -------------------------------------------------------------- assertions -- */

do $$
begin
  -- The path contract this whole migration rests on.
  if public.fms_dispatch_doc_order('11111111-2222-3333-4444-555555555555/r1/invoice/1-a.pdf')
     is distinct from '11111111-2222-3333-4444-555555555555'::uuid then
    raise exception 'fms_dispatch_doc_order no longer reads the order id from a document path';
  end if;

  -- A malformed path must answer "no order", never raise: an exception inside a
  -- policy surfaces as a 500 instead of a clean refusal.
  if public.fms_dispatch_doc_order('not-a-uuid/r1/invoice/1-a.pdf') is not null then
    raise exception 'fms_dispatch_doc_order accepted a path that names no order';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'fms dispatch docs%') <> 4 then
    raise exception 'expected exactly four fms-dispatch-docs policies';
  end if;
end $$;

commit;
