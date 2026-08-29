-- ===========================================================================
-- OCPI-3 · STAGE A — foundations for the machine mapping and the form reshape.
--
-- Spec: OCPI-3 in WORKLIST.md, sections A-M. ⚠ SECTION M SAYS WHAT THE LATER
-- POINTERS SUPERSEDED — warranties became FIXED SETTINGS rather than per-machine
-- defaults, so there are deliberately NO warranty columns on the machine here.
--
-- Purely ADDITIVE: three new tables, new nullable columns, one config row.
-- Nothing is renamed and nothing is dropped. In particular `dryer_type` KEEPS
-- ITS NAME and is merely relabelled in the UI as the dryer CATEGORY — renaming
-- it would break every frozen revision payload, which stores the key verbatim.
--
-- WHAT IS NOT HERE, ON PURPOSE
--   · No warranty columns — see above.
--   · No change to total_inr for the dryer price. The papers are to read
--     machine total -> dryer total -> final total, but WHETHER THE DRYER PRICE
--     ATTRACTS GST IS STILL UNANSWERED (open question, WORKLIST section K). The
--     price is stored; the arithmetic waits for the answer rather than guessing
--     at tax on a contract.
--   · No new master TYPE. `fms_ocpi_master_requests.master_type` keeps its four
--     values. Machine categories are owned by whoever owns 'machine', and dryer
--     names by whoever owns 'dryer_type' — so this adds nothing to the six
--     places that union is mirrored in.
--
-- Reversal (reverse order):
--   alter table public.fms_ocpi_deals drop column if exists centering_invoice_amount, ... ;
--   alter table public.fms_ocpi_machines drop column if exists opt_chilling_system, ... ;
--   drop table if exists public.fms_ocpi_machine_head_types;
--   drop table if exists public.fms_ocpi_dryers;
--   drop table if exists public.fms_ocpi_machine_categories;
--   delete from public.fms_ocpi_config where key = 'warranty_periods';
--   -- then re-run fms_ocpi_write_oc and fms_ocpi_save_draft from
--   -- 20261019120200 and 20261019120100 verbatim.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A.1 · Machine categories — Direct / Sublimation / Other.
--
-- Carries the MasterCrud contract columns (id / name / active / sort_order) so
-- the shared master screen needs no special casing.
--
-- ⚠ THE DRYER FLAG IS **NOT** HERE. It was specified on the category and the
--   client's own sheet then disproved it: in "Other", Position Printer needs a
--   dryer while all three Pengda machines do not. It lives on the machine.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_ocpi_machine_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fms_ocpi_machine_categories is
  'What kind of machine this is - Direct, Sublimation, Other. Chosen first on the quotation, and it narrows the machine list. Seeded from the client machine sheet.';

-- ---------------------------------------------------------------------------
-- A.1b · Dryer names, each belonging to a dryer CATEGORY.
--
-- `fms_ocpi_dryer_types` already holds the categories (Indian / Chinese / Not
-- Applicable) and keeps its table name; this is the list of actual dryers
-- within each. The quotation picks a category, then a name from that category.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_ocpi_dryers (
  id            uuid primary key default gen_random_uuid(),
  dryer_type_id uuid not null references public.fms_ocpi_dryer_types(id) on delete restrict,
  name          text not null,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (dryer_type_id, name)
);

comment on table public.fms_ocpi_dryers is
  'A dryer model, belonging to one dryer category. The quotation picks the category first and this list is filtered by it.';

-- ---------------------------------------------------------------------------
-- A.3 · A machine may carry SEVERAL print heads.
--
-- ⚠ THIS IS WHY IT IS A LINK TABLE AND NOT A COLUMN. The client's sheet lists
--   two heads in a single cell for five machines - "EX600 RC Katan & Homer",
--   "MS & Kyocera both", "EX600 RC & Kyocera" - and confirmed that a machine
--   genuinely offers more than one. The quotation shows ALL of them.
--
-- ⚠ THE DEAL STILL STORES ITS HEADS AS TEXT in fms_ocpi_deals.head_type,
--   joined. That is deliberate: the frozen revision payload and the revision
--   DIFF are flat key/value, so a child table would simply not appear when two
--   revisions are compared - and "which heads did we quote?" is exactly the
--   kind of change a reader needs to see.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_ocpi_machine_head_types (
  machine_id   uuid not null references public.fms_ocpi_machines(id) on delete cascade,
  head_type_id uuid not null references public.fms_ocpi_head_types(id) on delete restrict,
  sort_order   integer not null default 0,
  primary key (machine_id, head_type_id)
);

