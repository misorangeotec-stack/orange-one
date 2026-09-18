-- ===========================================================================
-- PF-16 — WHERE EACH UPLOADED FILE LANDS IN THE BACKUP, and the record of it.
--
-- THE ASK (client, 18-09-2026): the backed-up files must be readable by a person
-- — "module-wise and step-wise, so that any time in the future we can properly
-- go through those files". Storage keys are not that: they are
-- `95f708a1-8c35-…/r1/invoice/1789714554352-lgmb1u-SINO_4.pdf`. So each object
-- is given a folder built from the database:
--
--   Orange One Hub/Files/<Module>/<Step>/<YYYY-MM>/<Record>/<file>
--   e.g. Order to Dispatch/1. Sales invoice/2026-09/SO-2627-0047 - NILKANTH PRINT/SINO_4.pdf
--
--   Module  = the name the app itself uses (master_report_modules labels)
--   Step    = the upload's step, numbered in the order the flow runs
--   Month   = the month the file was uploaded (IST) — keeps a busy step from
--             becoming one folder with ten thousand orders in it
--   Record  = the number people quote, then who it is for
--   File    = the original name, minus the upload timestamp prefix
--   (Leads: <Salesperson>/<date - company - person>; sent reports: by date / sender.)
--
--   Measured 18-09 against live storage: 4,830 objects, 4,794 matched to their
--   record, 0.78 s for the whole catalogue. The 36 unmatched belong to records
--   deleted from the app; they are kept, under "Record 1a2b3c4d (not in app)".
--
-- ⚠ A FILE NEVER MOVES ONCE BACKED UP. The first night a file is copied, its
--   path is written to private.backup_files and never recomputed. A record whose
--   customer is later renamed keeps its first folder: new files for the same
--   record reuse the SAME record folder (matched on the record's id). A file
--   whose content is replaced in the app is copied again beside the old one,
--   "name (updated 2026-10-02).pdf" — the backup keeps both versions.
--
-- ⚠ THE FOLDER TREE IS FOR PEOPLE; THE INDEX IS FOR RESTORING. Because the tree
--   no longer mirrors the storage keys, "Files index.csv" (backup_files_index_csv)
--   maps every backed-up path back to its bucket + key. It is uploaded every run.
--   Losing it does not lose files, only the automatic way back into the app.
--
-- ⚠ A NEW MODULE OR A NEW UPLOAD FOLDER NEEDS NO CHANGE HERE TO BE BACKED UP —
--   an unknown bucket becomes its own module folder, an unknown step key becomes
--   its title-cased name, an unknown record becomes "Record <id> (not in app)".
--   Adding it to the lists below only makes the folder names nicer.
--
-- Additive: one private table, three private helpers, four public functions.
-- Reversal: 20261126130000_pf16_backup_file_layout_rollback.sql
-- ===========================================================================

create schema if not exists private;


-- ------------------------------------------------------------ name helpers --

-- Google Drive accepts almost anything, but these folders get downloaded to
-- Windows machines, where \ / : * ? " < > | and trailing dots/spaces break.
create or replace function private.backup_clean(p text, p_max int default 80)
returns text
language sql
immutable
as $$
  select coalesce(nullif(btrim(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''),
           '[\\/:*?"<>|[:cntrl:]]+', '-', 'g'), '\s+', ' ', 'g')), p_max), ' .'), ''), '_')
$$;

-- A file name keeps its extension even when shortened.
create or replace function private.backup_clean_file(p text)
returns text
language sql
immutable
as $$
  select case when length(c) <= 120 then c
              else left(regexp_replace(c, '(\.[^.]{1,8})$', ''), 110)
                   || coalesce(substring(c from '(\.[^.]{1,8})$'), '') end
    from (select private.backup_clean(p, 1000) as c) x
$$;

