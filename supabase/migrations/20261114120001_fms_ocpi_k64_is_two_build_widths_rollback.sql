-- ROLLBACK for 20261114120001_fms_ocpi_k64_is_two_build_widths.sql
--
-- ⚠ REFUSES TO RUN IF ANY DEAL HAS BEEN RAISED ON THE 3.2 m MACHINE. Deleting a
--   machine a deal points at would violate the foreign key; more importantly a
--   deal on the 3.2 m is a commercial fact that this rollback must not silently
--   reassign to the 1.8 m.

begin;

do $guard$
declare v_deals int;
begin
  select count(*) into v_deals
    from public.fms_ocpi_deals d
    join public.fms_ocpi_machines m on m.id = d.machine_id
   where m.name = 'K64 — 3.2 m';
  if v_deals > 0 then
    raise exception 'B8 rollback refuses: % deal(s) exist on K64 — 3.2 m. Move them first.', v_deals;
  end if;
end $guard$;

delete from public.fms_ocpi_machine_head_types
 where machine_id in (select id from public.fms_ocpi_machines where name = 'K64 — 3.2 m');

delete from public.fms_ocpi_machine_sections
 where machine_id in (select id from public.fms_ocpi_machines where name = 'K64 — 3.2 m');

delete from public.fms_ocpi_machines where name = 'K64 — 3.2 m';

update public.fms_ocpi_machines
   set name = 'K64', updated_at = now()
 where name = 'K64 — 1.8 m';

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machines where name = 'K64';
  if v_n <> 1 then raise exception 'B8 rollback: expected one machine named K64, found %', v_n; end if;
  select count(*) into v_n from public.fms_ocpi_machines where name like 'K64 — %';
  if v_n <> 0 then raise exception 'B8 rollback: % split record(s) survive', v_n; end if;
end $post$;

commit;