comment on table public.fms_ocpi_machine_head_types is
  'Which print heads a machine can be built with. A machine may have several; the quotation shows them all and the salesperson does not choose.';


-- ---------------------------------------------------------------------------
-- A.2 · What each machine now carries.
--
-- The four capability columns take 'no' | 'optional' | 'yes', which is the
-- client's own vocabulary from the sheet and is more useful than a boolean:
--   no       - the machine cannot have it, so never ask
--   optional - ask the salesperson
--   yes      - always included
-- Today all four are asked on every deal regardless of the machine.
--
-- ⚠ `name` STAYS THE MACHINE CODE and is untouched. billing_name is the full
--   invoice product name added beside it; nothing is re-keyed or back-filled,
--   and billing_name is deliberately NOT unique - two machines may share one.
-- ---------------------------------------------------------------------------
alter table public.fms_ocpi_machines
  add column if not exists billing_name text,
  add column if not exists category_id  uuid references public.fms_ocpi_machine_categories(id) on delete restrict,
  add column if not exists needs_dryer  boolean,
  add column if not exists opt_air_blade          text check (opt_air_blade          is null or opt_air_blade          in ('no','optional','yes')),
  add column if not exists opt_external_centering text check (opt_external_centering is null or opt_external_centering in ('no','optional','yes')),
  add column if not exists opt_ink_dust_exhauster text check (opt_ink_dust_exhauster is null or opt_ink_dust_exhauster in ('no','optional','yes')),
  add column if not exists opt_chilling_system    text check (opt_chilling_system    is null or opt_chilling_system    in ('no','optional','yes'));

comment on column public.fms_ocpi_machines.billing_name is
  'The full product name as it reads on an invoice. Prints beside the short name; NOT unique.';
comment on column public.fms_ocpi_machines.needs_dryer is
  'Does this machine take a dryer? Per MACHINE, not per category - the client sheet has Position Printer needing one while the three Pengdas in the same category do not.';
comment on column public.fms_ocpi_machines.opt_external_centering is
  'no | optional | yes. Also gates the centering device row in Shipment & invoice - which is why the rule is data and not a hard-coded check for the K64. The sheet marks it optional on Homer K24, K32, K64 and JP7, and yes on JPK.';

-- ---------------------------------------------------------------------------
-- A.4 - A.6 · The deal's dryer, and the Shipment & invoice section.
--
-- One section on the form asks the same four things of each item that is part
-- of the deal - how it ships, the route when separate, whether it is invoiced
-- separately, and if so the quantity and amount EXCLUDING TAX.
--
-- ⚠ FLAT COLUMNS, NOT A CHILD TABLE, for the same reason as the heads above:
--   payloadFromDraft, the frozen field_payload and revisionDiff are all flat
--   key/value. A child table would vanish from the revision comparison.
--
-- ⚠ head_ship_mode / head_ship_via / head_separate_invoice ALREADY EXIST and
--   are reused as-is. Only the quantity and amount are new for the head.
-- ---------------------------------------------------------------------------
alter table public.fms_ocpi_deals
  -- the dryer itself (dryer_type keeps its name and now means the CATEGORY)
  add column if not exists dryer_name       text,
  add column if not exists dryer_included   boolean,
  add column if not exists dryer_price      numeric(16, 2),

  -- head - shipment columns already exist
  add column if not exists head_invoice_qty        integer,
  add column if not exists head_invoice_amount     numeric(16, 2),

  add column if not exists dryer_ship_mode         text check (dryer_ship_mode is null or dryer_ship_mode in ('with_machine','separate')),
  add column if not exists dryer_ship_via          text,
  add column if not exists dryer_separate_invoice  boolean,
  add column if not exists dryer_invoice_qty       integer,
  add column if not exists dryer_invoice_amount    numeric(16, 2),

  add column if not exists spares_ship_mode        text check (spares_ship_mode is null or spares_ship_mode in ('with_machine','separate')),
  add column if not exists spares_ship_via         text,
  add column if not exists spares_separate_invoice boolean,
  add column if not exists spares_invoice_qty      integer,
  add column if not exists spares_invoice_amount   numeric(16, 2),

  add column if not exists centering_ship_mode        text check (centering_ship_mode is null or centering_ship_mode in ('with_machine','separate')),
  add column if not exists centering_ship_via         text,
  add column if not exists centering_separate_invoice boolean,
  add column if not exists centering_invoice_qty      integer,
  add column if not exists centering_invoice_amount   numeric(16, 2);