-- Inserts a suffix before the extension: "a.pdf" -> "a (2).pdf".
create or replace function private.backup_suffix(p text, p_suffix text)
returns text
language sql
immutable
as $$
  select regexp_replace(p, '(\.[^./]{1,8})?$', ' ' || p_suffix || '\1')
$$;


-- -------------------------------------------------------------------- log --

create table if not exists private.backup_files (
  bucket       text not null,
  name         text not null,
  etag         text not null default '',
  size         bigint,
  record_key   text not null default '',
  module_dir   text not null,
  step_dir     text not null,
  record_dir   text not null,
  -- The path before any " (2)" de-duplication; used to number the next clash.
  base_path    text not null,
  drive_path   text not null,
  run_id       bigint,
  backed_up_at timestamptz not null default now(),
  primary key (bucket, name, etag),
  unique (drive_path)
);

create index if not exists backup_files_record_idx on private.backup_files (bucket, record_key);
create index if not exists backup_files_base_idx   on private.backup_files (lower(base_path));

comment on table private.backup_files is
  'PF-16. One row per uploaded file (per content version) copied to Google Drive, and WHERE it went. Written only by backup_files_done after a successful upload. This is the restore map; see 20261126130000.';

revoke all on private.backup_files from public, anon, authenticated;


-- -------------------------------------------------------------- catalogue --
--
-- Every storage object with its human folder. p_only_new skips objects already
-- in the log (same bucket, key AND content), BEFORE any label is looked up, so
-- a nightly call labels only the handful of new files.
--
--   select module_dir, step_dir, count(*) from public.backup_file_catalog() group by 1, 2;

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
      when 'report-exports'  then case when o.seg[1] = 'scheduled' then
                                    case when o.seg[3] like 'sample-%' then 'sample' else 'scheduled' end
                                  else 'user' end
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
          when p.seg[1] = 'scheduled' then to_char(to_date(p.seg[2], 'YYYYMMDD'), 'YYYY-MM-DD')
          else (select pr.name from profiles pr where pr.id = p.u) end
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
  private.backup_clean(coalesce(m.label, l.bucket)) as module_dir,
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

revoke all on function public.backup_file_catalog(text, int, boolean) from public, anon, authenticated;


-- ------------------------------------------------------------------ plan --
--
-- The next batch of files to copy, each with its FINAL Drive path. Called by
-- the runner in a loop: plan -> download -> upload -> done -> plan(next_after).
-- A file that fails to upload is not in the log, so tomorrow's run offers it
-- again; the cursor only stops tonight's loop from retrying it forever.

