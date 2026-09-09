-- ===========================================================================
-- Complaint (RM/FG) FMS — THE COMPLAINT (Phase 5).
--
--   fms_complaint_requests        — the one entity, raise to close
--   fms_complaint_docs            — its evidence (a child table, not column pairs)
--   fms_complaint_can_see_request — the read rule
--   fms_complaint_can_act         — THE gate every step RPC calls
--   fms_complaint_resume_status   — where a held complaint goes back to
--
-- and flips the Master Report row on, now that its head_table exists.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ONE SHARED PARTY/INVOICE/LOT BLOCK, NOT TWO.
--
-- `complaint_type` decides the LABELS the form shows and which side of
-- mst_parties the picker offers — it does not select between two column sets.
-- One party_id/party_name, one invoice_no/invoice_date, one lot_no, one
-- item_id/item_name.
--
-- The reasons, in order of force:
--   1. mst_parties is ALREADY one table holding both concepts, because in Tally
--      a customer and a vendor are both a ledger. Two FK columns pointing at it
--      would be two answers to one question.
--   2. The business describes it that way. The source sheet's words for the
--      raw-material arm are "Purchase invoice. And all the heading of sales and
--      customer, change" — a heading change, not a different fact.
--   3. Every downstream reader wants ONE Party column: the queue grid, the Excel
--      export, the Control Center, the email rows, the Master Report. A
--      coalesced cell needs an explicit sortValue and filter override in every
--      one of them; one column needs none.
--   4. Splitting a shared block later is purely additive. MERGING two blocks
--      later is not possible under the additive-only rule — you cannot drop the
--      losing columns. Shared is the cheaper mistake.
-- ─────────────────────────────────────────────────────────────────────────
--
-- ⚠ ONE AUTHORITATIVE TIMESTAMP TRIO PER STEP: <p>_date (the business date the
--   actor states), <p>_at (when the system recorded it), <p>_by (who). That trio
--   is the authority. NEVER INFER A STEP'S COMPLETION FROM THE ACTIVITY TRAIL —
--   announce() is best-effort and its failures are swallowed.
--
-- ⚠ STATUSES ARE NOT STEP KEYS. closed / rejected / on_hold / cancelled live in
--   `status` and appear in no StepKey union. A status loose in a queue is work
--   owed by nobody.
--
-- ⚠ THERE IS NO `draft`. One intake form, submitted straight in; browser-side
--   draft safety is shared/lib/useStepDraft.ts, not a DB status. So no complaint
--   number is ever burnt on something nobody submitted.
--
-- ⚠ item_id AND party_id ARE NULLABLE FKs WITH A FROZEN NAME ALONGSIDE, and that
--   is load-bearing rather than lax. A complaint can legitimately name an item or
--   a party that is not in the central master, and refusing it would block the
--   complaint rather than fix the master. The frozen name is also what stops the
--   fms_dispatch_archive_round failure repeating: that function looked a name up
--   in the wrong table after a cutover and wrote the literal 'Item' onto 293
--   dispatches over three days with nothing erroring. Copy the name at submit;
--   keep the id for analytics.
--
-- ⚠ NO WRITE POLICY ON fms_complaint_requests, deliberately. Every mutation goes
--   through a SECURITY DEFINER RPC (phase 6) that re-checks authorization,
--   validates the transition and stamps the step's own trio.
--
-- Additive. Reversal:
--   update public.master_report_modules set enabled = false where app_id = 'complaint';
--   drop function if exists public.fms_complaint_resume_status(uuid);
--   drop function if exists public.fms_complaint_can_act(text,uuid,uuid);
--   drop function if exists public.fms_complaint_can_see_request(uuid,uuid);
--   drop table if exists public.fms_complaint_docs, public.fms_complaint_requests;
-- ===========================================================================

begin;

