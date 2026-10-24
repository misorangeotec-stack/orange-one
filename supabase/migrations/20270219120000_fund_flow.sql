-- ===========================================================================
-- FUND FLOW (FF-1) — the monthly Budgeted Fund Flow, entered and approved in Hub.
--
-- WHY
--   Every month the accounts team fills "0F_<MON> <YYYY> Cashflow.xlsx" by hand and a
--   script turns it into "Budgeted Fund Flow Summary.xlsx": opening balance, payments by
--   head (import dues and advances in USD, customs duty, EMI, vendors, tax, investment,
--   fixed expenses), receipts (machine advances, collections, refunds) and the closing
--   balance, each line Budgeted / Approved / Paid / Balance / Achieved %. These tables
--   hold the same lines so the team updates them during the month, the CFO approves them
--   after the management discussion, and the summary is the live roll-up.
--
-- THE MONTH WINDOW (user, 24-Oct-2026)
--   Month M opens two days before the end of M-1 (29-Oct for November) and closes on the
--   2nd of M+1, one day later when that is a Sunday. Outside the window a month is
--   read-only to editors. Dates are IST, never UTC: a 23:30 IST save on the 2nd must not
--   land on the 3rd.
--
-- CARRY FORWARD (user, 24-Oct-2026)
--   Unpaid Import Due, Import Advance and Customs Duty lines carry into the next month at
--   their balance; every other head copies last month's lines as an editable list.
--   Because M opens while M-1 is still being paid, a carried line FOLLOWS its source line
--   (trigger ff_line_propagate) until M-1 closes, and is frozen at close. Without that, a
--   payment made on the 30th would sit in October AND in November's budget.
--
-- AMOUNTS ARE STORED IN THE LINE'S OWN UNIT. Import Due / Import Advance lines are USD and
--   take the month's std rate (default 95) when shown in rupees, exactly as the Excel pack
--   restates every USD line at the std rate. Everything else is INR. Customs Duty is INR,
--   computed from the invoice USD, duty % and freight by one of three modes (see
--   ff_line_values) — the three formulas the Excel Duty sheet actually uses.
--
-- WRITES ONLY THROUGH THE ff_* RPCs. RLS allows SELECT; the default Supabase grants are
--   revoked because they include TRUNCATE, which RLS does not cover.
--
-- Reuses public.is_admin(uuid) and public.set_updated_at().
--
-- Reversal: 20270219120000_fund_flow_rollback.sql
-- ===========================================================================


-- ============================================================ roles ========

-- Who may do what on Fund Flow. Deliberately NOT app_access 'edit' on outstanding-dashboard:
-- that would open every hub screen to the people who type the budget.
--   editor : add / edit / delete lines while the month is open
--   cfo    : everything an editor can, plus approve, set the std rate, reopen and close
--   director: reads everything and gives the FINAL approval after the CFO (user, 24-Oct-2026);
--            edits nothing
-- Viewing is the report grant 'finance-fund-flow' in receivables_allowed_reports.
alter table public.profiles
  add column if not exists fund_flow_role text
    check (fund_flow_role in ('editor', 'cfo', 'director'));

-- Also receives the daily bank-balance check (user, 24-Oct-2026: "send the email to Dimple and CFO").
alter table public.profiles
  add column if not exists fund_flow_bank_alert boolean not null default false;

comment on column public.profiles.fund_flow_role is
  'Fund Flow rights: editor (enter lines), cfo (also approve, rate, reopen, close) or director (final approval after the CFO). NULL = none. Admins count as cfo. Viewing is the finance-fund-flow report grant.';