create or replace function public.backup_files_plan(
  p_after text default null,
  p_limit int  default 400
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD');
  v       jsonb;
begin
  with c as (
    select * from public.backup_file_catalog(p_after, greatest(1, least(coalesce(p_limit, 400), 2000)), true)
  ),
  r as (
    select c.*,
      exists (select 1 from private.backup_files f
               where f.bucket = c.bucket and f.name = c.name) as is_update,
      -- A record keeps the folder it was first given.
      coalesce((select f.record_dir from private.backup_files f
                 where f.bucket = c.bucket and f.record_key = c.record_key and c.record_key <> ''
                 order by f.backed_up_at limit 1), c.record_dir) as rdir
    from c
  ),
  b as (
    select r.*,
      concat_ws('/', r.module_dir, r.step_dir, r.month_dir, r.rdir) || '/'
        || case when r.is_update then private.backup_suffix(r.file_name, '(updated ' || v_today || ')')
                else r.file_name end as base_path
    from r
  ),
  d as (
    select b.*,
      row_number() over (partition by lower(b.base_path) order by b.created_at, b.name) as rn,
      (select count(*) from private.backup_files f where lower(f.base_path) = lower(b.base_path)) as taken
    from b
  )
  select jsonb_build_object(
           'items', coalesce(jsonb_agg(jsonb_build_object(
               'bucket',     d.bucket,
               'name',       d.name,
               'etag',       d.etag,
               'size',       d.size,
               'record_key', d.record_key,
               'module_dir', d.module_dir,
               'step_dir',   d.step_dir,
               'record_dir', d.rdir,
               'matched',    d.matched,
               'base_path',  d.base_path,
               'drive_path', case when d.taken + d.rn = 1 then d.base_path
                                  else private.backup_suffix(d.base_path, '(' || (d.taken + d.rn) || ')') end)
             order by (d.bucket || '/' || d.name) collate "C"), '[]'::jsonb),
           'next_after', max((d.bucket || '/' || d.name) collate "C"))
    into v
    from d;
  return v;
end $$;

revoke all on function public.backup_files_plan(text, int) from public, anon, authenticated;


-- ------------------------------------------------------------------ done --

create or replace function public.backup_files_done(p_run_id bigint, p_items jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  insert into private.backup_files
    (bucket, name, etag, size, record_key, module_dir, step_dir, record_dir, base_path, drive_path, run_id)
  select i ->> 'bucket', i ->> 'name', coalesce(i ->> 'etag', ''), nullif(i ->> 'size', '')::bigint,
         coalesce(i ->> 'record_key', ''), i ->> 'module_dir', i ->> 'step_dir', i ->> 'record_dir',
         i ->> 'base_path', i ->> 'drive_path', p_run_id
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.backup_files_done(bigint, jsonb) from public, anon, authenticated;


-- ----------------------------------------------------------------- index --
--
-- "Files index.csv": one line per backed-up file. Opens in Excel; the last two
-- columns are what a restore needs to put each file back where the app expects.

create or replace function public.backup_files_index_csv()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'Where it is in this backup,Module,Step,Record,Size (KB),Backed up on,Still in the app,App bucket,App path'
         || E'\n'
         || coalesce(string_agg(concat_ws(',',
              '"' || replace(f.drive_path, '"', '""') || '"',
              '"' || replace(f.module_dir, '"', '""') || '"',
              '"' || replace(f.step_dir,   '"', '""') || '"',
              '"' || replace(f.record_dir, '"', '""') || '"',
              round(coalesce(f.size, 0) / 1024.0)::text,
              to_char(f.backed_up_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
              case when o.id is null then 'No' else 'Yes' end,
              '"' || replace(f.bucket, '"', '""') || '"',
              '"' || replace(f.name,   '"', '""') || '"'),
            E'\n' order by f.drive_path collate "C"), '')
    from private.backup_files f
    left join storage.objects o on o.bucket_id = f.bucket and o.name = f.name
$$;

revoke all on function public.backup_files_index_csv() from public, anon, authenticated;


-- ================================================================ asserts ==

do $check$
declare
  v_item text;
  v_n    int;
begin
  foreach v_item in array array[
    'public.backup_file_catalog(text, int, boolean)',
    'public.backup_files_plan(text, int)',
    'public.backup_files_done(bigint, jsonb)',
    'public.backup_files_index_csv()'
  ] loop
    if to_regprocedure(v_item) is null then
      raise exception 'backup files: % was not created', v_item;
    end if;
    if has_function_privilege('anon', v_item, 'execute')
       or has_function_privilege('authenticated', v_item, 'execute') then
      raise exception 'backup files: a client role can execute %', v_item;
    end if;
  end loop;

  if private.backup_clean('a/b: c?  ') <> 'a-b- c-' then
    raise exception 'backup files: backup_clean gave %', private.backup_clean('a/b: c?  ');
  end if;
  if private.backup_suffix('x.pdf', '(2)') <> 'x (2).pdf'
     or private.backup_suffix('x', '(2)') <> 'x (2)' then
    raise exception 'backup files: backup_suffix is wrong';
  end if;

  -- The catalogue must run and must place every object somewhere.
  select count(*) into v_n from public.backup_file_catalog() c
   where c.module_dir is null or c.step_dir is null or c.record_dir is null or c.file_name is null;
  if v_n > 0 then
    raise exception 'backup files: % objects have no folder', v_n;
  end if;
end $check$;
