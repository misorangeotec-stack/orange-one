-- ===========================================================================
-- Travel Desk attachments: put the trip's own visibility rule on the bucket.
--
-- 20261005120000 created `fms-travel-docs` with four placeholder policies whose
-- whole condition was
--
--     bucket_id = 'fms-travel-docs'
--
-- i.e. "is this file in the travel bucket?" — no question about who is asking.
-- Any authenticated user of the portal could mint a signed URL for any ticket,
-- any hotel folio and any receipt, and could upload into and DELETE from the
-- bucket. Its own header said not to ship the claim on it. This is that fix, and
-- it lands BEFORE the first document is uploaded rather than after.
--
-- ⚠ IT MATTERS MORE HERE THAN IN MOST MODULES. A hotel folio says where a named
--   person slept; a receipt says what they spent and with whom. That is not
--   commercial data, it is personal data about a colleague.
--
-- The rule is not restated — it reuses `fms_travel_can_see_trip`. The object's
-- first path segment IS the trip id
--
--     <trip-id>/<slot>/<epoch>-<filename>
--     slot ∈ ticket | hotel | receipt | approval | cancellation | mileage-log
--
-- so a file can always name its own trip. One rule, two surfaces; they cannot
-- drift apart.
--
-- ⚠ WRITING IS KEYED ON THE SLOT, not merely on "may this person touch the
--   trip". The Travel Desk files tickets, hotel folios and cancellation
--   evidence; the TRAVELLER files receipts and the mileage log for their own
--   claim. Neither needs the other's folder, and a boundary that holds in the
--   RPC and leaks in Storage is not a boundary.
--
-- ⚠ ORPHANS BECOME ADMIN-ONLY. A file whose trip has been deleted stops
--   resolving and is refused to everyone but an admin. That is the correct
--   answer for a file nothing references; it is not a migration failure.
--
-- ⚠ THE `security_definer_function_executable` ADVISORY ON THESE HELPERS CANNOT
--   BE CLEARED. Revoking EXECUTE from `public` was measured on the dispatch pair
--   (20260821120000): the policies stop working, because a policy expression is
--   evaluated with the querying role's privileges. What stays exposed is a
--   boolean about a path the caller must already know — never a file, a name or
--   an amount. Do not "fix" it by revoking.
--
-- Reversal:
--   drop policy if exists "fms travel docs read"   on storage.objects;
--   drop policy if exists "fms travel docs insert" on storage.objects;
--   drop policy if exists "fms travel docs update" on storage.objects;
--   drop policy if exists "fms travel docs delete" on storage.objects;
--   create policy "fms travel docs read"   on storage.objects for select to authenticated using (bucket_id = 'fms-travel-docs');
--   create policy "fms travel docs insert" on storage.objects for insert to authenticated with check (bucket_id = 'fms-travel-docs');
--   create policy "fms travel docs update" on storage.objects for update to authenticated using (bucket_id = 'fms-travel-docs') with check (bucket_id = 'fms-travel-docs');
--   create policy "fms travel docs delete" on storage.objects for delete to authenticated using (bucket_id = 'fms-travel-docs');
--   drop function if exists public.fms_travel_can_add_doc(text, uuid);
--   drop function if exists public.fms_travel_can_see_doc(text, uuid);
--   drop function if exists public.fms_travel_doc_slot(text);
--   drop function if exists public.fms_travel_doc_trip(text);
-- ===========================================================================

begin;

/* ---------------------------------------------------------------- helpers -- */

/**
 * The trip a stored document belongs to, or null when the path names none.
 *
 * Guarded by the uuid shape because `split_part(...)::uuid` on a stray path
 * would RAISE — and an exception inside a policy is a 500, not a denial. A
 * malformed path must be refused, not crash.
 */
create or replace function public.fms_travel_doc_trip(p_name text)
returns uuid
language sql
immutable
-- Empty is safe: split_part, the regex operator and the uuid cast all live in
-- pg_catalog, which stays on the path regardless. A mutable search_path on a
-- function a POLICY consults invites shadowing `split_part` from a role-local
-- schema, which would hand back whatever trip id the caller fancied.
set search_path = ''
as $fn$
  select case
           when split_part(p_name, '/', 1) ~
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           then split_part(p_name, '/', 1)::uuid
         end;
$fn$;

comment on function public.fms_travel_doc_trip(text) is
  'Trip id from a fms-travel-docs object path (<trip-id>/<slot>/<file>). Null when the path names no trip - a malformed path must be DENIED, never raise, because an exception inside a policy is a 500.';

