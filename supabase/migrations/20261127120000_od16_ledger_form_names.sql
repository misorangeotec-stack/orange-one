-- ===========================================================================
-- OD-16 PHASE 1 — THE CUSTOMER READS A FORM NAME, NOT ONE OF OUR COMPANIES.
--
-- OD-14 asked the customer which of our books they are buying from and labelled
-- the choice `alias + location` — "O-tec - Surat", "Enterprise - Surat". That is
-- better than the raw Tally book string, but it is still OUR name for OUR legal
-- entity, and the instruction now is that the Order Desk must not show it at all.
--
-- What the customer should read instead is the FORM they place the order on — a
-- name we agree with them, kept per TALLY LEDGER.
--
-- ⚠ WHY THE LEDGER AND NOT THE COMPANY IS THE KEY, because it looks like the
--   company would do. Within one customer the two are 1:1 — `fms_dispatch_save_
--   customer_org` refuses more than one ticked ledger per company — but ACROSS
--   customers they are not. One company book holds thousands of ledgers, and two
--   customers buying from the same book can be on different forms. Keyed on the
--   company, every customer of O-tec Surat would be forced onto one name, which
--   is the very thing this replaces.
--
-- ⚠ Q11 IS NOT REVERSED, AND THIS IS THE PART TO GET RIGHT. The form name is
--   keyed on a ledger, so returning it to the customer's browser is one step away
--   from returning the ledger list itself. It is safe ONLY because the name is
--   ours to choose and is agreed WITH that customer — it carries no ledger id, no
--   ledger name and no hint of how many ledgers they are ticked into. The rule
--   stands unchanged: the Order Desk reads no table and never sees `party_ids`.
--
-- ⚠ THE FALLBACK IS THE OLD LABEL, DELIBERATELY. A ledger with no form mapped
--   still has to render something, and a blank picker option is worse than a
--   company name. So `form_name` comes back NULL and the caller falls back —
--   which means switching this on is safe before a single form is typed, and the
--   Setup screen flags the ledgers still missing one rather than the customer
--   discovering it.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. THE MASTER
-- ===========================================================================
create table if not exists public.fms_dispatch_ledger_forms (
  party_id   uuid primary key references public.mst_parties(id) on delete cascade,

  -- What the customer reads where our company name used to be.
  form_name  text not null,

  active     boolean not null default true,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),

  constraint fms_dispatch_ledger_forms_name_chk
    check (length(trim(form_name)) > 0)
);

comment on table public.fms_dispatch_ledger_forms is
  'OD-16. One Tally ledger -> the form name the customer places orders on. Edited only from '
  'Order to Dispatch -> Setup -> Forms, through fms_dispatch_save_ledger_form(). An unmapped '
  'ledger is not an error: the Order Desk falls back to the company label it showed before.';

comment on column public.fms_dispatch_ledger_forms.form_name is
  'Customer-facing. Never a Tally ledger name and never one of our legal entities.';

-- Setup lists by form name, and the Order Desk looks one up per ticked ledger.
create index if not exists fms_dispatch_ledger_forms_name_idx
  on public.fms_dispatch_ledger_forms (upper(trim(form_name)));

-- ---------------------------------------------------------------------------
-- RLS — the same coordinator rule the customer tables carry, for the same
-- reason: this is Setup data about customers, not a general master.
-- ---------------------------------------------------------------------------
alter table public.fms_dispatch_ledger_forms enable row level security;

drop policy if exists fms_dispatch_ledger_forms_select on public.fms_dispatch_ledger_forms;
create policy fms_dispatch_ledger_forms_select on public.fms_dispatch_ledger_forms
  for select to authenticated
  using ((select public.fms_dispatch_is_coordinator((select auth.uid()))));

drop policy if exists fms_dispatch_ledger_forms_write on public.fms_dispatch_ledger_forms;
create policy fms_dispatch_ledger_forms_write on public.fms_dispatch_ledger_forms
  for all to authenticated
  using      ((select public.fms_dispatch_is_coordinator((select auth.uid()))))
  with check ((select public.fms_dispatch_is_coordinator((select auth.uid()))));

-- ===========================================================================
-- 2. READING AND WRITING THE MASTER (Setup)
-- ===========================================================================
-- Every MAPPED ledger, named so Setup can show which book it sits in. Deliberately
-- NOT every ledger in the system: there are ~7,900 active parties and the screen
-- adds one by picking from the module's own customer list, which is already loaded.
create or replace function public.fms_dispatch_ledger_forms_admin()
returns table(
  party_id      uuid,
  party_name    text,
  company_id    uuid,
  company_label text,
  form_name     text,
  active        boolean
)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select f.party_id,
         mp.name,
         mp.company_id,
         coalesce(nullif(trim(c.alias), ''), c.name) || coalesce(' - ' || c.location, ''),
         f.form_name,
         f.active
    from public.fms_dispatch_ledger_forms f
    join public.mst_parties mp  on mp.id = f.party_id
    left join public.mst_companies c on c.id = mp.company_id
   where public.fms_dispatch_is_coordinator(auth.uid())
   order by f.form_name, mp.name;
