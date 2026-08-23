-- ===========================================================================
-- OCPI FMS — generate a quotation version, and mint its number.
--
--   fms_ocpi_generate_quotation(deal, field_payload, document_payload)
--     → the new version_no
--
-- WHAT "GENERATE" MEANS
--   The salesperson has filled the quotation and wants a PDF to send. Every
--   generation is a REVISION: version 1 is the first quotation, version 2 is
--   what came back after the customer pushed on price, and so on. The deal stays
--   at the `quotation` step throughout — a negotiation is not a workflow stage,
--   and modelling it as one would put the same deal in a queue once per round
--   and make "how many quotations are waiting?" unanswerable.
--
-- ⚠ THE NUMBER IS MINTED ON THE FIRST GENERATION AND NEVER AGAIN.
--   `QT-M0024`, continuing the paper series (the counter is seeded past the
--   highest number already issued — see 20260929120000). Revisions keep the SAME
--   number and increment the version, because a customer holding QT-M0024 must
--   still be holding QT-M0024 after the third round of haggling. A draft that is
--   never generated burns nothing.
--
-- ⚠ BOTH PAYLOADS ARE FROZEN, AND THAT IS THE POINT OF THIS TABLE.
--     field_payload    — the answers, for the revision diff
--     document_payload — the RESOLVED DOCUMENT: the machine's spec rows and
--                        section bodies exactly as they were at this moment
--   Freezing only the answers would mean that rewording a clause in
--   Administration → Machines next month silently rewrites version 1 of a
--   quotation the customer already has in their inbox. Customer Onboarding
--   records the same lesson by freezing `dir_threshold_at_decision` onto every
--   approved row: a rule change must never rewrite history.
--
-- ⚠ THE CALLER IS THE BROWSER, AND IT SUPPLIES THE PAYLOADS. That is deliberate:
--   the resolved document is what the PDF renderer actually used, so capturing
--   it there is the only way to be certain the snapshot and the file agree.
--   Nothing here trusts them for AUTHORIZATION — that is re-checked below — and
--   nothing downstream re-derives the document from live masters.
--
-- Purely ADDITIVE: one function.
--
-- Reversal:
--   drop function if exists public.fms_ocpi_generate_quotation(uuid, jsonb, jsonb);
-- ===========================================================================

begin;

create or replace function public.fms_ocpi_generate_quotation(
  p_deal     uuid,
  p_fields   jsonb default '{}'::jsonb,
  p_document jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_owner   uuid;
  v_no      text;
  v_version integer;
  v_missing text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, quotation_no, quotation_version_no
    into v_status, v_owner, v_no, v_version
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
      case when (select deal_value_amount from public.fms_ocpi_deals where id = p_deal) is null
           then 'the total deal value' end,
      case when (select deal_value_currency from public.fms_ocpi_deals where id = p_deal) is null
           then 'the currency' end
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
    (deal_id, version_no, field_payload, document_payload, generated_by)
  values
    (p_deal, v_version, coalesce(p_fields, '{}'::jsonb), coalesce(p_document, '{}'::jsonb), v_uid);

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
end $$;

comment on function public.fms_ocpi_generate_quotation(uuid, jsonb, jsonb) is
  'Freeze a quotation revision and mint its number on the first generation. Revisions keep the number and increment the version. Both the answers and the RESOLVED DOCUMENT are stored, so rewording a template later cannot rewrite a document a customer already holds.';
grant execute on function public.fms_ocpi_generate_quotation(uuid, jsonb, jsonb) to authenticated;

-- Record the stored PDF path once the browser has uploaded it.
create or replace function public.fms_ocpi_set_version_pdf(
  p_deal uuid, p_version integer, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_ocpi_can_act('quotation', p_deal, v_uid) then
    raise exception 'Not authorized';
  end if;
  -- ⚠ The path must live under this deal's folder. The storage policy derives
  --   the owning deal from the first path segment, so a path pointing elsewhere
  --   would be readable by the wrong people.
  if p_path is null or split_part(p_path, '/', 1) <> p_deal::text then
    raise exception 'A document path must start with its own deal id';
  end if;
  update public.fms_ocpi_quotation_versions
     set pdf_path = p_path
   where deal_id = p_deal and version_no = p_version;
end $$;

comment on function public.fms_ocpi_set_version_pdf(uuid, integer, text) is
  'Attach the generated PDF to a frozen quotation version. Refuses a path outside the deal''s own folder.';
grant execute on function public.fms_ocpi_set_version_pdf(uuid, integer, text) to authenticated;

commit;
