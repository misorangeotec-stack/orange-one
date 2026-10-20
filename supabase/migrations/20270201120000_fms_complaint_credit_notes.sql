-- ===========================================================================
-- COMPLAINT FMS — CUSTOMER COMPENSATION (the fourth option on "Raise a complaint").
--
-- Built as "Customer Credit Note" and renamed by the user to "Customer
-- Compensation" before go-live. Table, RPC and column names keep the
-- credit-note wording; every user-facing text says compensation. The form asks
-- only: customer · reason · amount (if any) · salesperson · approved by ·
-- attachments — so amount and details are nullable.
--
-- WHAT THE USER ASKED FOR
--   A fourth choice after Finished Good / Raw Material / Other Supplier
--   Complaint: "Customer Credit Note". The raiser fills
--     customer name · salesperson · approved by · reason for credit note ·
--     amount · full details
--   and submits. Salesperson is picked from the Tally salesperson list and
--   "Approved by" from Karan / Ayush / Manmohan / Nakul sir — both also take a
--   typed name, so they are free text here, never a FK. It goes to MANAGEMENT APPROVAL. Once approved it goes to
--   TALLY, where the credit/debit note is posted; the Tally bucket records
--     Tally no. · attachment · remark
--   and that closes the chain.
--
--     raise → cn_approval (management)  approve → cn_tally → closed
--                                        reject  → rejected
--
-- ⚠ ITS OWN TABLE, NOT A FOURTH `complaint_type` ON fms_complaint_requests.
--   A credit note has none of a complaint's facts — no LOT, no item, no
--   invoice, no issue date — and fms_complaint_submit_request, the queues, the
--   recap, the register and the email payload all assume those exist. A row
--   with nine blank columns in every grid is the wrong shape; a small table
--   beside it is the right one. It shares everything that is NOT row-shaped:
--   step owners (two new step keys), coordinators, the raise gate
--   (fms_complaint_can_raise), the counters, the activity trail, the bell and
--   the docs bucket.
--
-- ⚠ BELL ONLY, NO EMAIL. fms_complaint_announce builds an email payload only
--   for p_entity_type = 'request'; 'credit_note' rows notify in the bell and
--   are skipped by the mailer. Nothing about the live complaint email changes.
--
-- ⚠ NUMBERING: CC-<fy>-0001, its own scope 'credit_note:<fy>', so complaint
--   numbers (CMP-) are untouched.
--
-- ⚠ DOCUMENTS live in the existing fms-complaint-docs bucket under
--   cn/<credit-note-id>/<slot>/<epoch>-<file>. The four existing
--   "fms complaint docs …" policies return false for that path (its first
--   segment is not a uuid), so three NEW policies grant it. Permissive policies
--   OR together; the existing four are not touched.
--
-- Purely ADDITIVE. Rollback: 20270201120000_fms_complaint_credit_notes_rollback.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- The credit note.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_complaint_credit_notes (
  id              uuid primary key default gen_random_uuid(),
  cn_no           text not null unique,
  status          text not null check (status in
                    ('awaiting_cn_approval', 'awaiting_cn_tally', 'closed', 'rejected')),
  current_step    text,
  raised_by       uuid references auth.users on delete set null,
  requester_name  text not null,
  company_id      uuid references public.mst_companies on delete set null,
  -- Nullable FK with the name FROZEN alongside, exactly like the complaint row:
  -- a customer missing from the central master must not block a credit note.
  party_id        uuid references public.mst_parties on delete set null,
  party_name      text not null check (btrim(party_name) <> ''),
  salesperson_name text not null check (btrim(salesperson_name) <> ''),
  -- Who agreed to the credit note before it was raised. Free text: the form
  -- offers four names but accepts any.
  approved_by_name text not null check (btrim(approved_by_name) <> ''),
  reason          text not null check (btrim(reason) <> ''),
  -- "Amount, if any" — null when there is none, never zero.
  amount          numeric(14, 2) check (amount is null or amount > 0),
  -- Retired from the form before go-live (the reason carries it). Kept nullable.
  details         text,
  submitted_at    timestamptz not null default now(),

  -- management approval
  apr_decision    text check (apr_decision in ('approve', 'reject')),
  apr_note        text,
  apr_at          timestamptz,
  apr_by          uuid references auth.users on delete set null,

  -- Tally
  tally_no        text,
  tally_remarks   text,
  tally_at        timestamptz,
  tally_by        uuid references auth.users on delete set null,

  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_complaint_credit_notes is
  'Customer compensations (built as credit notes) raised from the Complaint module: raise -> management approval (cn_approval) -> Tally entry (cn_tally) -> closed. Every write is a security-definer RPC.';

create index if not exists fms_complaint_credit_notes_status_idx on public.fms_complaint_credit_notes (status);
create index if not exists fms_complaint_credit_notes_raised_idx on public.fms_complaint_credit_notes (raised_by);

drop trigger if exists trg_fms_complaint_credit_notes_updated on public.fms_complaint_credit_notes;
create trigger trg_fms_complaint_credit_notes_updated
  before update on public.fms_complaint_credit_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Its documents. slot 'raise' = supporting papers; 'tally' = the posted voucher.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_complaint_credit_note_docs (
  id              uuid primary key default gen_random_uuid(),
  credit_note_id  uuid not null references public.fms_complaint_credit_notes on delete cascade,
  step_key        text not null,
  slot            text not null check (slot in ('raise', 'tally')),
  -- cn/<credit-note-id>/<slot>/<epoch>-<filename>. The second segment is what
  -- the storage policies read.
  path            text not null unique,
  name            text not null,
  mime            text,
  size_bytes      bigint,
  uploaded_by     uuid references auth.users on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists fms_complaint_credit_note_docs_cn_idx
  on public.fms_complaint_credit_note_docs (credit_note_id);

-- ---------------------------------------------------------------------------
-- READ RULE — the same people who can read a complaint: admins, coordinators,
-- the raiser, view-only readers of the module, and anyone who owns any
-- complaint step. Exists twice (function + inlined policy); move them together.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_can_see_cn(p_cn uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.fms_complaint_credit_notes c
    where c.id = p_cn
      and (
        public.is_admin(p_uid)
        or public.fms_complaint_is_coordinator(p_uid)
        or c.raised_by = p_uid
        or public.module_is_viewer(p_uid, 'complaint')
        or exists (
          select 1 from public.fms_complaint_step_owners o
          where p_uid = any(o.employee_ids)
        )
      )
  );
$fn$;
grant execute on function public.fms_complaint_can_see_cn(uuid, uuid) to authenticated;

alter table public.fms_complaint_credit_notes enable row level security;
alter table public.fms_complaint_credit_note_docs enable row level security;

drop policy if exists fms_complaint_credit_notes_select on public.fms_complaint_credit_notes;
create policy fms_complaint_credit_notes_select on public.fms_complaint_credit_notes
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and (
      (select public.is_admin((select auth.uid())))
      or (select public.fms_complaint_is_coordinator((select auth.uid())))
      or raised_by = (select auth.uid())
      or (select public.module_is_viewer((select auth.uid()), 'complaint'))
      or exists (
        select 1 from public.fms_complaint_step_owners o
        where (select auth.uid()) = any(o.employee_ids)
      )
    )
  );

drop policy if exists fms_complaint_credit_note_docs_select on public.fms_complaint_credit_note_docs;
create policy fms_complaint_credit_note_docs_select on public.fms_complaint_credit_note_docs
  for select to authenticated
  using ((select public.fms_complaint_can_see_cn(credit_note_id, (select auth.uid()))));

-- NO WRITE POLICY on either table. Every mutation is a definer RPC below.

-- ---------------------------------------------------------------------------
-- THE ACT GATE. Bucket owners of the step, admins and coordinators — and only
-- with an edit grant. Mirrored in the app by store.tsx `canActOnCn`.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_cn_can_act(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.module_can_edit(p_uid, 'complaint')
     and (
       public.is_admin(p_uid)
       or public.fms_complaint_is_coordinator(p_uid)
       or public.fms_complaint_is_step_owner(p_step_key, p_uid)
     );
$fn$;
grant execute on function public.fms_complaint_cn_can_act(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- SUBMIT
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_cn_submit(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id     uuid;
  v_fy     text := public.fms_complaint_fy_code(current_date);
  v_no     text;
  v_party  text := nullif(btrim(p->>'party_name'), '');
  v_reason text := nullif(btrim(p->>'reason'), '');
  v_sales  text := nullif(btrim(p->>'salesperson_name'), '');
  v_apprby text := nullif(btrim(p->>'approved_by_name'), '');
  v_det    text := nullif(btrim(p->>'details'), '');
  v_amt    numeric;
  v_me     text := coalesce((select name from public.profiles where id = auth.uid()), 'Someone');
begin
  if not public.fms_complaint_can_raise(auth.uid()) then
    raise exception 'Not authorized to raise a compensation';
  end if;
  if v_party is null then raise exception 'Customer name is required.'; end if;
  if v_sales is null then raise exception 'Salesperson is required.'; end if;
  if v_apprby is null then raise exception 'Approved by is required.'; end if;
  if v_reason is null then raise exception 'Reason for compensation is required.'; end if;
  -- Optional: blank means "no amount".
  if nullif(btrim(coalesce(p->>'amount', '')), '') is not null then
    begin
      v_amt := round((p->>'amount')::numeric, 2);
    exception when others then
      raise exception 'Amount must be a number.';
    end;
    if v_amt <= 0 then
      raise exception 'Amount must be more than zero, or left blank.';
    end if;
  end if;

  v_no := 'CC-' || v_fy || '-'
          || lpad(public.fms_complaint_next_seq('credit_note:' || v_fy)::text, 4, '0');

  insert into public.fms_complaint_credit_notes (
    cn_no, status, current_step, raised_by, requester_name, company_id,
    party_id, party_name, salesperson_name, approved_by_name, reason, amount, details, submitted_at
  ) values (
    v_no, 'awaiting_cn_approval', 'cn_approval', auth.uid(),
    coalesce(nullif(btrim(p->>'requester_name'), ''), v_me),
    nullif(p->>'company_id', '')::uuid,
    nullif(p->>'party_id', '')::uuid,
    v_party, v_sales, v_apprby, v_reason, v_amt, v_det, now()
  )
  returning id into v_id;

  perform public.fms_complaint_announce(
    'credit_note', v_id, 'cn_raised',
    format('%s raised customer compensation %s for %s%s — awaiting management approval',
           v_me, v_no, v_party,
           case when v_amt is null then '' else ' (Rs ' || to_char(v_amt, 'FM99,99,99,99,990.00') || ')' end),
    public.fms_complaint_step_owner_ids('cn_approval'),
    jsonb_build_object('cn_no', v_no, 'amount', v_amt)
  );
  return v_id;
end $fn$;
grant execute on function public.fms_complaint_cn_submit(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- MANAGEMENT APPROVAL — approve → Tally bucket; reject → rejected (reason required).
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_cn_approve(p_cn uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row  public.fms_complaint_credit_notes%rowtype;
  v_dec  text := nullif(btrim(p->>'decision'), '');
  v_note text := nullif(btrim(p->>'note'), '');
  v_me   text := coalesce((select name from public.profiles where id = auth.uid()), 'Someone');
begin
  select * into v_row from public.fms_complaint_credit_notes where id = p_cn for update;
  if not found then raise exception 'Compensation not found'; end if;
  if not public.fms_complaint_cn_can_act('cn_approval', auth.uid()) then
    raise exception 'Not authorized to approve compensations';
  end if;
  if v_row.status <> 'awaiting_cn_approval' then
    raise exception 'Compensation % is not awaiting approval (it is %)', v_row.cn_no, v_row.status;
  end if;
  if v_dec is null or v_dec not in ('approve', 'reject') then
    raise exception 'Choose Approve or Reject.';
  end if;
  if v_dec = 'reject' and v_note is null then
    raise exception 'Give the reason for rejecting.';
  end if;

  update public.fms_complaint_credit_notes
     set apr_decision = v_dec,
         apr_note     = v_note,
         apr_at       = now(),
         apr_by       = auth.uid(),
         status       = case when v_dec = 'approve' then 'awaiting_cn_tally' else 'rejected' end,
         current_step = case when v_dec = 'approve' then 'cn_tally' else null end,
         closed_at    = case when v_dec = 'approve' then null else now() end
   where id = p_cn;

  if v_dec = 'approve' then
    perform public.fms_complaint_announce(
      'credit_note', p_cn, 'cn_approved',
      format('%s approved compensation %s for %s — post it in Tally', v_me, v_row.cn_no, v_row.party_name),
      public.fms_complaint_step_owner_ids('cn_tally') || coalesce(array[v_row.raised_by], '{}'::uuid[]),
      jsonb_build_object('cn_no', v_row.cn_no, 'note', v_note)
    );
  else
    perform public.fms_complaint_announce(
      'credit_note', p_cn, 'cn_rejected',
      format('%s rejected compensation %s for %s: %s', v_me, v_row.cn_no, v_row.party_name, v_note),
      coalesce(array[v_row.raised_by], '{}'::uuid[]),
      jsonb_build_object('cn_no', v_row.cn_no, 'note', v_note)
    );
  end if;
end $fn$;
grant execute on function public.fms_complaint_cn_approve(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- TALLY — Tally no. (required), remark (optional), attachment via add_doc.
-- Submitting closes the chain.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_cn_record_tally(p_cn uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.fms_complaint_credit_notes%rowtype;
  v_no  text := nullif(btrim(p->>'tally_no'), '');
  v_rem text := nullif(btrim(p->>'remarks'), '');
  v_me  text := coalesce((select name from public.profiles where id = auth.uid()), 'Someone');
begin
  select * into v_row from public.fms_complaint_credit_notes where id = p_cn for update;
  if not found then raise exception 'Compensation not found'; end if;
  if not public.fms_complaint_cn_can_act('cn_tally', auth.uid()) then
    raise exception 'Not authorized to post compensations in Tally';
  end if;
  if v_row.status <> 'awaiting_cn_tally' then
    raise exception 'Compensation % is not waiting for Tally (it is %)', v_row.cn_no, v_row.status;
  end if;
  if v_no is null then raise exception 'Tally number is required.'; end if;

  update public.fms_complaint_credit_notes
     set tally_no      = v_no,
         tally_remarks = v_rem,
         tally_at      = now(),
         tally_by      = auth.uid(),
         status        = 'closed',
         current_step  = null,
         closed_at     = now()
   where id = p_cn;

  perform public.fms_complaint_announce(
    'credit_note', p_cn, 'cn_closed',
    format('%s posted compensation %s for %s in Tally (%s) — closed', v_me, v_row.cn_no, v_row.party_name, v_no),
    coalesce(array[v_row.raised_by], '{}'::uuid[]),
    jsonb_build_object('cn_no', v_row.cn_no, 'tally_no', v_no)
  );
end $fn$;
grant execute on function public.fms_complaint_cn_record_tally(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- DOCUMENTS
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_cn_add_doc(p_cn uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id   uuid;
  v_slot text := p->>'slot';
  v_path text := p->>'path';
  v_row  public.fms_complaint_credit_notes%rowtype;
begin
  select * into v_row from public.fms_complaint_credit_notes where id = p_cn;
  if not found then raise exception 'Compensation not found'; end if;
  if not public.module_can_edit(auth.uid(), 'complaint')
     or not public.fms_complaint_can_see_cn(p_cn, auth.uid()) then
    raise exception 'Not authorized to attach to this compensation';
  end if;
  if v_path is null or split_part(v_path, '/', 1) <> 'cn' or split_part(v_path, '/', 2) <> p_cn::text then
    raise exception 'Attachment path does not belong to this compensation';
  end if;
  if v_slot = 'tally' and not (
       v_row.status = 'awaiting_cn_tally' and public.fms_complaint_cn_can_act('cn_tally', auth.uid())
     ) then
    raise exception 'Only the Tally desk can attach the Tally document, while the compensation waits for Tally';
  end if;

  insert into public.fms_complaint_credit_note_docs
    (credit_note_id, step_key, slot, path, name, mime, size_bytes, uploaded_by)
  values (
    p_cn, coalesce(nullif(p->>'step_key', ''), 'raise'), v_slot, v_path,
    coalesce(nullif(p->>'name', ''), 'file'), nullif(p->>'mime', ''),
    nullif(p->>'size_bytes', '')::bigint, auth.uid()
  )
  returning id into v_id;
  return v_id;
end $fn$;
grant execute on function public.fms_complaint_cn_add_doc(uuid, jsonb) to authenticated;

create or replace function public.fms_complaint_cn_delete_doc(p_doc uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_doc    public.fms_complaint_credit_note_docs%rowtype;
  v_status text;
begin
  select * into v_doc from public.fms_complaint_credit_note_docs where id = p_doc;
  if not found then raise exception 'Attachment not found'; end if;
  select status into v_status from public.fms_complaint_credit_notes where id = v_doc.credit_note_id;
  if not public.module_can_edit(auth.uid(), 'complaint')
     or not (public.is_admin(auth.uid()) or v_doc.uploaded_by = auth.uid()) then
    raise exception 'Only the person who attached it can remove it';
  end if;
  if v_status in ('closed', 'rejected') and not public.is_admin(auth.uid()) then
    raise exception 'This compensation is finished; its attachments are kept';
  end if;
  -- The row only, like fms_complaint_delete_doc: Supabase refuses direct
  -- deletes from storage.objects, and the app removes the object itself.
  delete from public.fms_complaint_credit_note_docs where id = p_doc;
end $fn$;
grant execute on function public.fms_complaint_cn_delete_doc(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- STORAGE — cn/<credit-note-id>/... in fms-complaint-docs.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_cn_doc_note(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $fn$
  select case
           when split_part(p_name, '/', 1) = 'cn'
            and split_part(p_name, '/', 2) ~
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           then split_part(p_name, '/', 2)::uuid
         end;
$fn$;

drop policy if exists "fms complaint cn docs read"   on storage.objects;
drop policy if exists "fms complaint cn docs insert" on storage.objects;
drop policy if exists "fms complaint cn docs delete" on storage.objects;

create policy "fms complaint cn docs read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-complaint-docs'
    and (select public.fms_complaint_can_see_cn(public.fms_complaint_cn_doc_note(name), (select auth.uid())))
  );

create policy "fms complaint cn docs insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fms-complaint-docs'
    and (select public.module_can_edit((select auth.uid()), 'complaint'))
    and (select public.fms_complaint_can_see_cn(public.fms_complaint_cn_doc_note(name), (select auth.uid())))
  );

create policy "fms complaint cn docs delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fms-complaint-docs'
    and (select public.module_can_edit((select auth.uid()), 'complaint'))
    and (select public.fms_complaint_can_see_cn(public.fms_complaint_cn_doc_note(name), (select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- ASSERTIONS
-- ---------------------------------------------------------------------------
do $mig$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('fms_complaint_credit_notes', 'fms_complaint_credit_note_docs')
       and roles::text like '%public%'
  ) then
    raise exception 'Credit notes: a policy is scoped to {public}';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'fms complaint docs %') <> 4 then
    raise exception 'Credit notes: the four existing complaint docs policies changed';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'fms complaint cn docs %') <> 3 then
    raise exception 'Credit notes: expected 3 cn docs storage policies';
  end if;
  if public.fms_complaint_cn_doc_note('cn/not-a-uuid/raise/1.pdf') is not null
     or public.fms_complaint_cn_doc_note('0b8c3f7e-1111-4222-8333-944455556666/evidence/1.jpg') is not null then
    raise exception 'Credit notes: cn_doc_note must be null for a non-cn path';
  end if;
end $mig$;

commit;
