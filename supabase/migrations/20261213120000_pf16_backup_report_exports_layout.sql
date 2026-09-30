-- PF-16 . The nightly backup stopped because a second report moved into the
-- `report-exports` bucket.
--
-- WHAT BROKE (runs 16 to 21, 29 and 30 September 2026)
--   `backup_file_catalog` read the Drive folder for a scheduled report out of
--   the storage path, and it assumed the only shape the bucket had ever held:
--
--     scheduled/<YYYYMMDD>/<mode>-<id>/<rep>/<file>      the Collections report
--
--   so it ran `to_date(seg[2], 'YYYYMMDD')` on the second segment. On 28-09 the
--   Daily Report began writing into the same bucket under its own name, exactly
--   as it should (it sweeps its own folder on its own retention clock):
--
--     scheduled/daily-report/<YYYYMMDD>/<run>/<file>     the Daily Report
--
--   `to_date('daily-report', 'YYYYMMDD')` reads the first four characters as the
--   year and raises 22007, `invalid value "dail" for "YYYY"`. One unreadable
--   folder name therefore failed the whole plan call, and with it the entire
--   file half of the backup. Four files nobody could name stopped 160 from
--   being copied.
--
-- THE FIX, IN TWO PARTS
--   1. `private.backup_ymd` parses YYYYMMDD and returns null instead of raising
--      when the text is not a date. Naming a folder is a convenience; it must
--      never be able to fail a backup. Every reader of a path segment now goes
--      through it.
--   2. `report-exports` understands both shapes, and any future report that
--      namespaces itself the same way is handled without another migration: it
--      gets its own module folder from its own folder name.
--
-- WHERE THE DAILY REPORT LANDS IN DRIVE
--   Daily Report - reports sent/Scheduled sends/2026-09-29/Daily_Report_29-09-2026.pdf
--   which mirrors the Collections tree
--   Outstanding Dashboard - reports sent/Scheduled sends/2026-09-26/<file>
--
-- NOTHING MOVES. Verified against live before writing this: all 208
-- `report-exports` files already in `private.backup_files` compute byte
-- identical module / step / record folders under the new logic, so no file is
-- re-uploaded and no Drive folder is orphaned. Only the 4 Daily Report files,
-- none of which has ever been backed up, get a folder for the first time.
--
-- Additive only: two `create or replace`, no table touched.


-- ------------------------------------------------------------------ ymd --
--
-- A date out of a path segment, or null. `to_date` on its own raises on
-- anything that is not a date, and a raise inside the catalog fails the run,
-- so the regex must reject every value `to_date` would reject: a real month
-- and a real day, not merely eight digits (`20261399` is eight digits).
-- STABLE, not IMMUTABLE, because `to_date` itself is only STABLE.

create or replace function private.backup_ymd(p text)
returns date
language sql
stable
as $ymd$
  select case when p ~ '^(19|20)[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$'
              then to_date(p, 'YYYYMMDD') end
$ymd$;

comment on function private.backup_ymd(text) is
  'PF-16. YYYYMMDD out of a storage path segment, or null when the segment is not a date. Total by design: naming a backup folder must never be able to fail the backup.';


-- -------------------------------------------------------------- catalog --

