-- ===========================================================================
-- DAILY REPORT (DR-1) — the credit-limit block, typed daily, per company.
--
-- WHY
--   The top-right table of the client's evening sheet (DAILY REPORT-08.09.26)
--   is the CC limit block. It has never shown anything, for three reasons that
--   no amount of typing into the account master would fix:
--
--     1. It is per COMPANY, and the account master is per ACCOUNT. The sheet
--        prints one AXIS row for the whole of Orange O Tec.
--     2. Two of its figures change DAILY — LC/BC utilised and CC limit held by
--        bank — and a column on a master keeps no history, so yesterday's
--        figure is overwritten and a past report cannot be re-rendered.
--     3. Its "available balance" is the company's bank total for the day,
--        which is derived, not typed.
--
--   So this is a dated table keyed on entity + bank + day. Of the sheet's seven
--   columns only four are data, and they live here; the other three are worked
--   out in the browser (lib/aggregate.ts, facilityFor) from these and from
--   daily_report_bank_balances:
--     available balance = the company's bank total        (2.37 + 0.08 = 2.45)
--     free limit        = LC/BC limit − LC/BC utilised     (5.00 − 4.78 = 0.22)
--     available CC      = CC limit − held by bank          (44.50 − 4.50 = 40.00)
--
-- ⚠ KEYED ON THE ENTITY ALIAS, NEVER ON company_id.
--   mst_companies is per Tally BOOK. O-tec and Enterprise each have a Surat and
--   a Noida book, so a company_id key gives five CC rows where the sheet has
--   three companies, and splits Orange O Tec's cash in two. The alias
--   ("O-tec", "Enterprise", "Colorix") is what the report already groups by.
--   There is deliberately no location column either: Delhi is a reporting
--   location, not a book, and a facility is sanctioned to a company.
--
-- ⚠ IN RUPEE LAKHS, like every money column in this module. The sheet prints
--   "(IN CR.)" under its available-balance column while the figure there is the
--   lakh bank total. Unconfirmed with the client as at 17-09-2026 — see DR-1.
--
-- The existing per-account columns (daily_report_bank_accounts.cc_limit_lacs,
-- lc_bc_limit_lacs, hold_by_bank_lacs and daily_report_bank_balances.
-- lc_bc_utilised_lacs) are left exactly where they are. The screens stop
-- reading and writing them; the database keeps them. Additive only.
--
-- Reuses public.is_admin(uuid) and public.set_bank_daily_balances(jsonb).
--
-- Reversal: run 20261125120000_dr1_cc_limits_rollback.sql, or
--   drop function if exists public.set_daily_report_evening(jsonb, jsonb);
--   drop function if exists public.set_cc_daily_limits(jsonb);
--   drop function if exists public.set_cc_daily_limit(text, text, date, numeric, numeric, numeric, numeric);
--   drop table if exists public.daily_report_cc_limits;
-- ===========================================================================


-- ============================================================ the table =====

create table if not exists public.daily_report_cc_limits (
  -- mst_companies.alias. Not a foreign key: the alias is shared by two book
  -- rows, so it is not unique there. The writer checks it names a company that
  -- holds an active bank account, which is the question that matters here.
  entity_alias         text not null check (btrim(entity_alias) <> ''),

  -- A REAL COLUMN, NOT AN ASSUMPTION. The sheet shows Axis only, but Orange O
  -- Tec also holds an ICICI cash-credit account — a second bank's facility has
  -- to be a second row, not a code change. Upper-case and trimmed by
  -- constraint, so "Axis" and "AXIS" can never become two banks.
  bank                 text not null default 'AXIS'
                         check (bank <> '' and bank = upper(btrim(bank))),

  balance_date         date not null,

  -- Every figure is NULLABLE, and NULL is UNKNOWN — never zero. A free limit
  -- worked out from a blank utilised figure is confidently wrong, so the
  -- report prints a dash wherever an input is NULL. A stored 0.00 is a real
  -- zero: a nil hold, a fully drawn line.
  cc_limit_lacs        numeric(14,2) check (cc_limit_lacs >= 0),
  lc_bc_limit_lacs     numeric(14,2) check (lc_bc_limit_lacs >= 0),
  lc_bc_utilised_lacs  numeric(14,2) check (lc_bc_utilised_lacs >= 0),
  hold_by_bank_lacs    numeric(14,2) check (hold_by_bank_lacs >= 0),

  entered_by           uuid references auth.users on delete set null,
  entered_at           timestamptz not null default now(),
  updated_by           uuid references auth.users on delete set null,
  updated_at           timestamptz not null default now(),

  primary key (entity_alias, bank, balance_date),

  -- AN ALL-BLANK ROW CANNOT EXIST. The only way this table says "nobody
  -- recorded this company's facility that day" is for the row to be ABSENT —
  -- the same rule as the balances table, whose NOT NULL closing balance plays
  -- this part. The writer deletes rather than storing four NULLs.
  constraint daily_report_cc_limits_not_empty check (
    num_nonnulls(cc_limit_lacs, lc_bc_limit_lacs, lc_bc_utilised_lacs, hold_by_bank_lacs) > 0
  )
);

