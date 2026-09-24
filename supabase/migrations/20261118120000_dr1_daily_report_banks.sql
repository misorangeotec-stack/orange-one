-- ===========================================================================
-- DAILY REPORT (DR-1) — the bank account master and the hand-typed balances.
--
-- WHY
--   Every evening two people hand-build an Excel sheet and circulate it as a
--   PDF — one for Surat, one for Noida — and management and the CFO read it.
--   Nearly everything on it (sales, purchases, collections, payments, heads and
--   machines despatched) is already in the Tally mirror and is now read from
--   there. TWO THINGS ARE NOT, and this migration is for those two:
--
--     1. The list of bank accounts itself. Tally knows its own bank LEDGERS,
--        but not the account number, IFSC, sanctioned limit, or the short label
--        the report prints as a column head.
--     2. The closing balance of each account on each day. That is read off the
--        bank portal at about 7pm and typed in. Tally's book balance is a
--        DIFFERENT number — it excludes uncleared cheques and bank-only entries
--        like interest and charges — so it cannot stand in for this one.
--
-- THESE ARE APP-OWNED TABLES, NOT CENTRAL MASTERS.
--   The daily_report_ prefix matches master_report_* and fms_*. Nothing here is
--   synced from Tally, nothing else joins to it, and it is gated by the
--   'daily-report' module rather than by mst_master_managers. Deliberately NOT
--   added to MASTER_TABLE in core/platform/masterWrites.ts: the screen reuses
--   the MasterCrud *component*, which is a UI shell taking callbacks, not the
--   central-masters write path.
--
-- Reuses the existing public.set_updated_at() and public.is_admin(uuid).
--
-- Reversal: run 20261118120000_dr1_daily_report_banks_rollback.sql, or
--   drop function if exists public.daily_report_balance_status(date);
--   drop function if exists public.set_bank_daily_balances(jsonb);
--   drop function if exists public.set_bank_daily_balance(uuid, date, numeric, numeric);
--   drop table if exists public.daily_report_bank_balances;
--   drop table if exists public.daily_report_bank_accounts;
-- ===========================================================================


-- ======================================================= the master ========

create table if not exists public.daily_report_bank_accounts (
  id                 uuid primary key default gen_random_uuid(),

  -- WHO OWNS THE MONEY. Restrict, not cascade: balances typed against this
  -- account are history and must not vanish with a company row.
  company_id         uuid not null references public.mst_companies on delete restrict,

  -- WHERE THE REPORT FILES IT — this account's own location, NOT the company's.
  -- THERE IS NO DELHI TALLY BOOK. The Delhi account lives inside the Orange
  -- O Tec NOIDA book, so its company_id says Noida and this column says Delhi.
  -- Minting an "O-tec — Delhi" mst_companies row instead would put a phantom
  -- entity on Order to Dispatch's company picker that can raise no invoice.
  -- The report's location filter reads THIS column.
  location           text not null check (location in ('Surat', 'Noida', 'Delhi')),

  bank_name          text not null,
  branch             text,
  account_no         text,
  ifsc               text,
  account_type       text not null default 'current'
                       check (account_type in ('cc', 'od', 'current', 'savings')),

  -- The balance grid gives each account ONE narrow column, so this is what it
  -- prints as the head. Portal-owned and short by design — the Tally ledger
  -- name ("ICICI BANK(CURRENT A/C)802505000011") is unusable as a heading.
  short_label        text not null,

  -- ── the link to Tally ────────────────────────────────────────────────────
  -- GUID, NEVER THE NAME. Account numbers sit INSIDE the ledger names
  -- ("AXIS BANK LTD. 919020047722830 (DELHI)"), so a name join here would be a
  -- substring match on a string the client edits, and a Tally rename bumps no
  -- ALTERID. This is the failure collection_refresh_use_ledger_id.sql was
  -- written to retire. tally_ledger_name is DISPLAY AND DRIFT-DETECTION ONLY.
  -- NULLABLE: an account may legitimately have no ledger in the mirror — see
  -- the Colorix note in the seed migration.
  tally_ledger_guid  text,
  tally_ledger_name  text,
  tally_tenant_id    text,

  -- ── facility, for the report's upper-right block ─────────────────────────
  -- ALL THREE ARE IN RUPEE LAKHS, like every other money column in this report.
  -- The reference sheet's facility block appears to be in CRORES; whoever seeds
  -- these must convert. Left NULL rather than guessed — a limit of zero reads
  -- as a WITHDRAWN facility, which is a different statement.
  cc_limit_lacs      numeric(14,2),
  lc_bc_limit_lacs   numeric(14,2),
  hold_by_bank_lacs  numeric(14,2),

  sort_order         integer not null default 0,
  active             boolean not null default true,
  notes              text,
  created_by         uuid references auth.users on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint daily_report_bank_accounts_label_key unique (company_id, location, short_label)
);