comment on column public.fms_ocpi_deals.dryer_price is
  'Charged only when the dryer is NOT part of the deal. Stored here; it does NOT yet feed total_inr - whether it attracts GST is still unanswered, and guessing at tax on a contract is not a decision code should make.';
comment on column public.fms_ocpi_deals.dryer_type is
  'The dryer CATEGORY (Indian / Chinese / Not Applicable). Relabelled in the UI by OCPI-3 section B; the column keeps its name so every frozen revision payload still reads.';

-- ---------------------------------------------------------------------------
-- A.7 · Warranty periods are a SETTING, not a per-machine mapping.
--
-- ⚠ THIS REPLACES THE MAPPING THAT WAS SPECIFIED FIRST. The client settled on
--   fixed periods: machine 12 months, head 18, and NO warranty offered on the
--   dryer or on spare parts. There is no dropdown; an exception is written into
--   Special remarks instead.
--
-- It belongs here for the reason QuotationValiditySection already gives about
-- {{quotation_validity_days}}: a company-wide policy should change every
-- machine template at once, not 28 templates by hand. And, as with that one,
-- changing it does not rewrite papers already issued - each revision freezes
-- its own resolved document.
--
-- ⚠ THE TEMPLATE PLACEHOLDERS MUST BE RE-POINTED AT THIS BEFORE THE DEAL
--   COLUMNS STOP BEING FILLED. {{machine_warranty_months}} appears in the
--   warranty clause of ALL TEN templates and {{head_warranty_months}} in four.
--   Remove the fields first and every detailed sheet prints a blank warranty
--   period. That is stage D task 1, and it is ordered that way on purpose.
-- ---------------------------------------------------------------------------
insert into public.fms_ocpi_config (key, value)
values ('warranty_periods', jsonb_build_object('machine_months', 12, 'head_months', 18))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Row-level security for the three new tables.
--
-- ⚠ NO NEW MASTER TYPE IS INTRODUCED. `master_type` is a four-value union
--   mirrored in six places - the TypeScript type, two SQL check constraints,
--   the elsif chain in fms_ocpi_resolve_master_request, Settings -> Master
--   owners, and RequireMasterOwner. Widening it costs all six and buys a
--   "request a new category" flow nobody asked for. Instead:
--     · machine categories and the machine->head links follow the MACHINE owner
--       (a category is part of the machine vocabulary, and the link table is
--       part of the machine - exactly the reasoning fms_ocpi_machine_sections
--       already uses)
--     · dryer names follow the DRYER_TYPE owner
--   Admins pass either way, as they do everywhere in this module.
-- ---------------------------------------------------------------------------
alter table public.fms_ocpi_machine_categories  enable row level security;
alter table public.fms_ocpi_dryers              enable row level security;
alter table public.fms_ocpi_machine_head_types  enable row level security;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('fms_ocpi_machine_categories', 'machine'),
      ('fms_ocpi_machine_head_types', 'machine'),
      ('fms_ocpi_dryers',             'dryer_type')
    ) as t(tbl, mt)
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', r.tbl);
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated using (true)', r.tbl);

    execute format('drop policy if exists %1$s_write on public.%1$I', r.tbl);
    execute format(
      'create policy %1$s_write on public.%1$I for all to authenticated
         using ((select public.is_admin((select auth.uid())))
                or (select public.fms_ocpi_is_master_manager(%2$L, (select auth.uid()))))
         with check ((select public.is_admin((select auth.uid())))
                or (select public.fms_ocpi_is_master_manager(%2$L, (select auth.uid()))))',
      r.tbl, r.mt);
  end loop;
end $$;

create index if not exists fms_ocpi_machines_category_idx
  on public.fms_ocpi_machines (category_id);
