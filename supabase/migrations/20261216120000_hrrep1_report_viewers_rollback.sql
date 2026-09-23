-- Rollback for HRREP-1.
--
-- The table holds permissions an admin ticked by hand, so dropping it silently would
-- throw away a decision nobody has a copy of. Print the list first, then drop.
do $$
declare n int;
begin
  select count(*) into n from public.hr_report_viewers;
  raise notice 'HRREP-1 rollback: dropping hr_report_viewers, which holds % row(s).', n;
  if n > 0 then
    raise notice 'Viewers being removed: %', (
      select string_agg(coalesce(p.name, v.user_id::text), ', ')
      from public.hr_report_viewers v
      left join public.profiles p on p.id = v.user_id
    );
  end if;
end $$;

drop policy if exists hr_report_viewers_select on public.hr_report_viewers;
drop policy if exists hr_report_viewers_insert on public.hr_report_viewers;
drop policy if exists hr_report_viewers_update on public.hr_report_viewers;
drop policy if exists hr_report_viewers_delete on public.hr_report_viewers;
drop table if exists public.hr_report_viewers;