$fn$;

revoke all on function public.fms_dispatch_ledger_forms_admin() from public;
grant execute on function public.fms_dispatch_ledger_forms_admin() to authenticated;

comment on function public.fms_dispatch_ledger_forms_admin() is
  'OD-16. The ledger -> form mappings, for Setup -> Forms. Coordinator-gated in the body as '
  'well as by RLS, so it answers nothing to anyone else.';

-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_save_ledger_form(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_party uuid := nullif(trim(p->>'party_id'), '')::uuid;
  v_name  text := nullif(trim(p->>'form_name'), '');
  v_act   boolean := coalesce((p->>'active')::boolean, true);
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then
    raise exception 'Only a dispatch coordinator may edit forms';
  end if;
  if v_party is null then raise exception 'Pick a ledger'; end if;
  if v_name is null then raise exception 'Give the form a name'; end if;

  if not exists (select 1 from public.mst_parties where id = v_party) then
    raise exception 'That ledger no longer exists';
  end if;

  insert into public.fms_dispatch_ledger_forms as f
         (party_id, form_name, active, created_by, updated_by)
  values (v_party, v_name, v_act, v_uid, v_uid)
  on conflict (party_id) do update
     set form_name  = excluded.form_name,
         active     = excluded.active,
         updated_at = now(),
         updated_by = v_uid;

  return v_party;
end;
$fn$;

revoke all on function public.fms_dispatch_save_ledger_form(jsonb) from public;
grant execute on function public.fms_dispatch_save_ledger_form(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- HARD DELETE, and that is safe here in a way it is not for `mst_party_items`.
-- Nothing syncs this table from Tally, so there is no upsert waiting to recreate
-- a row somebody switched off — the soft-delete dance that `active` exists for on
-- the mapping tables buys nothing. `active` stays for parking a form without
-- losing the text.
create or replace function public.fms_dispatch_delete_ledger_form(p_party uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then
    raise exception 'Only a dispatch coordinator may edit forms';
  end if;
  delete from public.fms_dispatch_ledger_forms where party_id = p_party;
end;
$fn$;

revoke all on function public.fms_dispatch_delete_ledger_form(uuid) from public;
grant execute on function public.fms_dispatch_delete_ledger_form(uuid) to authenticated;

-- ===========================================================================
-- 3. THE ORDER DESK READS THE FORM NAME
-- ===========================================================================
-- ⚠ DROPPED AND RECREATED, NOT `create or replace`. Both functions gain a column,
--   and Postgres refuses to replace a function whose OUT parameters changed.
--   `fms_dispatch_my_companies` has to go first: it depends on the other.
drop function if exists public.fms_dispatch_my_companies();
drop function if exists public.fms_dispatch_customer_org_companies(uuid);

-- As OD-14, plus the form. `label` is UNCHANGED and still the company — it is the
-- fallback, and Setup needs it to say what a customer with no form would see.
create or replace function public.fms_dispatch_customer_org_companies(p_org uuid)
returns table(company_id uuid, label text, form_name text, item_count integer)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select mp.company_id,
         coalesce(nullif(trim(c.alias), ''), c.name) || coalesce(' - ' || c.location, ''),
         -- ⚠ `max()` ONLY BECAUSE THE GROUP FORCES AN AGGREGATE. Within one org a
         --   company has exactly one ticked ledger (save_customer_org refuses a
         --   second), so there is never more than one form to choose between.
         max(f.form_name) filter (where f.active),
         count(distinct upper(trim(tgt.name)))::integer
    from public.fms_dispatch_customer_orgs g
    join public.mst_parties mp        on mp.id = any (g.party_ids)
    join public.mst_companies c       on c.id = mp.company_id and c.active
    left join public.fms_dispatch_ledger_forms f on f.party_id = mp.id
    join public.mst_party_items pi    on pi.party_id = mp.id and pi.active
    join public.mst_items src         on src.id = pi.item_id and src.active
    join public.mst_items tgt         on tgt.company_id = mp.company_id and tgt.active
                                     and upper(trim(tgt.name)) = upper(trim(src.name))
   where g.id = p_org
   group by mp.company_id, 2
   order by 4 desc, 2;
$fn$;

revoke all on function public.fms_dispatch_customer_org_companies(uuid) from public, authenticated;

create or replace function public.fms_dispatch_my_companies()
returns table(company_id uuid, label text, form_name text, item_count integer)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select * from public.fms_dispatch_customer_org_companies(
    public.fms_dispatch_customer_org_of(auth.uid()));
$fn$;

revoke all on function public.fms_dispatch_my_companies() from public;
grant execute on function public.fms_dispatch_my_companies() to authenticated;

comment on function public.fms_dispatch_my_companies() is
  'OD-16. The forms the signed-in customer may place an order on, richest book first. '
  'form_name is the customer-facing name from fms_dispatch_ledger_forms; NULL means no form '
  'is mapped for that ledger yet and the caller falls back to label.';

commit;