comment on table public.daily_report_cc_limits is
  'The Daily Report credit-limit block: one row per company (mst_companies.alias) per bank per day, in rupee lakhs. AN ABSENT ROW MEANS NOT RECORDED. NULL figures are unknown, never zero. Written only through set_cc_daily_limit().';
comment on column public.daily_report_cc_limits.entity_alias is
  'mst_companies.alias - the entity, not the Tally book. O-tec and Enterprise each span two books; keying on company_id would split them.';
comment on column public.daily_report_cc_limits.bank is
  'Upper-case bank name, AXIS by default. A second bank facility for the same company is a second row.';

create index if not exists daily_report_cc_limits_date_idx
  on public.daily_report_cc_limits (balance_date desc);


-- ============================================================== RLS ========

alter table public.daily_report_cc_limits enable row level security;

-- The same gate as daily_report_bank_balances: this is the company's borrowing
-- position, so reading it requires the module, at any level.
drop policy if exists daily_report_cc_limits_select on public.daily_report_cc_limits;
create policy daily_report_cc_limits_select
  on public.daily_report_cc_limits for select to authenticated
  using (
    (select public.is_admin((select auth.uid())))
    or exists (select 1 from public.app_access a
                where a.user_id = (select auth.uid()) and a.app_id = 'daily-report')
  );

-- No insert/update/delete policies at all. Writes go through
-- set_cc_daily_limit() only, so no client can bypass the future-date guard.


-- ========================================================= the writes ======

-- Mirrors set_bank_daily_balance line for line. Where that routine's NULL
-- closing balance deletes the row, here it is all four figures NULL: un-typing
-- a company's block must land it back in "not recorded", not store a zero.
create or replace function public.set_cc_daily_limit(
  p_entity_alias   text,
  p_bank           text,
  p_balance_date   date,
  p_cc_limit       numeric,
  p_lc_bc_limit    numeric,
  p_lc_bc_utilised numeric,
  p_hold_by_bank   numeric)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_bank  text := upper(btrim(coalesce(nullif(btrim(p_bank), ''), 'AXIS')));
begin
  if v_uid is null then
    raise exception 'sign in to record a credit limit';
  end if;
  if not (
    public.is_admin(v_uid)
    or exists (select 1 from public.app_access a
                where a.user_id = v_uid and a.app_id = 'daily-report'
                  and a.access_level = 'edit')
  ) then
    raise exception 'you may not record credit limits';
  end if;
  if not exists (select 1 from public.daily_report_bank_accounts a
                   join public.mst_companies c on c.id = a.company_id
                  where c.alias = p_entity_alias and a.active) then
    raise exception 'unknown company, or one with no active bank account (%)', p_entity_alias;
  end if;
  -- A fat-fingered year would mint a phantom row on every future report.
  if p_balance_date > v_today then
    raise exception 'cannot record a credit limit for a future date (%)', p_balance_date;
  end if;
  -- least() ignores NULLs, so this asks only about the figures actually given.
  if least(p_cc_limit, p_lc_bc_limit, p_lc_bc_utilised, p_hold_by_bank) < 0 then
    raise exception 'a limit, utilised or held figure cannot be negative';
  end if;

  if p_cc_limit is null and p_lc_bc_limit is null
     and p_lc_bc_utilised is null and p_hold_by_bank is null then
    delete from public.daily_report_cc_limits
     where entity_alias = p_entity_alias and bank = v_bank and balance_date = p_balance_date;
    return;
  end if;

  insert into public.daily_report_cc_limits
    (entity_alias, bank, balance_date, cc_limit_lacs, lc_bc_limit_lacs,
     lc_bc_utilised_lacs, hold_by_bank_lacs, entered_by, updated_by)
  values (p_entity_alias, v_bank, p_balance_date, p_cc_limit, p_lc_bc_limit,
          p_lc_bc_utilised, p_hold_by_bank, v_uid, v_uid)
  on conflict (entity_alias, bank, balance_date) do update
    set cc_limit_lacs       = excluded.cc_limit_lacs,
        lc_bc_limit_lacs    = excluded.lc_bc_limit_lacs,
        lc_bc_utilised_lacs = excluded.lc_bc_utilised_lacs,
        hold_by_bank_lacs   = excluded.hold_by_bank_lacs,
        updated_by          = v_uid,
        updated_at          = now();