create or replace function public.ff_role(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    when p_uid is null then 'none'
    when public.is_admin(p_uid) then 'cfo'
    else coalesce(
      (select case
                when p.fund_flow_role is not null then p.fund_flow_role
                when 'finance-fund-flow' = any(coalesce(p.receivables_allowed_reports, '{}')) then 'viewer'
              end
         from public.profiles p where p.id = p_uid),
      'none')
  end
$fn$;

revoke execute on function public.ff_role(uuid) from public, anon;
grant execute on function public.ff_role(uuid) to authenticated;

comment on function public.ff_role(uuid) is
  'Fund Flow role: cfo | director | editor | viewer | none. Admins are cfo. One function so the RLS, every RPC and the page agree.';


-- ============================================================ month window =

-- (opens_on, closes_on) for month M. One routine, used by the RPCs and the page.
create or replace function public.ff_month_window(p_month date)
returns table (opens_on date, closes_on date)
language sql
immutable
as $fn$
  select (p_month - 1 - 2)::date,
         case when extract(dow from (p_month + interval '1 month' + interval '1 day'))::int = 0
              then (p_month + interval '1 month' + interval '2 day')::date
              else (p_month + interval '1 month' + interval '1 day')::date end
$fn$;

comment on function public.ff_month_window(date) is
  'Month M opens on the last day of M-1 minus 2 days and closes on the 2nd of M+1 (3rd if the 2nd is a Sunday). User rule, 24-Oct-2026.';

create or replace function public.ff_today()
returns date
language sql
stable
-- IST is a fixed +05:30 with no daylight saving, so plain arithmetic is exact and does not
-- depend on the server's time zone database.
as $fn$ select ((now() at time zone 'UTC') + interval '5 hours 30 minutes')::date $fn$;


-- ============================================================ tables =======

create table if not exists public.fund_flow_month (
  month              date primary key check (extract(day from month) = 1),
  -- INR per USD for every USD line of the month. The Excel pack used 95.
  std_rate           numeric(10,4) not null default 95 check (std_rate > 0),
  -- The rate is ENTERED ONCE and then fixed for the month (user, 24-Oct-2026). Until then std_rate
  -- is last month's rate, shown as provisional; the plan cannot be approved on a provisional rate.
  rate_fixed_at      timestamptz,
  rate_fixed_by      uuid references auth.users on delete set null,
  -- Customer Collections target = this share of the total due in the Customer Collection report
  -- (user, 24-Oct-2026: 55% by default, changeable). A new month starts with last month's share.
  collection_pct     numeric(6,4) not null default 0.55 check (collection_pct > 0 and collection_pct <= 1),
  -- NULL = take the Daily Report bank total for the last day of the previous month.
  opening_override   numeric(18,2),
  opening_reason     text,
  status             text not null default 'open' check (status in ('open', 'closed')),
  -- A CFO reopen. While true the month is editable past closes_on and the daily
  -- housekeeping will not auto-close it; only an explicit ff_close_month does.
  reopened           boolean not null default false,
  -- THE PLAN (user, 24-Oct-2026). When the CFO approves the month's plan, every line's approved
  -- figure is fixed and kept as its plan figure. From then on a user may still add, change or
  -- delete lines, but each change waits for the CFO: Approved does not move until the CFO approves
  -- it, a new line counts as 0 approved until approved, and a delete is only a request. The
  -- "Changes after plan" report is built from these plan figures.
  plan_approved_at   timestamptz,
  plan_approved_by   uuid references auth.users on delete set null,
  -- FINAL approval by a Director, after the CFO has approved the plan (user, 24-Oct-2026: any one
  -- Director). Later changes still go to the CFO line by line and are reported to the Directors.
  final_approved_at  timestamptz,
  final_approved_by  uuid references auth.users on delete set null,
  final_note         text,
  closed_at          timestamptz,
  closed_by          uuid references auth.users on delete set null,
  created_by         uuid references auth.users on delete set null,
  created_at         timestamptz not null default now(),
  updated_by         uuid references auth.users on delete set null,
  updated_at         timestamptz not null default now()
);

comment on table public.fund_flow_month is
  'One row per Fund Flow month (the 1st). Holds the std USD rate, any opening-balance override and the open/closed state.';

create table if not exists public.fund_flow_line (
  id                    uuid primary key default gen_random_uuid(),
  month                 date not null references public.fund_flow_month on delete restrict,
  head                  text not null check (head in (
                          'import_due', 'import_advance', 'local_advance', 'customs_duty',
                          'emi', 'other_vendor', 'tds', 'gst', 'investment', 'fixed_expense',
                          'machine_advance', 'collection', 'refund')),
  -- Import Advance only: what the advance is for (user, 24-Oct-2026) — replaces the Excel's four
  -- payment-stage blocks with the product: machines, ink, heads, paper, spare parts.
  block                 text check (block in ('mach', 'ink', 'head', 'paper', 'parts')),
  company               text check (company in ('O Tec', 'Enterprises', 'Colorix', 'Group')),
  location              text check (location in ('Surat', 'Noida', 'Delhi')),
  -- The Excel "Type" column, kept as text: 'Dues', 'Repayment', 'Salary', 'Exhibition-ITME'.
  line_type             text,
  party                 text,
  -- Advances: the customer / purpose column ("SERACOT", "RUBY - EXHIBITION").
  customer_for          text,
  ref_no                text,
  description           text,
  item                  text,
  doc_date              date,
  currency              text not null default 'INR' check (currency in ('USD', 'INR')),

  -- ── amounts, in the line's unit (USD for USD lines, else INR) ──────────────
  -- Budget. Customs Duty: an optional override of the computed total (NULL = compute).
  amt_budget            numeric(18,4),
  -- CFO's approved amount, set ONLY by ff_approve / ff_approve_plan and always as a fixed figure.
  -- NULL = never approved: follows the budget before the plan is approved, counts 0 after.
  amt_approved          numeric(18,4),
  amt_paid              numeric(18,4),
  -- Carried lines: what was already paid in earlier months. Budget less this is the month's due.
  paid_before           numeric(18,4) not null default 0,

  -- ── customs duty inputs ───────────────────────────────────────────────────
  inv_usd               numeric(18,4),
  duty_pct              numeric(9,6) check (duty_pct is null or (duty_pct >= 0 and duty_pct <= 5)),
  freight_inr           numeric(18,2),
  -- freight_in_base: (inv INR + freight) x duty %          (paper, machines, thickener)
  -- freight_added  : inv INR x duty % + freight             (spares, heads, ink)
  -- typed          : duty_typed_inr as entered              (duty quoted as an amount)
  duty_mode             text check (duty_mode in ('freight_in_base', 'freight_added', 'typed')),
  duty_typed_inr        numeric(18,2),
  -- An amount over the formula the Excel carried on a few lines (L19 = J19 + 133,907.60).
  extra_inr             numeric(18,2),
  -- The Excel kept a few shipments at 0 ("not budgeted this month").
  not_this_month        boolean not null default false,
  -- Customs: Paid = the whole total.
  paid_in_full          boolean not null default false,

  -- ── detail columns ────────────────────────────────────────────────────────
  loan_os               numeric(18,2),
  terms                 text,
  status_note           text,
  remarks               text,
  sales_person          text,
  machine               text,
  expected_date         date,
  follow_up             text,
  -- Collections: total due / order book.
  total_due             numeric(18,2),

  -- ── links to Tally (ConnectWave) — the figure used, frozen with its time ─────
  tally_company_guid    text,
  tally_ledger          text,
  tally_ledger_guid     text,
  tally_due_inr         numeric(18,2),
  tally_due_as_at       timestamptz,
  tally_paid_inr        numeric(18,2),
  tally_paid_as_at      timestamptz,
  paid_source           text not null default 'manual' check (paid_source in ('manual', 'tally', 'linked')),
  -- Actual INR paid on a USD line (from Tally). A memo only: totals stay at the std rate.
  actual_inr            numeric(18,2),
  -- Collections: the Salesperson Collection Report figures behind the line.
  link_target_inr       numeric(18,2),
  link_received_inr     numeric(18,2),
  link_due_inr          numeric(18,2),
  link_as_at            timestamptz,
  override_reason       text,

  -- ── approval ──────────────────────────────────────────────────────────────
  approved_by           uuid references auth.users on delete set null,
  approved_at           timestamptz,
  -- The budget (line unit) when the CFO approved — a later budget edit shows as
  -- "changed after approval" without moving the approved amount.
  approved_budget_snap  numeric(18,4),
  -- The line's approved figure when the month's plan was approved. NULL = added after the plan.
  plan_unit             numeric(18,4),
  -- A user asked to remove an approved line; it stays in the totals until the CFO approves.
  delete_requested_at   timestamptz,
  delete_requested_by   uuid references auth.users on delete set null,
  -- The CFO did NOT approve this line (user, 24-Oct-2026: "keep as it is, do not delete it, keep
  -- unapproved items separately"). It stays in the month, counts 0 approved, is listed apart, and
  -- the CFO can still approve it later. Its unpaid budget still carries to the next month.
  not_approved_at       timestamptz,
  not_approved_by       uuid references auth.users on delete set null,

  -- ── carry forward ─────────────────────────────────────────────────────────
  carried_from_line_id  uuid references public.fund_flow_line on delete set null,
  carry_frozen          boolean not null default true,

  sort_order            integer not null default 0,
  deleted_at            timestamptz,
  created_by            uuid references auth.users on delete set null,
  created_at            timestamptz not null default now(),
  updated_by            uuid references auth.users on delete set null,
  updated_at            timestamptz not null default now(),

  constraint fund_flow_line_block_only_on_advances
    check (block is null or head = 'import_advance'),
  constraint fund_flow_line_usd_heads
    check (currency = 'INR' or head in ('import_due', 'import_advance'))
);

comment on table public.fund_flow_line is
  'One Fund Flow budget line. Amounts in the line unit (USD for Import Due/Advance, else INR). Written only through ff_save_lines / ff_approve. A carried line follows its source until the source month closes.';

create index if not exists fund_flow_line_month_idx on public.fund_flow_line (month, head, sort_order);
create index if not exists fund_flow_line_carried_idx on public.fund_flow_line (carried_from_line_id)
  where carried_from_line_id is not null;
-- One Tally ledger on one head per month: the vendor pull must never create a second line.
create unique index if not exists fund_flow_line_one_ledger_per_month
  on public.fund_flow_line (month, tally_company_guid, tally_ledger)
  where tally_ledger is not null and deleted_at is null;

create table if not exists public.fund_flow_log (
  id          bigserial primary key,
  month       date not null,
  line_id     uuid,
  action      text not null,
  old_row     jsonb,
  new_row     jsonb,
  reason      text,
  by_user     uuid references auth.users on delete set null,
  -- The person's name when the change was made, so the Changes tab and the alerts show WHO
  -- without every viewer needing the people directory (user, 24-Oct-2026).
  by_name     text,
  at          timestamptz not null default now()
);

create index if not exists fund_flow_log_month_idx on public.fund_flow_log (month, at desc);

comment on table public.fund_flow_log is
  'Every Fund Flow change, approval, rate change, open, close and reopen — who, when, before and after.';

create or replace function public.ff_log_by_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.by_name is null and new.by_user is not null then
    select coalesce(nullif(btrim(p.name), ''), p.email) into new.by_name from public.profiles p where p.id = new.by_user;
  end if;
  if new.by_name is null and new.by_user is null then new.by_name := 'System (scheduled)'; end if;
  return new;
end $fn$;
drop trigger if exists fund_flow_log_by_name on public.fund_flow_log;
create trigger fund_flow_log_by_name before insert on public.fund_flow_log
  for each row execute function public.ff_log_by_name();

drop trigger if exists fund_flow_month_updated on public.fund_flow_month;
create trigger fund_flow_month_updated before update on public.fund_flow_month
  for each row execute function public.set_updated_at();
drop trigger if exists fund_flow_line_updated on public.fund_flow_line;
create trigger fund_flow_line_updated before update on public.fund_flow_line
  for each row execute function public.set_updated_at();


-- ============================================================ the formulas =

-- The line in rupees. ONE routine for the view, the carry trigger and the close, and the
-- frontend's lib/fundFlowCalc.ts is its mirror (checked against the Excel pack).
--   gross_budget = the line's budget (USD x rate, or INR, or the customs total)
--   approved     = the CFO's figure; never approved = the budget until the plan is approved,
--                  0 after (p_locked) — a line added after the plan waits for the CFO
--   due this month = less what earlier months already paid (carried lines)
--   carry_unit   = what carries to next month: the approved figure, or the budget for a line
--                  the CFO has not yet seen (so a late addition is not lost at month end)
create or replace function public.ff_line_values(l public.fund_flow_line, p_rate numeric, p_locked boolean default false)
returns table (
  budget_unit numeric, approved_unit numeric, paid_unit numeric, fx numeric,
  budget_inr numeric, approved_inr numeric, paid_inr numeric, balance_inr numeric, carry_unit numeric)
language plpgsql
immutable
as $fn$
declare
  v_inv  numeric := coalesce(l.inv_usd, 0) * p_rate;
  v_tot  numeric;
begin
  fx := case when l.currency = 'USD' then p_rate else 1 end;

  if l.head = 'customs_duty' then
    v_tot := case
      when l.not_this_month then 0
      when l.duty_mode = 'typed' then coalesce(l.duty_typed_inr, 0)
      when l.duty_mode = 'freight_added' then v_inv * coalesce(l.duty_pct, 0) + coalesce(l.freight_inr, 0)
      else (v_inv + coalesce(l.freight_inr, 0)) * coalesce(l.duty_pct, 0)
    end + case when l.not_this_month then 0 else coalesce(l.extra_inr, 0) end;
    budget_unit := coalesce(l.amt_budget, v_tot);
  else
    budget_unit := coalesce(l.amt_budget, 0);
  end if;

  approved_unit := case when l.not_approved_at is not null then 0
                        else coalesce(l.amt_approved, case when p_locked then 0 else budget_unit end) end;
  carry_unit := coalesce(l.amt_approved, budget_unit);
  -- "Paid in full" is the shipment's whole total — the budget, whatever was approved.
  paid_unit := case
    when l.head = 'customs_duty' and l.paid_in_full then budget_unit - coalesce(l.paid_before, 0)
    else coalesce(l.amt_paid, 0) end;

  budget_inr   := (budget_unit - coalesce(l.paid_before, 0)) * fx;
  approved_inr := (approved_unit - coalesce(l.paid_before, 0)) * fx;
  paid_inr     := paid_unit * fx;
  balance_inr  := approved_inr - paid_inr;
  return next;
end $fn$;

comment on function public.ff_line_values(public.fund_flow_line, numeric, boolean) is
  'A Fund Flow line in rupees at the month std rate: budget, approved, paid, balance, and what carries. Mirrors lib/fundFlowCalc.ts.';

create or replace view public.v_fund_flow_line
with (security_invoker = true)
as
select l.*,
       v.budget_unit, v.approved_unit, v.paid_unit, v.fx,
       v.budget_inr, v.approved_inr, v.paid_inr, v.balance_inr,
       case when v.approved_inr = 0 then null else v.paid_inr / v.approved_inr end as achieved,
       (l.approved_at is not null
         and abs(coalesce(l.approved_budget_snap, 0) - v.budget_unit) > 0.005) as changed_after_approval,
       -- What the CFO still has to look at, once the plan is approved.
       (m.plan_approved_at is not null and l.approved_at is null and l.not_approved_at is null) as awaiting_approval,
       (l.not_approved_at is not null) as not_approved,
       (m.plan_approved_at is not null and l.plan_unit is null) as added_after_plan,
       (l.delete_requested_at is not null) as delete_requested,
       m.std_rate, (m.plan_approved_at is not null) as plan_locked
  from public.fund_flow_line l
  join public.fund_flow_month m on m.month = l.month
  cross join lateral public.ff_line_values(l, m.std_rate, m.plan_approved_at is not null) v
 where l.deleted_at is null;

comment on view public.v_fund_flow_line is
  'Live Fund Flow lines with their rupee figures. security_invoker, so the line RLS applies.';


-- ============================================================ RLS ==========

alter table public.fund_flow_month enable row level security;
alter table public.fund_flow_line  enable row level security;
alter table public.fund_flow_log   enable row level security;

drop policy if exists fund_flow_month_select on public.fund_flow_month;
create policy fund_flow_month_select on public.fund_flow_month for select to authenticated
  using ((select public.ff_role((select auth.uid()))) <> 'none');

drop policy if exists fund_flow_line_select on public.fund_flow_line;
create policy fund_flow_line_select on public.fund_flow_line for select to authenticated
  using ((select public.ff_role((select auth.uid()))) <> 'none');

drop policy if exists fund_flow_log_select on public.fund_flow_log;
create policy fund_flow_log_select on public.fund_flow_log for select to authenticated
  using ((select public.ff_role((select auth.uid()))) <> 'none');

-- No write policies: every write goes through an ff_* function.
revoke all on public.fund_flow_month, public.fund_flow_line, public.fund_flow_log from anon, authenticated;
grant select on public.fund_flow_month, public.fund_flow_line, public.fund_flow_log to authenticated;
revoke all on public.v_fund_flow_line from anon, authenticated;
grant select on public.v_fund_flow_line to authenticated;


-- ============================================================ guards =======

-- May this user write lines in this month right now? Raises with the reason if not.
create or replace function public.ff_assert_can_edit(p_month date, p_uid uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_role text := public.ff_role(p_uid);
  m      public.fund_flow_month;
  w      record;
  v_today date := public.ff_today();
begin
  if v_role not in ('editor', 'cfo') then
    raise exception 'you may not edit the Fund Flow';
  end if;
  select * into m from public.fund_flow_month where month = p_month;
  if not found then
    raise exception 'Fund Flow for % is not open yet', to_char(p_month, 'Mon-YY');
  end if;
  select * into w from public.ff_month_window(p_month);
  if m.status = 'closed' then
    raise exception 'Fund Flow for % is closed — ask the CFO to reopen it', to_char(p_month, 'Mon-YY');
  end if;
  if not m.reopened and (v_today < w.opens_on or v_today > w.closes_on) then
    raise exception 'Fund Flow for % can be edited from % to % only',
      to_char(p_month, 'Mon-YY'), to_char(w.opens_on, 'DD-Mon'), to_char(w.closes_on, 'DD-Mon');
  end if;
end $fn$;


-- ============================================================ carry ========

-- Heads whose unpaid balance carries into the next month (user rule).
create or replace function public.ff_is_carry_head(p_head text)
returns boolean language sql immutable
as $fn$ select p_head in ('import_due', 'import_advance', 'customs_duty') $fn$;

-- Bring a carried (child) line into line with its source while the source month is open.
-- USD heads: the child's budget is the source's approved amount and paid_before the source's
-- paid to date, so its due = the source's live balance, valued at the CHILD month's rate.
-- Customs: the inputs are copied and the total recomputed at the child month's rate.
create or replace function public.ff_sync_child(p_child uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c  public.fund_flow_line;
  s  public.fund_flow_line;
  sr numeric;
  sv record;
begin
  select * into c from public.fund_flow_line where id = p_child;
  if not found or c.carry_frozen or c.carried_from_line_id is null or not public.ff_is_carry_head(c.head) then return; end if;
  select * into s from public.fund_flow_line where id = c.carried_from_line_id;
  if not found then return; end if;
  if s.deleted_at is not null then
    update public.fund_flow_line set deleted_at = now() where id = c.id and deleted_at is null;
    return;
  end if;
  select std_rate into sr from public.fund_flow_month where month = s.month;
  select * into sv from public.ff_line_values(s, sr);

  update public.fund_flow_line set
    amt_budget     = case when s.head = 'customs_duty' then coalesce(s.amt_approved, s.amt_budget)
                          else sv.carry_unit end,
    paid_before    = coalesce(s.paid_before, 0) + sv.paid_unit,
    inv_usd        = s.inv_usd,
    duty_pct       = s.duty_pct,
    freight_inr    = s.freight_inr,
    duty_mode      = s.duty_mode,
    duty_typed_inr = s.duty_typed_inr,
    extra_inr      = s.extra_inr,
    not_this_month = false,
    paid_in_full   = false
  where id = c.id;
end $fn$;

create or replace function public.ff_line_propagate()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare r record;
begin
  -- pg_trigger_depth guard: the child update below fires this trigger again for the
  -- child, which has no unfrozen children of its own in the normal case; the guard stops
  -- a pathological chain from recursing.
  if pg_trigger_depth() > 3 then return new; end if;
  for r in select id from public.fund_flow_line
            where carried_from_line_id = new.id and not carry_frozen and deleted_at is null loop
    perform public.ff_sync_child(r.id);
  end loop;
  return new;
end $fn$;

drop trigger if exists fund_flow_line_propagate on public.fund_flow_line;
create trigger fund_flow_line_propagate after update on public.fund_flow_line
  for each row execute function public.ff_line_propagate();


-- ============================================================ open / close =

-- Create month M (idempotent). Editors from opens_on; the CFO at any time (the first month,
-- or an early start). Copies the previous month:
--   carry heads  -> every line with a balance, linked and FOLLOWING its source (unfrozen)
--   other heads  -> every line, budget kept, approval and paid cleared, free to edit
create or replace function public.ff_open_month(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_role  text := public.ff_role(v_uid);
  w       record;
  v_prev  date := (p_month - interval '1 month')::date;
  v_rate  numeric := 95;
  v_prev_closed boolean := false;
  v_pct   numeric;
  v_carry int := 0;
  v_copy  int := 0;
  r       record;
  v_new   uuid;
begin
  if extract(day from p_month) <> 1 then
    raise exception 'a Fund Flow month starts on the 1st';
  end if;
  if exists (select 1 from public.fund_flow_month where month = p_month) then
    return jsonb_build_object('created', false);
  end if;
  select * into w from public.ff_month_window(p_month);
  -- The FIRST month (nothing before it to copy) is the CFO's to start, so an editor cannot
  -- begin a Fund Flow series by accident.
  -- v_uid NULL = the scheduler (pg_cron): the client roles always carry a user, and anon cannot
  -- call this. It may open a month from its opens_on, exactly as an editor may.
  if v_role <> 'cfo' and not exists (select 1 from public.fund_flow_month where month = v_prev) then
    raise exception 'the first Fund Flow month is started by the CFO';
  end if;
  if not (v_role = 'cfo' or ((v_role = 'editor' or v_uid is null) and public.ff_today() >= w.opens_on)) then
    raise exception 'Fund Flow for % opens on %', to_char(p_month, 'Mon-YY'), to_char(w.opens_on, 'DD-Mon-YYYY');
  end if;

  select std_rate, status = 'closed', collection_pct into v_rate, v_prev_closed, v_pct from public.fund_flow_month where month = v_prev;
  v_prev_closed := coalesce(v_prev_closed, false);
  insert into public.fund_flow_month (month, std_rate, collection_pct, created_by, updated_by)
  values (p_month, coalesce(v_rate, 95), coalesce(v_pct, 0.55), v_uid, v_uid);

  for r in
    select l.*, v.carry_unit, v.paid_unit
      from public.fund_flow_line l
      join public.fund_flow_month m on m.month = l.month
      cross join lateral public.ff_line_values(l, m.std_rate) v
     where l.month = v_prev and l.deleted_at is null
     order by l.head, l.sort_order
  loop
    if public.ff_is_carry_head(r.head) then
      continue when abs(r.carry_unit - coalesce(r.paid_before, 0) - r.paid_unit) < 0.005;
      insert into public.fund_flow_line (
        month, head, block, company, location, line_type, party, customer_for, ref_no,
        description, item, doc_date, currency, terms, status_note, remarks,
        tally_company_guid, tally_ledger, tally_ledger_guid,
        carried_from_line_id, carry_frozen, sort_order, created_by, updated_by)
      values (
        p_month, r.head, r.block, r.company, r.location, r.line_type, r.party, r.customer_for, r.ref_no,
        r.description, r.item, r.doc_date, r.currency, r.terms, r.status_note, r.remarks,
        r.tally_company_guid, r.tally_ledger, r.tally_ledger_guid,
        r.id, false, r.sort_order, v_uid, v_uid)
      returning id into v_new;
      perform public.ff_sync_child(v_new);
      -- Previous month ALREADY closed (nobody visited inside the window, so housekeeping closed it
      -- before opening this one): its figures are final, so the carried line is frozen now —
      -- its own to edit — instead of following a source that will never close again.
      if v_prev_closed then
        update public.fund_flow_line set carry_frozen = true where id = v_new;
      end if;
      v_carry := v_carry + 1;
    else
      insert into public.fund_flow_line (
        month, head, company, location, line_type, party, customer_for, ref_no, description,
        item, currency, amt_budget, loan_os, terms, remarks, sales_person, machine,
        expected_date, follow_up, total_due, tally_company_guid, tally_ledger, tally_ledger_guid,
        carried_from_line_id, carry_frozen, sort_order, created_by, updated_by)
      values (
        p_month, r.head, r.company, r.location, r.line_type, r.party, r.customer_for, r.ref_no, r.description,
        r.item, r.currency, r.amt_budget, r.loan_os, r.terms, r.remarks, r.sales_person, r.machine,
        null, r.follow_up, r.total_due, r.tally_company_guid, r.tally_ledger, r.tally_ledger_guid,
        r.id, true, r.sort_order, v_uid, v_uid);
      v_copy := v_copy + 1;
    end if;
  end loop;

  insert into public.fund_flow_log (month, action, new_row, by_user)
  values (p_month, 'open', jsonb_build_object('carried', v_carry, 'copied', v_copy, 'from', v_prev), v_uid);

  return jsonb_build_object('created', true, 'carried', v_carry, 'copied', v_copy);
end $fn$;

-- Close month M: freeze its carried children in M+1 at their final figures, add a child for
-- any balance that appeared after the open (a reversed payment), drop children whose
-- source ended fully paid. CFO any time; anyone with a role once the window has passed
-- (that is the housekeeping path — ff_housekeep).
create or replace function public.ff_close_month(p_month date, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_role  text := public.ff_role(v_uid);
  m       public.fund_flow_month;
  w       record;
  v_next  date := (p_month + interval '1 month')::date;
  r       record;
  v_new   uuid;
  v_added int := 0;
  v_drop  int := 0;
begin
  select * into m from public.fund_flow_month where month = p_month for update;
  if not found then raise exception 'no Fund Flow for %', to_char(p_month, 'Mon-YY'); end if;
  if m.status = 'closed' then return jsonb_build_object('closed', false); end if;
  select * into w from public.ff_month_window(p_month);
  if not (v_role = 'cfo' or ((v_role <> 'none' or v_uid is null) and public.ff_today() > w.closes_on and not m.reopened)) then
    raise exception 'only the CFO can close % before %', to_char(p_month, 'Mon-YY'), to_char(w.closes_on, 'DD-Mon');
  end if;

  if exists (select 1 from public.fund_flow_month where month = v_next) then
    -- A balance with no child yet (unpaid again after the open, or added late).
    for r in
      select l.*, v.carry_unit, v.paid_unit
        from public.fund_flow_line l
        join public.fund_flow_month mm on mm.month = l.month
        cross join lateral public.ff_line_values(l, mm.std_rate) v
       where l.month = p_month and l.deleted_at is null and public.ff_is_carry_head(l.head)
         and abs(v.carry_unit - coalesce(l.paid_before, 0) - v.paid_unit) >= 0.005
         and not exists (select 1 from public.fund_flow_line c
                          where c.carried_from_line_id = l.id and c.deleted_at is null)
    loop
      insert into public.fund_flow_line (
        month, head, block, company, location, line_type, party, customer_for, ref_no,
        description, item, doc_date, currency, terms, status_note, remarks,
        tally_company_guid, tally_ledger, tally_ledger_guid,
        carried_from_line_id, carry_frozen, sort_order, created_by, updated_by)
      values (
        v_next, r.head, r.block, r.company, r.location, r.line_type, r.party, r.customer_for, r.ref_no,
        r.description, r.item, r.doc_date, r.currency, r.terms, r.status_note, r.remarks,
        r.tally_company_guid, r.tally_ledger, r.tally_ledger_guid,
        r.id, false, r.sort_order, v_uid, v_uid)
      returning id into v_new;
      perform public.ff_sync_child(v_new);
      v_added := v_added + 1;
    end loop;

    -- Final sync, then freeze.
    for r in select c.id from public.fund_flow_line c
               join public.fund_flow_line s on s.id = c.carried_from_line_id
              where s.month = p_month and not c.carry_frozen and c.deleted_at is null loop
      perform public.ff_sync_child(r.id);
    end loop;

    -- Source ended fully paid: the child has nothing left to budget.
    with gone as (
      update public.fund_flow_line c set deleted_at = now()
       where c.id in (
         select x.id
           from public.fund_flow_line x
           join public.fund_flow_month mm on mm.month = x.month
           cross join lateral public.ff_line_values(x, mm.std_rate) v
          where x.month = v_next and not x.carry_frozen and x.deleted_at is null
            and x.carried_from_line_id in (select id from public.fund_flow_line where month = p_month)
            and abs(v.carry_unit - coalesce(x.paid_before, 0)) < 0.005)
      returning c.id)
    select count(*) into v_drop from gone;

    update public.fund_flow_line set carry_frozen = true
     where month = v_next and not carry_frozen
       and carried_from_line_id in (select id from public.fund_flow_line where month = p_month);
  end if;

  update public.fund_flow_month
     set status = 'closed', reopened = false, closed_at = now(), closed_by = v_uid, updated_by = v_uid
   where month = p_month;

  insert into public.fund_flow_log (month, action, new_row, reason, by_user)
  values (p_month, 'close', jsonb_build_object('carried_added', v_added, 'carried_dropped', v_drop), p_reason, v_uid);

  return jsonb_build_object('closed', true, 'carried_added', v_added, 'carried_dropped', v_drop);
end $fn$;

create or replace function public.ff_reopen_month(p_month date, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_uid uuid := auth.uid();
begin
  if public.ff_role(v_uid) <> 'cfo' then raise exception 'only the CFO can reopen a month'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'give a reason for reopening'; end if;
  update public.fund_flow_month set status = 'open', reopened = true, updated_by = v_uid
   where month = p_month and status = 'closed';
  if not found then raise exception 'no closed Fund Flow for %', to_char(p_month, 'Mon-YY'); end if;
  -- The next month's CARRIED lines follow again until this month is closed once more. Only the
  -- carry heads: a copied line (vendors, EMI, fixed …) also points at its source but is the
  -- team's own from the day it was copied, and must never start following again.
  update public.fund_flow_line set carry_frozen = false
   where month = (p_month + interval '1 month')::date and deleted_at is null
     and public.ff_is_carry_head(head)
     and carried_from_line_id in (select id from public.fund_flow_line where month = p_month);
  insert into public.fund_flow_log (month, action, reason, by_user) values (p_month, 'reopen', p_reason, v_uid);
  perform public.ff_notify(array(select public.ff_users('cfo') union select public.ff_users('director')),
    format('%s Fund Flow REOPENED after closing', to_char(p_month, 'Mon-YY')),
    array[format('Reason: %s', p_reason), 'Every change made while it is open is listed in the 4 PM / 7 PM change summary.'],
    v_uid);
end $fn$;

-- Called on page load. Opens the month whose window has begun and closes months whose window
-- has passed. Idempotent and cheap; returns nothing the page relies on.
create or replace function public.ff_housekeep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role  text := public.ff_role(auth.uid());
  v_today date := public.ff_today();
  v_this  date := date_trunc('month', v_today)::date;
  v_next  date := (date_trunc('month', v_today) + interval '1 month')::date;
  r       record;
  out     jsonb := '{}'::jsonb;
begin
  -- auth.uid() NULL = the scheduler, which runs this at 00:05 IST so a month opens and closes on
  -- its day even when nobody visits the page.
  if v_role = 'none' and auth.uid() is not null then return out; end if;
  for r in select m.month from public.fund_flow_month m
             cross join lateral public.ff_month_window(m.month) w
            where m.status = 'open' and not m.reopened and v_today > w.closes_on loop
    out := out || jsonb_build_object('closed_' || to_char(r.month, 'YYYY-MM'), public.ff_close_month(r.month));
  end loop;
  -- Only once a first month exists — the very first month is created by the CFO (or the seed).
  if (v_role in ('editor', 'cfo') or auth.uid() is null) and exists (select 1 from public.fund_flow_month) then
    if not exists (select 1 from public.fund_flow_month where month = v_this)
       and exists (select 1 from public.fund_flow_month where month < v_this) then
      out := out || jsonb_build_object('opened_this', public.ff_open_month(v_this));
    end if;
    if v_today >= (select opens_on from public.ff_month_window(v_next))
       and not exists (select 1 from public.fund_flow_month where month = v_next)
       and exists (select 1 from public.fund_flow_month where month = v_this) then
      out := out || jsonb_build_object('opened_next', public.ff_open_month(v_next));
    end if;
  end if;
  return out;
end $fn$;


-- ============================================================ writes =======

-- Save lines for one month in ONE transaction. p_lines:
--   [{"id": null | uuid, "expected_updated_at": "...", "delete": false, <field>: <value>, ...}]
-- A new line has id null. An existing line must carry the updated_at the page read, and a
-- stale one is refused ("changed by X at HH:MM") rather than silently overwritten.
-- Approval fields are not writable here (ff_approve). On an unfrozen carried line the
-- amounts follow the source, so only the notes can change.
create or replace function public.ff_save_lines(p_month date, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  e       jsonb;
  cur     public.fund_flow_line;
  v_id    uuid;
  v_who   text;
  v_n     int := 0;
  v_ids   jsonb := '[]'::jsonb;
  -- Fields an editor may set. Everything else is server-owned.
  k_text  text[] := array['head','block','company','location','line_type','party','customer_for',
                          'ref_no','description','item','currency','terms','status_note','remarks',
                          'sales_person','machine','follow_up','duty_mode','override_reason',
                          'tally_company_guid','tally_ledger','tally_ledger_guid','paid_source'];
  k_num   text[] := array['amt_budget','amt_paid','inv_usd','duty_pct','freight_inr','duty_typed_inr',
                          'extra_inr','loan_os','total_due','tally_due_inr','tally_paid_inr',
                          'actual_inr','link_target_inr','link_received_inr','link_due_inr'];
  k_amt   text[] := array['amt_budget','inv_usd','duty_pct','freight_inr','duty_typed_inr','extra_inr',
                          'not_this_month','paid_in_full','currency'];
  k       text;
  v_set   jsonb;
begin
  perform public.ff_assert_can_edit(p_month, v_uid);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'ff_save_lines expects a JSON array';
  end if;

  for e in select * from jsonb_array_elements(p_lines) loop
    v_set := e - 'id' - 'expected_updated_at' - 'delete';
    -- Drop anything not on the allow-lists.
    for k in select jsonb_object_keys(v_set) loop
      if not (k = any(k_text) or k = any(k_num)
              or k in ('doc_date','expected_date','not_this_month','paid_in_full','sort_order',
                       'tally_due_as_at','tally_paid_as_at','link_as_at')) then
        v_set := v_set - k;
      end if;
    end loop;

    if nullif(e ->> 'id', '') is null then
      if coalesce((e ->> 'delete')::boolean, false) then continue; end if;
      insert into public.fund_flow_line (month, head, created_by, updated_by)
      values (p_month, coalesce(v_set ->> 'head', 'other_vendor'), v_uid, v_uid)
      returning * into cur;
    else
      select * into cur from public.fund_flow_line where id = (e ->> 'id')::uuid for update;
      if not found or cur.month <> p_month then raise exception 'unknown line %', e ->> 'id'; end if;
      if e ? 'expected_updated_at'
         and date_trunc('milliseconds', cur.updated_at) <> date_trunc('milliseconds', (e ->> 'expected_updated_at')::timestamptz) then
        select coalesce(nullif(btrim(p.name), ''), p.email, 'someone') into v_who from public.profiles p where p.id = cur.updated_by;
        raise exception 'a line was changed by % at % — reload and try again',
          coalesce(v_who, 'someone'), to_char((cur.updated_at at time zone 'UTC') + interval '5 hours 30 minutes', 'HH24:MI');
      end if;
      if coalesce((e ->> 'delete')::boolean, false) then
        -- An APPROVED line is not removed by an editor: the delete becomes a request, and the
        -- line keeps counting until the CFO approves the removal (user, 24-Oct-2026). A line the
        -- CFO never approved, or the CFO's own delete, goes straight away.
        if cur.approved_at is not null and public.ff_role(v_uid) <> 'cfo' then
          update public.fund_flow_line set delete_requested_at = now(), delete_requested_by = v_uid, updated_by = v_uid
           where id = cur.id;
          insert into public.fund_flow_log (month, line_id, action, old_row, by_user)
          values (p_month, cur.id, 'delete_request', to_jsonb(cur), v_uid);
        else
          update public.fund_flow_line set deleted_at = now(), updated_by = v_uid where id = cur.id;
          insert into public.fund_flow_log (month, line_id, action, old_row, by_user)
          values (p_month, cur.id, 'delete', to_jsonb(cur), v_uid);
        end if;
        v_n := v_n + 1;
        continue;
      end if;
      -- A carried line still following its source: the budget side is the source's, so only
      -- this month's payment and the notes are the editor's to change.
      if not cur.carry_frozen then
        for k in select unnest(k_amt) loop v_set := v_set - k; end loop;
      end if;
    end if;

    update public.fund_flow_line l set
      head            = coalesce(v_set ->> 'head', l.head),
      block           = case when v_set ? 'block' then nullif(v_set ->> 'block', '') else l.block end,
      company         = case when v_set ? 'company' then nullif(v_set ->> 'company', '') else l.company end,
      location        = case when v_set ? 'location' then nullif(v_set ->> 'location', '') else l.location end,
      line_type       = case when v_set ? 'line_type' then v_set ->> 'line_type' else l.line_type end,
      party           = case when v_set ? 'party' then v_set ->> 'party' else l.party end,
      customer_for    = case when v_set ? 'customer_for' then v_set ->> 'customer_for' else l.customer_for end,
      ref_no          = case when v_set ? 'ref_no' then v_set ->> 'ref_no' else l.ref_no end,
      description     = case when v_set ? 'description' then v_set ->> 'description' else l.description end,
      item            = case when v_set ? 'item' then v_set ->> 'item' else l.item end,
      doc_date        = case when v_set ? 'doc_date' then nullif(v_set ->> 'doc_date', '')::date else l.doc_date end,
      currency        = coalesce(v_set ->> 'currency', l.currency),
      amt_budget      = case when v_set ? 'amt_budget' then nullif(v_set ->> 'amt_budget', '')::numeric else l.amt_budget end,
      amt_paid        = case when v_set ? 'amt_paid' then nullif(v_set ->> 'amt_paid', '')::numeric else l.amt_paid end,
      inv_usd         = case when v_set ? 'inv_usd' then nullif(v_set ->> 'inv_usd', '')::numeric else l.inv_usd end,
      duty_pct        = case when v_set ? 'duty_pct' then nullif(v_set ->> 'duty_pct', '')::numeric else l.duty_pct end,
      freight_inr     = case when v_set ? 'freight_inr' then nullif(v_set ->> 'freight_inr', '')::numeric else l.freight_inr end,
      duty_mode       = case when v_set ? 'duty_mode' then nullif(v_set ->> 'duty_mode', '') else l.duty_mode end,
      duty_typed_inr  = case when v_set ? 'duty_typed_inr' then nullif(v_set ->> 'duty_typed_inr', '')::numeric else l.duty_typed_inr end,
      extra_inr       = case when v_set ? 'extra_inr' then nullif(v_set ->> 'extra_inr', '')::numeric else l.extra_inr end,
      not_this_month  = coalesce((v_set ->> 'not_this_month')::boolean, l.not_this_month),
      paid_in_full    = coalesce((v_set ->> 'paid_in_full')::boolean, l.paid_in_full),
      loan_os         = case when v_set ? 'loan_os' then nullif(v_set ->> 'loan_os', '')::numeric else l.loan_os end,
      terms           = case when v_set ? 'terms' then v_set ->> 'terms' else l.terms end,
      status_note     = case when v_set ? 'status_note' then v_set ->> 'status_note' else l.status_note end,
      remarks         = case when v_set ? 'remarks' then v_set ->> 'remarks' else l.remarks end,
      sales_person    = case when v_set ? 'sales_person' then v_set ->> 'sales_person' else l.sales_person end,
      machine         = case when v_set ? 'machine' then v_set ->> 'machine' else l.machine end,
      expected_date   = case when v_set ? 'expected_date' then nullif(v_set ->> 'expected_date', '')::date else l.expected_date end,
      follow_up       = case when v_set ? 'follow_up' then v_set ->> 'follow_up' else l.follow_up end,
      total_due       = case when v_set ? 'total_due' then nullif(v_set ->> 'total_due', '')::numeric else l.total_due end,
      tally_company_guid = case when v_set ? 'tally_company_guid' then nullif(v_set ->> 'tally_company_guid', '') else l.tally_company_guid end,
      tally_ledger    = case when v_set ? 'tally_ledger' then nullif(v_set ->> 'tally_ledger', '') else l.tally_ledger end,
      tally_ledger_guid = case when v_set ? 'tally_ledger_guid' then nullif(v_set ->> 'tally_ledger_guid', '') else l.tally_ledger_guid end,
      tally_due_inr   = case when v_set ? 'tally_due_inr' then nullif(v_set ->> 'tally_due_inr', '')::numeric else l.tally_due_inr end,
      tally_due_as_at = case when v_set ? 'tally_due_as_at' then nullif(v_set ->> 'tally_due_as_at', '')::timestamptz else l.tally_due_as_at end,
      tally_paid_inr  = case when v_set ? 'tally_paid_inr' then nullif(v_set ->> 'tally_paid_inr', '')::numeric else l.tally_paid_inr end,
      tally_paid_as_at = case when v_set ? 'tally_paid_as_at' then nullif(v_set ->> 'tally_paid_as_at', '')::timestamptz else l.tally_paid_as_at end,
      paid_source     = coalesce(nullif(v_set ->> 'paid_source', ''), l.paid_source),
      actual_inr      = case when v_set ? 'actual_inr' then nullif(v_set ->> 'actual_inr', '')::numeric else l.actual_inr end,
      link_target_inr = case when v_set ? 'link_target_inr' then nullif(v_set ->> 'link_target_inr', '')::numeric else l.link_target_inr end,
      link_received_inr = case when v_set ? 'link_received_inr' then nullif(v_set ->> 'link_received_inr', '')::numeric else l.link_received_inr end,
      link_due_inr    = case when v_set ? 'link_due_inr' then nullif(v_set ->> 'link_due_inr', '')::numeric else l.link_due_inr end,
      link_as_at      = case when v_set ? 'link_as_at' then nullif(v_set ->> 'link_as_at', '')::timestamptz else l.link_as_at end,
      override_reason = case when v_set ? 'override_reason' then v_set ->> 'override_reason' else l.override_reason end,
      sort_order      = coalesce((v_set ->> 'sort_order')::int, l.sort_order),
      updated_by      = v_uid
    where l.id = cur.id
    returning l.id into v_id;

    insert into public.fund_flow_log (month, line_id, action, old_row, new_row, by_user)
    select p_month, v_id, case when nullif(e ->> 'id', '') is null then 'add' else 'edit' end,
           case when nullif(e ->> 'id', '') is null then null else to_jsonb(cur) end,
           to_jsonb(n), v_uid
      from public.fund_flow_line n where n.id = v_id;

    v_ids := v_ids || to_jsonb(v_id);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('saved', v_n, 'ids', v_ids);
end $fn$;

-- CFO decisions on lines. p_items, one per line:
--   {"id": uuid}                       approve the budget as it stands
--   {"id": uuid, "approved": number}   approve this amount (line unit, gross of earlier months)
--   {"id": uuid, "reject": true}       turn the change down:
--                                        a delete request  -> cleared, the line stays
--                                        a never-approved line -> marked Not approved, KEPT (counts 0)
--                                        an edit after approval -> budget put back as approved
-- An approved line that has a delete request is removed by {"id", "approve_delete": true}.
--   {"id": uuid, "unapprove": true}    the CFO takes an approval back (user, 24-Oct-2026): the line
--                                        becomes Not approved — kept, counts 0, can be approved again
-- Approval ALWAYS stores a fixed figure, so a later budget edit can never move it silently.
create or replace function public.ff_approve(p_month date, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  e      jsonb;
  cur    public.fund_flow_line;
  v      record;
  rate   numeric;
  locked boolean;
  n      int := 0;
  v_amt  numeric;
begin
  if public.ff_role(v_uid) <> 'cfo' then raise exception 'only the CFO can approve'; end if;
  perform public.ff_assert_can_edit(p_month, v_uid);
  select std_rate, plan_approved_at is not null into rate, locked from public.fund_flow_month where month = p_month;
  for e in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into cur from public.fund_flow_line
     where id = (e ->> 'id')::uuid and month = p_month and deleted_at is null for update;
    if not found then raise exception 'unknown line %', e ->> 'id'; end if;
    select * into v from public.ff_line_values(cur, rate, locked);

    if coalesce((e ->> 'unapprove')::boolean, false) then
      if cur.approved_at is null then raise exception 'line % is not approved', coalesce(cur.party, cur.id::text); end if;
      update public.fund_flow_line set amt_approved = null, approved_at = null, approved_by = null, approved_budget_snap = null,
             not_approved_at = now(), not_approved_by = v_uid, updated_by = v_uid
       where id = cur.id;
      insert into public.fund_flow_log (month, line_id, action, old_row, new_row, by_user)
      values (p_month, cur.id, 'unapprove', jsonb_build_object('approved', cur.amt_approved, 'party', cur.party, 'head', cur.head),
              jsonb_build_object('approved', 0, 'party', cur.party, 'head', cur.head), v_uid);
    elsif coalesce((e ->> 'approve_delete')::boolean, false) then
      update public.fund_flow_line set deleted_at = now(), updated_by = v_uid where id = cur.id;
      insert into public.fund_flow_log (month, line_id, action, old_row, by_user)
      values (p_month, cur.id, 'delete_approved', to_jsonb(cur), v_uid);
    elsif coalesce((e ->> 'reject')::boolean, false) then
      if cur.delete_requested_at is not null then
        update public.fund_flow_line set delete_requested_at = null, delete_requested_by = null, updated_by = v_uid where id = cur.id;
      elsif cur.approved_at is null then
        update public.fund_flow_line set not_approved_at = now(), not_approved_by = v_uid, updated_by = v_uid where id = cur.id;
      else
        -- Back to what was approved. Customs keeps its inputs and takes the approved total as
        -- its override, so the figure is exactly the one the CFO saw.
        update public.fund_flow_line set amt_budget = cur.approved_budget_snap, updated_by = v_uid where id = cur.id;
      end if;
      insert into public.fund_flow_log (month, line_id, action, old_row, by_user)
      values (p_month, cur.id, 'reject', to_jsonb(cur), v_uid);
    else
      v_amt := case when e ? 'approved' and nullif(e ->> 'approved', '') is not null
                    then (e ->> 'approved')::numeric else v.budget_unit end;
      update public.fund_flow_line set
        amt_approved = v_amt, approved_by = v_uid, approved_at = now(), approved_budget_snap = v.budget_unit,
        not_approved_at = null, not_approved_by = null, updated_by = v_uid
      where id = cur.id;
      insert into public.fund_flow_log (month, line_id, action, old_row, new_row, by_user)
      values (p_month, cur.id, 'approve', jsonb_build_object('approved', cur.amt_approved, 'party', cur.party),
              jsonb_build_object('approved', v_amt, 'budget', v.budget_unit, 'party', cur.party), v_uid);
    end if;
    n := n + 1;
  end loop;
  return n;
end $fn$;

-- The CFO approves the month's PLAN: every line not yet decided is approved as budgeted (lines the
-- CFO marked Not approved stay so, with a plan figure of 0), and
-- every line's approved figure is kept as its plan figure. After this, additions, edits and
-- deletes wait for the CFO line by line, and "Changes after plan" reports them.
create or replace function public.ff_approve_plan(p_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  m     public.fund_flow_month;
  n     int;
  v_na  int;
begin
  if public.ff_role(v_uid) <> 'cfo' then raise exception 'only the CFO can approve the plan'; end if;
  perform public.ff_assert_can_edit(p_month, v_uid);
  select * into m from public.fund_flow_month where month = p_month for update;
  if m.plan_approved_at is not null then
    raise exception 'the % plan is already approved — approve changes line by line', to_char(p_month, 'Mon-YY');
  end if;
  if m.rate_fixed_at is null then
    raise exception 'enter the % std rate first — the plan is approved on a fixed rate', to_char(p_month, 'Mon-YY');
  end if;
  with todo as (
    select l.id, v.budget_unit
      from public.fund_flow_line l
      cross join lateral public.ff_line_values(l, m.std_rate, false) v
     where l.month = p_month and l.deleted_at is null and l.approved_at is null and l.not_approved_at is null)
  update public.fund_flow_line l set amt_approved = t.budget_unit, approved_by = v_uid, approved_at = now(),
         approved_budget_snap = t.budget_unit, updated_by = v_uid
    from todo t where t.id = l.id;
  -- A Not approved line's plan figure is 0, so approving it later shows as a change after plan.
  update public.fund_flow_line set plan_unit = case when not_approved_at is not null then 0 else amt_approved end
   where month = p_month and deleted_at is null;
  get diagnostics n = row_count;
  select count(*) into v_na from public.fund_flow_line where month = p_month and deleted_at is null and not_approved_at is not null;
  update public.fund_flow_month set plan_approved_at = now(), plan_approved_by = v_uid, updated_by = v_uid where month = p_month;
  insert into public.fund_flow_log (month, action, new_row, by_user)
  values (p_month, 'plan_approved', jsonb_build_object('lines', n, 'not_approved', v_na), v_uid);
  perform public.ff_notify(array(select public.ff_users('director')),
    format('%s budget approved by the CFO - waiting for your final approval', to_char(p_month, 'Mon-YY')),
    array[format('%s lines approved; %s kept as Not approved (counted 0).', n - v_na, v_na),
          'Open Reports > Budgeted Fund Flow to give the final approval.'],
    v_uid);
  return n;
end $fn$;

-- The Customer Collections share of due (editor or CFO, while the month can be edited). Logged.
create or replace function public.ff_set_collection_pct(p_month date, p_pct numeric)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_old numeric;
begin
  perform public.ff_assert_can_edit(p_month, v_uid);
  if p_pct is null or p_pct <= 0 or p_pct > 1 then raise exception 'the collection %% must be above 0 and at most 100'; end if;
  select collection_pct into v_old from public.fund_flow_month where month = p_month for update;
  update public.fund_flow_month set collection_pct = p_pct, updated_by = v_uid where month = p_month;
  insert into public.fund_flow_log (month, action, old_row, new_row, by_user)
  values (p_month, 'collection_pct', jsonb_build_object('collection_pct', v_old), jsonb_build_object('collection_pct', p_pct), v_uid);
end $fn$;

create or replace function public.ff_set_month(p_month date, p_std_rate numeric, p_opening numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  old   public.fund_flow_month;
begin
  if public.ff_role(v_uid) <> 'cfo' then raise exception 'only the CFO can change the rate or the opening'; end if;
  perform public.ff_assert_can_edit(p_month, v_uid);
  select * into old from public.fund_flow_month where month = p_month for update;
  -- p_std_rate NULL = leave the rate alone. A rate given FIXES it, once: after that it can only be
  -- given again unchanged (user, 24-Oct-2026: "once inputed it may not change for the month").
  if p_std_rate is not null and p_std_rate <= 0 then raise exception 'the std rate must be above 0'; end if;
  if p_std_rate is not null and old.rate_fixed_at is not null and p_std_rate <> old.std_rate then
    raise exception 'the % std rate is fixed at % and cannot change', to_char(p_month, 'Mon-YY'), old.std_rate;
  end if;
  if p_opening is not null and coalesce(btrim(p_reason), '') = '' then
    raise exception 'give a reason for overriding the opening balance';
  end if;
  update public.fund_flow_month set std_rate = coalesce(p_std_rate, std_rate),
         rate_fixed_at = case when p_std_rate is not null then coalesce(rate_fixed_at, now()) else rate_fixed_at end,
         rate_fixed_by = case when p_std_rate is not null then coalesce(rate_fixed_by, v_uid) else rate_fixed_by end,
         opening_override = p_opening,
         opening_reason = case when p_opening is null then null else p_reason end, updated_by = v_uid
   where month = p_month;
  insert into public.fund_flow_log (month, action, old_row, new_row, reason, by_user)
  values (p_month, 'month', jsonb_build_object('std_rate', old.std_rate, 'opening_override', old.opening_override),
          jsonb_build_object('std_rate', coalesce(p_std_rate, old.std_rate), 'opening_override', p_opening,
                             'rate_fixed', p_std_rate is not null and old.rate_fixed_at is null), p_reason, v_uid);
end $fn$;


-- ============================================================ final approval =

-- A Director's FINAL approval of the month's budget, after the CFO approved the plan.
create or replace function public.ff_final_approve(p_month date, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  m     public.fund_flow_month;
begin
  if public.ff_role(v_uid) <> 'director' then raise exception 'only a Director gives the final approval'; end if;
  select * into m from public.fund_flow_month where month = p_month for update;
  if not found then raise exception 'no Fund Flow for %', to_char(p_month, 'Mon-YY'); end if;
  if m.plan_approved_at is null then
    raise exception 'the CFO has not approved the % plan yet', to_char(p_month, 'Mon-YY');
  end if;
  if m.final_approved_at is not null then
    raise exception 'the % budget already has the Directors'' approval', to_char(p_month, 'Mon-YY');
  end if;
  update public.fund_flow_month set final_approved_at = now(), final_approved_by = v_uid,
         final_note = nullif(btrim(p_note), ''), updated_by = v_uid
   where month = p_month;
  insert into public.fund_flow_log (month, action, reason, by_user) values (p_month, 'final_approved', p_note, v_uid);
  perform public.ff_notify(array(select public.ff_users('cfo')),
    format('%s budget: final approval given by the Directors', to_char(p_month, 'Mon-YY')),
    array_remove(array[case when nullif(btrim(p_note), '') is not null then 'Note: ' || p_note end], null),
    v_uid);
end $fn$;


-- ============================================================ notifications =
-- Reminders and change alerts (user, 24-Oct-2026), to the Hub bell and by email:
--   * the month opening, closing tomorrow / today, and closed  -> CFO (closed also -> Directors)
--   * every Saturday (the working day before, if Saturday is a holiday): follow up the editors
--     to update the month                                       -> CFO; Directors if their
--                                                                  approval is still pending
--   * a change summary at 4 PM, and again at 7 PM for anything after 4 PM -> CFO; changes made
--     after closing (a reopen) or after the Directors' approval also -> Directors
--   * CFO approves the plan -> Directors; Directors approve -> CFO; reopen -> CFO + Directors
-- Bell rows use notifications.type 'fund_flow' with their own message and link. Email goes through
-- email_outbox (kind 'fund_flow_notice') only while the 'fund-flow' email switch is on.

alter type public.notification_type add value if not exists 'fund_flow';
alter table public.notifications
  add column if not exists message text,
  add column if not exists link text;
comment on column public.notifications.message is 'Free-text bell message for module notices (Fund Flow). NULL for task notifications.';
comment on column public.notifications.link is 'Where the bell row opens, for module notices. NULL for task notifications.';

-- What has been sent, so a re-run or a retried cron never sends twice; also the change
-- summary's watermark.
create table if not exists public.fund_flow_notice_sent (
  key      text primary key,
  sent_at  timestamptz not null default now(),
  info     jsonb
);
alter table public.fund_flow_notice_sent enable row level security;
revoke all on public.fund_flow_notice_sent from anon, authenticated;

create or replace function public.ff_users(p_role text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$ select id from public.profiles where fund_flow_role = p_role $fn$;

-- "Dimple, Vishal and Samin": the people with the right to update the month.
create or replace function public.ff_editor_names()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  with n as (select coalesce(nullif(btrim(name), ''), email) as nm from public.profiles
              where fund_flow_role = 'editor' order by 1)
  select case when count(*) = 0 then 'the Fund Flow editors'
              when count(*) = 1 then max(nm)
              else string_agg(nm, ', ') filter (where nm <> (select max(nm) from n)) || ' and ' || max(nm) end
    from n
$fn$;

-- Back over Sundays and the Hub's public holidays (when that list exists).
create or replace function public.ff_prev_working_day(d date)
returns date
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v   date := d;
  hol boolean;
begin
  for i in 1..14 loop
    hol := false;
    if to_regclass('public.public_holidays') is not null then
      execute 'select exists (select 1 from public.public_holidays where holiday_date = $1)' into hol using v;
    end if;
    if extract(dow from v)::int = 0 or hol then v := v - 1; else return v; end if;
  end loop;
  return v;
end $fn$;

create or replace function public.ff_notify(p_users uuid[], p_subject text, p_points text[], p_actor uuid default null,
                                            p_link text default '/reports/finance-fund-flow')
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  u      uuid;
  n      int := 0;
  v_mail boolean := false;
  v_to   text;
begin
  begin v_mail := public.email_module_enabled('fund-flow'); exception when others then v_mail := false; end;
  for u in select distinct x from unnest(coalesce(p_users, '{}'::uuid[])) x where x is not null loop
    -- Isolated: a notice can never undo the Fund Flow write that caused it.
    begin
      insert into public.notifications (user_id, type, actor_id, message, link)
      values (u, 'fund_flow', p_actor, p_subject, p_link);
      n := n + 1;
    exception when others then null;
    end;
    if v_mail then
      begin
        v_to := coalesce((select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
                         (select nullif(btrim(au.email), '') from auth.users au where au.id = u));
        insert into public.email_outbox (kind, to_user_id, to_email, actor_id, payload)
        values ('fund_flow_notice', u, v_to, p_actor,
                jsonb_build_object('subject', p_subject, 'headline', p_subject,
                                   'bullets', to_jsonb(coalesce(p_points, '{}'::text[])),
                                   'link', p_link));
      exception when others then null;
      end;
    end if;
  end loop;
  return n;
end $fn$;

-- Where a month stands, as short points for a reminder.
create or replace function public.ff_month_points(p_month date)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  m   public.fund_flow_month;
  w   record;
  t   record;
  out text[] := '{}';
begin
  select * into m from public.fund_flow_month where month = p_month;
  if not found then return out; end if;
  select * into w from public.ff_month_window(p_month);
  select count(*) as lines,
         coalesce(sum(approved_inr), 0) as appr, coalesce(sum(paid_inr), 0) as paid,
         count(*) filter (where awaiting_approval or changed_after_approval or delete_requested) as waiting,
         count(*) filter (where not_approved) as na,
         count(*) filter (where updated_at < now() - interval '7 days') as stale
    into t from public.v_fund_flow_line where month = p_month;
  out := out || format('Window %s to %s; status %s%s.', to_char(w.opens_on, 'DD-Mon'), to_char(w.closes_on, 'DD-Mon'),
                       m.status, case when m.reopened then ' (reopened)' else '' end);
  out := out || case when m.rate_fixed_at is null then format('Std rate NOT entered yet (provisional %s).', m.std_rate)
                     else format('Std rate fixed at %s.', m.std_rate) end;
  out := out || case when m.plan_approved_at is null then 'Plan not yet approved by the CFO.'
                     when m.final_approved_at is null then 'Plan approved by the CFO; Directors'' final approval pending.'
                     else 'Final approval given by the Directors.' end;
  out := out || format('Paid %s of approved %s (%s lines).', to_char(t.paid, 'FM99,99,99,99,990'), to_char(t.appr, 'FM99,99,99,99,990'), t.lines);
  if t.waiting > 0 then out := out || format('%s change(s) waiting for the CFO.', t.waiting); end if;
  if t.na > 0 then out := out || format('%s line(s) kept as Not approved.', t.na); end if;
  if t.stale > 0 then out := out || format('%s line(s) not updated for 7 days.', t.stale); end if;
  return out;
end $fn$;

-- Send once per key.
create or replace function public.ff_notify_once(p_key text, p_users uuid[], p_subject text, p_points text[])
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.fund_flow_notice_sent (key) values (p_key) on conflict do nothing;
  if not found then return false; end if;
  perform public.ff_notify(p_users, p_subject, p_points, null);
  return true;
end $fn$;

-- An amount as the hub writes it: 4000000.0000 -> 40,00,000; blank -> '-'.
create or replace function public.ff_amt(t text)
returns text
language sql
immutable
as $fn$
  select case when nullif(t, '') is null then '-'
              else rtrim(rtrim(to_char(t::numeric, 'FM99,99,99,99,990.00'), '0'), '.') end
$fn$;

-- One change, in a few words.
create or replace function public.ff_log_line(g public.fund_flow_log)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  who  text;
  r    jsonb := coalesce(g.new_row, g.old_row, '{}'::jsonb);
  what text;
  amt  text := '';
begin
  who := coalesce(g.by_name, (select coalesce(nullif(btrim(name), ''), email) from public.profiles where id = g.by_user));
  what := coalesce(nullif(r ->> 'party', ''), nullif(r ->> 'line_type', ''), '');
  if g.action = 'edit' and g.old_row is not null and g.new_row is not null then
    if (g.old_row ->> 'amt_budget') is distinct from (g.new_row ->> 'amt_budget') then
      amt := amt || format(' budget %s -> %s', public.ff_amt(g.old_row ->> 'amt_budget'), public.ff_amt(g.new_row ->> 'amt_budget'));
    end if;
    if (g.old_row ->> 'amt_paid') is distinct from (g.new_row ->> 'amt_paid') then
      amt := amt || format(' paid %s -> %s', public.ff_amt(g.old_row ->> 'amt_paid'), public.ff_amt(g.new_row ->> 'amt_paid'));
    end if;
  elsif g.action = 'add' then
    amt := format(' budget %s', public.ff_amt(r ->> 'amt_budget'));
  end if;
  return format('%s: %s%s%s%s', coalesce(who, 'system'),
    case g.action when 'add' then 'added' when 'edit' then 'changed' when 'delete' then 'deleted'
                  when 'delete_request' then 'asked to remove' when 'approve' then 'approved'
                  when 'reject' then 'did not approve' when 'unapprove' then 'took back the approval of' when 'delete_approved' then 'removed'
                  when 'month' then 'changed the rate / opening' when 'collection_pct' then 'changed the collection % of due' when 'reopen' then 'reopened the month'
                  when 'plan_approved' then 'approved the plan' when 'final_approved' then 'gave the final approval'
                  else g.action end,
    case when r ? 'head' then ' ' || replace(r ->> 'head', '_', ' ') else '' end,
    case when what <> '' then ' - ' || what else '' end,
    amt);
end $fn$;

-- The month's paid-basis closing against the Daily Report bank total on a date (user, 24-Oct-2026:
-- a zero bank balance or any difference is flagged in red on the page and emailed to the CFO and
-- Dimple). Opening = the override, else the Daily Report total for the previous month end.
create or replace function public.ff_bank_check(p_month date, p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  m        public.fund_flow_month;
  v_open   numeric;
  v_rec    numeric;
  v_pay    numeric;
  v_bank   jsonb;
  v_total  numeric;
  v_gaps   text;
begin
  if auth.uid() is not null and public.ff_role(auth.uid()) = 'none' then raise exception 'no Fund Flow access'; end if;
  select * into m from public.fund_flow_month where month = p_month;
  if not found then return null; end if;
  v_open := coalesce(m.opening_override, (public.ff_bank_position((p_month - 1)::date) ->> 'total_inr')::numeric, 0);
  -- Received: Customer Collections + Refunds. A machine advance received is already inside
  -- Customer Collections (the Customer Collection report), so it is not added again.
  select coalesce(sum(paid_inr) filter (where head in ('collection', 'refund')), 0),
         coalesce(sum(paid_inr) filter (where head not in ('machine_advance', 'collection', 'refund')), 0)
    into v_rec, v_pay from public.v_fund_flow_line where month = p_month;
  v_bank := public.ff_bank_position(p_as_of);
  v_total := coalesce((v_bank ->> 'total_inr')::numeric, 0);
  select string_agg((a ->> 'label') || case when (a ->> 'missing')::boolean then ' (no entry)' else ' (last ' || (a ->> 'date') || ')' end, ', ')
    into v_gaps
    from jsonb_array_elements(coalesce(v_bank -> 'accounts', '[]'::jsonb)) a
   where (a ->> 'missing')::boolean or (a ->> 'stale')::boolean;
  return jsonb_build_object('as_of', p_as_of, 'bank', v_total, 'closing_paid', v_open + v_rec - v_pay,
                            'diff', v_open + v_rec - v_pay - v_total, 'gaps', v_gaps);
end $fn$;

-- The scheduled runs. p_slot: 'housekeep' 00:05 IST, 'morning' 09:30 IST, 'digest' 16:00 and 19:00 IST.
create or replace function public.ff_notify_run(p_slot text, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_today date := ((p_now at time zone 'UTC') + interval '5 hours 30 minutes')::date;
  v_cfo   uuid[] := array(select public.ff_users('cfo'));
  v_dir   uuid[] := array(select public.ff_users('director'));
  v_eds   text := public.ff_editor_names();
  v_sat   date;
  m       record;
  w       record;
  g       public.fund_flow_log;
  v_from  timestamptz;
  v_to    timestamptz;
  pts_c   text[];
  pts_d   text[];
  cfo_one uuid;
  out     jsonb := '{}'::jsonb;
  tag     text;
begin
  if auth.uid() is not null and not public.is_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  if p_slot = 'housekeep' then
    return public.ff_housekeep();
  end if;

  if p_slot = 'morning' then
    for m in select * from public.fund_flow_month order by month loop
      select * into w from public.ff_month_window(m.month);
      if v_today >= w.opens_on and v_today <= w.closes_on and m.status = 'open' then
        perform public.ff_notify_once('open:' || m.month, v_cfo,
          format('%s Fund Flow is open - please get %s to update it', to_char(m.month, 'Mon-YY'), v_eds),
          array[format('Open from %s; closes %s.', to_char(w.opens_on, 'DD-Mon'), to_char(w.closes_on, 'Dy DD-Mon'))]
            || case when m.rate_fixed_at is null then array['Enter the month''s std rate (Rate / opening); it is then fixed for the month.'] else '{}'::text[] end);
      end if;
      if m.status = 'open' and not m.reopened and v_today = w.closes_on - 1 then
        perform public.ff_notify_once('close-1:' || m.month, v_cfo,
          format('%s Fund Flow closes tomorrow (%s)', to_char(m.month, 'Mon-YY'), to_char(w.closes_on, 'DD-Mon')),
          public.ff_month_points(m.month));
      end if;
      if m.status = 'open' and not m.reopened and v_today = w.closes_on then
        perform public.ff_notify_once('close0:' || m.month, v_cfo,
          format('%s Fund Flow closes TODAY - last day for %s to update it', to_char(m.month, 'Mon-YY'), v_eds),
          public.ff_month_points(m.month));
      end if;
      if m.status = 'closed' then
        perform public.ff_notify_once('closed:' || m.month || ':' || coalesce(m.closed_at::text, ''), v_cfo || v_dir,
          format('%s Fund Flow is closed', to_char(m.month, 'Mon-YY')),
          public.ff_month_points(m.month) || array['Changes now need the CFO to reopen the month; every change is reported.']);
      end if;
    end loop;

    -- Bank check on yesterday's Daily Report: zero, accounts not entered, or a difference from the
    -- paid-basis closing -> CFO and the bank-alert people (Dimple).
    declare
      v_day  date := v_today - 1;
      v_chk  jsonb;
      v_why  text[];
    begin
      v_chk := public.ff_bank_check(date_trunc('month', v_day)::date, v_day);
      if v_chk is not null then
        v_why := '{}';
        if (v_chk ->> 'bank')::numeric = 0 then v_why := v_why || 'Bank balance is ZERO on the Daily Report.'::text; end if;
        if v_chk ->> 'gaps' is not null then v_why := v_why || ('Not entered that day: ' || (v_chk ->> 'gaps') || '.'); end if;
        if abs((v_chk ->> 'diff')::numeric) >= 1 then
          v_why := v_why || format('Difference: paid-basis closing %s less bank %s = %s.', public.ff_amt(v_chk ->> 'closing_paid'),
                                   public.ff_amt(v_chk ->> 'bank'), public.ff_amt(v_chk ->> 'diff'));
        end if;
        if cardinality(v_why) > 0 then
          perform public.ff_notify_once('bank:' || v_day, v_cfo || array(select id from public.profiles where fund_flow_bank_alert),
            format('Fund Flow bank check %s: %s', to_char(v_day, 'DD-Mon'),
                   case when (v_chk ->> 'bank')::numeric = 0 then 'bank balance is zero' else 'balance does not match' end),
            v_why || 'Please check the Daily Report bank entries and the Paid / Received figures in the Fund Flow.'::text);
        end if;
      end if;
    end;

    -- Weekly: Saturday, or the working day before it when Saturday is a holiday.
    v_sat := v_today + ((6 - extract(dow from v_today)::int + 7) % 7);
    if public.ff_prev_working_day(v_sat) = v_today then
      for m in select * from public.fund_flow_month where status = 'open' order by month loop
        perform public.ff_notify_once('weekly:' || v_sat || ':' || m.month, v_cfo,
          format('Weekly Fund Flow update %s - follow up %s', to_char(m.month, 'Mon-YY'), v_eds),
          array[format('Please ask %s to update Paid / Received and any new lines for %s.', v_eds, to_char(m.month, 'Mon-YY'))]
            || public.ff_month_points(m.month));
        if m.plan_approved_at is not null and m.final_approved_at is null then
          perform public.ff_notify_once('weekly-dir:' || v_sat || ':' || m.month, v_dir,
            format('%s budget waiting for your final approval', to_char(m.month, 'Mon-YY')),
            public.ff_month_points(m.month));
        end if;
      end loop;
    end if;
    return jsonb_build_object('slot', 'morning', 'today', v_today);
  end if;

  if p_slot = 'digest' then
    select coalesce((select (info ->> 'upto')::timestamptz from public.fund_flow_notice_sent where key = 'digest'),
                    p_now - interval '1 day') into v_from;
    v_to := p_now;
    -- One summary per CFO, leaving out what that CFO did; one for the Directors with only the
    -- changes made after closing (a reopen) or after their final approval.
    foreach cfo_one in array coalesce(v_cfo, '{}'::uuid[]) loop
      pts_c := '{}';
      for g in select * from public.fund_flow_log where at > v_from and at <= v_to and by_user is distinct from cfo_one
                 and action not in ('open', 'close') order by at loop
        select case when mm.reopened then '[AFTER CLOSE] '
                    when mm.final_approved_at is not null and g.at > mm.final_approved_at then '[AFTER FINAL APPROVAL] '
                    when mm.plan_approved_at is not null and g.at > mm.plan_approved_at then '[after plan] '
                    else '' end into tag
          from public.fund_flow_month mm where mm.month = g.month;
        pts_c := pts_c || (coalesce(tag, '') || to_char(g.month, 'Mon-YY') || ' ' || public.ff_log_line(g));
      end loop;
      if cardinality(pts_c) > 0 then
        perform public.ff_notify(array[cfo_one],
          format('Fund Flow: %s change(s) since %s', cardinality(pts_c),
                 to_char((v_from at time zone 'UTC') + interval '5 hours 30 minutes', 'DD-Mon HH24:MI')),
          case when cardinality(pts_c) > 25 then pts_c[1:25] || format('... and %s more (see the Changes tab).', cardinality(pts_c) - 25) else pts_c end);
      end if;
    end loop;
    pts_d := '{}';
    for g in select l.* from public.fund_flow_log l join public.fund_flow_month mm on mm.month = l.month
              where l.at > v_from and l.at <= v_to and l.action not in ('open', 'close', 'reopen', 'final_approved')
                and (mm.reopened or (mm.final_approved_at is not null and l.at > mm.final_approved_at)) order by l.at loop
      pts_d := pts_d || (to_char(g.month, 'Mon-YY') || ' ' || public.ff_log_line(g));
    end loop;
    if cardinality(pts_d) > 0 then
      perform public.ff_notify(v_dir,
        format('Fund Flow: %s change(s) after closing / after your approval', cardinality(pts_d)),
        case when cardinality(pts_d) > 25 then pts_d[1:25] || format('... and %s more (see the Changes tab).', cardinality(pts_d) - 25) else pts_d end);
    end if;
    insert into public.fund_flow_notice_sent (key, info) values ('digest', jsonb_build_object('upto', v_to))
      on conflict (key) do update set info = excluded.info, sent_at = now();
    out := jsonb_build_object('slot', 'digest', 'cfo_changes', cardinality(pts_c), 'director_changes', cardinality(pts_d));
    return out;
  end if;

  raise exception 'unknown slot %', p_slot;
end $fn$;

-- DAILY REPORT BANK BALANCES — the chase (user, 24-Oct-2026). The bank balances on the Daily
-- Report are typed by the team each evening; the Fund Flow's "balance as on today" is that figure.
-- If yesterday's (the last working day's) balances are not all entered by 10:30 AM IST, remind the
-- Daily Report team (edit access), the CFO and Dimple (bank alert) — bell with a pop-up on opening
-- the hub, and email — and again every 15 minutes until done. From the 4th reminder (after 3 went
-- unanswered) the Directors are told too. Once entered, the open reminders are cleared.
-- Runs from pg_cron every 15 minutes, 10:30 to 19:15 IST, Monday to Saturday; holidays skipped.
create or replace function public.ff_bank_chase(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ist     timestamp := (p_now at time zone 'UTC') + interval '5 hours 30 minutes';
  v_today   date := v_ist::date;
  v_for     date;
  v_missing text;
  v_key     text;
  v_n       int;
  v_team    uuid[];
  v_to      uuid[];
  v_link    text := '/daily-report/bank-balances';
begin
  if auth.uid() is not null and not public.is_admin(auth.uid()) then raise exception 'Not authorized'; end if;
  if v_ist::time < time '10:30' then return jsonb_build_object('skipped', 'before 10:30'); end if;
  if public.ff_prev_working_day(v_today) <> v_today then return jsonb_build_object('skipped', 'not a working day'); end if;
  v_for := public.ff_prev_working_day(v_today - 1);
  v_key := 'bankchase:' || v_today;

  select string_agg(coalesce(a.short_label, a.id::text), ', ' order by a.sort_order, a.short_label) into v_missing
    from public.daily_report_bank_accounts a
   where a.active
     and not exists (select 1 from public.daily_report_bank_balances b
                      where b.bank_account_id = a.id and b.balance_date = v_for);

  if v_missing is null then
    -- All entered: close today's open reminders so the pop-up stops.
    update public.notifications set read_at = now()
     where type::text = 'fund_flow' and link = v_link and read_at is null and created_at >= v_today::timestamp - interval '5 hours 30 minutes';
    return jsonb_build_object('for', v_for, 'missing', null);
  end if;

  insert into public.fund_flow_notice_sent (key, info) values (v_key, jsonb_build_object('n', 0))
    on conflict (key) do nothing;
  update public.fund_flow_notice_sent set info = jsonb_build_object('n', coalesce((info ->> 'n')::int, 0) + 1), sent_at = now()
   where key = v_key returning (info ->> 'n')::int into v_n;

  begin
    execute 'select array(select user_id from public.app_access where app_id = ''daily-report'' and access_level = ''edit'')' into v_team;
  exception when others then v_team := '{}';
  end;
  v_to := coalesce(v_team, '{}') || array(select public.ff_users('cfo'))
          || array(select id from public.profiles where fund_flow_bank_alert);
  if v_n >= 4 then v_to := v_to || array(select public.ff_users('director')); end if;

  perform public.ff_notify(v_to,
    format('%sDaily Report bank balance for %s not entered (reminder %s)',
           case when v_n >= 4 then 'ESCALATED: ' else '' end, to_char(v_for, 'DD-Mon'), v_n),
    array[format('Not entered: %s.', v_missing),
          'Please enter the closing balances in Daily Report > Bank balances. The Fund Flow''s balance as on today and its difference depend on it.',
          case when v_n >= 4 then 'Three reminders have gone unanswered, so the Directors are now copied.'
               else 'You will be reminded every 15 minutes until it is done; after 3 reminders the Directors are told.' end],
    null, v_link);
  return jsonb_build_object('for', v_for, 'missing', v_missing, 'reminder', v_n);
end $fn$;

revoke all on function public.ff_notify_run(text, timestamptz) from public, anon, authenticated;
revoke all on function public.ff_notify(uuid[], text, text[], uuid, text) from public, anon, authenticated;
revoke all on function public.ff_bank_chase(timestamptz) from public, anon, authenticated;
revoke all on function public.ff_notify_once(text, uuid[], text, text[]) from public, anon, authenticated;

-- Schedules (cron is UTC). Only where pg_cron is installed (the Hub DB); re-runnable by name.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('fund-flow-housekeep', '35 18 * * *', $$select public.ff_notify_run('housekeep');$$);  -- 00:05 IST
    perform cron.schedule('fund-flow-morning',   '0 4 * * *',   $$select public.ff_notify_run('morning');$$);    -- 09:30 IST
    perform cron.schedule('fund-flow-digest-4pm', '30 10 * * *', $$select public.ff_notify_run('digest');$$);    -- 16:00 IST
    perform cron.schedule('fund-flow-digest-7pm', '30 13 * * *', $$select public.ff_notify_run('digest');$$);    -- 19:00 IST
    -- Every 15 minutes 10:30 to 19:15 IST (05:00 to 13:45 UTC), Monday to Saturday.
    perform cron.schedule('fund-flow-bank-chase', '*/15 5-13 * * 1-6', $$select public.ff_bank_chase();$$);
  end if;
end $cron$;


-- ============================================================ bank =========

-- Cash per the Daily Report on a date, for Fund Flow viewers who may not hold the
-- daily-report module. Totals and the account list only, in rupees.
-- ⚠ closing_balance_lacs HOLDS RUPEES despite its name: the Daily Report saves the figure
--   exactly as typed off the bank portal and divides by 1,00,000 only on display
--   (apps/daily-report/data/bankBalances.ts). Never multiply it here.
-- An account with no row that day takes its last earlier row and says so; an account with
-- no row at all is listed as missing — never counted as 0.
create or replace function public.ff_bank_position(p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_accounts jsonb;
  v_total    numeric;
begin
  -- No user = the scheduler (pg_cron); anon cannot call this.
  if auth.uid() is not null and public.ff_role(auth.uid()) = 'none' then raise exception 'no Fund Flow access'; end if;
  with acc as (
    select a.id, a.short_label, a.location, a.sort_order,
           (select b.balance_date from public.daily_report_bank_balances b
             where b.bank_account_id = a.id and b.balance_date <= p_as_of
             order by b.balance_date desc limit 1) as d
      from public.daily_report_bank_accounts a
     where a.active
  )
  select jsonb_agg(jsonb_build_object(
           'label', acc.short_label, 'location', acc.location, 'date', acc.d,
           'balance_inr', b.closing_balance_lacs,
           'stale', acc.d is not null and acc.d < p_as_of,
           'missing', acc.d is null) order by acc.sort_order, acc.short_label),
         sum(b.closing_balance_lacs)
    into v_accounts, v_total
    from acc
    left join public.daily_report_bank_balances b on b.bank_account_id = acc.id and b.balance_date = acc.d;
  return jsonb_build_object('as_of', p_as_of, 'total_inr', coalesce(v_total, 0), 'accounts', coalesce(v_accounts, '[]'::jsonb));
end $fn$;


-- ============================================================ grants =======

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.ff_assert_can_edit(date, uuid)', 'public.ff_sync_child(uuid)',
    'public.ff_open_month(date)', 'public.ff_close_month(date, text)', 'public.ff_reopen_month(date, text)',
    'public.ff_housekeep()', 'public.ff_save_lines(date, jsonb)', 'public.ff_approve(date, jsonb)',
    'public.ff_set_month(date, numeric, numeric, text)', 'public.ff_bank_position(date)',
    'public.ff_month_window(date)', 'public.ff_today()', 'public.ff_is_carry_head(text)',
    'public.ff_line_values(public.fund_flow_line, numeric, boolean)', 'public.ff_approve_plan(date)',
    'public.ff_final_approve(date, text)', 'public.ff_bank_check(date, date)', 'public.ff_set_collection_pct(date, numeric)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Notification internals: the scheduler and the RPCs above only.
  foreach f in array array[
    'public.ff_users(text)', 'public.ff_editor_names()', 'public.ff_prev_working_day(date)',
    'public.ff_month_points(date)', 'public.ff_log_line(public.fund_flow_log)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  -- Internal: only the RPCs above call these.
  revoke execute on function public.ff_sync_child(uuid) from authenticated;
  revoke execute on function public.ff_assert_can_edit(date, uuid) from authenticated;
end $grants$;


-- ============================================================ asserts ======

do $check$
declare w record;
begin
  -- The user's window rule, on the two dates that prove it.
  select * into w from public.ff_month_window('2026-11-01');
  if w.opens_on <> '2026-10-29' or w.closes_on <> '2026-12-02' then
    raise exception 'FF-1: Nov-26 window wrong: % to %', w.opens_on, w.closes_on;
  end if;
  -- 2-May-2027 is a Sunday, so Apr-27 closes on Monday 3-May.
  select * into w from public.ff_month_window('2027-04-01');
  if w.closes_on <> '2027-05-03' then
    raise exception 'FF-1: Apr-27 should close on 3-May-2027 (2-May is a Sunday), got %', w.closes_on;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'fund_flow_role') then
    raise exception 'FF-1: profiles.fund_flow_role missing';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'fund_flow_month' and column_name = 'rate_fixed_at') then
    raise exception 'FF-1: fund_flow_month.rate_fixed_at missing';
  end if;
end $check$;
