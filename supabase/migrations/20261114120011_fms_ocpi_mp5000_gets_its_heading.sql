-- R8 (part five) · MP5000's customs heading — supplied by the client,
--                   10-Sep-2026.
--
-- WHY IT WAS BLANK
--   MP5000 was one of four machines with nothing to read: never invoiced through
--   Tally (all 83,247 voucher lines were searched), no HSN on any paper in the
--   2025.26 or 2026.27 folders, and no sibling to infer from — `MS-JP7` is its
--   own product, not a variant of anything else in the master. So
--   `20261114120010` left it alone rather than guess. The client has now given
--   the code directly.
--
--     MP5000   84433910
--
--   That is the same heading the two Pengdas and the JPK carry, and the one the
--   Position Printer and Rocket carry — so it is not an outlier, it simply had
--   no evidence trail of its own.
--
-- ⚠ THIS IS A DEFAULT, NOT A VERDICT — the same as every other row in this
--   column since `20261114120009`. It is what the quotation's HSN picker offers
--   first; the salesperson confirms it with the export team and may pick the
--   other. Nothing here forces `84433910` onto an MP5000 invoice.
--
-- 🟢 THREE MACHINES REMAIN BLANK and there is still nothing to read for them —
--    Book Printer, Label Printer, Mini Lario. Mini Lario has spare-part lines in
--    Tally but the machine itself has never been invoiced. A blank prints no HSN
--    line at all, and the picker still lets a deal choose one, so this blocks no
--    paper.

begin;

do $assert$
declare v_n int; v_now text;
begin
  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 25 then raise exception 'R8e pre 1: expected 25 machines already coded, found %', v_n; end if;

  select hsn_code into v_now from public.fms_ocpi_machines where name = 'MP5000';
  if not found then raise exception 'R8e pre 2: no machine named MP5000'; end if;
  if v_now is not null then raise exception 'R8e pre 3: MP5000 already carries % — this has run before', v_now; end if;
end $assert$;

update public.fms_ocpi_machines
   set hsn_code = '84433910', updated_at = now()
 where name = 'MP5000' and hsn_code is null;

do $post$
declare v_n int; v_bad text;
begin
  select hsn_code into v_bad from public.fms_ocpi_machines where name = 'MP5000';
  if v_bad <> '84433910' then raise exception 'R8e post 1: MP5000 reads %', coalesce(v_bad, 'NULL'); end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 26 then raise exception 'R8e post 2: expected 26 coded machines, found %', v_n; end if;

  -- ⚠ THE ORDER IS THE DATABASE'S COLLATION, not alphabet-as-you-read-it — the
  --   trap that failed 20261114120010 on its first run. These three happen to
  --   agree either way, but do not extend this without checking.
  select string_agg(name, ', ' order by name) into v_bad
    from public.fms_ocpi_machines where hsn_code is null;
  if v_bad is distinct from 'Book Printer, Label Printer, Mini Lario' then
    raise exception 'R8e post 3: the wrong machines are blank — %', coalesce(v_bad, 'none');
  end if;

  select count(*) into v_n from public.fms_ocpi_machines
   where hsn_code is not null and hsn_code !~ '^\d{8}$';
  if v_n <> 0 then raise exception 'R8e post 4: % heading(s) are not 8 bare digits', v_n; end if;

  select string_agg(distinct hsn_code, ', ') into v_bad from public.fms_ocpi_machines
   where hsn_code is not null and hsn_code not in ('84433250','84433910');
  if v_bad is not null then raise exception 'R8e post 5: unexpected heading(s): %', v_bad; end if;
end $post$;

commit;
