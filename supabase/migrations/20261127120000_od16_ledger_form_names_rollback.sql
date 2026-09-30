-- ===========================================================================
-- ROLLBACK for 20261127120000_od16_ledger_form_names.
--
-- Puts the two Order Desk functions back to their OD-14 shape (no `form_name`
-- column) and drops the master.
--
-- ⚠ THE FRONTEND MUST BE ROLLED BACK WITH IT, or before it. The OD-16 Place-an-
--   order screen reads `form_name` off this RPC; against the OD-14 shape that
--   column is simply absent, which renders as an unlabelled picker rather than an
--   error. There is no version of this where only one half moves.
--
-- ⚠ DROPPING THE TABLE LOSES THE TYPED FORM NAMES. They are hand-entered and
--   exist nowhere else — no Tally sync recreates them. If the intent is to undo
--   the code but keep the data, run everything here EXCEPT the final drop.
-- ===========================================================================

begin;

drop function if exists public.fms_dispatch_my_companies();
drop function if exists public.fms_dispatch_customer_org_companies(uuid);

create or replace function public.fms_dispatch_customer_org_companies(p_org uuid)
returns table(company_id uuid, label text, item_count integer)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select mp.company_id,
         coalesce(nullif(trim(c.alias), ''), c.name) || coalesce(' - ' || c.location, ''),
         count(distinct upper(trim(tgt.name)))::integer
    from public.fms_dispatch_customer_orgs g
    join public.mst_parties mp        on mp.id = any (g.party_ids)
    join public.mst_companies c       on c.id = mp.company_id and c.active
    join public.mst_party_items pi    on pi.party_id = mp.id and pi.active
    join public.mst_items src         on src.id = pi.item_id and src.active
    join public.mst_items tgt         on tgt.company_id = mp.company_id and tgt.active
                                     and upper(trim(tgt.name)) = upper(trim(src.name))
   where g.id = p_org
   group by mp.company_id, 2
   order by 3 desc, 2;
$fn$;

revoke all on function public.fms_dispatch_customer_org_companies(uuid) from public, authenticated;

create or replace function public.fms_dispatch_my_companies()
returns table(company_id uuid, label text, item_count integer)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select * from public.fms_dispatch_customer_org_companies(
    public.fms_dispatch_customer_org_of(auth.uid()));
$fn$;

revoke all on function public.fms_dispatch_my_companies() from public;
grant execute on function public.fms_dispatch_my_companies() to authenticated;

comment on function public.fms_dispatch_my_companies() is
  'OD-14. The Orange companies the signed-in customer may order from, named as they would '
  'recognise them (alias + location, never the Tally book string), richest book first. A book '
  'that can supply them nothing is left out rather than offered as an empty order screen.';

drop function if exists public.fms_dispatch_delete_ledger_form(uuid);
drop function if exists public.fms_dispatch_save_ledger_form(jsonb);
drop function if exists public.fms_dispatch_ledger_forms_admin();

drop table if exists public.fms_dispatch_ledger_forms;

commit;
