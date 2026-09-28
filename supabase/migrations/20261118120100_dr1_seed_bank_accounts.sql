-- ===========================================================================
-- DAILY REPORT (DR-1) — seed the eleven bank accounts.
--
-- SOURCE OF TRUTH FOR THE ACCOUNT ITSELF is the finance team's own bank-details
-- sheet (beneficiary, account number, IFSC, bank, location). The Tally ledger
-- GUID beside it is a HUMAN MATCH, done once, by laying that sheet next to the
-- bank ledgers in ConnectWave:
--
--   select d.guid, d.ledger, d.sub_group
--     from public.v_ledger_detail d
--    where d.tenant_id = 'acct_orange::<company guid>'
--      and d.sub_group in ('Bank Accounts', 'Bank OD A/c', 'Bank OCC A/c');
--
-- ⚠ THE MATCH IS NOT AUTOMATABLE AND MUST NOT BE RE-DERIVED BY SUBSTRING.
--   Some ledgers carry the account number in the name ("AXIS BANK LTD.
--   919020047722830 (DELHI)"), some carry only the last four digits
--   ("AXIS BANK (CURRENT A/C)-3024"), and some carry nothing at all
--   ("AXIS BANK LTD (CC A/C)"). A substring match would link the first group,
--   silently miss the third, and is exactly the name-keyed failure that
--   collection_refresh_use_ledger_id.sql was written to retire. Each row below
--   records HOW it was matched so a later reader can re-check the weak ones
--   rather than trusting all eleven equally.
--
-- ⚠ ONE ACCOUNT HAS NO LEDGER AT ALL. Colorix's Axis account (919020080469516)
--   has no counterpart in the Colorix Tally book, which carries only
--   "YES BANK (001163400001473)". It is seeded UNLINKED rather than forced onto
--   the wrong ledger. Nothing in Phase 1 reads the link — it exists for the
--   later Tally-book-balance comparison — so an unlinked account still records
--   and reports its typed balance normally. The master screen shows it as
--   "not linked" so the gap is visible rather than assumed away.
--
-- ⚠ LIMITS ARE DELIBERATELY NOT SEEDED. The reference sheet's facility block
--   carries CC 44.50 / LC-BC 5.00 / held-by-bank 4.50 against "AXIS", but its
--   own header says "(IN CR.)" while every other figure on the page is in
--   lakhs, and 44.50 works as neither (the Axis CC ledger alone stands at
--   7.47 Cr drawn, so a 44.50 LAKH limit is impossible, and 44.50 Cr is larger
--   than the business). Seeding either reading would put a wrong number on a
--   CFO's page. They are typed on the master screen once the unit is confirmed;
--   until then the facility block renders an em dash, which is honest.
--
-- Company rows are joined by mst_companies.tally_guid so no portal uuid is
-- hard-coded here and the seed survives a rebuilt masters table.
--
-- Reversal: 20261118120100_dr1_seed_bank_accounts_rollback.sql
-- ===========================================================================

insert into public.daily_report_bank_accounts (
  company_id, location, bank_name, branch, account_no, ifsc, account_type,
  short_label, tally_ledger_guid, tally_ledger_name, tally_tenant_id,
  sort_order, notes)
select c.id, v.location, v.bank_name, v.branch, v.account_no, v.ifsc, v.account_type,
       v.short_label, v.ledger_guid, v.ledger_name,
       case when v.ledger_guid is null then null
            else 'acct_orange::' || v.company_guid end,
       v.sort_order, v.notes
  from (values
    -- ORANGE O TEC PVT LTD ---------------------------------------------------
    ('a4e100d1-3b6f-4193-876a-c754f1a74552', 'Surat', 'AXIS',  'Surat (CC)',
     '919030077980346', 'UTIB0003360', 'cc', 'AXIS CC 0346',
     'a4e100d1-3b6f-4193-876a-c754f1a74552-00000a4f', 'AXIS BANK LTD (CC A/C)', 10,
     'Matched by elimination: the only Axis cash-credit ledger in the O-tec Surat book. The ledger name carries no account number.'),

    ('a4e100d1-3b6f-4193-876a-c754f1a74552', 'Surat', 'AXIS',  'Surat (Current)',
     '919020047723024', 'UTIB0003360', 'current', 'AXIS CA 3024',
     'a4e100d1-3b6f-4193-876a-c754f1a74552-00000a4a', 'AXIS BANK (CURRENT A/C)-3024', 20,
     'Certain: the ledger name ends -3024, the last four digits of the account.'),

    ('a4e100d1-3b6f-4193-876a-c754f1a74552', 'Surat', 'ICICI', 'Surat',
     '019351000014', 'ICIC0000193', 'cc', 'ICICI 0014',
     'a4e100d1-3b6f-4193-876a-c754f1a74552-00000d7e', 'ICICI BANK (CC A/C)', 30,
     'WEAKEST MATCH — by elimination only: the sole ICICI ledger in the O-tec Surat book. Its name carries no number, and the sheet does not say this account is a CC. Re-check before relying on the Tally comparison.'),

    ('53d35745-5246-4e1a-a27a-d4769f245b50', 'Noida', 'AXIS',  'Noida',
     '924020069048473', 'UTIB0003360', 'current', 'AXIS 8473',
     '53d35745-5246-4e1a-a27a-d4769f245b50-000009ad', 'AXIS BANK LTD.', 40,
     'Matched by elimination: the O-tec Noida book holds two Axis ledgers and the other is explicitly the Delhi one.'),

    -- Delhi has NO Tally book of its own; this account lives in the O-tec Noida
    -- book, which is why company_id says Noida and location says Delhi.
    ('53d35745-5246-4e1a-a27a-d4769f245b50', 'Delhi', 'AXIS',  'Delhi',
     '919020047722830', 'UTIB0003360', 'current', 'AXIS 22830',
     '53d35745-5246-4e1a-a27a-d4769f245b50-00001b13', 'AXIS BANK LTD. 919020047722830 (DELHI)', 50,
     'Certain: the full account number is in the ledger name. Booked inside the O-tec NOIDA company because Delhi has no Tally book of its own.'),

    -- ORANGE O TEC ENTERPRISES PVT LTD --------------------------------------
    ('59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e', 'Surat', 'AXIS',  'Surat (CC)',
     '926030022877763', 'UTIB0000047', 'cc', 'AXIS CC 7763',
     '59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e-000011ef', 'AXIS BANK LTD (CC A/C)-7763', 60,
     'Certain: the ledger name ends -7763, the last four digits of the account.'),

    ('59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e', 'Surat', 'ICICI', 'Surat',
     '218705001278', 'ICIC0002187', 'current', 'ICICI 1278',
     '59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e-000000e1', 'ICICI BANK (CURRENT A/C)', 70,
     'Matched by elimination: the Enterprise Surat book holds two ICICI current ledgers and the other names account 802505000011 in full.'),

    ('59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e', 'Surat', 'ICICI', 'Surat (new)',
     '802505000011', 'ICIC0008025', 'od', 'ICICI 0011',
     '59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e-00000183', 'ICICI BANK(CURRENT A/C)802505000011', 80,
     'Certain: the full account number is in the ledger name. Typed od, not current, because Tally files it under Bank OD A/c despite the ledger name saying CURRENT.'),

    ('779c26f4-3fd8-46bd-9995-4f9916c98856', 'Noida', 'AXIS',  'Noida',
     '926020017333080', 'UTIB0005112', 'current', 'AXIS 3080',
     '779c26f4-3fd8-46bd-9995-4f9916c98856-0000161b', 'AXIS BANK-3080(CA)', 90,
     'Matched on -3080. NOTE: the Enterprise SURAT book mirrors the same physical account as "AXIS BANK (CURRENT AC)3080". Linked to the NOIDA ledger because the bank sheet files this account under Noida. If the Tally comparison later reads short, check whether postings are split across both books.'),

    ('779c26f4-3fd8-46bd-9995-4f9916c98856', 'Noida', 'ICICI', 'Noida',
     '081605013289', 'ICIC0000816', 'current', 'ICICI 3289',
     '779c26f4-3fd8-46bd-9995-4f9916c98856-000001f4', 'ICICI BANK-3289 (CURRENT A/C)', 100,
     'Certain: the ledger name carries -3289, the last four digits of the account.'),

    -- COLORIX DIGITAL PRINTING SOLUTIONS LLP --------------------------------
    ('393ee4bd-4fdc-4aed-ae88-e2ff1394927a', 'Surat', 'AXIS',  'Surat',
     '919020080469516', 'UTIB0003360', 'current', 'AXIS 9516',
     null, null, 110,
     'NOT LINKED. The Colorix Tally book carries one bank ledger, YES BANK (001163400001473), and no Axis ledger at all. Left unlinked rather than forced onto the wrong ledger; the typed balance still records and reports normally.')
  ) as v(company_guid, location, bank_name, branch, account_no, ifsc, account_type,
         short_label, ledger_guid, ledger_name, sort_order, notes)
  join public.mst_companies c on c.tally_guid = v.company_guid
on conflict on constraint daily_report_bank_accounts_label_key do nothing;


-- ============================================================ asserts ======

do $check$
declare
  v_n        int;
  v_delhi    int;
  v_unlinked text;
begin
  select count(*) into v_n from public.daily_report_bank_accounts where active;
  -- A company_guid that failed to match mst_companies would silently drop its
  -- rows from the join, so this count also proves every entity resolved.
  if v_n <> 11 then
    raise exception 'DR-1 seed: expected 11 active bank accounts, found % (a company tally_guid may not have matched mst_companies)', v_n;
  end if;

  -- If this ever fails, someone has minted a Delhi company row and the whole
  -- account-location-versus-company-location model needs revisiting.
  select count(*) into v_delhi
    from public.daily_report_bank_accounts where active and location = 'Delhi';
  if v_delhi <> 1 then
    raise exception 'DR-1 seed: expected exactly 1 Delhi account, found %', v_delhi;
  end if;

  -- Deliberately a NOTICE, not an exception. An unlinked account is a known,
  -- recorded state (Colorix), not a broken seed — and Phase 1 reads nothing
  -- through the link. Raising here would block a correct migration.
  select string_agg(short_label, ', ' order by sort_order) into v_unlinked
    from public.daily_report_bank_accounts
   where active and tally_ledger_guid is null;
  if v_unlinked is not null then
    raise notice 'DR-1 seed: % has no Tally ledger link (expected: AXIS 9516, Colorix)', v_unlinked;
  end if;
end $check$;
