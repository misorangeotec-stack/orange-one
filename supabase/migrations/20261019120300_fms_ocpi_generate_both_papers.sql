-- ===========================================================================
-- OCPI — STAGE D of the revision: both papers are generated together, and every
-- revision keeps its own price, its own exchange rate and its own pair of PDFs.
--
-- WHAT THE CLIENT ASKED FOR
--   There is no longer a quotation that becomes, later and through a second
--   form, an order confirmation. One act produces TWO sheets at once — the
--   short summary and the machine's detailed sheet — and both are re-headed
--   when the Directors approve (stage E). Generating a revision produces a new
--   pair; the pair already with the customer is kept exactly as it was.
--
-- WHAT THIS MIGRATION DOES
--   fms_ocpi_generate_quotation is re-issued so that a version row records:
--     · deal_value_amount / deal_value_currency / fx_rate — READ OFF THE DEAL
--       ROW, not taken from the payload, so the figure frozen onto the revision
--       is the one the server actually derived (write_quotation forces USD on a
--       high seas sale, and the payload may say otherwise).
--     · oc_document_payload — the RESOLVED detailed sheet, tokens already
--       filled, exactly as document_payload freezes the summary's template.
--
-- ⚠ THE PRICE IS FROZEN ON THE VERSION, NOT LOOKED UP THROUGH THE DEAL. The
--   deal carries only its CURRENT value. A negotiation that went ₹52L → ₹47L →
--   ₹44L has to be readable afterwards, and the revision strip can only show it
--   if each revision kept its own figure. Reading the deal would show ₹44L three
--   times.
--
-- ⚠ THE EXCHANGE RATE IS FROZEN WITH IT, for the same reason and a sharper one:
--   a paper must keep the arithmetic it was issued under. Re-deriving a rupee
--   equivalent from today's rate would silently restate a total a customer has
--   already been quoted.
--
-- ⚠ ADDING A PARAMETER TO create or replace MAKES AN OVERLOAD, NOT A
--   REPLACEMENT. The 3-argument signature is dropped explicitly first — the
--   lesson stage A learned when two fms_ocpi_set_version_pdf functions existed
--   side by side and only reading pg_proc showed it. Every caller passes named
--   arguments and p_oc_document defaults, so nothing breaks in the gap.
--
-- Additive only: no column is dropped, no data is rewritten, and a version row
-- written before this migration simply carries nulls in the three money columns.
--
-- Reversal (reverse order):
--   drop function if exists public.fms_ocpi_generate_quotation(uuid, jsonb, jsonb, jsonb);
--   -- then re-run 20260929121200's fms_ocpi_generate_quotation verbatim
-- ===========================================================================

begin;

drop function if exists public.fms_ocpi_generate_quotation(uuid, jsonb, jsonb);

create or replace function public.fms_ocpi_generate_quotation(
  p_deal        uuid,
  p_fields      jsonb default '{}'::jsonb,
  p_document    jsonb default '{}'::jsonb,
  p_oc_document jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid := auth.uid();
  v_status   text;
  v_owner    uuid;
  v_no       text;
  v_version  integer;
  v_missing  text;
  v_amount   numeric;
  v_currency text;
  v_fx       numeric;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, quotation_no, quotation_version_no,
         deal_value_amount, deal_value_currency, fx_rate
    into v_status, v_owner, v_no, v_version,
         v_amount, v_currency, v_fx
    from public.fms_ocpi_deals
   where id = p_deal
     for update;

  if v_status is null then raise exception 'Quotation not found'; end if;

  -- Generating is a quotation-step act, so it needs the quotation step's
  -- authority — plus, for a draft, ownership of the draft itself.
  if not public.fms_ocpi_can_act('quotation', p_deal, v_uid) then
    raise exception 'You are not authorized to generate this quotation';
  end if;
  if v_owner is distinct from v_uid and not public.fms_ocpi_is_coordinator(v_uid) then
    raise exception 'This quotation belongs to someone else';
  end if;

  -- A quotation may be revised while it is still being written, and after it has
  -- been sent back for rework. Once it is with an approver, or beyond, it is out
  -- of the salesperson's hands.
  if v_status not in ('draft', 'rework') then
    raise exception 'This quotation cannot be revised while it is %',
      replace(v_status, '_', ' ');
  end if;

  -- The same minimum the table CHECK enforces, raised here as a sentence a
  -- salesperson can act on instead of a constraint violation.
  select string_agg(x, ', ') into v_missing from (
    select unnest(array[
      case when nullif(btrim(coalesce((select customer_name from public.fms_ocpi_deals where id = p_deal), '')), '') is null
           then 'the customer name' end,
      case when nullif(btrim(coalesce((select salesperson_name from public.fms_ocpi_deals where id = p_deal), '')), '') is null
           then 'the salesperson' end,
      case when (select machine_id from public.fms_ocpi_deals where id = p_deal) is null
           then 'the machine' end,
      case when (select machine_count from public.fms_ocpi_deals where id = p_deal) is null
           then 'how many machines' end,
      case when v_amount is null   then 'the total deal value' end,
      case when v_currency is null then 'the currency' end
    ]) as x
  ) t where x is not null;

  if v_missing is not null then
    raise exception 'Still needed before a quotation can be generated: %', v_missing;
  end if;

  -- Mint on the FIRST generation only.
  if v_no is null then
    v_no := 'QT-M' || lpad(public.fms_ocpi_next_seq('quotation')::text, 4, '0');
  end if;

  v_version := coalesce(v_version, 0) + 1;

  insert into public.fms_ocpi_quotation_versions
    (deal_id, version_no, field_payload, document_payload, oc_document_payload,
     deal_value_amount, deal_value_currency, fx_rate, generated_by)
  values
    (p_deal, v_version,
     coalesce(p_fields, '{}'::jsonb),
     coalesce(p_document, '{}'::jsonb),
     coalesce(p_oc_document, '{}'::jsonb),
     v_amount, v_currency, v_fx, v_uid);

  update public.fms_ocpi_deals
     set quotation_no         = v_no,
         quotation_version_no = v_version,
         -- Rework is answered by regenerating, so a revision clears it.
         status               = 'draft',
         rework_stage         = null,
         rework_reason        = null,
         current_step         = 'quotation'
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal,
    case when v_version = 1 then 'quotation_generated' else 'quotation_revised' end,
    case when v_version = 1
         then 'Quotation ' || v_no || ' generated'
         else 'Quotation ' || v_no || ' revised (Rev ' || (v_version - 1) || ')' end,
    '{}'::uuid[],
    jsonb_build_object('quotation_no', v_no, 'version_no', v_version)
  );

  return v_version;
end $function$;

commit;
