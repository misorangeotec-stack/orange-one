-- ===========================================================================
-- PRODUCTION ENTRY FMS — CERTIFICATE OF ANALYSIS (COA) at the Quality Check.
--
-- WHAT THIS IS
--   Once a lot's Quality Check is APPROVED, QC issues a Certificate of Analysis
--   for it. One entry produces TWO documents off the same data: a CUSTOMER copy
--   and an INTERNAL copy. They differ only in which parameters print — five on
--   the customer copy, nine on the internal one (source: the factory's own
--   "Daily Quality Monitoring Sheet OOT QC FMT 002", tab "COA (Both)").
--
--   ⚠ THE COA IS NOT A STEP IN THE CHAIN. Quality Check advances the card to the
--     Log Book exactly as before; the COA hangs off the approved card and blocks
--     nothing. No new status, no queue, no SLA anchor. A repackaging card bypasses
--     Quality Check entirely, so it never gets one.
--
-- TABLES
--   fms_production_test_equipments  — master: the instrument a test is run on
--   fms_production_coa_parameters   — master: what is measured, its standard, the
--                                     equipment it uses, and which copy it prints on
--   fms_production_coas             — one COA per job card (unique request_id)
--
-- ⚠ WHY `lines` IS A SNAPSHOT, NOT A JOIN
--   Every line freezes the parameter's NAME, STANDARD and EQUIPMENT NAME as they
--   read at the moment the COA was saved. Re-reading the masters at print time
--   would mean that editing a standard next month silently rewrites a certificate
--   that has already gone to a customer. Same rule the Travel Authorisation
--   follows against its frozen rate card.
--
-- ⚠ TWO GOVERNANCE CHECK CONSTRAINTS ARE WIDENED (section 4). Without this,
--   assigning an owner to either new master fails on the constraint — and the
--   resolve RPC + the email payload both need a 'test_equipment' arm, or a
--   requested equipment cannot be approved and emails as "category". That exact
--   bug already shipped once for 'packaging_item'
--   (see 20260729120000_add_fms_production_master_request_unit_and_guard.sql).
--
-- ⚠ 'coa_parameter' IS DELIBERATELY ABSENT from fms_production_master_requests'
--   constraint and from the resolve RPC — the BOM precedent. A row carrying a
--   standard, an audience, an order AND an equipment does not fit the
--   single-payload "request a new master" modal, so it is created on its own
--   Masters tab rather than requested. It IS in the master_managers constraint,
--   so it can still have an owner.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid) /
-- public.fms_production_is_master_manager(text,uuid) / fms_production_can_act(...).
--
-- Reversal (reverse order):
--   drop function if exists public.fms_production_save_coa(jsonb);
--   -- restore fms_production_email_payload + fms_production_resolve_master_request
--   -- from 20260729120000_add_fms_production_master_request_unit_and_guard.sql
--   alter table public.fms_production_master_requests
--     drop constraint if exists fms_production_master_requests_master_type_check;
--   alter table public.fms_production_master_requests
--     add constraint fms_production_master_requests_master_type_check
--     check (master_type in ('category','raw_material','fg_item','unit','packaging_item'));
--   alter table public.fms_production_master_managers
--     drop constraint if exists fms_production_master_managers_master_type_check;
--   alter table public.fms_production_master_managers
--     add constraint fms_production_master_managers_master_type_check
--     check (master_type in ('category','raw_material','fg_item','unit','packaging_item','bom'));
--   drop table if exists public.fms_production_coas;
--   drop table if exists public.fms_production_coa_parameters;
--   drop table if exists public.fms_production_test_equipments;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. fms_production_test_equipments — the instrument master.
--    Shape copied from fms_production_units: a flat name + active + order list.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_production_test_equipments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_production_test_equipments is
  'Test-equipment master for the Production Entry COA (PHS-3C, FE30K, Brookfield, ...). Mapped OPTIONALLY against a COA parameter - three of the nine parameters have no instrument.';

drop trigger if exists trg_fms_production_test_equipments_updated on public.fms_production_test_equipments;
create trigger trg_fms_production_test_equipments_updated
  before update on public.fms_production_test_equipments
  for each row execute function public.set_updated_at();

alter table public.fms_production_test_equipments enable row level security;
drop policy if exists fms_production_test_equipments_select on public.fms_production_test_equipments;
create policy fms_production_test_equipments_select on public.fms_production_test_equipments
  for select to authenticated using (true);
