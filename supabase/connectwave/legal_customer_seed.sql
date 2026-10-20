-- Seed: the first 20 Legal Customers (list from accounts, 20-10-2026).
-- ⚠️ CONNECTWAVE project, AFTER legal_customer.sql. Idempotent: re-running leaves existing rows alone.
-- Matched to Tally by exact ledger name; where Tally holds more books than the sheet listed, the
-- ledgers with money outstanding were taken (the ₹0 ones were left out).
insert into public.ext_legal_customer (ledger_id, tally_name, company, location, salesperson, reason, checked, match_status, source, updated_by)
values
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-00007285', 'ASTITA INTERNATIONAL', 'O-tec', 'Surat', 'SUHEL', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-000013e1', 'SWASTIK VALUE ADDITION PVT LTD', 'O-tec', 'Surat', 'KARAN SIR', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e-00000cb3', 'SWASTIK VALUE ADDITION PVT LTD', 'Enterprise', 'Surat', 'KARAN SIR', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-00003121', 'GOPAL HOME FURNISHING - MACHINE', 'O-tec', 'Surat', 'KARAN SIR', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('53d35745-5246-4e1a-a27a-d4769f245b50-00000d99', 'GOPAL HOME FURNISHING', 'O-tec', 'Noida', 'KARAN SIR', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('779c26f4-3fd8-46bd-9995-4f9916c98856-00001475', 'GOPAL HOME FURNISHING', 'Enterprise', 'Noida', 'KARAN SIR', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-000034a3', 'GOPAL HOME FURNISHING', 'O-tec', 'Surat', 'KARAN SIR', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e-00000ffe', 'GOPAL HOME FURNISHING', 'Enterprise', 'Surat', 'KARAN SIR', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-0000131a', 'SHREE SAI DIGITEX(SACHIN DIVISION)', 'O-tec', 'Surat', 'KARAN SIR', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-000039c6', 'SHREE SAI DIGITEX (LAXMI DIVISION)', 'O-tec', 'Surat', 'KARAN SIR', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-00001188', 'RAINBOW DIGITAL PRINTS', 'O-tec', 'Surat', 'NAKUL JI', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-000010a3', 'PANACHE CREATION', 'O-tec', 'Surat', 'KARAN SIR', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e-00000c83', 'PANACHE CREATION', 'Enterprise', 'Surat', 'KARAN SIR', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-00007216', 'SHREE SHYAM CREATION', 'O-tec', 'Surat', 'SUHEL', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('53d35745-5246-4e1a-a27a-d4769f245b50-000000e5', 'NARAYANI UDYOG', 'O-tec', 'Noida', 'KHURSHID JI', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-00000ffc', 'NARAYANI UDYOG MACHINE', 'O-tec', 'Surat', 'KHURSHID JI', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-00003639', 'UMA CREATION', 'O-tec', 'Surat', 'NAKUL JI', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-0000368e', 'ALOK FABRICS', 'O-tec', 'Surat', 'DHANANJAY', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-0000751e', 'JAY DIGI TEX', 'O-tec', 'Surat', 'SUHEL', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026'),
  ('a4e100d1-3b6f-4193-876a-c754f1a74552-00007735', 'AMAR CREATION', 'O-tec', 'Surat', 'PURAV SHAH', 'LEGAL', true, 'guid_matched', 'legal_sheet', 'seed 20-10-2026')
on conflict (ledger_id) do nothing;

-- Verify: select count(*) from public.ext_legal_customer;   -- 20
