-- ===========================================================================
-- MASTER REQUESTS: an approved COMPANY keeps its gate pass prefix.
--
-- WHY NOW. Every master behind the sales-order intake form can be requested
-- from the picker that needs it — including the billing company and our own
-- dispatch locations, which used to be left out of the "request a new entry"
-- picker on the theory that they were one-time configuration. They are still
-- reviewed by the master's owner before a row exists; what changed is only that
-- the person mid-order can ask.
--
-- ⚠ WIRE CONTRACT. `lib/masterFields.ts` has always put `gate_pass_prefix` into
--   a company's proposed_payload — the form collects it — but the company arm
--   below never read it, so approving a company silently dropped the prefix and
--   the new entity quietly issued GP-... passes instead of its own series. That
--   was invisible while companies could not be requested. It is not any more.
--
-- Everything else in this function is unchanged from 20260819120000.
-- ===========================================================================

create or replace function public.fms_dispatch_resolve_master_request(
  p_request_id uuid, p_approve boolean, p_payload jsonb default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_type text; v_status text; v_payload jsonb; v_new_id uuid; v_name text;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_dispatch_master_requests where id = p_request_id for update;

  if v_type is null then raise exception 'Master request % not found', p_request_id; end if;
  if v_status <> 'pending' then raise exception 'Master request % is already %', p_request_id, v_status; end if;

  if not (public.is_admin(auth.uid()) or public.fms_dispatch_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);
  v_name    := nullif(trim(v_payload->>'name'), '');

  if p_approve then
    -- ⚠ customer_item is EXEMPT from the name check. A mapping row has no name of
    --   its own — it is described by the pair it names — so demanding one here
    --   would make every mapping request unapprovable.
    if v_name is null and v_type <> 'customer_item' then
      raise exception 'A name is required to approve a master request';
    end if;

    if v_type = 'company' then
      -- gate_pass_prefix: blank is legal and falls back to GP at print time; two
      -- companies sharing one prefix is rejected by the unique index, which is
      -- the point — the two series would otherwise interleave into one.
      insert into public.fms_dispatch_companies (name, gstin, address, gate_pass_prefix, created_by)
      values (v_name,
              nullif(trim(v_payload->>'gstin'),''),
              nullif(trim(v_payload->>'address'),''),
              nullif(trim(v_payload->>'gate_pass_prefix'),''),
              auth.uid())
      returning id into v_new_id;

    elsif v_type = 'customer' then
      insert into public.fms_dispatch_customers
        (name, code, location, gstin, contact_name, phone, email, created_by)
      values (v_name,
              nullif(trim(v_payload->>'code'),''),
              nullif(trim(v_payload->>'location'),''),
              nullif(trim(v_payload->>'gstin'),''),
              nullif(trim(v_payload->>'contact_name'),''),
              nullif(trim(v_payload->>'phone'),''),
              nullif(trim(v_payload->>'email'),''),
              auth.uid())
      returning id into v_new_id;

    elsif v_type = 'item' then
      insert into public.fms_dispatch_items (name, code, unit, hsn_code, created_by)
      values (v_name,
              nullif(trim(v_payload->>'code'),''),
              nullif(trim(v_payload->>'unit'),''),
              nullif(trim(v_payload->>'hsn_code'),''),
              auth.uid())
      returning id into v_new_id;

    elsif v_type = 'customer_item' then
      if nullif(trim(v_payload->>'customer_id'),'') is null
         or nullif(trim(v_payload->>'item_id'),'') is null then
        raise exception 'A mapping needs both a customer and an item';
      end if;
      insert into public.fms_dispatch_customer_items (customer_id, item_id, created_by)
      values ((v_payload->>'customer_id')::uuid, (v_payload->>'item_id')::uuid, auth.uid())
      returning id into v_new_id;

    elsif v_type = 'company_location' then
      -- A location without its company is not a location, it is a word.
      if nullif(trim(v_payload->>'company_id'),'') is null then
        raise exception 'A location needs the company it belongs to';
      end if;
      insert into public.fms_dispatch_company_locations (name, company_id, created_by)
      values (v_name, (v_payload->>'company_id')::uuid, auth.uid())
      returning id into v_new_id;

    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_dispatch_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_dispatch_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;

-- ---------------------------------------------------------------- asserts --
--
-- ⚠ MATCH CODE, NOT PROSE — pg_get_functiondef returns the comments too, and the
--   comment above names the very column being tested.
do $check$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_resolve_master_request';
  if v_def is null then raise exception 'resolve_master_request missing after replace'; end if;
  if v_def not like '%address, gate_pass_prefix, created_by%' then
    raise exception 'the company arm still drops the gate pass prefix';
  end if;
  -- Every arm still present: this replace must not have narrowed the function.
  if v_def not like '%fms_dispatch_customer_items%' then raise exception 'lost the customer_item arm'; end if;
  if v_def not like '%fms_dispatch_company_locations%' then raise exception 'lost the company_location arm'; end if;
end $check$;
