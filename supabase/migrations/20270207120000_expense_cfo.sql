-- Expense Analysis (CFO) - the CFO expense workbook as a hub report.
--
-- Filled by tools/expense_cfo_loader.py (local, nightly + on demand), which reads the
-- ConnectWave Tally mirror, classifies every expense-ledger line the way the refresh-expenses
-- Excel does, and proves the result against Tally's own Trial Balance before it is shown.
-- The page reads only the newest load whose status is 'tied' or 'not_tied'; a 'not_tied'
-- load is shown stamped DRAFT with every gap listed.
--
-- Why a hub table and not a ConnectWave rpt_* object: there is no DB access to ConnectWave,
-- and its rpt_expense_line drops ledgers under Colorix's "OTHER EXPENSES" group (Rs 1,35,003.53
-- on 23-Oct-2026), so the lines are rebuilt from the raw voucher lines instead.
--
-- Additive only. Rollback: 20270207120000_expense_cfo_rollback.sql

create table if not exists public.expense_cfo_load (
  load_id      bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  date_to      date not null,
  status       text not null default 'loading'
               check (status in ('loading', 'tied', 'not_tied', 'failed')),
  -- per company: lines, tb_as_of, tb_captured_at, gaps, notes
  companies    jsonb not null default '{}'::jsonb
);

create table if not exists public.expense_cfo_line (
  load_id        bigint not null references public.expense_cfo_load(load_id) on delete cascade,
  company        text not null,
  entity         text not null,
  vch_date       date not null,
  voucher_guid   text not null,
  list_key       text not null,
  line_no        integer not null,
  voucher_type   text not null,
  voucher_no     text not null default '',
  ledger_guid    text not null,
  gl             text not null,
  exp_type       text not null check (exp_type in ('DIRECT', 'INDIRECT')),
  main_group     text not null,
  sub_group      text not null,
  sub_sub_group  text not null,
  party          text not null default '',
  party_source   text not null default '',
  narration      text not null default '',
  amount         numeric(18, 2) not null,     -- spend positive, reversals negative
  is_sales_vch   boolean not null default false,
  component      text not null default '',
  primary key (load_id, voucher_guid, list_key, line_no)
);

create index if not exists expense_cfo_line_load_date on public.expense_cfo_line (load_id, vch_date);

-- One row per TB comparison: the Direct / Indirect totals and every first-level child under them.
create table if not exists public.expense_cfo_tie (
  load_id      bigint not null references public.expense_cfo_load(load_id) on delete cascade,
  company      text not null,
  exp_type     text not null,
  level        text not null check (level in ('group', 'child')),
  name         text not null,
  tb           numeric(18, 2) not null,
  lines        numeric(18, 2) not null,
  gap          numeric(18, 2) not null,
  as_of        date not null,
  captured_at  timestamptz not null,
  primary key (load_id, company, exp_type, level, name)
);

alter table public.expense_cfo_load enable row level security;
alter table public.expense_cfo_line enable row level security;
alter table public.expense_cfo_tie  enable row level security;

-- Company expense detail is not open to every signed-in user: it needs the Outstanding
-- Dashboard app (where Finance reports live), same pattern as daily_report_bank_balances.
-- No insert/update/delete policies: only the loader writes, as the database owner.
do $$
declare t text;
begin
  foreach t in array array['expense_cfo_load', 'expense_cfo_line', 'expense_cfo_tie'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$
      create policy %I on public.%I for select to authenticated
      using (
        (select public.is_admin((select auth.uid())))
        or exists (select 1 from public.app_access a
                    where a.user_id = (select auth.uid()) and a.app_id = 'outstanding-dashboard')
      )$p$, t || '_select', t);
    -- Supabase's default privileges hand authenticated INSERT..TRUNCATE on every new table, and
    -- TRUNCATE is not subject to RLS - so take everything back and grant SELECT alone.
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