comment on table public.daily_report_bank_accounts is
  'Bank accounts the Daily Report tracks. Portal-owned: Tally holds the ledgers, not the account numbers, limits or column labels. Deactivate, never delete - typed balances reference these rows.';
comment on column public.daily_report_bank_accounts.location is
  'This ACCOUNT reporting location, not the company one. There is no Delhi Tally book; the Delhi account sits in the O-tec Noida book.';
comment on column public.daily_report_bank_accounts.tally_ledger_guid is
  'v_ledger_detail.guid on ConnectWave. The join key. Never match on tally_ledger_name - a Tally rename would silently orphan the account.';
comment on column public.daily_report_bank_accounts.short_label is
  'What the balance grid prints as this account column head. Keep under ~12 characters; the column is narrow and a long label is truncated, not wrapped.';

-- Two accounts must never claim one Tally ledger, or a future reconciliation
-- double-counts. Partial, because unlinked accounts may all be NULL.
create unique index if not exists daily_report_bank_accounts_ledger_key
  on public.daily_report_bank_accounts (tally_ledger_guid)
  where tally_ledger_guid is not null;

create index if not exists daily_report_bank_accounts_company_idx
  on public.daily_report_bank_accounts (company_id);
create index if not exists daily_report_bank_accounts_location_idx
  on public.daily_report_bank_accounts (location) where active;

drop trigger if exists set_updated_at on public.daily_report_bank_accounts;
create trigger set_updated_at before update on public.daily_report_bank_accounts
  for each row execute function public.set_updated_at();


-- ================================================ the typed balances =======

create table if not exists public.daily_report_bank_balances (
  bank_account_id      uuid not null
                         references public.daily_report_bank_accounts on delete restrict,
  balance_date         date not null,

  -- NOT NULL, AND THAT IS THE WHOLE DESIGN.
  -- The ONLY way to say "nobody recorded this day" is for the row to be ABSENT.
  -- A row that exists always carries a real number, so:
  --   · a Sunday         -> no row -> renders blank
  --   · an empty account -> 0.00   -> renders 0.00
  -- and the two can never be confused. If this column were nullable, "not
  -- recorded" and "recorded as nothing" would collapse into one state and the
  -- report would silently understate cash. There is no "?? 0" in the read path.
  closing_balance_lacs numeric(14,2) not null,

  -- The one facility figure with no source anywhere. Nullable and normally
  -- blank; the report renders the LC/BC free limit as an em dash while it is,
  -- because a free limit computed from a missing input is a confidently wrong
  -- number, which is worse than no number.
  lc_bc_utilised_lacs  numeric(14,2),

  entered_by           uuid references auth.users on delete set null,
  entered_at           timestamptz not null default now(),
  updated_by           uuid references auth.users on delete set null,
  updated_at           timestamptz not null default now(),

  -- IS the unique (bank_account_id, balance_date) the report needs, at the cost
  -- of one index rather than two. Same shape as module_visits.
  primary key (bank_account_id, balance_date)
);

comment on table public.daily_report_bank_balances is
  'One hand-typed closing balance per bank account per day. AN ABSENT ROW MEANS NOT RECORDED - Sundays are absent by design. A stored 0.00 means the account genuinely stood at zero. Written only through set_bank_daily_balance().';
comment on column public.daily_report_bank_balances.closing_balance_lacs is
  'Closing balance in rupee lakhs, read off the bank portal. Deliberately NOT Tally book balance, which excludes uncleared cheques and bank-only entries.';