end $fn$;

revoke execute on function public.set_cc_daily_limit(text, text, date, numeric, numeric, numeric, numeric)
  from public, anon;
grant execute on function public.set_cc_daily_limit(text, text, date, numeric, numeric, numeric, numeric)
  to authenticated;

comment on function public.set_cc_daily_limit(text, text, date, numeric, numeric, numeric, numeric) is
  'Records one company credit-limit block for one bank and day. All four figures NULL DELETES the row, returning the day to "not recorded" - that is how a mistyped block is un-typed without lying with a zero.';


-- p_rows is
--   [{"entity_alias": "O-tec", "bank": "AXIS", "balance_date": "2026-09-08",
--     "cc_limit_lacs": 44.5, "lc_bc_limit_lacs": 5, "lc_bc_utilised_lacs": 4.78,
--     "hold_by_bank_lacs": 4.5}, ...]
create or replace function public.set_cc_daily_limits(p_rows jsonb)
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
    raise exception 'set_cc_daily_limits expects a JSON array';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    perform public.set_cc_daily_limit(
      r ->> 'entity_alias',
      r ->> 'bank',
      (r ->> 'balance_date')::date,
      -- nullif on the TEXT form so a JSON null and an absent key both mean blank.
      nullif(r ->> 'cc_limit_lacs', '')::numeric,
      nullif(r ->> 'lc_bc_limit_lacs', '')::numeric,
      nullif(r ->> 'lc_bc_utilised_lacs', '')::numeric,
      nullif(r ->> 'hold_by_bank_lacs', '')::numeric);
    n := n + 1;
  end loop;
  return n;
end $fn$;

revoke execute on function public.set_cc_daily_limits(jsonb) from public, anon;
grant execute on function public.set_cc_daily_limits(jsonb) to authenticated;

comment on function public.set_cc_daily_limits(jsonb) is
  'Bulk form of set_cc_daily_limit. Returns the number of rows acted on.';


-- THE EVENING IN ONE TRANSACTION. The entry screen's Save all writes the
-- closing balances and the credit-limit blocks together, and the rule that
-- made set_bank_daily_balances a single transaction applies to both: a
-- half-saved evening is worse than an unsaved one. Two RPC calls would be two
-- transactions, so this wraps the two bulk writers in one.
create or replace function public.set_daily_report_evening(p_balances jsonb, p_cc_limits jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return public.set_bank_daily_balances(coalesce(p_balances, '[]'::jsonb))
       + public.set_cc_daily_limits(coalesce(p_cc_limits, '[]'::jsonb));
end $fn$;

revoke execute on function public.set_daily_report_evening(jsonb, jsonb) from public, anon;
grant execute on function public.set_daily_report_evening(jsonb, jsonb) to authenticated;

comment on function public.set_daily_report_evening(jsonb, jsonb) is
  'The evening entry screen save: closing balances (set_bank_daily_balances) and credit-limit blocks (set_cc_daily_limits) in ONE transaction. Returns the rows acted on across both.';


-- ============================================================ asserts ======

do $check$
begin
  if to_regclass('public.daily_report_cc_limits') is null then
    raise exception 'DR-1 CC: daily_report_cc_limits was not created';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.daily_report_cc_limits'::regclass) then
    raise exception 'DR-1 CC: RLS is off on daily_report_cc_limits';
  end if;

  -- A write policy would let a client skip the future-date guard.
  if exists (select 1 from pg_policy
              where polrelid = 'public.daily_report_cc_limits'::regclass and polcmd <> 'r') then
    raise exception 'DR-1 CC: daily_report_cc_limits must have no write policy';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('set_cc_daily_limit', 'set_cc_daily_limits', 'set_daily_report_evening')
                and not p.prosecdef) then
    raise exception 'DR-1 CC: every writer must be SECURITY DEFINER';
  end if;
end $check$;
