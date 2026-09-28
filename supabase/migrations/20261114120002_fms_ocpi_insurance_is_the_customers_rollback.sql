-- ROLLBACK for 20261114120002.
--
-- THE SIX ORIGINAL WORDINGS CANNOT BE RESTORED. They were normalised to one and
-- the mapping from machine to original wording is not recoverable from the rows.
-- This restores the PROMISE that preceded R2, in the majority wording (12 of the
-- 21 decks carried "Product Insurance borne by Customer."). The other five
-- wordings said the same thing in different words; if the exact originals are
-- ever needed, they are listed in the header of the forward migration and in
-- 20260929120500 / 20261023120000.
--
-- Roll lib/fieldSpec.ts back with it, or the invoice and the contract state
-- different insurance promises on the same deal.
--
-- JPK is NOT re-silenced. It gained a clause it never had; leaving it is additive
-- and says nothing untrue.

begin;

update public.fms_ocpi_machine_sections
   set body = replace(body,
         'Insurance: Transit insurance will be borne by the customer.',
         'Insurance: Product Insurance borne by Customer.'),
       updated_at = now()
 where body like '%Insurance: Transit insurance will be borne by the customer.%';

update public.fms_ocpi_machine_sections
   set body = replace(body, 'Insurance will be borne by Customer.', 'Insurance will be bare by Customer.'),
       updated_at = now()
 where key = 'cancellation' and active and body like '%Insurance will be borne by Customer.%';

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machine_sections
   where body like '%Transit insurance will be borne by the customer%';
  if v_n <> 0 then raise exception 'R2 rollback: % section(s) still carry the R2 clause', v_n; end if;
end $post$;

commit;
