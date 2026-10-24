-- Red Mark: a TYPE on every row — Red Mark or Legal (2026-10-21).
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange),
--    NOT the Orange One identity project. Apply through the management API or the SQL editor, in ONE
--    transaction. Deploy this BEFORE the muster-write Edge Function that writes the column, and before
--    the frontend that reads it.
--
-- WHY
--   Decided in the 21-10-2026 meeting: there is no separate Legal page. Legal customers live on the
--   Red Mark master — one packet, "Red Mark + Legal" — and each row says which of the two it is. Both
--   types count as Red Mark everywhere they did before (badge, KPI, Red Mark filter, the report); the
--   type is what the Category filter on the outstanding pages uses to show just one of them.
--
-- WHAT IT DOES
--   1. Adds ext_redmark.mark_type, 'redmark' | 'legal', NOT NULL DEFAULT 'redmark'. Every existing row
--      reads 'redmark' the moment the column exists — nothing about it changes.
--   2. Marks the 20 ledgers on accounts' legal list (21-10-2026) as 'legal'. All 20 are already on the
--      master (checked 21-10-2026: 51 rows, 0 cleared), so this is an UPDATE only — nothing is added.
--
-- Reversal: redmark_type_rollback.sql.

alter table public.ext_redmark
  add column if not exists mark_type text not null default 'redmark';

do $$
begin
  alter table public.ext_redmark
    add constraint ext_redmark_mark_type_check check (mark_type in ('redmark', 'legal'));
exception
  when duplicate_object then null;   -- already applied
end $$;

comment on column public.ext_redmark.mark_type is
  'redmark | legal. Both are on the Red Mark + Legal master and both set Customer.blocked; the type only splits them, for the Category filter and the report. Written only by the muster-write Edge Function.';

-- The accounts legal list. Matched to Tally by exact ledger name; where Tally has more books than the
-- sheet listed, the ledgers with money outstanding were taken (the ₹0 ones were left out).
update public.ext_redmark
   set mark_type = 'legal', updated_by = 'legal list 21-10-2026'
 where ledger_id in (
    'a4e100d1-3b6f-4193-876a-c754f1a74552-00007285'   -- ASTITA INTERNATIONAL (O-tec Surat),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-000013e1'   -- SWASTIK VALUE ADDITION PVT LTD (O-tec Surat),
    '59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e-00000cb3'   -- SWASTIK VALUE ADDITION PVT LTD (Enterprise Surat),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-00003121'   -- GOPAL HOME FURNISHING - MACHINE (O-tec Surat),
    '53d35745-5246-4e1a-a27a-d4769f245b50-00000d99'   -- GOPAL HOME FURNISHING (O-tec Noida),
    '779c26f4-3fd8-46bd-9995-4f9916c98856-00001475'   -- GOPAL HOME FURNISHING (Enterprise Noida),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-000034a3'   -- GOPAL HOME FURNISHING (O-tec Surat),
    '59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e-00000ffe'   -- GOPAL HOME FURNISHING (Enterprise Surat),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-0000131a'   -- SHREE SAI DIGITEX(SACHIN DIVISION) (O-tec Surat),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-000039c6'   -- SHREE SAI DIGITEX (LAXMI DIVISION) (O-tec Surat),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-00001188'   -- RAINBOW DIGITAL PRINTS (O-tec Surat),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-000010a3'   -- PANACHE CREATION (O-tec Surat),
    '59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e-00000c83'   -- PANACHE CREATION (Enterprise Surat),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-00007216'   -- SHREE SHYAM CREATION (O-tec Surat),
    '53d35745-5246-4e1a-a27a-d4769f245b50-000000e5'   -- NARAYANI UDYOG (O-tec Noida),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-00000ffc'   -- NARAYANI UDYOG MACHINE (O-tec Surat),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-00003639'   -- UMA CREATION (O-tec Surat),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-0000368e'   -- ALOK FABRICS (O-tec Surat),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-0000751e'   -- JAY DIGI TEX (O-tec Surat),
    'a4e100d1-3b6f-4193-876a-c754f1a74552-00007735'   -- AMAR CREATION (O-tec Surat)
 );

notify pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
--   select mark_type, count(*) from public.ext_redmark group by 1 order by 1;   -- legal 20, redmark 31