create table if not exists public.fms_complaint_requests (
  id                uuid primary key default gen_random_uuid(),
  complaint_no      text unique,
  complaint_type    text not null check (complaint_type in ('finished_good', 'raw_material')),
  status            text not null default 'awaiting_acknowledge' check (status in (
                      'awaiting_acknowledge', 'awaiting_investigation', 'awaiting_capa',
                      'awaiting_resolution', 'awaiting_confirmation', 'awaiting_close',
                      'closed', 'rejected', 'on_hold', 'cancelled')),
  current_step      text not null default 'acknowledge',
  raised_by         uuid references auth.users on delete set null,
  requester_name    text not null,
  company_id        uuid references public.mst_companies on delete set null,

  -- ---- the raise panel: ONE block, FG and RM (see the header) --------------
  lot_no            text,
  -- TYPED BY THE RAISER. Measured 05-09-2026: Tally carries the batch/lot on
  -- every inventory line, but MFDON and EXPIRYPERIOD came back EMPTY on every
  -- batch row across all five companies, and nothing in fms_production_* or
  -- fms_dispatch_* holds an expiry either. There is no source to fill this from.
  lot_expiry_date   date,
  -- The phase-2 seam. Ships now so the lookup's hit rate is measurable the day
  -- it starts working and phase 2 needs no migration. See lib/resolveLot.ts.
  lot_source        text not null default 'manual' check (lot_source in ('manual', 'tally')),
  category          text,   -- "Category of Ink", seeded from mst_items.category
  ink_type          text,
  item_id           uuid references public.mst_items   on delete set null,
  item_name         text,   -- FROZEN COPY — never re-joined for display
  party_id          uuid references public.mst_parties on delete set null,
  party_name        text,   -- FROZEN COPY
  invoice_no        text,   -- sales (FG) / purchase (RM)
  invoice_date      date,
  qty_affected      numeric(14,3),
  unit_name         text,
  nature_id         uuid references public.fms_complaint_natures on delete set null,

  -- ---- the three the raiser types by hand ---------------------------------
  issue_identified_at timestamptz,   -- when it was NOTICED, not when raised
  problem_details     text,
  other_remarks       text,

  submitted_at      timestamptz not null default now(),

  -- ---- acknowledge --------------------------------------------------------
  ack_decision      text check (ack_decision is null or ack_decision in ('accept', 'reject')),
  ack_severity      text check (ack_severity is null or ack_severity in ('critical', 'major', 'minor')),
  ack_assignee_id   uuid references auth.users on delete set null,
  ack_assignee_name text,
  -- The date PROMISED TO THE PARTY. Once set it overrides the resolution SLA —
  -- see complaintDueIso in lib/queues.ts. A date somebody committed to a
  -- customer beats a generic clock.
  ack_target_date   date,
  ack_reject_reason text,
  ack_note          text,
  ack_date          date,
  ack_at            timestamptz,
  ack_by            uuid references auth.users on delete set null,

  -- ---- investigation ------------------------------------------------------
  inv_root_cause_id      uuid references public.fms_complaint_root_causes on delete set null,
  inv_root_cause_note    text,
  inv_findings           text,
  inv_responsible_dept_id uuid references public.departments on delete set null,
  inv_capa_owner_id      uuid references auth.users on delete set null,
  inv_capa_owner_name    text,
  inv_date               date,
  inv_at                 timestamptz,
  inv_by                 uuid references auth.users on delete set null,

  -- ---- capa ---------------------------------------------------------------
  capa_corrective    text,
  capa_preventive    text,
  capa_resolver_id   uuid references auth.users on delete set null,
  capa_resolver_name text,
  capa_target_date   date,
  capa_note          text,
  capa_date          date,
  capa_at            timestamptz,
  capa_by            uuid references auth.users on delete set null,

  -- ---- resolution ---------------------------------------------------------
  res_type           text check (res_type is null or res_type in
                       ('replace', 'credit_note', 'rework', 'no_action')),
  res_reference      text,   -- credit-note no. / replacement lot / rework job
  res_qty            numeric(14,3),
  res_value          numeric(14,2),
  res_confirmer_id   uuid references auth.users on delete set null,
  res_confirmer_name text,
  res_note           text,
  res_date           date,
  res_at             timestamptz,
  res_by             uuid references auth.users on delete set null,

  -- ---- confirmation -------------------------------------------------------
  -- `false` still advances: whether the party is happy is a FACT to record, not
  -- a gate to pass. A complaint closed with the customer still unhappy is a
  -- different and more useful thing to be able to count than one that cannot close.
  cfm_party_satisfied boolean,
  cfm_note            text,
  cfm_date            date,
  cfm_at              timestamptz,
  cfm_by              uuid references auth.users on delete set null,

  -- ---- close --------------------------------------------------------------
  cls_note  text,
  cls_date  date,
  cls_at    timestamptz,
  cls_by    uuid references auth.users on delete set null,
  closed_at timestamptz,

  -- ---- lifecycle ----------------------------------------------------------
  rejected_at      timestamptz,
  reject_reason    text,
  hold_at          timestamptz,
  hold_reason      text,
  -- Stored EXPLICITLY rather than re-derived from the timestamps. Sampling
  -- derives it, which is why its edit rules have to lock everything while a
  -- request is held: resuming there reads the very columns an edit touches.
  hold_from_status text,
  cancelled_at     timestamptz,
  cancel_reason    text,
  -- edited_*, NOT updated_*: updated_at is a trigger on every row touch and
  -- answers "when did anything happen", never "did a human correct this".
  edited_at        timestamptz,
  edited_by        uuid references auth.users on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Everything the source sheet marks as required on the raise panel. Enforced
  -- here as well as in the form so a direct RPC call cannot skip it.
  constraint fms_complaint_complete_on_raise check (
        nullif(btrim(coalesce(lot_no, '')), '')          is not null
    and nullif(btrim(coalesce(item_name, '')), '')       is not null
    and nullif(btrim(coalesce(party_name, '')), '')      is not null
    and nullif(btrim(coalesce(invoice_no, '')), '')      is not null
    and invoice_date        is not null
    and issue_identified_at is not null
    and nullif(btrim(coalesce(problem_details, '')), '') is not null
  ),
  -- A problem cannot be noticed before the goods were invoiced.
  constraint fms_complaint_issue_not_before_invoice check (
    issue_identified_at is null or invoice_date is null
    or issue_identified_at::date >= invoice_date
  )
);

