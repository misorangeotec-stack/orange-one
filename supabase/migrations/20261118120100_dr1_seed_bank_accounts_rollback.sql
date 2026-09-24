-- ===========================================================================
-- ROLLBACK of 20261118120100_dr1_seed_bank_accounts.sql
--
-- Removes ONLY the eleven seeded accounts, matched on (company, location,
-- short_label) — the same key the seed used for its ON CONFLICT. An account
-- added by hand afterwards is left alone.
--
-- ⚠ REFUSES TO RUN IF ANY BALANCE HAS BEEN TYPED against a seeded account.
--   daily_report_bank_balances references these rows ON DELETE RESTRICT, so the
--   delete would fail anyway — but with a foreign-key error that says nothing
--   useful. The check below names the accounts and tells you what to do, and it
--   runs BEFORE the delete rather than inside its lock.
--   To discard those balances deliberately, run the whole-feature rollback
--   (20261118120000_dr1_daily_report_banks_rollback.sql), which says so.
-- ===========================================================================

do $check$
declare v_blocked text;
begin
  select string_agg(distinct a.short_label, ', ') into v_blocked
    from public.daily_report_bank_balances b
    join public.daily_report_bank_accounts a on a.id = b.bank_account_id
   where a.notes is not null;
  if v_blocked is not null then
    raise exception
      'DR-1 seed rollback: balances have been typed against % — deactivate those accounts instead, or run the full feature rollback to discard the balances',
      v_blocked;
  end if;
end $check$;

delete from public.daily_report_bank_accounts a
 using public.mst_companies c
 where c.id = a.company_id
   and (c.tally_guid, a.location, a.short_label) in (
     ('a4e100d1-3b6f-4193-876a-c754f1a74552', 'Surat', 'AXIS CC 0346'),
     ('a4e100d1-3b6f-4193-876a-c754f1a74552', 'Surat', 'AXIS CA 3024'),
     ('a4e100d1-3b6f-4193-876a-c754f1a74552', 'Surat', 'ICICI 0014'),
     ('53d35745-5246-4e1a-a27a-d4769f245b50', 'Noida', 'AXIS 8473'),
     ('53d35745-5246-4e1a-a27a-d4769f245b50', 'Delhi', 'AXIS 22830'),
     ('59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e', 'Surat', 'AXIS CC 7763'),
     ('59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e', 'Surat', 'ICICI 1278'),
     ('59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e', 'Surat', 'ICICI 0011'),
     ('779c26f4-3fd8-46bd-9995-4f9916c98856', 'Noida', 'AXIS 3080'),
     ('779c26f4-3fd8-46bd-9995-4f9916c98856', 'Noida', 'ICICI 3289'),
     ('393ee4bd-4fdc-4aed-ae88-e2ff1394927a', 'Surat', 'AXIS 9516')
   );
