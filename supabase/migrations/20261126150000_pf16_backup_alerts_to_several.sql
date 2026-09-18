-- ===========================================================================
-- PF-16 — a failed night alerts SEVERAL people, not one.
--
-- Asked 18-09-2026: the alert must reach support@orangeonehub.com AND
-- e.techie4@gmail.com. The mailer has no Cc (send-email builds To / Reply-To
-- only), so "several recipients" means one email_outbox row per address — the
-- house pattern. private.backup_config.alert_email now holds a comma-separated
-- list; this replaces backup_watchdog() with the same rules, looping over it.
--
-- Additive in effect: only the function body changes; one address still works.
-- Reversal: re-run the backup_watchdog() definition in 20261126120000.
-- ===========================================================================

create or replace function public.backup_watchdog()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      record;
  v_ist    timestamp := now() at time zone 'Asia/Kolkata';
  v_date   date      := (now() at time zone 'Asia/Kolkata')::date;
  v_last   public.backup_runs%rowtype;
  v_good   public.backup_runs%rowtype;
  v_pct    numeric;
  v_body   text;
  v_to     text[];
  v_addr   text;
  v_subj   text;
begin
  select * into cfg from private.backup_config where id = 1;
  if not found or not cfg.enabled then
    return;
  end if;

  select array_agg(a) into v_to
    from (select btrim(x) as a
            from regexp_split_to_table(coalesce(cfg.alert_email, ''), '[,;]') x) s
   where a like '%_@_%';
  if v_to is null then
    return;                                   -- nobody to tell: stay quiet
  end if;
  if v_ist::time < cfg.alert_after_ist then
    return;
  end if;

  select * into v_good from public.backup_runs r
   where r.status = 'success' and r.mode <> 'dry-run'
   order by r.started_at desc limit 1;

  -- 1. No good backup for today.
  if cfg.last_alert_date is distinct from v_date
     and not exists (select 1 from public.backup_runs r
                      where r.for_date = v_date and r.mode <> 'dry-run' and r.status = 'success') then

    select * into v_last from public.backup_runs r
     where r.for_date = v_date and r.mode <> 'dry-run'
     order by r.started_at desc limit 1;

    v_body := case
      when v_last.id is null then
        'Last night''s backup did not start at all: no run reached the database. '
        || 'Most likely the wake-up call to GitHub failed (token expired or revoked) or GitHub dropped it. '
      else
        format('Last night''s backup started at %s IST and ended as %s. Error: %s. ',
               to_char(v_last.started_at at time zone 'Asia/Kolkata', 'HH24:MI'),
               v_last.status, coalesce(v_last.error, 'none recorded'))
    end
    || case when v_good.id is null then 'There is no successful backup yet.'
            else format('The last good backup is from %s.',
                        to_char(v_good.started_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'))
       end
    || ' Nothing has been deleted: old copies are only removed after a new one is safely saved.';
    v_subj := format('Orange One backup did NOT complete - %s', to_char(v_date, 'DD Mon'));

    foreach v_addr in array v_to loop
      insert into public.email_outbox (kind, to_email, to_name, subject, payload)
      values ('receivables_collections_report', v_addr, 'Orange One', v_subj,
              jsonb_build_object('subject', v_subj, 'eyebrow', 'Backup', 'tag', 'Orange One Hub',
                                 'headline', 'Last night''s backup did not complete',
                                 'body', v_body,
                                 'footerNote', 'backup watchdog. You are on the alert list for the nightly backup.'));
    end loop;

    update private.backup_config set last_alert_date = v_date, updated_at = now() where id = 1;
  end if;

  -- 2. Space running out.
  if v_good.id is not null and v_good.backup_bytes is not null then
    v_pct := round(100.0 * v_good.backup_bytes / (cfg.drive_limit_gb * 1024 * 1024 * 1024), 1);
    if v_pct >= cfg.warn_at_pct
       and (cfg.last_space_alert_date is null or cfg.last_space_alert_date <= v_date - 7) then
      v_subj := format('Orange One backup space is %s%% full', v_pct);
      foreach v_addr in array v_to loop
        insert into public.email_outbox (kind, to_email, to_name, subject, payload)
        values ('receivables_collections_report', v_addr, 'Orange One', v_subj,
                jsonb_build_object(
                  'subject', v_subj, 'eyebrow', 'Backup', 'tag', 'Orange One Hub',
                  'headline', 'The backup is running out of space',
                  'body', format('The backup folder now holds %s GB of the %s GB that backup@orangeonehub.com may use. '
                                 || 'Please raise that account''s storage limit in Google Admin (Storage) before it fills; '
                                 || 'when it is full, new backups will fail.',
                                 round(v_good.backup_bytes / 1073741824.0, 1), cfg.drive_limit_gb),
                  'footerNote', 'backup watchdog. You are on the alert list for the nightly backup.'));
      end loop;
      update private.backup_config set last_space_alert_date = v_date, updated_at = now() where id = 1;
    end if;
  end if;
end $$;

revoke all on function public.backup_watchdog() from public, anon, authenticated;
