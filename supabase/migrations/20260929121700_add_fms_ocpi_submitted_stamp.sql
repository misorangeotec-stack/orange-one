-- ===========================================================================
-- OCPI FMS — stamp WHEN a quotation reached the approvers.
--
--   fms_ocpi_deals.qs_at    the moment it was sent for approval
--
-- ⚠ WITHOUT THIS, EVERY APPROVER'S QUEUE WOULD BE BORN RED. The per-step due
--   dates landing in this phase measure each step from the completion of the one
--   before it. Every other step already has its stamp — qa_at, oc_at, oca_at,
--   cs_at — but the origin step had none, so quotation approval would have had
--   to anchor on the deal's CREATION. A salesperson who drafts a quotation, sits
--   on it for three weeks while negotiating, and then submits it, would hand the
--   approver something already twenty days overdue at the instant it arrived.
--   A due date nobody can ever meet is not a deadline; it is noise that teaches
--   people to ignore the colour red.
--
-- ⚠ IT IS RE-STAMPED ON RE-SUBMISSION, and that is the point rather than a
--   nicety. When an approver sends a quotation back, the salesperson edits,
--   regenerates and submits again — and the approver's clock starts again from
--   THAT moment, not from the first attempt. Otherwise a single round of rework
--   permanently marks the deal late.
--
-- Purely ADDITIVE: one nullable column, and one line added to a function that is
-- otherwise restated verbatim from 20260929120800.
--
-- Reversal (reverse order):
--   -- re-apply 20260929120800_add_fms_ocpi_quotation_approval.sql
--   alter table public.fms_ocpi_deals drop column if exists qs_at;
-- ===========================================================================

begin;

alter table public.fms_ocpi_deals
  add column if not exists qs_at timestamptz;

comment on column public.fms_ocpi_deals.qs_at is
  'When the quotation was sent for approval. Re-stamped on every re-submission after rework, so the approver''s SLA clock starts when the work actually reached them.';

-- Backfill: a deal already past the approval step gets the decision time, which
-- is the latest moment it can honestly be said to have arrived. Nothing invents
-- a time earlier than one we can prove.
update public.fms_ocpi_deals
   set qs_at = coalesce(qa_at, updated_at)
 where qs_at is null
   and status <> 'draft';

-- ---------------------------------------------------------------------------
-- Re-issue fms_ocpi_submit_quotation. Verbatim from 20260929120800 apart from
-- the qs_at line in the UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_submit_quotation(p_deal uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_no     text;
  v_ver    integer;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, quotation_no, quotation_version_no
    into v_status, v_owner, v_no, v_ver
    from public.fms_ocpi_deals where id = p_deal for update;

  if v_status is null then raise exception 'Quotation not found'; end if;
  if not public.fms_ocpi_can_act('quotation', p_deal, v_uid) then
    raise exception 'You are not authorized to submit this quotation';
  end if;
  if v_owner is distinct from v_uid and not public.fms_ocpi_is_coordinator(v_uid) then
    raise exception 'This quotation belongs to someone else';
  end if;
  if v_status not in ('draft', 'rework') then
    raise exception 'This quotation is already %', replace(v_status, '_', ' ');
  end if;

  -- ⚠ A QUOTATION MUST EXIST BEFORE IT CAN BE APPROVED. Approving a set of form
  --   answers that were never rendered would mean the approver signed off
  --   something nobody has seen as a document.
  if v_no is null or coalesce(v_ver, 0) < 1 then
    raise exception 'Generate the quotation before sending it for approval';
  end if;

  update public.fms_ocpi_deals
     set status = 'awaiting_quotation_approval',
         current_step = 'quotation_approval',
         qs_at = now()
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'quotation_submitted',
    v_no || ' sent for approval',
    public.fms_ocpi_step_owner_ids('quotation_approval'),
    jsonb_build_object('quotation_no', v_no, 'version_no', v_ver));
end $fn$;

comment on function public.fms_ocpi_submit_quotation(uuid) is
  'Mark a generated quotation final and send it to the quotation_approval owners, stamping qs_at. Refuses a quotation that has never been generated.';
grant execute on function public.fms_ocpi_submit_quotation(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'fms_ocpi_deals'
                    and column_name = 'qs_at') then
    raise exception 'qs_at did not land on fms_ocpi_deals';
  end if;
end $$;

commit;