create index if not exists fms_ocpi_dryers_type_idx
  on public.fms_ocpi_dryers (dryer_type_id);

-- ---------------------------------------------------------------------------
-- A.8 · fms_ocpi_write_oc — re-issued for the new columns.
--
-- ⚠ THIS FUNCTION IS THE AUTHORITY ON THE BRANCH RULES, not branching.ts. The
--   TypeScript copy decides what a user SEES; this decides what is STORED, and
--   it nulls whatever its branches hide on every write. Change one and change
--   the other, or the server quietly erases answers the form is still showing.
--   Reproduced from 20261019120200 with the Shipment & invoice columns added;
--   nothing existing is altered.
--
-- ⚠ THE DRYER CONDITION IS UNCHANGED, still `dryer_type <> 'Not Applicable'`.
--   Stage E moves it onto the machine's needs_dryer flag - here AND in
--   branching.ts, together. Doing it now would put the two out of step.
--
-- ⚠ total_inr STILL IGNORES dryer_price - see the file header.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_write_oc(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incl_head   boolean;
  v_incl_spares boolean;
  v_dryer       text;
  v_transport   text;
  v_currency    text;
  v_amount      numeric;
  v_inr         numeric;
  v_ship_mode   text := nullif(btrim(p->>'head_ship_mode'), '');
  v_rate        numeric;
  v_value       numeric;
  v_gst         numeric;
  v_has_dryer   boolean;
  v_centering   text;
  v_dry_ship    text := nullif(btrim(p->>'dryer_ship_mode'), '');
  v_spr_ship    text := nullif(btrim(p->>'spares_ship_mode'), '');
  v_cen_ship    text := nullif(btrim(p->>'centering_ship_mode'), '');
  v_dry_inv     boolean := (p->>'dryer_separate_invoice')::boolean;
  v_spr_inv     boolean := (p->>'spares_separate_invoice')::boolean;
  v_cen_inv     boolean := (p->>'centering_separate_invoice')::boolean;
  v_head_inv    boolean := (p->>'head_separate_invoice')::boolean;
begin
  -- Can the MACHINE take a centering device? Read off the machine: the deal has
  -- no answer of its own to branch on. 'no' or unmapped means never ask, so
  -- nothing is stored.
  select d.incl_head, d.incl_spares, d.dryer_type, d.transport_terms,
         d.deal_value_currency, d.deal_value_amount, d.deal_value_inr,
         m.opt_external_centering
    into v_incl_head, v_incl_spares, v_dryer, v_transport,
         v_currency, v_amount, v_inr, v_centering
    from public.fms_ocpi_deals d
    left join public.fms_ocpi_machines m on m.id = d.machine_id
   where d.id = p_deal;

  v_has_dryer := v_dryer is not null and v_dryer <> 'Not Applicable';

  v_rate := case when v_transport = 'high_seas' then null
                 else nullif(p->>'gst_rate', '')::numeric end;

  v_value := case when v_currency = 'USD' then v_inr else v_amount end;
  v_gst   := case when v_rate is null or v_value is null then null
                  else round(v_value * v_rate / 100, 2) end;

  update public.fms_ocpi_deals set
    head_ship_mode        = case when v_incl_head is distinct from true then null else v_ship_mode end,
    head_ship_via         = case when v_incl_head is distinct from true or v_ship_mode is distinct from 'separate'
                                 then null else nullif(btrim(p->>'head_ship_via'), '') end,
    head_balance_remarks  = case when v_incl_head is distinct from true then null
                                 else nullif(btrim(p->>'head_balance_remarks'), '') end,
    head_separate_invoice = case when v_incl_head is distinct from true then null else v_head_inv end,
    -- quantity and amount belong to a SEPARATE invoice and to nothing else
    head_invoice_qty      = case when v_incl_head is distinct from true or v_head_inv is distinct from true
                                 then null else nullif(p->>'head_invoice_qty', '')::integer end,
    head_invoice_amount   = case when v_incl_head is distinct from true or v_head_inv is distinct from true
                                 then null else nullif(p->>'head_invoice_amount', '')::numeric end,

    dryer_chambers  = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_chambers'), '') end,
    heating_mode    = case when not v_has_dryer then null else nullif(btrim(p->>'heating_mode'), '') end,
    dryer_warranty  = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_warranty'), '') end,
    platter_details = nullif(btrim(p->>'platter_details'), ''),

    dryer_name      = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_name'), '') end,
    dryer_included  = case when not v_has_dryer then null else (p->>'dryer_included')::boolean end,
    -- a price only when the dryer is NOT part of the deal
    dryer_price     = case when not v_has_dryer or (p->>'dryer_included')::boolean is not false
                           then null else nullif(p->>'dryer_price', '')::numeric end,

    dryer_ship_mode        = case when not v_has_dryer then null else v_dry_ship end,
    dryer_ship_via         = case when not v_has_dryer or v_dry_ship is distinct from 'separate'
                                  then null else nullif(btrim(p->>'dryer_ship_via'), '') end,
    dryer_separate_invoice = case when not v_has_dryer then null else v_dry_inv end,
    dryer_invoice_qty      = case when not v_has_dryer or v_dry_inv is distinct from true
                                  then null else nullif(p->>'dryer_invoice_qty', '')::integer end,
    dryer_invoice_amount   = case when not v_has_dryer or v_dry_inv is distinct from true
                                  then null else nullif(p->>'dryer_invoice_amount', '')::numeric end,

    spares_ship_mode        = case when v_incl_spares is distinct from true then null else v_spr_ship end,
    spares_ship_via         = case when v_incl_spares is distinct from true or v_spr_ship is distinct from 'separate'
                                   then null else nullif(btrim(p->>'spares_ship_via'), '') end,
    spares_separate_invoice = case when v_incl_spares is distinct from true then null else v_spr_inv end,
    spares_invoice_qty      = case when v_incl_spares is distinct from true or v_spr_inv is distinct from true
                                   then null else nullif(p->>'spares_invoice_qty', '')::integer end,
    spares_invoice_amount   = case when v_incl_spares is distinct from true or v_spr_inv is distinct from true
                                   then null else nullif(p->>'spares_invoice_amount', '')::numeric end,

    centering_ship_mode        = case when coalesce(v_centering, 'no') = 'no' then null else v_cen_ship end,
    centering_ship_via         = case when coalesce(v_centering, 'no') = 'no' or v_cen_ship is distinct from 'separate'
                                      then null else nullif(btrim(p->>'centering_ship_via'), '') end,
    centering_separate_invoice = case when coalesce(v_centering, 'no') = 'no' then null else v_cen_inv end,
    centering_invoice_qty      = case when coalesce(v_centering, 'no') = 'no' or v_cen_inv is distinct from true
                                      then null else nullif(p->>'centering_invoice_qty', '')::integer end,
    centering_invoice_amount   = case when coalesce(v_centering, 'no') = 'no' or v_cen_inv is distinct from true
                                      then null else nullif(p->>'centering_invoice_amount', '')::numeric end,

    air_blade           = (p->>'air_blade')::boolean,
    external_centering  = (p->>'external_centering')::boolean,
    ink_dust_exhauster  = (p->>'ink_dust_exhauster')::boolean,
    chilling_system     = (p->>'chilling_system')::boolean,

    other_commitments        = nullif(btrim(p->>'other_commitments'), ''),
    printer_warranty         = nullif(btrim(p->>'printer_warranty'), ''),
    head_warranty            = nullif(btrim(p->>'head_warranty'), ''),
    post_warranty_head_price = nullif(p->>'post_warranty_head_price', '')::numeric,
    consumables_supplier     = nullif(btrim(p->>'consumables_supplier'), ''),
    insurance_clause_agreed  = (p->>'insurance_clause_agreed')::boolean,

    ref_no            = nullif(btrim(p->>'ref_no'), ''),
    delivery_days     = nullif(btrim(p->>'delivery_days'), ''),
    trade_term        = nullif(btrim(p->>'trade_term'), ''),
    machine_model_no  = nullif(btrim(p->>'machine_model_no'), ''),
    prepared_by       = nullif(btrim(p->>'prepared_by'), ''),
    approved_by       = nullif(btrim(p->>'approved_by'), ''),

    -- Derived, not taken from the payload.
    gst_rate          = v_rate,
    machine_value_inr = v_value,
    gst_amount_inr    = v_gst,
    total_inr         = case when v_value is null then null else v_value + coalesce(v_gst, 0) end
  where id = p_deal;
end $$;

comment on function public.fms_ocpi_write_oc(uuid, jsonb) is
  'Write the part-B columns from a jsonb bag, nulling whatever the branch rules hide. Now covers Shipment & invoice for head, dryer, spare parts and centering device - quantity and amount are kept only when that item is separately invoiced. High Seas suppresses GST entirely; the rupee value, GST and total are DERIVED. total_inr does NOT include dryer_price - its tax treatment is unsettled. Touches NO part-A column.';

-- ---------------------------------------------------------------------------
-- A.9 · fms_ocpi_save_draft — the part-B key list grows.
--
-- ⚠ THIS IS THE EASIEST THING IN THE MODULE TO MISS. save_draft calls write_oc
--   ONLY when the incoming bag carries at least one of these literal key names.
--   A new part-B field left off this list is never written at all: no error, no
--   warning, the value simply never lands. The `?|` guard exists so a part-A
--   only bag does not blank the whole order confirmation, and that is still
--   right - it just has to know about every part-B key.
--
--   The pre-reshape deal QT-M0037 is what this looks like from the outside: its
--   frozen payload carries 36 keys, none of them part B, so write_oc never ran
--   and its paper prints a blank total to this day.
--
-- Everything above the guard is unchanged from 20261019120100.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_save_draft(p jsonb, p_deal uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid := p_deal;
  v_status text;
  v_owner  uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if nullif(btrim(p->>'customer_name'), '') is null then
    raise exception 'Enter the customer name before saving';
  end if;

  if v_id is null then
    if not public.fms_ocpi_can_act('quotation', null, v_uid) then
      raise exception 'You are not authorized to raise a quotation';
    end if;
    insert into public.fms_ocpi_deals (raised_by, status, current_step)
    values (v_uid, 'draft', 'quotation')
    returning id into v_id;
  else
    select status, raised_by into v_status, v_owner
      from public.fms_ocpi_deals where id = v_id for update;
    if v_status is null then raise exception 'Quotation not found'; end if;
    if v_status <> 'draft' then
      raise exception 'This quotation has already been submitted — use Edit instead';
    end if;
    if v_owner is distinct from v_uid and not public.fms_ocpi_is_coordinator(v_uid) then
      raise exception 'This draft belongs to someone else';
    end if;
  end if;

  -- ⚠ ORDER IS SEMANTIC. write_oc branches on part-A answers it reads off the
  --   row, so part A must already be written.
  perform public.fms_ocpi_write_quotation(v_id, p);

  if p ?| array[
       'head_ship_mode', 'head_ship_via', 'head_balance_remarks', 'head_separate_invoice',
       'head_invoice_qty', 'head_invoice_amount',
       'dryer_chambers', 'heating_mode', 'dryer_warranty', 'platter_details',
       'dryer_name', 'dryer_included', 'dryer_price',
       'dryer_ship_mode', 'dryer_ship_via', 'dryer_separate_invoice',
       'dryer_invoice_qty', 'dryer_invoice_amount',
       'spares_ship_mode', 'spares_ship_via', 'spares_separate_invoice',
       'spares_invoice_qty', 'spares_invoice_amount',
       'centering_ship_mode', 'centering_ship_via', 'centering_separate_invoice',
       'centering_invoice_qty', 'centering_invoice_amount',
       'air_blade', 'external_centering', 'ink_dust_exhauster', 'chilling_system',
       'other_commitments', 'printer_warranty', 'head_warranty', 'post_warranty_head_price',
       'consumables_supplier', 'insurance_clause_agreed',
       'ref_no', 'delivery_days', 'trade_term', 'machine_model_no',
       'prepared_by', 'approved_by', 'gst_rate', 'machine_value_inr'
     ] then
    perform public.fms_ocpi_write_oc(v_id, p);
  end if;

  return v_id;
end $$;

comment on function public.fms_ocpi_save_draft(jsonb, uuid) is
  'Create or update a draft quotation from one merged payload. Calls fms_ocpi_write_quotation, then fms_ocpi_write_oc when the bag carries part-B keys - the list now includes every Shipment & invoice key. One transaction; neither writer touches the other''s columns. Requires only the customer name; mints no number.';

commit;