comment on table public.fms_complaint_requests is
  'One quality complaint, raise to close. complaint_type (finished_good | raw_material) re-labels the shared party/invoice/lot block rather than selecting a second set of columns. One authoritative timestamp trio per step.';

create index if not exists fms_complaint_requests_status_idx   on public.fms_complaint_requests (status);
create index if not exists fms_complaint_requests_raised_idx   on public.fms_complaint_requests (raised_by);
create index if not exists fms_complaint_requests_party_idx    on public.fms_complaint_requests (party_id);
create index if not exists fms_complaint_requests_item_idx     on public.fms_complaint_requests (item_id);
create index if not exists fms_complaint_requests_type_idx     on public.fms_complaint_requests (complaint_type);
create index if not exists fms_complaint_requests_created_idx  on public.fms_complaint_requests (created_at);
-- The lookup a complaint about a repeat failure starts from.
create index if not exists fms_complaint_requests_lot_idx      on public.fms_complaint_requests (lower(lot_no));

drop trigger if exists trg_fms_complaint_requests_updated on public.fms_complaint_requests;
create trigger trg_fms_complaint_requests_updated
  before update on public.fms_complaint_requests
  for each row execute function public.set_updated_at();


-- ===========================================================================
-- fms_complaint_docs — the evidence.
--
-- A CHILD TABLE, not <step>_doc_path / _name column pairs. Seven steps each take
-- SEVERAL files — the customer's photographs of a leaking pouch, the lab report,
-- the credit note — and column pairs cap every step at one.
-- ===========================================================================
create table if not exists public.fms_complaint_docs (
  id           uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.fms_complaint_requests on delete cascade,
  step_key     text not null,
  slot         text not null check (slot in
                 ('evidence', 'lab_report', 'capa_doc', 'resolution_doc', 'other')),
  -- <complaint-id>/<slot>/<epoch>-<filename>. THE FIRST SEGMENT IS LOAD-BEARING:
  -- phase 7's storage policies derive the owning complaint from it.
  path         text not null unique,
  name         text not null,
  mime         text,
  size_bytes   bigint,
  uploaded_by  uuid references auth.users on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.fms_complaint_docs is
  'Evidence attached to a complaint, many per step. The object path begins with the complaint id — the storage policies in phase 7 read that segment.';

create index if not exists fms_complaint_docs_complaint_idx on public.fms_complaint_docs (complaint_id);

alter table public.fms_complaint_docs enable row level security;


-- ===========================================================================
-- READ RULE
--
-- ⚠ THIS RULE EXISTS TWICE — as the function below AND inlined in the SELECT
--   policy. They must move together. The function is what the storage policies
--   (phase 7) and the RPCs call; the inlined copy is what makes the policy an
--   InitPlan rather than a per-row function call.
-- ===========================================================================
create or replace function public.fms_complaint_can_see_request(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_complaint_requests r
    where r.id = p_req
      and (
        public.is_admin(p_uid)
        or public.fms_complaint_is_coordinator(p_uid)
        or r.raised_by = p_uid
        or r.ack_assignee_id = p_uid
        or r.inv_capa_owner_id = p_uid
        or r.capa_resolver_id = p_uid
        or r.res_confirmer_id = p_uid
        -- ⚠ module_is_viewer is module_level() = 'view' EXACTLY, so an EDIT
        --   grant makes it false. Edit-holders reach rows through the step-owner
        --   arm below, never through this one.
        or public.module_is_viewer(p_uid, 'complaint')
        or exists (
          select 1 from public.fms_complaint_step_owners o
          where p_uid = any(o.employee_ids)
        )
      )
  );
$$;
grant execute on function public.fms_complaint_can_see_request(uuid, uuid) to authenticated;

alter table public.fms_complaint_requests enable row level security;

drop policy if exists fms_complaint_requests_select on public.fms_complaint_requests;
create policy fms_complaint_requests_select on public.fms_complaint_requests
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and (
      (select public.is_admin((select auth.uid())))
      or (select public.fms_complaint_is_coordinator((select auth.uid())))
      or raised_by = (select auth.uid())
      or ack_assignee_id = (select auth.uid())
      or inv_capa_owner_id = (select auth.uid())
      or capa_resolver_id = (select auth.uid())
      or res_confirmer_id = (select auth.uid())
      or (select public.module_is_viewer((select auth.uid()), 'complaint'))
      or exists (
        select 1 from public.fms_complaint_step_owners o
        where (select auth.uid()) = any(o.employee_ids)
      )
    )
  );