drop policy if exists fms_production_test_equipments_write on public.fms_production_test_equipments;
create policy fms_production_test_equipments_write on public.fms_production_test_equipments
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('test_equipment', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('test_equipment', auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. fms_production_coa_parameters — what a COA measures.
--
--    `standard`   the DEFAULT specification, pre-filled onto every new COA and
--                 editable there. Free text, not numeric: the factory writes
--                 ranges ("6.5 - 8.5"), limits ("< 5") and words ("Clear").
--    `appears_on` which copy the parameter prints on. 'both' is the COMMON case,
--                 not 'customer' — the five customer parameters appear on the
--                 internal copy as well. Nothing is customer-only today.
--    `sort_order` the print order, and the order of the entry form. Unlike every
--                 other Production master this one exposes an Order INPUT: the
--                 shared MasterCrud shows the column but renders no field for it.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_production_coa_parameters (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  standard          text,
  test_equipment_id uuid references public.fms_production_test_equipments on delete set null,
  appears_on        text not null default 'both'
                    check (appears_on in ('customer','internal','both')),
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_by        uuid references auth.users on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.fms_production_coa_parameters is
  'COA parameter master: what is measured, its default standard, the (optional) test equipment, and which copy it prints on. appears_on ''both'' means BOTH copies, and is the common case.';
comment on column public.fms_production_coa_parameters.standard is
  'Default specification, pre-filled onto a new COA and editable there. Free text - the factory writes ranges, limits and words, not only numbers.';
comment on column public.fms_production_coa_parameters.appears_on is
  'customer | internal | both. Which generated copy prints this parameter. Entry captures every active parameter regardless.';

create index if not exists fms_production_coa_parameters_equipment_idx
  on public.fms_production_coa_parameters (test_equipment_id);

drop trigger if exists trg_fms_production_coa_parameters_updated on public.fms_production_coa_parameters;
create trigger trg_fms_production_coa_parameters_updated
  before update on public.fms_production_coa_parameters
  for each row execute function public.set_updated_at();

alter table public.fms_production_coa_parameters enable row level security;
drop policy if exists fms_production_coa_parameters_select on public.fms_production_coa_parameters;
create policy fms_production_coa_parameters_select on public.fms_production_coa_parameters
  for select to authenticated using (true);
drop policy if exists fms_production_coa_parameters_write on public.fms_production_coa_parameters;
create policy fms_production_coa_parameters_write on public.fms_production_coa_parameters
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('coa_parameter', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('coa_parameter', auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. fms_production_coas — one certificate per job card.
--
--    UNIQUE on request_id: a COA is EDITED IN PLACE, never re-issued as a new
--    revision. Correcting one updates this row and the activity trail records
--    who changed it.
--
--    product_name / lot_no are SNAPSHOTS taken by the RPC from the card itself
--    (the FG item's name and the Lot/Batch Card number) — the client never sends
--    them, so a COA cannot be issued naming something the card does not say.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_production_coas (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null unique references public.fms_production_requests on delete cascade,
  product_name  text,
  lot_no        text,
  issue_date    date not null,
  conclusion    text,
  lines         jsonb not null default '[]'::jsonb,
  issued_by     uuid references auth.users on delete set null,
  issued_at     timestamptz not null default now(),
  updated_by    uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.fms_production_coas is
  'Certificate of Analysis, one per job card (unique request_id - edited in place, never re-issued). Written only through fms_production_save_coa.';
comment on column public.fms_production_coas.lines is
  'FROZEN snapshot, one element per parameter: {parameter_id, name, standard, observed, equipment_id, equipment_name, appears_on, sort_order}. Names/standards are NOT re-read from the masters at print time - editing a standard must never rewrite a certificate already sent to a customer.';

create index if not exists fms_production_coas_issue_date_idx on public.fms_production_coas (issue_date);

drop trigger if exists trg_fms_production_coas_updated on public.fms_production_coas;
create trigger trg_fms_production_coas_updated
  before update on public.fms_production_coas
  for each row execute function public.set_updated_at();

-- Readable by every granted user (same audience as the activity trail); writes go
-- through the SECURITY DEFINER RPC below, which re-checks authorization itself.
alter table public.fms_production_coas enable row level security;
drop policy if exists fms_production_coas_select on public.fms_production_coas;
create policy fms_production_coas_select on public.fms_production_coas
  for select to authenticated using (true);
drop policy if exists fms_production_coas_write_admin on public.fms_production_coas;
create policy fms_production_coas_write_admin on public.fms_production_coas
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Widen the two master-governance CHECK constraints.
--
--    ⚠ 'coa_parameter' goes into MANAGERS ONLY. It is not requestable (see the
--      header), so putting it in the requests constraint would advertise a shape
--      the request modal cannot express and the resolve RPC would refuse.
-- ---------------------------------------------------------------------------
alter table public.fms_production_master_managers
  drop constraint if exists fms_production_master_managers_master_type_check;
alter table public.fms_production_master_managers
  add constraint fms_production_master_managers_master_type_check
  check (master_type in ('category','raw_material','fg_item','unit','packaging_item','bom','test_equipment','coa_parameter'));

alter table public.fms_production_master_requests
  drop constraint if exists fms_production_master_requests_master_type_check;
alter table public.fms_production_master_requests
  add constraint fms_production_master_requests_master_type_check
  check (master_type in ('category','raw_material','fg_item','unit','packaging_item','test_equipment'));

-- ---------------------------------------------------------------------------
-- 5. Resolve a master request — 'test_equipment' arm added.
--    Body from 20260729120000_add_fms_production_master_request_unit_and_guard.sql;
--    the single branch marked CHANGED is the only difference.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_new_id  uuid;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_production_master_requests
  where id = p_request_id
  for update;

  if v_type is null then raise exception 'Master request % not found', p_request_id; end if;
  if v_status <> 'pending' then raise exception 'Master request % is already %', p_request_id, v_status; end if;

  if not (public.is_admin(auth.uid()) or public.fms_production_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    -- 'category' is hidden from the UI registry but kept here: legacy pending
    -- rows may still reference it, and dropping the branch would fail them.
    if v_type = 'category' then
      insert into public.fms_production_categories (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    elsif v_type = 'raw_material' then
      insert into public.fms_production_raw_materials (name, unit_id, created_by)
      values (nullif(trim(v_payload->>'name'),''), nullif(v_payload->>'unit_id','')::uuid, auth.uid())
      returning id into v_new_id;
    elsif v_type = 'fg_item' then
      insert into public.fms_production_fg_items (name, unit_id, created_by)
      values (nullif(trim(v_payload->>'name'),''), nullif(v_payload->>'unit_id','')::uuid, auth.uid())
      returning id into v_new_id;
    elsif v_type = 'unit' then
      insert into public.fms_production_units (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    elsif v_type = 'packaging_item' then
      insert into public.fms_production_packaging_items (name, unit_id, created_by)
      values (nullif(trim(v_payload->>'name'),''), nullif(v_payload->>'unit_id','')::uuid, auth.uid())
      returning id into v_new_id;
    elsif v_type = 'test_equipment' then
      -- CHANGED: without this arm an approved equipment request raises
      -- 'Unknown master type' and the request could never be resolved.
      insert into public.fms_production_test_equipments (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_production_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_production_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;
grant execute on function public.fms_production_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Email payload — label 'test_equipment' properly.
--    Body from 20260729120000_add_fms_production_master_request_unit_and_guard.sql;
--    only the master-label CASE changes (marked CHANGED).
--
--    ⚠ Miss this and equipment requests email as "category", exactly as
--      packaging requests did before that migration fixed the same omission.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_email_payload(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_meta        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b text := '/production-entry';
  r record;
  mr record;
  v_doc text;
  v_subject text; v_eyebrow text; v_headline text; v_action text;
  v_cta_label text; v_cta_path text;
  v_rows jsonb;
  v_note jsonb := '{}'::jsonb;
  v_label text;
  v_name text;
  v_unit text;
  v_next_label text;
  v_next_queue text;
  v_qty text;
begin
  -- ---- master-data governance ----
  if p_entity_type = 'master_request' then
    select * into mr from public.fms_production_master_requests where id = p_entity_id;
    if not found then return jsonb_build_object('headline', p_text); end if;
    -- CHANGED: 'test_equipment' had no arm, so those requests emailed as "category".
    v_label := case coalesce(p_meta->>'masterType', mr.master_type)
                 when 'raw_material' then 'raw material'
                 when 'packaging_item' then 'packaging item'
                 when 'fg_item' then 'FG item'
                 when 'unit' then 'unit'
                 when 'test_equipment' then 'test equipment'
                 else 'category' end;
    v_name  := coalesce(mr.proposed_payload->>'name', 'entry');
    select u.name into v_unit from public.fms_production_units u
     where u.id = nullif(mr.proposed_payload->>'unit_id','')::uuid;
    v_rows := jsonb_build_array(jsonb_build_object('label','Name','value', v_name))
              || case when coalesce(v_unit,'') <> ''
                      then jsonb_build_array(jsonb_build_object('label','Unit','value', v_unit))
                      else '[]'::jsonb end;
    if p_type = 'master_requested' then
      return jsonb_build_object(
        'subject', 'New ' || v_label || ' requested - "' || v_name || '"',
        'eyebrow', 'Master request',
        'headline', 'A new ' || v_label || ' was requested',
        'action', 'requested a new ' || v_label,
        'rows', v_rows,
        'ctaLabel', 'Review master requests', 'ctaPath', b || '/master-requests');
    else
      return jsonb_build_object(
        'subject', case when p_type = 'master_approved'
                        then 'Your ' || v_label || ' was approved - "' || v_name || '"'
                        else 'Your ' || v_label || ' request was rejected' end,
        'eyebrow', case when p_type = 'master_approved' then 'Master approved' else 'Master rejected' end,
        'headline', case when p_type = 'master_approved'
                         then 'Your new ' || v_label || ' was approved'
                         else 'Your ' || v_label || ' request was rejected' end,
        'action', case when p_type = 'master_approved' then 'approved a ' || v_label else 'rejected a ' || v_label end,
        'rows', v_rows,
        'ctaLabel', 'Open masters', 'ctaPath', b || '/master-requests')
      || case when coalesce(btrim(mr.review_note),'') <> ''
              then jsonb_build_object('note', jsonb_build_object('label','Note','text', mr.review_note))
              else '{}'::jsonb end;
    end if;
  end if;

  -- ---- production job card ----
  select req.*,
         cat.name as category_name,
         rm.name  as raw_material_name,
         fg.name  as fg_item_name,
         un.name  as unit_name
    into r
    from public.fms_production_requests req
    left join public.fms_production_categories    cat on cat.id = req.category_id
    left join public.fms_production_raw_materials  rm on rm.id  = req.raw_material_id
    left join public.fms_production_fg_items       fg on fg.id  = req.fg_item_id
    left join public.fms_production_units          un on un.id  = req.unit_id
   where req.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_doc := 'Job card #' || r.req_no;
  v_qty := case when r.required_qty is null then '-'
                else trim(to_char(r.required_qty, 'FM999999990.###')) ||
                     case when coalesce(r.unit_name,'') <> '' then ' ' || r.unit_name else '' end end;

  v_rows := jsonb_build_array(
    jsonb_build_object('label','Job card no.','value', coalesce(nullif(btrim(r.jobcard_no),''), r.req_no)),
    jsonb_build_object('label','Category','value', coalesce(r.category_name,'-')),
    jsonb_build_object('label','Raw material','value', coalesce(r.raw_material_name,'-')),
    jsonb_build_object('label','Required qty','value', v_qty),
    jsonb_build_object('label','FG item','value', coalesce(r.fg_item_name,'-'))
  );

  -- Map the row's next due step -> friendly label + queue path.
  v_next_label := case r.current_step
                    when 'material_handover' then 'Material Handover'
                    when 'transfer_slip'     then 'Transfer Slip & Batch Card'
                    when 'production_entry'  then 'Production Entry'
                    when 'quality_check'     then 'Quality Checking'
                    when 'mc_testing'        then 'M/C Testing'
                    when 'pm_handover'       then 'Packing Material Handover'
                    when 'pm_transfer'       then 'Packing Material Transfer'
                    when 'packing_entry'     then 'Packing Entry'
                    when 'fg_transfer'       then 'FG Transfer'
                    else 'the next step' end;
  v_next_queue := case r.current_step
                    when 'material_handover' then '/queues/material-handover'
                    when 'transfer_slip'     then '/queues/transfer-slip'
                    when 'production_entry'  then '/queues/production'
                    when 'quality_check'     then '/queues/quality'
                    when 'mc_testing'        then '/queues/mc-testing'
                    when 'pm_handover'       then '/queues/pm-handover'
                    when 'pm_transfer'       then '/queues/pm-transfer'
                    when 'packing_entry'     then '/queues/packing'
                    when 'fg_transfer'       then '/queues/fg-transfer'
                    else '/requests/' || r.id::text end;

  -- Eyebrow = what just happened (the announced/completed step).
  v_eyebrow := case p_type
                 when 'raised' then 'New job card'
                 when 'material_handover' then 'Handover confirmed'
                 when 'transfer_slip' then 'Transfer slip done'
                 when 'production_entry' then 'Production recorded'
                 when 'quality_check' then 'Quality checked'
                 when 'mc_testing' then 'M/C tested'
                 when 'pm_handover' then 'PM handed over'
                 when 'pm_transfer' then 'PM transferred'
                 when 'packing_entry' then 'Packing recorded'
                 when 'fg_transfer' then 'Closed'
                 else 'Production Entry' end;

  if r.status = 'closed' then
    v_action := 'recorded the FG transfer';
    v_headline := 'Job card closed - FG transferred to Hojiwala';
    v_subject := 'Job card closed - ' || v_doc;
    v_cta_label := 'Open the job card'; v_cta_path := b || '/requests/' || r.id::text;
    if r.final_qty is not null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','Final qty','value', trim(to_char(r.final_qty,'FM999999990.###'))));
    end if;
    if coalesce(btrim(r.fg_remarks),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object('label','Remarks','text', r.fg_remarks));
    end if;
  else
    v_action := case p_type when 'raised' then 'raised a job card' else 'completed a production step' end;
    v_headline := 'Ready for ' || v_next_label;
    v_subject := 'Ready for ' || v_next_label || ' (' || v_doc || ')';
    v_cta_label := 'Open ' || v_next_label || ' queue'; v_cta_path := b || v_next_queue;
  end if;

  return jsonb_build_object(
    'subject', v_subject, 'eyebrow', v_eyebrow, 'headline', v_headline,
    'action', v_action, 'docLabel', v_doc,
    'rows', v_rows,
    'ctaLabel', v_cta_label, 'ctaPath', v_cta_path
  ) || v_note;
exception when others then
  return jsonb_build_object('headline', coalesce(nullif(btrim(p_text),''), 'Production Entry update'));
end $$;
grant execute on function public.fms_production_email_payload(text, uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. fms_production_save_coa — write the certificate (insert or edit in place).
--
--    ONE function, not the record/update pair every STEP carries. Those two exist
--    because a step both advances the card and stays revisable afterwards, and
--    the two have different status transitions. The COA advances nothing, so a
--    single upsert on the unique request_id is the whole story — the same shape
--    fms_production_save_bom uses for its own header-plus-lines record.
--
--    p = { request_id, issue_date?, conclusion?,
--          lines: [ { parameter_id?, name, standard?, observed?,
--                     equipment_id?, equipment_name?, appears_on?, sort_order? } ] }
--
--    ⚠ product_name and lot_no are read from the CARD, never from p. A client
--      cannot issue a certificate naming a product the job card does not say.
--
--    ⚠ The issue date may be BACK-dated but never post-dated, and "today" is IST.
--      The database runs in UTC, so `current_date` would let a 05:00-IST caller
--      post-date by a day. Same guard as fms_production_submit_request.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_save_coa(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid := nullif(p->>'request_id', '')::uuid;
  v_today   date;
  v_issue   date;
  v_lines   jsonb := coalesce(p->'lines', '[]'::jsonb);
  v_product text;
  v_lot     text;
  v_qc      text;
  v_type    text;
  v_id      uuid;
  v_existed boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if v_req is null then raise exception 'A job card is required'; end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'lines must be a JSON array'; end if;

  select fg.name, r.jobcard_no, r.qc_status, r.card_type
    into v_product, v_lot, v_qc, v_type
    from public.fms_production_requests r
    left join public.fms_production_fg_items fg on fg.id = r.fg_item_id
   where r.id = v_req;

  if not found then raise exception 'Job card % not found', v_req; end if;

  -- A repackaging card bypasses Quality Check entirely, so it can never have an
  -- approved test to certify. Checked explicitly rather than relying on qc_status
  -- being null, so the refusal says WHY.
  if v_type = 'repackaging' then
    raise exception 'A repackaging card does not run quality checking, so it has no COA.';
  end if;
  if coalesce(v_qc, '') <> 'approved' then
    raise exception 'The quality check must be approved before a COA can be issued.';
  end if;
  if not public.fms_production_can_act('quality_check', v_req, v_uid) then
    raise exception 'Only an owner of the Quality Checking step can issue or edit a COA.';
  end if;

  v_today := (now() at time zone 'Asia/Kolkata')::date;
  v_issue := coalesce(nullif(trim(p->>'issue_date'), '')::date, v_today);
  if v_issue > v_today then
    raise exception 'The COA issue date cannot be in the future.';
  end if;

  select id into v_id from public.fms_production_coas where request_id = v_req;
  v_existed := v_id is not null;

  insert into public.fms_production_coas
    (request_id, product_name, lot_no, issue_date, conclusion, lines, issued_by, updated_by)
  values
    (v_req, v_product, v_lot, v_issue,
     nullif(btrim(p->>'conclusion'), ''), v_lines, v_uid, v_uid)
  on conflict (request_id) do update
    set product_name = excluded.product_name,
        lot_no       = excluded.lot_no,
        issue_date   = excluded.issue_date,
        conclusion   = excluded.conclusion,
        lines        = excluded.lines,
        updated_by   = v_uid
  returning id into v_id;

  -- Activity only: entity_type stays 'request' (a COA belongs to its job card),
  -- so nothing else has to learn a new entity type. No notification fan-out —
  -- issuing a certificate is not somebody else's cue to act.
  insert into public.fms_production_activity (entity_type, entity_id, type, actor_id, note, meta)
  values ('request', v_req,
          case when v_existed then 'coa_updated' else 'coa_issued' end,
          v_uid, null,
          jsonb_build_object('coa_id', v_id, 'lot_no', v_lot, 'issue_date', v_issue));

  return v_id;
end $$;
comment on function public.fms_production_save_coa(jsonb) is
  'Issue or edit in place the Certificate of Analysis for a job card. Quality Check must be approved; caller must be an admin, a process coordinator or a Quality Checking step owner. Product name and lot number are read from the card, never from the payload.';
grant execute on function public.fms_production_save_coa(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. SEED — the nine parameters and six instruments the factory uses today.
--
--    Transcribed from tab "COA (Both)" of the Daily Quality Monitoring Sheet.
--    Standards are left NULL: the shared sheet has that column blank, so QC fills
--    them in the master rather than having a wrong figure seeded under them.
--
--    ⚠ appears_on: the five "customer" parameters are 'both', NOT 'customer'.
--      They print on the internal copy too — the two blocks in the sheet are
--      nested, not disjoint. Nothing is customer-only today.
--
--    ⚠ Two names are corrected against the sheet's own spelling: "Surface Tention"
--      -> "Surface Tension" (as the Daily QC tab spells it) and "Mililiter" ->
--      "Millilitre". One of the two prints on a customer-facing document.
--
--    The micro sign in "0.25µ" is U+00B5, NOT Greek mu U+03BC — the PDF font
--      carries the former and not the latter (see shared/lib/pdfBrand.ts).
--
--    Idempotent: re-running changes nothing already present.
-- ---------------------------------------------------------------------------
insert into public.fms_production_test_equipments (name, sort_order) values
  ('PHS-3C',     1),
  ('FE30K',      2),
  ('K6',         3),
  ('BROOKFIELD', 4),
  ('TU1810',     5),
  ('Pycnometer', 6)
on conflict (name) do nothing;

insert into public.fms_production_coa_parameters (name, test_equipment_id, appears_on, sort_order)
select v.name,
       (select e.id from public.fms_production_test_equipments e where e.name = v.equipment),
       v.appears_on,
       v.sort_order
from (values
  ('PH',                                                                        'PHS-3C',     'both',     1),
  ('Conductivity (ms/cm)',                                                      'FE30K',      'both',     2),
  ('Surface Tension (mN/m)',                                                    'K6',         'both',     3),
  ('Viscosity (cps)',                                                           'BROOKFIELD', 'both',     4),
  ('Concentration (%)',                                                         'TU1810',     'both',     5),
  ('Density (kg/m³)',                                                           'Pycnometer', 'internal', 6),
  ('10% Ink Solution in Water Foam Volume in Millilitre (1 g ink + 9 g water)', null,         'internal', 7),
  ('Time Required to Settle Foam',                                              null,         'internal', 8),
  ('0.25µ Volume Drop Spreading Time',                                          null,         'internal', 9)
) as v(name, equipment, appears_on, sort_order)
on conflict (name) do nothing;
