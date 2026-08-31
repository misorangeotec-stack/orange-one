-- ============================================================================
-- OCPI-10 · Section B becomes seven pointers plus Others.
--
-- ASKED FOR BY RITESH BHAI, 31-Aug-2026. Section B (Deal inclusions) asks three
-- questions -- ink, spare parts, head. Four more -- air blade, external
-- centering, ink dust exhauster, chilling system -- were asked in a different
-- card entirely, under a heading "Options included" in Document details, where
-- a salesperson filling in a deal does not think to look for them. All four
-- move into section B, so it reads as SEVEN pointers, plus a free-text eighth.
--
-- THREE OF THE FOUR STOP BEING GATED BY THE MACHINE. They are asked on every
-- deal. The FOURTH -- external centering -- KEEPS its gate, and that is the
-- client's own distinction, not an oversight: the centering system follows the
-- dryer's logic. If the machine backs it, ask; otherwise do not. So section B
-- holds seven pointers on the 5 machines that can carry a centering device and
-- six on the other 23. That is the intended behaviour, not a rendering fault.
--
-- ⚠ THIS MIGRATION IS THE HALF THAT MAKES THE FEATURE WORK AT ALL.
--   Until now this function read the capability off the MACHINE and nulled the
--   salesperson's answer on save whenever the machine's sheet said "no":
--
--     air_blade = case when coalesce(v_air, 'no') = 'no' then null else ... end
--
--   The sheet says "no" or is blank for the air blade on 25 of the 28 machines.
--   So on almost every deal the question could be answered, saved, and lost --
--   no error, nothing in a log. Ship the form change without this and the four
--   questions appear, accept a click, and discard it. The form change and this
--   migration must go together, and this one goes FIRST.
--
-- ⚠ external_centering KEEPS ITS CLEARING, deliberately. It is still a gated
--   field, so the server must still refuse an answer the form never asked for.
--   Do not "tidy" it into matching the other three.
--
-- ⚠ v_centering SURVIVES; v_air, v_exhauster and v_chilling DO NOT.
--   Those three were read on the three gate lines and nowhere else, so they go
--   with the gates. v_centering is read SIX times -- the tick, and the five
--   centering_ship_* / centering_*_invoice clearings that OCPI-10 does not
--   touch. Dropping it would silently break the centering shipment block. The
--   select list and the into list below were edited together to keep their
--   arity; assertion 4 at the foot of this file proves v_centering is still
--   receiving opt_external_centering and not, say, opt_air_blade.
--
-- ⚠ WHAT THE MACHINE MASTER'S FOUR COLUMNS ARE FOR NOW, since they no longer
--   hide three of the four questions. They keep TWO jobs, and neither is
--   decorative: they drive the quotation's "standard on this machine" note on
--   all four, and they still drive the GATE on external centering alone (both
--   its tick and its shipment questions). The Machines master's own hints were
--   reworded in the same change so the screen does not imply a gate that only
--   one of them still has.
--
-- ⚠ THE NEW FIELD IS other_inclusions, NOT other_commitments.
--   other_commitments is RETIRED -- it still prints on old deals that carry a
--   value, and the form renders it read-only under a "retired" notice, but
--   there has been no input for it for some time. Reusing that column would
--   un-retire a field the module deliberately withdrew. This is a new nullable
--   column beside it.
--
-- ADDITIVE ONLY. One new nullable column; two functions replaced from the
-- bodies pulled out of the LIVE database on 31-Aug-2026, not from whichever
-- migration file grep finds first -- these have been redefined five times and
-- the live body has already been found to differ from the newest file once.
-- ============================================================================

begin;

alter table public.fms_ocpi_deals add column if not exists other_inclusions text;

comment on column public.fms_ocpi_deals.other_inclusions is
  'Section B free text: anything included in the deal that is not one of the seven pointers. NOT other_commitments, which is retired and has no input. For anything else about the deal, the live field is remarks (Special remarks).';