/** The slot, or null when the path does not name a known one. */
create or replace function public.fms_travel_doc_slot(p_name text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
           when split_part(p_name, '/', 2) in
                ('ticket', 'hotel', 'receipt', 'approval', 'cancellation', 'mileage-log')
           then split_part(p_name, '/', 2)
         end;
$fn$;

comment on function public.fms_travel_doc_slot(text) is
  'Slot from a fms-travel-docs object path. Null for anything not in the known set, which the write policy treats as a refusal.';

/**
 * May this user READ this document? Exactly the trip's own visibility rule.
 *
 * `security definer` so the lookup is not itself filtered by the trips policy:
 * the answer must be the same whether or not the caller can select the row, and
 * a policy that depends on another policy is a trap for the next reader.
 *
 * ⚠ `is_admin` is hoisted OUT of the EXISTS on purpose. Inside it, an orphaned
 *   file resolves to no trip and the whole clause goes false — which would leave
 *   an admin able to DELETE a stray attachment but not to look at it first.
 */
create or replace function public.fms_travel_can_see_doc(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin(p_uid)
      or exists (
           select 1
             from public.fms_travel_trips t
            where t.id = public.fms_travel_doc_trip(p_name)
              and public.fms_travel_can_see_trip(
                    p_uid, t.raised_by, t.traveller_id, t.status, t.approver_manager_ids)
         );
$fn$;

comment on function public.fms_travel_can_see_doc(text, uuid) is
  'Storage read rule for fms-travel-docs: can this user see the trip this file hangs off? A draft stays private to its author, exactly as the trips policy says.';

/**
 * May this user ADD or REPLACE a document here?
 *
 * Stricter than reading, and keyed on the SLOT.
 *
 *   ticket · hotel · cancellation   the Travel Desk's own filing — coordinators,
 *                                   the booking step's owners, admins
 *   receipt · mileage-log           the TRAVELLER's evidence for their own claim,
 *                                   plus whoever raised the trip for them
 *   approval                        the authorisation printout: either side may
 *                                   file it, since either may be the one holding
 *                                   the signed copy
 *
 * ⚠ THE TRIP'S CURRENT STATUS IS NOT CHECKED. The RPCs already refuse a step
 *   that has moved on, and re-checking here would refuse a correction to the
 *   person whose job the correction is — a refund lands weeks after booking, and
 *   a missing receipt turns up after the claim was filed.
 */
create or replace function public.fms_travel_can_add_doc(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_uid is not null
     and public.fms_travel_doc_slot(p_name) is not null
     and (
       public.is_admin(p_uid)
       or exists (
            select 1
              from public.fms_travel_trips t
             where t.id = public.fms_travel_doc_trip(p_name)
               and (
                 -- The desk's folders.
                 (public.fms_travel_doc_slot(p_name) in ('ticket', 'hotel', 'cancellation')
                  and (public.fms_travel_is_coordinator(p_uid)
                       or public.fms_travel_is_step_owner('booking', p_uid)))
                 -- The traveller's own evidence.
                 or (public.fms_travel_doc_slot(p_name) in ('receipt', 'mileage-log')
                     and (t.traveller_id = p_uid or t.raised_by = p_uid
                          or public.fms_travel_is_coordinator(p_uid)))
                 -- Either side may file the signed authorisation.
                 or (public.fms_travel_doc_slot(p_name) = 'approval'
                     and (t.traveller_id = p_uid or t.raised_by = p_uid
                          or public.fms_travel_is_coordinator(p_uid)
                          or public.fms_travel_is_step_owner('booking', p_uid)))
               )
          )
     );
$fn$;

comment on function public.fms_travel_can_add_doc(text, uuid) is
  'Storage write rule for fms-travel-docs, keyed on the SLOT: the desk files tickets, hotel folios and cancellation evidence; the traveller files receipts and the mileage log. A path naming no known slot is refused outright.';


/* --------------------------------------------------------------- policies -- */

drop policy if exists "fms travel docs read"   on storage.objects;
drop policy if exists "fms travel docs insert" on storage.objects;
drop policy if exists "fms travel docs update" on storage.objects;
drop policy if exists "fms travel docs delete" on storage.objects;

create policy "fms travel docs read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-travel-docs'
    and public.fms_travel_can_see_doc(name, (select auth.uid()))
  );

create policy "fms travel docs insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fms-travel-docs'
    and public.fms_travel_can_add_doc(name, (select auth.uid()))
  );

-- ⚠ UPDATE IS AS WIDE AS INSERT. Uploads use `upsert: true` against a stable
--   path for a given slot, so re-uploading a corrected ticket OVERWRITES rather
--   than adds. A narrower UPDATE would refuse the correction to the person whose
--   job it is, and would do it as "not found" — which reads like data loss.
create policy "fms travel docs update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fms-travel-docs'
    and public.fms_travel_can_add_doc(name, (select auth.uid()))
  )
  with check (
    bucket_id = 'fms-travel-docs'
    and public.fms_travel_can_add_doc(name, (select auth.uid()))
  );

-- ⚠ DELETING IS THE SAME RIGHT AS ADDING, not the same right as reading.
--   Everybody who can see a trip could otherwise remove the receipt that proves
--   what it cost.
create policy "fms travel docs delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fms-travel-docs'
    and public.fms_travel_can_add_doc(name, (select auth.uid()))
  );


do $mig$
declare v_bad int;
begin
  -- The four policies exist and none is scoped {public}.
  select count(*) into v_bad
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'fms travel docs%' and roles::text like '%public%';
  if v_bad > 0 then
    raise exception 'Travel Desk storage: % policy/policies scoped to {public}', v_bad;
  end if;

  select count(*) into v_bad
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'fms travel docs%';
  if v_bad <> 4 then
    raise exception 'expected 4 travel storage policies, found %', v_bad;
  end if;

  -- A malformed path resolves to NULL rather than raising: the whole reason the
  -- uuid regex is there.
  if public.fms_travel_doc_trip('not-a-uuid/ticket/x.pdf') is not null then
    raise exception 'doc_trip accepted a malformed path';
  end if;
  if public.fms_travel_doc_slot('00000000-0000-0000-0000-000000000000/../etc/passwd') is not null then
    raise exception 'doc_slot accepted an unknown slot';
  end if;
  -- ...and nobody may write to a path that names no slot.
  if public.fms_travel_can_add_doc('00000000-0000-0000-0000-000000000000/nonsense/x.pdf',
                                   (select id from auth.users limit 1)) then
    raise exception 'can_add_doc accepted an unknown slot';
  end if;
end $mig$;

commit;