create index if not exists daily_report_bank_balances_date_idx
  on public.daily_report_bank_balances (balance_date desc);


-- ============================================================== RLS ========

alter table public.daily_report_bank_accounts enable row level security;

-- The account list reads openly to signed-in users, like the other masters —
-- a bank's name and IFSC are not the sensitive part.
drop policy if exists daily_report_bank_accounts_select on public.daily_report_bank_accounts;
create policy daily_report_bank_accounts_select
  on public.daily_report_bank_accounts for select to authenticated using (true);

-- Helper calls are wrapped in (select ...) so Postgres hoists them into a
-- one-shot InitPlan instead of re-running them per row.
drop policy if exists daily_report_bank_accounts_write on public.daily_report_bank_accounts;
create policy daily_report_bank_accounts_write
  on public.daily_report_bank_accounts for all to authenticated
  using (
    (select public.is_admin((select auth.uid())))
    or exists (select 1 from public.app_access a
                where a.user_id = (select auth.uid())
                  and a.app_id = 'daily-report'
                  and a.access_level = 'edit')
  )
  with check (
    (select public.is_admin((select auth.uid())))
    or exists (select 1 from public.app_access a
                where a.user_id = (select auth.uid())
                  and a.app_id = 'daily-report'
                  and a.access_level = 'edit')
  );

alter table public.daily_report_bank_balances enable row level security;

-- THE BALANCES ARE NOT OPEN TO EVERY SIGNED-IN USER, unlike the masters.
-- This is the company's live cash position. Reading it requires the module.
drop policy if exists daily_report_bank_balances_select on public.daily_report_bank_balances;
create policy daily_report_bank_balances_select
  on public.daily_report_bank_balances for select to authenticated
  using (
    (select public.is_admin((select auth.uid())))
    or exists (select 1 from public.app_access a
                where a.user_id = (select auth.uid()) and a.app_id = 'daily-report')
  );

-- No insert/update/delete policies at all. Writes go through
-- set_bank_daily_balance() only, so no client can bypass the future-date guard.


-- ========================================================= the writes ======