create or replace function public.backup_file_catalog(
  p_after    text    default null,
  p_limit    int     default null,
  p_only_new boolean default false
)
returns table (
  bucket      text,
  name        text,
  etag        text,
  size        bigint,
  created_at  timestamptz,
  record_key  text,
  module_dir  text,
  step_dir    text,
  month_dir   text,
  record_dir  text,
  file_name   text,
  matched     boolean
)
language sql
stable
security definer
set search_path = public
as $$
with o as (
  select ob.bucket_id as bucket, ob.name,
         coalesce(ob.metadata->>'eTag', '') as etag,
         coalesce((ob.metadata->>'size')::bigint, 0) as size,
         ob.created_at,
         string_to_array(ob.name, '/') as seg,
         (regexp_match(ob.name, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))[1]::uuid as u
    from storage.objects ob
   where ob.name !~ '(^|/)\.emptyFolderPlaceholder$'
     and (p_after is null or (ob.bucket_id || '/' || ob.name) collate "C" > p_after collate "C")
     and (not p_only_new or not exists (
            select 1 from private.backup_files f
             where f.bucket = ob.bucket_id and f.name = ob.name
               and f.etag = coalesce(ob.metadata->>'eTag', '')))
   order by (ob.bucket_id || '/' || ob.name) collate "C"
   limit p_limit
),
p as (   -- per-bucket parse: the step key, the record key, and the bare file name
  select o.*,
    o.seg[cardinality(o.seg)] as base,
    case o.bucket
      when 'fms-dispatch-docs' then o.seg[3]
      when 'fms-purchase-docs' then case
          when o.seg[1] = 'po' and o.seg[2] = 'new' then 'po_new'
          when o.seg[1] in ('po', 'payment', 'sourcing') then o.seg[1]
          when cardinality(o.seg) = 2 then 'pi'
          else o.seg[2] end
      when 'fms-import-docs' then case
          when o.seg[1] = 'po' and o.seg[2] = 'new' then 'po_new'
          when o.seg[1] in ('po', 'payment', 'sourcing') then o.seg[1]
          when cardinality(o.seg) = 2 then 'pi'
          else o.seg[2] end
      when 'fms-hr-docs'     then o.seg[1]
      when 'lead-media'      then 'lead'
      when 'report-exports'  then case
          when o.seg[1] <> 'scheduled' then 'user'
          -- Collections: scheduled/<YYYYMMDD>/<mode>-<id>/<rep>/<file>
          when private.backup_ymd(o.seg[2]) is not null then
            case when o.seg[3] like 'sample-%' then 'sample' else 'scheduled' end
          -- Any other report that namespaces itself: scheduled/<report>/<YYYYMMDD>/<run>/<file>
          else 'scheduled' end
      else case when cardinality(o.seg) >= 3 then o.seg[2] else '' end
    end as step_key,
    case o.bucket when 'lead-media' then o.seg[2] else o.u::text end as record_key,
    case when o.bucket = 'fms-dispatch-docs' then nullif(substring(o.seg[2] from '^r([0-9]+)$'), '')::int end as round_no
  from o
),
steps(bucket, step_key, label) as (values
  ('fms-dispatch-docs',  'invoice',           '1. Sales invoice'),
  ('fms-dispatch-docs',  'eway',              '2. E-way bill'),
  ('fms-dispatch-docs',  'receiver',          '3. Receiver copy - LR'),
  ('fms-production-docs','logbook',           '1. Logbook'),
  ('fms-production-docs','quality',           '2. Quality check'),
  ('fms-production-docs','fgtransfer',        '3. FG transfer - stock journal'),
  ('fms-purchase-docs',  'sourcing',          '1. Sourcing quotations'),
  ('fms-purchase-docs',  'po_new',            '2. Purchase order'),
  ('fms-purchase-docs',  'po',                '2. Purchase order'),
  ('fms-purchase-docs',  'pi',                '3. Vendor PI'),
  ('fms-purchase-docs',  'payment',           '4. Payment advice'),
  ('fms-purchase-docs',  'grn',               '5. GRN'),
  ('fms-purchase-docs',  'qc',                '6. QC inspection'),
  ('fms-purchase-docs',  'tally',             '7. Tally booking'),
  ('fms-purchase-docs',  'return',            '8. Purchase return'),
  ('fms-purchase-docs',  'gate',              '9. Gate out'),
  ('fms-import-docs',    'sourcing',          '1. Sourcing quotations'),
  ('fms-import-docs',    'po_new',            '2. Purchase order'),
  ('fms-import-docs',    'po',                '2. Purchase order'),
  ('fms-import-docs',    'pi',                '3. Vendor PI'),
  ('fms-import-docs',    'payment',           '4. Payment advice'),
  ('fms-import-docs',    'grn',               '5. GRN'),
  ('fms-import-docs',    'qc',                '6. QC inspection'),
  ('fms-import-docs',    'tally',             '7. Tally booking'),
  ('fms-import-docs',    'return',            '8. Purchase return'),
  ('fms-import-docs',    'gate',              '9. Gate out'),
  ('fms-ocpi-docs',      'quotation',         '1. Quotation'),
  ('fms-ocpi-docs',      'oc',                '2. Order confirmation (OC)'),
  ('fms-ocpi-docs',      'customer-signed',   '3. OC signed by customer'),
  ('fms-ocpi-docs',      'management-signed', '4. OC signed by management'),
  ('fms-sampling-docs',  'send',              '1. Sent to party'),
  ('fms-sampling-docs',  'lab',               '2. Lab report'),
  ('fms-hr-docs',        'jd',                '1. Job description'),
  ('fms-hr-docs',        'resumes',           '2. Resumes (CVs)'),
  ('report-exports',     'scheduled',         'Scheduled sends'),
  ('report-exports',     'sample',            'Sample sends'),
  ('report-exports',     'user',              'Sent by users')
),
modules(bucket, label) as (values
  ('fms-dispatch-docs',   'Order to Dispatch'),
  ('fms-production-docs', 'Production Entry'),
  ('fms-purchase-docs',   'Purchase RM Domestic'),
  ('fms-import-docs',     'Purchase RM Import'),
  ('fms-ocpi-docs',       'OCPI'),
  ('fms-sampling-docs',   'Ink - RM Sampling'),
  ('fms-hr-docs',         'New Recruitment'),
  ('lead-media',          'Leads Dashboard'),
  ('report-exports',      'Outstanding Dashboard - reports sent'),
  ('fms-complaint-docs',  'Complaint (RM-FG)'),
  ('fms-asset-docs',      'Asset Maintenance'),
  ('fms-travel-docs',     'Travel Desk'),
  ('fms-exit-docs',       'Employee Exit'),
  ('fms-customer-docs',   'New Customer Onboarding')
),
lbl as (  -- the record folder: the number people use, then who it is for
  select p.*,
    case p.bucket
      when 'fms-dispatch-docs' then (
        select d.order_no || coalesce(' - ' || mp.name, '')
          from fms_dispatch_orders d left join mst_parties mp on mp.id = d.customer_id
         where d.id = p.u)
      when 'fms-production-docs' then (
        select r.req_no || coalesce(' - ' || fg.name, '')
          from fms_production_requests r left join fms_production_fg_items fg on fg.id = r.fg_item_id
         where r.id = p.u)
      when 'fms-purchase-docs' then coalesce(
        (select po.po_no || coalesce(' - ' || v.name, '')
           from fms_purchase_pos po left join fms_purchase_vendors v on v.id = po.vendor_id
          where po.id = p.u limit 1),
        (select po.po_no || coalesce(' - ' || v.name, '') from fms_purchase_pos po left join fms_purchase_vendors v on v.id = po.vendor_id where p.step_key = 'po_new' and po.document_path = p.name limit 1),
        (select rq.request_no from fms_purchase_requests rq where rq.id = p.u))
      when 'fms-import-docs' then coalesce(
        (select po.po_no || coalesce(' - ' || v.name, '')
           from fms_import_pos po left join fms_import_vendors v on v.id = po.vendor_id
          where po.id = p.u limit 1),
        (select po.po_no || coalesce(' - ' || v.name, '') from fms_import_pos po left join fms_import_vendors v on v.id = po.vendor_id where p.step_key = 'po_new' and po.document_path = p.name limit 1),
        (select rq.request_no from fms_import_requests rq where rq.id = p.u))
      when 'fms-ocpi-docs' then (
        select coalesce(d.quotation_no, d.oc_no) || coalesce(' - ' || d.customer_name, '')
          from fms_ocpi_deals d where d.id = p.u)
      when 'fms-sampling-docs' then (
        select s.req_no || coalesce(' - ' || s.party_name, '')
          from fms_sampling_requests s where s.id = p.u)
      when 'fms-hr-docs' then (
        select r.mrf_no || coalesce(' - ' || r.job_title, '')
          from fms_hr_requisitions r where r.id = p.u)
      when 'lead-media' then (
        select to_char(l.captured_on, 'YYYY-MM-DD') || coalesce(' - ' || nullif(btrim(l.company_name), ''), '')
               || coalesce(' - ' || nullif(btrim(l.person_name), ''), '')
          from app_leads l where l.id = p.seg[2])
      when 'report-exports' then case
          when p.seg[1] <> 'scheduled' then (select pr.name from profiles pr where pr.id = p.u)
          else to_char(coalesce(private.backup_ymd(p.seg[2]),
                                private.backup_ymd(p.seg[3])), 'YYYY-MM-DD') end
      when 'fms-complaint-docs' then (
        select c.complaint_no || coalesce(' - ' || c.party_name, '')
          from fms_complaint_requests c where c.id = p.u)
      when 'fms-travel-docs' then (
        select t.trip_no || coalesce(' - ' || t.traveller_name, '')
          from fms_travel_trips t where t.id = p.u)
      when 'fms-exit-docs' then (
        select x.exit_no || coalesce(' - ' || x.employee_name, '')
          from fms_exit_cases x where x.id = p.u)
      when 'fms-customer-docs' then (
        select cr.req_no || coalesce(' - ' || cr.legal_name, '')
          from fms_customer_requests cr where cr.id = p.u)
      when 'fms-asset-docs' then coalesce(
        (select a.asset_no || coalesce(' - ' || a.name, '') from fms_asset_assets a where a.id = p.u),
        (select j.job_no from fms_asset_jobs j where j.id = p.u))
    end as record_label,
    case when p.bucket = 'lead-media' then
        (select pr.name from profiles pr where pr.id = p.u) end as lead_owner,
    case when p.bucket = 'fms-hr-docs' and p.step_key = 'resumes' then
        (select c.candidate_no || coalesce(' - ' || c.name, '')
           from fms_hr_candidates c where c.resume_path = p.name limit 1) end as candidate_label
  from p
)
select l.bucket, l.name, l.etag, l.size, l.created_at,
  coalesce(l.record_key, '') as record_key,
  private.backup_clean(case
    when l.bucket = 'report-exports' and l.seg[1] = 'scheduled'
         and private.backup_ymd(l.seg[2]) is null
      then initcap(replace(replace(l.seg[2], '-', ' '), '_', ' ')) || ' - reports sent'
    else coalesce(m.label, l.bucket) end) as module_dir,
  private.backup_clean(case
    when l.bucket = 'lead-media' then coalesce(l.lead_owner, 'Unknown user')
    when s.label is not null then s.label
    when l.step_key <> '' and l.step_key !~ '^[0-9a-f-]{36}$' then initcap(replace(replace(l.step_key, '-', ' '), '_', ' '))
    else 'Other files'
  end) as step_dir,
  case when l.bucket in ('lead-media', 'report-exports') then null
       else to_char(l.created_at at time zone 'Asia/Kolkata', 'YYYY-MM') end as month_dir,
  private.backup_clean(case
    when l.record_label is not null then l.record_label
    when l.u is not null then 'Record ' || left(l.u::text, 8) || ' (not in app)'
    else 'Other'
  end) as record_dir,
  private.backup_clean_file(
    (case when l.round_no > 1 then 'Round ' || l.round_no || ' - ' else '' end)
    || coalesce(l.candidate_label || ' - ', '')
    || case when l.bucket = 'fms-dispatch-docs'
            then regexp_replace(regexp_replace(l.base, '^[0-9]{13}-', ''), '^[a-z0-9]{6}-', '')
            else regexp_replace(l.base, '^[0-9]{13}-', '') end) as file_name,
  (l.record_label is not null) as matched