-- NO WRITE POLICY — see the header. Every mutation is a definer RPC.

drop policy if exists fms_complaint_docs_select on public.fms_complaint_docs;
create policy fms_complaint_docs_select on public.fms_complaint_docs
  for select to authenticated
  using ((select public.fms_complaint_can_see_request(complaint_id, (select auth.uid()))));


-- ===========================================================================
-- THE ACT GATE
--
-- ⚠ MIRRORED IN TWO PLACES IN THE APP, ARM FOR ARM: store.tsx `canActOn` and
--   core/workspace/mywork/items/complaint.ts. When those drifted for Sampling,
--   anyone who was only ever a per-request assignee saw an empty My Work while
--   the job sat in their queue.
--
-- ⚠ THE PER-REQUEST ARMS ARE THE ONES THAT MATTER. The people who do most of the
--   work here are NAMED ON THE COMPLAINT by the previous step and own no step at
--   all: the investigator named at acknowledge, the CAPA owner named at
--   investigation, the resolver named at CAPA, the confirmer named at resolution.
--
-- ⚠ THE ARMS DO NOT EARLY-RETURN on the step-owner check. A step owner AND a
--   named assignee can both act — the owner list is additive co-ownership, which
--   is how a quality head covers for an investigator on leave. (hr-exit's can_act
--   makes the same choice; hr-recruitment's early return is the bug avoided.)
-- ===========================================================================
create or replace function public.fms_complaint_can_act(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.module_can_edit(p_uid, 'complaint')
     and exists (
       select 1 from public.fms_complaint_requests r
       where r.id = p_req
         and (
           public.is_admin(p_uid)
           or public.fms_complaint_is_coordinator(p_uid)
           or public.fms_complaint_is_step_owner(p_step_key, p_uid)
           or (p_step_key = 'investigation' and r.ack_assignee_id   = p_uid)
           or (p_step_key = 'capa'          and r.inv_capa_owner_id = p_uid)
           or (p_step_key = 'resolution'    and r.capa_resolver_id  = p_uid)
           or (p_step_key = 'confirmation'  and r.res_confirmer_id  = p_uid)
           -- Whoever raised it closes it: they are the one who knows it is over.
           or (p_step_key = 'close'         and r.raised_by         = p_uid)
         )
     );
$$;

comment on function public.fms_complaint_can_act(text, uuid, uuid) is
  'May this user act on this step of this complaint? Admin / coordinator / step owner / the per-request assignee named by the previous step. Mirrored in store.tsx canActOn and mywork/items/complaint.ts.';
grant execute on function public.fms_complaint_can_act(text, uuid, uuid) to authenticated;


-- ===========================================================================
-- RESUME — where a held complaint goes back to.
--
-- Reads `hold_from_status`, which was stamped when it was held. Explicit rather
-- than re-derived, so an edit made while the complaint was parked cannot change
-- where it resumes.
-- ===========================================================================
create or replace function public.fms_complaint_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select r.hold_from_status from public.fms_complaint_requests r where r.id = p_req),
    -- Only reachable for a row held before this column existed; the earliest
    -- open status is the safe landing, because a step already done simply
    -- re-completes with the same values.
    'awaiting_acknowledge'
  );
$$;
grant execute on function public.fms_complaint_resume_status(uuid) to authenticated;


-- The head table now exists, so the director's report may count it.
update public.master_report_modules set enabled = true where app_id = 'complaint';


do $mig$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'fms_complaint_requests' and c.relrowsecurity
  ) then
    raise exception 'Complaint: RLS is not enabled on fms_complaint_requests';
  end if;

  -- The absence of a write policy is a design decision; assert it stayed absent.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fms_complaint_requests'
       and cmd <> 'SELECT'
  ) then
    raise exception 'Complaint: fms_complaint_requests must have no write policy — mutations go through RPCs';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('fms_complaint_requests', 'fms_complaint_docs')
       and roles::text like '%public%'
  ) then
    raise exception 'Complaint: a request policy is scoped to {public}';
  end if;

  if not exists (
    select 1 from public.master_report_modules
     where app_id = 'complaint' and enabled
       and to_regclass('public.' || head_table) is not null
  ) then
    raise exception 'Complaint: the Master Report row did not enable against a real table';
  end if;
end $mig$;

commit;