-- p_closing NULL is a DELETE, not a zero.
-- Without this the only way to undo a mistyped figure is to type 0, which is a
-- lie the report would then print as a real balance. Un-typing must be
-- possible, and it must land the row back in the "not recorded" state.
create or replace function public.set_bank_daily_balance(
  p_bank_account_id uuid,
  p_balance_date    date,
  p_closing         numeric,
  p_lc_bc_utilised  numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  -- The house day boundary. A UTC one would let a 7pm IST entry on 31-Mar land
  -- in the wrong financial year.
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if v_uid is null then
    raise exception 'sign in to record a bank balance';
  end if;

  if not (
    public.is_admin(v_uid)
    or exists (select 1 from public.app_access a
                where a.user_id = v_uid and a.app_id = 'daily-report'
                  and a.access_level = 'edit')
  ) then
    raise exception 'you may not record bank balances';
  end if;

  if not exists (select 1 from public.daily_report_bank_accounts a
                  where a.id = p_bank_account_id and a.active) then
    raise exception 'unknown or inactive bank account';
  end if;

  -- A fat-fingered year would mint a phantom column on every future report.
  if p_balance_date > v_today then
    raise exception 'cannot record a balance for a future date (%)', p_balance_date;
  end if;

  if p_closing is null then
    delete from public.daily_report_bank_balances
     where bank_account_id = p_bank_account_id and balance_date = p_balance_date;
    return;
  end if;

  insert into public.daily_report_bank_balances
    (bank_account_id, balance_date, closing_balance_lacs, lc_bc_utilised_lacs,
     entered_by, updated_by)
  values (p_bank_account_id, p_balance_date, p_closing, p_lc_bc_utilised, v_uid, v_uid)
  on conflict (bank_account_id, balance_date) do update
    set closing_balance_lacs = excluded.closing_balance_lacs,
        lc_bc_utilised_lacs  = excluded.lc_bc_utilised_lacs,
        updated_by           = v_uid,
        updated_at           = now();
end $fn$;

revoke execute on function public.set_bank_daily_balance(uuid, date, numeric, numeric)
  from public, anon;
grant execute on function public.set_bank_daily_balance(uuid, date, numeric, numeric)
  to authenticated;

comment on function public.set_bank_daily_balance(uuid, date, numeric, numeric) is
  'Records one account closing balance for one day. A NULL closing balance DELETES the row, returning the day to "not recorded" - that is how a mistyped figure is un-typed without lying with a zero.';


-- The evening's entries as ONE transaction: either the whole evening lands or
-- none of it does. p_rows is
--   [{"bank_account_id": "...", "balance_date": "2026-09-08",
--     "closing_balance_lacs": 2.37, "lc_bc_utilised_lacs": null}, ...]
create or replace function public.set_bank_daily_balances(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r jsonb;
  n integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'set_bank_daily_balances expects a JSON array';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    perform public.set_bank_daily_balance(
      (r ->> 'bank_account_id')::uuid,
      (r ->> 'balance_date')::date,
      -- nullif on the TEXT form, so a JSON null and an absent key both mean
      -- "clear this cell" rather than erroring on a numeric cast of ''.
      nullif(r ->> 'closing_balance_lacs', '')::numeric,
      nullif(r ->> 'lc_bc_utilised_lacs', '')::numeric);
    n := n + 1;
  end loop;

  return n;
end $fn$;

revoke execute on function public.set_bank_daily_balances(jsonb) from public, anon;
grant execute on function public.set_bank_daily_balances(jsonb) to authenticated;

comment on function public.set_bank_daily_balances(jsonb) is
  'Bulk form of set_bank_daily_balance - the evening entries in one transaction. Returns the number of rows acted on.';


-- ================================================= the completeness ========

-- ONE ROUTINE, THREE CONSUMERS.
-- The nav badge, the report's Bank KPI tile and the entry screen's chip all ask
-- this. If each counted for itself they would drift, and the badge that is
-- supposed to chase a missing number would be the one that is wrong.
create or replace function public.daily_report_balance_status(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_res  jsonb;
begin
  if v_uid is not null
     and not (
       public.is_admin(v_uid)
       or exists (select 1 from public.app_access a
                   where a.user_id = v_uid and a.app_id = 'daily-report')
     ) then
    raise exception 'you do not have access to the Daily Report';
  end if;

  select jsonb_build_object(
           'date',     v_date,
           'expected', count(*),
           'entered',  count(b.bank_account_id),
           'missing',  coalesce(jsonb_agg(
                         jsonb_build_object(
                           'id',          a.id,
                           'short_label', a.short_label,
                           'location',    a.location,
                           'company',     c.alias)
                         order by a.sort_order, a.short_label)
                         filter (where b.bank_account_id is null), '[]'::jsonb))
    into v_res
    from public.daily_report_bank_accounts a
    join public.mst_companies c on c.id = a.company_id
    left join public.daily_report_bank_balances b
           on b.bank_account_id = a.id and b.balance_date = v_date
   where a.active;

  return v_res;
end $fn$;

revoke execute on function public.daily_report_balance_status(date) from public, anon;
grant execute on function public.daily_report_balance_status(date) to authenticated;

comment on function public.daily_report_balance_status(date) is
  'How complete a day bank entry is: expected, entered, and which accounts are still missing. Read by the nav badge, the report KPI tile and the entry screen so the three cannot disagree.';


-- ============================================================ asserts ======

do $check$
declare v_n int;
begin
  select count(*) into v_n from information_schema.tables
   where table_schema = 'public'
     and table_name in ('daily_report_bank_accounts', 'daily_report_bank_balances');
  if v_n <> 2 then
    raise exception 'DR-1: expected both bank tables, found %', v_n;
  end if;

  -- The blank-not-zero invariant IS the NOT NULL on the balance column. If a
  -- later migration relaxes it, "not recorded" and "recorded as nothing"
  -- collapse into one state and the report starts understating cash silently.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = 'daily_report_bank_balances'
                and column_name = 'closing_balance_lacs'
                and is_nullable = 'YES') then
    raise exception 'DR-1: closing_balance_lacs must stay NOT NULL - absence is how a day says "not recorded"';
  end if;
end $check$;