from lbl l
left join modules m on m.bucket = l.bucket
left join steps s on s.bucket = l.bucket and s.step_key = l.step_key
$$;

-- ================================================================ asserts ==
--
-- These read the whole of storage.objects, so they run AFTER the DDL above and
-- take no lock of their own; the `create or replace` is already committed.

do $check$
declare
  v_n    int;
  v_bad  text;
begin
  -- 1. the parser is total on the values that broke the run
  if private.backup_ymd('daily-report') is not null then
    raise exception 'backup_ymd: a non-date returned a date';
  end if;
  if private.backup_ymd('20261399') is not null then
    raise exception 'backup_ymd: an impossible date was accepted';
  end if;
  if private.backup_ymd('20260929') <> date '2026-09-29' then
    raise exception 'backup_ymd: a real date did not survive';
  end if;

  -- 2. the catalog can now read EVERY object in the bucket that broke it
  select count(*) into v_n
    from public.backup_file_catalog('report-export', 2000, false);
  if v_n = 0 then
    raise exception 'backup files: the catalog returned nothing for report-exports';
  end if;

  -- 3. every file it returns has a folder for each level; a null here is the
  --    silent version of the bug we just fixed
  select c.bucket || '/' || c.name into v_bad
    from public.backup_file_catalog('report-export', 2000, false) c
   where c.module_dir is null or c.step_dir is null or c.record_dir is null
      or c.file_name is null
   limit 1;
  if v_bad is not null then
    raise exception 'backup files: % has no folder', v_bad;
  end if;

  -- 4. nothing already copied to Drive changes folder
  select count(*) into v_n
    from private.backup_files f
    join public.backup_file_catalog('report-export', 2000, false) c
      on c.bucket = f.bucket and c.name = f.name
   where f.module_dir is distinct from c.module_dir
      or f.step_dir   is distinct from c.step_dir
      or f.record_dir is distinct from c.record_dir;
  if v_n > 0 then
    raise exception 'backup files: % file(s) already in Drive would move', v_n;
  end if;

  raise notice 'PF-16 report-exports layout: OK';
end $check$;