-- ────────────────────────────────────────────────────────────────────────────
-- fms_ocpi_write_oc -- three gates removed, one kept, one column added.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.fms_ocpi_write_oc(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_incl_head   boolean;
  v_incl_spares boolean;
  v_transport   text;
  v_currency    text;
  v_amount      numeric;
  v_inr         numeric;
  v_fx          numeric;
  v_ship_mode   text := nullif(btrim(p->>'head_ship_mode'), '');
  v_rate        numeric;
  v_value       numeric;
  v_gst         numeric;
  v_has_dryer   boolean;
  -- ⚠ THE ONLY SURVIVING EXTRA-CAPABILITY VARIABLE (OCPI-10). The other
  --   three came out with the gates they fed; this one still drives six
  --   clearings -- the centering tick and the five shipment lines.
  --   ⚠ Do NOT name the three removed variables anywhere in this
  --     function, comments included. Assertion 2 greps this function's own
  --     definition for them, and pg_get_functiondef returns the comments too
  --     -- so a helpful note naming them would fail the migration.
  v_centering   text;
  v_dry_price   numeric;
  v_dry_inr     numeric;
  v_dry_gst     numeric;
  v_grand       numeric;
  v_dry_ship    text := nullif(btrim(p->>'dryer_ship_mode'), '');
  v_spr_ship    text := nullif(btrim(p->>'spares_ship_mode'), '');
  v_cen_ship    text := nullif(btrim(p->>'centering_ship_mode'), '');
  v_dry_inv     boolean := (p->>'dryer_separate_invoice')::boolean;
  v_spr_inv     boolean := (p->>'spares_separate_invoice')::boolean;
  v_cen_inv     boolean := (p->>'centering_separate_invoice')::boolean;
  v_head_inv    boolean := (p->>'head_separate_invoice')::boolean;
begin
  -- ⚠ THE SELECT LIST AND THE INTO LIST MUST STAY ALIGNED. Three machine
  --   columns and three targets came out of this together (OCPI-10). Assign
  --   opt_air_blade into v_centering by accident and the centering shipment
  --   block starts obeying the wrong machine, silently. Assertion 4 checks it.
  select d.incl_head, d.incl_spares, d.transport_terms,
         d.deal_value_currency, d.deal_value_amount, d.deal_value_inr, d.fx_rate,
         m.needs_dryer,
         m.opt_external_centering
    into v_incl_head, v_incl_spares, v_transport,
         v_currency, v_amount, v_inr, v_fx,
         v_has_dryer,
         v_centering
    from public.fms_ocpi_deals d
    left join public.fms_ocpi_machines m on m.id = d.machine_id
   where d.id = p_deal;

  v_has_dryer := v_has_dryer is true;

  v_rate := case when v_transport = 'high_seas' then null
                 else nullif(p->>'gst_rate', '')::numeric end;

  v_value := case when v_currency = 'USD' then v_inr else v_amount end;
  v_gst   := case when v_rate is null or v_value is null then null
                  else round(v_value * v_rate / 100, 2) end;

  -- The dryer's own money. A price exists only when the dryer is NOT part of the deal.
  v_dry_price := case when not v_has_dryer or (p->>'dryer_included')::boolean is not false
                      then null else nullif(p->>'dryer_price', '')::numeric end;

  -- Quoted in the DEAL's currency, converted at the SAME frozen rate as the machine.
  v_dry_inr := case
                 when v_dry_price is null then null
                 when v_currency = 'USD'
                   then case when v_fx is null then null else round(v_dry_price * v_fx, 2) end
                 else v_dry_price
               end;

  v_dry_gst := case when v_rate is null or v_dry_inr is null then null
                    else round(v_dry_inr * v_rate / 100, 2) end;

  -- Null only when the MACHINE total is unknown: an incomplete deal prints a
  -- blank, never a total that quietly treats a missing figure as zero.
  v_grand := case when v_value is null then null
                  else v_value + coalesce(v_gst, 0)
                       + coalesce(v_dry_inr, 0) + coalesce(v_dry_gst, 0) end;

  update public.fms_ocpi_deals set
    head_ship_mode        = case when v_incl_head is distinct from true then null else v_ship_mode end,
    head_ship_via         = case when v_incl_head is distinct from true or v_ship_mode is distinct from 'separate'
                                 then null else nullif(btrim(p->>'head_ship_via'), '') end,
    head_balance_remarks  = case when v_incl_head is distinct from true then null
                                 else nullif(btrim(p->>'head_balance_remarks'), '') end,
    head_separate_invoice = case when v_incl_head is distinct from true then null else v_head_inv end,
    head_invoice_qty      = case when v_incl_head is distinct from true or v_head_inv is distinct from true
                                 then null else nullif(p->>'head_invoice_qty', '')::integer end,
    head_invoice_amount   = case when v_incl_head is distinct from true or v_head_inv is distinct from true
                                 then null else nullif(p->>'head_invoice_amount', '')::numeric end,

    dryer_chambers  = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_chambers'), '') end,
    heating_mode    = case when not v_has_dryer then null else nullif(btrim(p->>'heating_mode'), '') end,
    dryer_warranty  = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_warranty'), '') end,
    platter_details = nullif(btrim(p->>'platter_details'), ''),

    dryer_name      = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_name'), '') end,
    dryer_included  = case when not v_has_dryer then null else (p->>'dryer_included')::boolean end,
    dryer_price     = v_dry_price,

    dryer_ship_mode        = case when not v_has_dryer then null else v_dry_ship end,
    dryer_ship_via         = case when not v_has_dryer or v_dry_ship is distinct from 'separate'
                                  then null else nullif(btrim(p->>'dryer_ship_via'), '') end,
    dryer_separate_invoice = case when not v_has_dryer then null else v_dry_inv end,
    dryer_invoice_qty      = case when not v_has_dryer or v_dry_inv is distinct from true
                                  then null else nullif(p->>'dryer_invoice_qty', '')::integer end,
    dryer_invoice_amount   = case when not v_has_dryer or v_dry_inv is distinct from true
                                  then null else nullif(p->>'dryer_invoice_amount', '')::numeric end,

    spares_ship_mode        = case when v_incl_spares is distinct from true then null else v_spr_ship end,
    spares_ship_via         = case when v_incl_spares is distinct from true or v_spr_ship is distinct from 'separate'
                                   then null else nullif(btrim(p->>'spares_ship_via'), '') end,
    spares_separate_invoice = case when v_incl_spares is distinct from true then null else v_spr_inv end,
    spares_invoice_qty      = case when v_incl_spares is distinct from true or v_spr_inv is distinct from true
                                   then null else nullif(p->>'spares_invoice_qty', '')::integer end,
    spares_invoice_amount   = case when v_incl_spares is distinct from true or v_spr_inv is distinct from true
                                   then null else nullif(p->>'spares_invoice_amount', '')::numeric end,

    -- ⚠ UNTOUCHED BY OCPI-10, all five. The centering device's shipment
    --   questions follow the machine exactly as they always have.
    centering_ship_mode        = case when coalesce(v_centering, 'no') = 'no' then null else v_cen_ship end,
    centering_ship_via         = case when coalesce(v_centering, 'no') = 'no' or v_cen_ship is distinct from 'separate'
                                      then null else nullif(btrim(p->>'centering_ship_via'), '') end,
    centering_separate_invoice = case when coalesce(v_centering, 'no') = 'no' then null else v_cen_inv end,
    centering_invoice_qty      = case when coalesce(v_centering, 'no') = 'no' or v_cen_inv is distinct from true
                                      then null else nullif(p->>'centering_invoice_qty', '')::integer end,
    centering_invoice_amount   = case when coalesce(v_centering, 'no') = 'no' or v_cen_inv is distinct from true
                                      then null else nullif(p->>'centering_invoice_amount', '')::numeric end,

    -- ⚠ THREE OF THESE FOUR NO LONGER READ THE MACHINE, ON PURPOSE (OCPI-10).
    --   Air blade, ink dust exhauster and chilling system are asked on every
    --   deal now, so the salesperson's answer is stored as given. Restoring a
    --   machine-capability guard on any of these three would silently
    --   discard the answer on 25 of the 28 machines -- that WAS the bug this
    --   migration exists to remove. Assertion 2 objects if one comes back.
    air_blade           = (p->>'air_blade')::boolean,
    -- ⚠ ... AND THE FOURTH STILL DOES. External centering follows the dryer's
    --   logic by the client's own instruction: backed by the machine, or not
    --   asked at all. It is still a gated field, so it still clears. Do not
    --   tidy this into matching the three around it.
    external_centering  = case when coalesce(v_centering, 'no') = 'no' then null else (p->>'external_centering')::boolean end,
    ink_dust_exhauster  = (p->>'ink_dust_exhauster')::boolean,
    chilling_system     = (p->>'chilling_system')::boolean,

    -- Section B's eighth pointer. Free text, never gated, and NOT the retired
    -- other_commitments on the line below it.
    other_inclusions         = nullif(btrim(p->>'other_inclusions'), ''),

    other_commitments        = nullif(btrim(p->>'other_commitments'), ''),
    printer_warranty         = nullif(btrim(p->>'printer_warranty'), ''),
    head_warranty            = nullif(btrim(p->>'head_warranty'), ''),
    post_warranty_head_price = nullif(p->>'post_warranty_head_price', '')::numeric,
    consumables_supplier     = nullif(btrim(p->>'consumables_supplier'), ''),
    insurance_clause_agreed  = (p->>'insurance_clause_agreed')::boolean,

    ref_no            = nullif(btrim(p->>'ref_no'), ''),
    delivery_days     = nullif(btrim(p->>'delivery_days'), ''),
    trade_term        = nullif(btrim(p->>'trade_term'), ''),
    machine_model_no  = nullif(btrim(p->>'machine_model_no'), ''),
    prepared_by       = nullif(btrim(p->>'prepared_by'), ''),
    approved_by       = nullif(btrim(p->>'approved_by'), ''),

    -- Derived, not taken from the payload.
    gst_rate          = v_rate,
    machine_value_inr = v_value,
    gst_amount_inr    = v_gst,
    total_inr         = case when v_value is null then null else v_value + coalesce(v_gst, 0) end,
    dryer_value_inr   = v_dry_inr,
    dryer_gst_inr     = v_dry_gst,
    grand_total_inr   = v_grand
  where id = p_deal;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- fms_ocpi_save_draft -- one key added to the part-B sniff array.
--
-- ⚠ THE WHOLE OF THE CHANGE IS ONE STRING, and leaving it out would have been
--   invisible: without 'other_inclusions' in this array, a payload carrying
--   only that new key would never reach write_oc and the text would never
--   land. In practice the form always sends the four extras too, so the array
--   would have matched anyway -- which is exactly why it is worth adding
--   rather than relying on.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.fms_ocpi_save_draft(p jsonb, p_deal uuid default null::uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid := p_deal;
  v_status text;
  v_owner  uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if nullif(btrim(p->>'customer_name'), '') is null then
    raise exception 'Enter the customer name before saving';
  end if;

  if v_id is null then
    if not public.fms_ocpi_can_act('quotation', null, v_uid) then
      raise exception 'You are not authorized to raise a quotation';
    end if;
    insert into public.fms_ocpi_deals (raised_by, status, current_step)
    values (v_uid, 'draft', 'quotation')
    returning id into v_id;
  else
    select status, raised_by into v_status, v_owner
      from public.fms_ocpi_deals where id = v_id for update;
    if v_status is null then raise exception 'Quotation not found'; end if;
    if v_status <> 'draft' then
      raise exception 'This quotation has already been submitted - use Edit instead';
    end if;
    if v_owner is distinct from v_uid and not public.fms_ocpi_is_coordinator(v_uid) then
      raise exception 'This draft belongs to someone else';
    end if;
  end if;

  -- ORDER IS SEMANTIC: write_oc branches on part-A answers it reads off the
  -- row, so part A must already be written.
  perform public.fms_ocpi_write_quotation(v_id, p);

  -- THE EASIEST THING IN THIS MODULE TO MISS. write_oc runs ONLY when the bag
  -- carries one of these literal key names. A new part-B field left off this
  -- list is never written at all - no error, no warning, the value simply never
  -- lands. QT-M0037 is what that looks like from outside: 36 keys, none of them
  -- part B, so write_oc never ran and its paper prints a blank total.
  if p ?| array[
       'head_ship_mode', 'head_ship_via', 'head_balance_remarks', 'head_separate_invoice',
       'head_invoice_qty', 'head_invoice_amount',
       'dryer_chambers', 'heating_mode', 'dryer_warranty', 'platter_details',
       'dryer_name', 'dryer_included', 'dryer_price',
       'dryer_ship_mode', 'dryer_ship_via', 'dryer_separate_invoice',
       'dryer_invoice_qty', 'dryer_invoice_amount',
       'spares_ship_mode', 'spares_ship_via', 'spares_separate_invoice',
       'spares_invoice_qty', 'spares_invoice_amount',
       'centering_ship_mode', 'centering_ship_via', 'centering_separate_invoice',
       'centering_invoice_qty', 'centering_invoice_amount',
       'air_blade', 'external_centering', 'ink_dust_exhauster', 'chilling_system',
       'other_inclusions',
       'other_commitments', 'printer_warranty', 'head_warranty', 'post_warranty_head_price',
       'consumables_supplier', 'insurance_clause_agreed',
       'ref_no', 'delivery_days', 'trade_term', 'machine_model_no',
       'prepared_by', 'approved_by', 'gst_rate', 'machine_value_inr'
     ] then
    perform public.fms_ocpi_write_oc(v_id, p);
  end if;

  return v_id;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- Machine checks. Each one is a way this migration could be silently undone.
-- ────────────────────────────────────────────────────────────────────────────
do $check$
declare
  v_def text;
  v_n   integer;
begin
  -- 1 · The column exists.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'fms_ocpi_deals'
       and column_name = 'other_inclusions'
  ) then
    raise exception 'OCPI-10: other_inclusions was not added';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_oc';
  if v_def is null then raise exception 'OCPI-10: fms_ocpi_write_oc missing after replace'; end if;

  -- 2 · THE POINT OF THE WHOLE MIGRATION. None of the three ungated extras may
  --     be guarded on a machine capability again. This is what objects if an
  --     older body is restored over this one -- the failure mode the work list
  --     warned about, and the one that nothing else would catch.
  if v_def ~ 'v_air' or v_def ~ 'v_exhauster' or v_def ~ 'v_chilling' then
    raise exception 'OCPI-10: write_oc still reads a machine capability for air blade / exhauster / chilling - an older body was restored';
  end if;
  if v_def not like '%air_blade           = (p->>''air_blade'')::boolean%'
  or v_def not like '%ink_dust_exhauster  = (p->>''ink_dust_exhauster'')::boolean%'
  or v_def not like '%chilling_system     = (p->>''chilling_system'')::boolean%' then
    raise exception 'OCPI-10: write_oc does not store all three ungated extras as given';
  end if;

  -- 3 · THE EXCEPTION SURVIVES. External centering is still a gated field --
  --     both its tick and its five shipment lines, so six uses of v_centering.
  if v_def not like '%external_centering  = case when coalesce(v_centering, ''no'') = ''no'' then null%' then
    raise exception 'OCPI-10: external_centering lost its gate - it is the one extra that keeps it';
  end if;
  v_n := (length(v_def) - length(replace(v_def, 'coalesce(v_centering', ''))) / length('coalesce(v_centering');
  if v_n <> 6 then
    raise exception 'OCPI-10: expected 6 centering guards (1 tick + 5 shipment), found %', v_n;
  end if;

  -- 4 · THE ALIGNMENT CHECK. Three columns and three targets came out of the
  --     select together; this proves v_centering is still fed by
  --     opt_external_centering and not by a neighbour that shifted up.
  if v_def not like '%m.opt_external_centering%'
  or v_def like '%m.opt_air_blade%'
  or v_def like '%m.opt_ink_dust_exhauster%'
  or v_def like '%m.opt_chilling_system%' then
    raise exception 'OCPI-10: write_oc still selects a removed machine capability - the select/into lists are out of step';
  end if;

  -- 5 · The new column is written.
  if v_def not like '%other_inclusions         = nullif(btrim(p->>''other_inclusions''), '''')%' then
    raise exception 'OCPI-10: write_oc does not write other_inclusions';
  end if;

  -- 6 · OCPI-7's money guard, restated so THIS change is checked against it
  --     too. write_oc owns every rupee derivation on this table and must not
  --     have learned about an offer column.
  if v_def like '%offer_subtotal%' or v_def like '%offer_rate%' or v_def like '%offer_qty%' then
    raise exception 'OCPI-10: fms_ocpi_write_oc mentions an offer column - a deal total must never include one';
  end if;

  -- 7 · The sniff array carries the new key, or a payload of only that key
  --     would never reach write_oc.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_save_draft';
  if v_def is null then raise exception 'OCPI-10: fms_ocpi_save_draft missing after replace'; end if;
  if v_def not like '%''other_inclusions''%' then
    raise exception 'OCPI-10: save_draft part-B key array does not carry other_inclusions';
  end if;
end $check$;

commit;
