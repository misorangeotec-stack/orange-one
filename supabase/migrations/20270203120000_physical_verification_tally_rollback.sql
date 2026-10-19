-- Reverses 20270203120000: no step 4, no Tally posting columns.
-- ⚠ Drops any godown / batch splits and voucher numbers already recorded.

begin;

drop function if exists public.pv_tally_unpost(uuid[], text);
drop function if exists public.pv_tally_post(uuid[], text, date);
drop function if exists public.pv_tally_save(jsonb);
drop function if exists public.pv_can_post(uuid);

delete from public.pv_activity where action in ('tally_saved', 'tally_posted', 'tally_unposted');
alter table public.pv_activity drop constraint if exists pv_activity_action_check;
alter table public.pv_activity add constraint pv_activity_action_check
  check (action in ('scheduled', 'rescheduled', 'saved', 'submitted', 'returned', 'accepted'));

drop index if exists public.pv_counts_tally_idx;
alter table public.pv_counts
  drop column if exists tally_posted_at,
  drop column if exists tally_posted_by,
  drop column if exists tally_voucher_date,
  drop column if exists tally_voucher_no,
  drop column if exists tally_alloc;

alter table public.pv_settings drop column if exists tally_ids;

commit;
