-- OD-13 · P1 — who the customer is, built for N customers rather than for two.
--
-- Bishen and Ganga are the first two, not the design. Everything here is per-row
-- configuration edited on a screen: **adding the tenth customer must be a ten-minute Setup
-- job for an admin, with no migration, no deploy and no developer.** That requirement is
-- what shapes the two tables below.
--
-- WHY TWO TABLES AND NOT ONE
-- --------------------------
-- The CUSTOMER and the LOGIN are separate from day one. Today that is one login each, which
-- is decision Q3 ("one login per customer, not per person"). The day Bishen wants a second
-- person it is one more row in `fms_dispatch_customer_logins` -- no migration -- and their
-- order history does not fragment, because everything downstream keys on `org_id` rather
-- than on `raised_by`.
--
-- ⚠ This is a deliberate ONE-CLAUSE deviation from Q3, and it is the only one. Q3 says not
--   to build the per-customer read predicate yet. It is built because multi-customer
--   readiness was asked for explicitly, and the cost is a single EXISTS in a policy that
--   already exists -- whereas retrofitting it later means splitting a live order history.
--   Q3's *decision* (one shared login per customer to start) is untouched.
--
-- WHAT THE TICK LIST IS FOR (Q11), AND THE CONSTRAINT NOBODY WOULD THINK TO ADD
-- ----------------------------------------------------------------------------
-- "Bishen Dyeing" is not one row in `mst_parties`. It is five, one per Tally book, plus two
-- more the client said explicitly must NOT be ticked:
--
--     BISHEN DYEING PRINTING & WEAVING MILLS              x5  (five books)   <- ticked
--     BISHEN DYEING PRINTING & WEAVING MILLS(MACHINE)                        <- NOT ticked
--     BISHEN DYEING PRINTING & WEAVING MILLS -OLD MACHINE                    <- NOT ticked
--
-- At credit check we pick the billing company, and the order's `customer_id` is re-pointed
-- to the ticked ledger belonging to THAT company (P4). That only works if the tick list
-- holds **at most one ledger per company** -- otherwise "which Bishen?" has two answers and
-- the re-point is a coin toss. Nothing in the data enforces it, so
-- `fms_dispatch_save_customer_org` does, at save time, which is the only moment a human can
-- still see the mistake. A ticked ledger with **no** company is refused for the same
-- reason: it could never be chosen, so ticking it is a trap for whoever reads the list next.
--
-- ACTIVE DEFAULTS TO FALSE, ON PURPOSE
-- ------------------------------------
-- A half-built customer must not be live. `active` starts false and the save RPC REFUSES to
-- set it true while anything is missing -- no ledgers, no notification recipient, or **no
-- mapped items** (a customer whose `mst_party_items` union is empty opens the app to an
-- empty picker and cannot order at all, which looks like a broken app rather than an
-- unfinished setup). The reason is returned in the error, not merely logged.
--
-- ⚠ `fms_dispatch_customer_org_of()` requires BOTH the login and the org to be active, so
--   deactivating an org logs that customer out of ordering. It is deliberately NOT used by
--   the staff-side recipient arm in P2: staff must still be able to open the old orders of a
--   customer that has since been switched off. Any reader that needs "who raised this,
--   historically" must go to the tables directly, not through this helper.
--
-- SAFETY
-- ------
-- Additive only: two new tables, four new functions, no existing object altered. Nothing
-- here grants anybody anything until a row is created and activated on the Setup screen,
-- and there are no rows yet -- so this migration is inert on the day it lands.

begin;

-- ---------------------------------------------------------------------------
-- 1 · The customer.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_dispatch_customer_orgs (
  id                    uuid primary key default gen_random_uuid(),

  -- What THEY see, at the head of their own app. Never a Tally ledger name.
  display_name          text not null,

  -- The tick list (Q11). At most one ledger per company; see the header.
  party_ids             uuid[] not null default '{}',
  -- The provisional customer_id an order is raised against, before credit check
  -- knows which book bills it (P3). Must be one of party_ids.
  primary_party_id      uuid references public.mst_parties(id),

  -- Shown to them as text, seeded from mst_parties.location. They do not pick it.
  customer_location     text,

  -- Q8: who we tell. Never hardcoded, never empty, never defaulted to nobody.
  notify_user_ids       uuid[] not null default '{}',

  -- Optional shortcuts that PRE-FILL credit check; never a decision (Q1/Q2 stand).
  -- Justified by the data: all 24 sampled orders for both customers dispatched from
  -- SURAT-HOJIWALA. They are what stops credit check getting slower as customers are added.
  default_location_id   uuid references public.mst_locations(id),
  default_dispatch_type text,

  active                boolean not null default false,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),

  constraint fms_dispatch_customer_orgs_type_chk
    check (default_dispatch_type is null or default_dispatch_type in ('local','transport')),
  constraint fms_dispatch_customer_orgs_name_chk
    check (length(trim(display_name)) > 0)
);

comment on table public.fms_dispatch_customer_orgs is
  'One row per CUSTOMER who may place their own orders (OD-13). Owns the ticked-ledger list, '
  'the notification recipients and the credit-check pre-fills. Edited only from Order to '
  'Dispatch -> Setup -> Customer Logins, through fms_dispatch_save_customer_org().';

-- ---------------------------------------------------------------------------
-- 2 · The login.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_dispatch_customer_logins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  org_id     uuid not null references public.fms_dispatch_customer_orgs(id) on delete restrict,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

comment on table public.fms_dispatch_customer_logins is
  'Which customer a login belongs to. PRIMARY KEY on profile_id: one login is one customer, '
  'never two. Today one row per org (Q3); a second person at the same customer is one more '
  'row and no migration.';

create index if not exists fms_dispatch_customer_logins_org_idx
  on public.fms_dispatch_customer_logins (org_id);

-- ---------------------------------------------------------------------------
-- 3 · The helper everything downstream is expressed through.
-- ---------------------------------------------------------------------------
-- Returns the caller's org, or NULL for staff. Every rule in P2/P3/P4 goes through this, so
-- nothing hard-codes a customer. SECURITY DEFINER because the caller is external and cannot
-- read either table under RLS.
create or replace function public.fms_dispatch_customer_org_of(p_uid uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select l.org_id
    from public.fms_dispatch_customer_logins l
    join public.fms_dispatch_customer_orgs g on g.id = l.org_id
   where l.profile_id = p_uid
     and l.active
     and g.active
   limit 1;
$fn$;

comment on function public.fms_dispatch_customer_org_of(uuid) is
  'The customer this login belongs to, or NULL for staff. Requires BOTH the login and the '
  'org to be active, so deactivating either stops ordering. Do NOT use it to answer "who '
  'raised this order, historically" -- that must read the tables directly, or staff lose '
  'sight of a switched-off customer''s old orders.';

-- One site of ours, active, belonging to one company of ours. Lifted verbatim from
-- fms_dispatch_submit_order so the org defaults cannot drift from what intake enforces.
-- (⚠ submit_order is NOT rewritten to call this here -- that is a change to the staff flow,
--  which this task must not touch. It is folded in at P4, where the same predicate is needed
--  a third time and the three can be proved identical together.)
create or replace function public.fms_dispatch_location_is_active_for_company(
  p_location uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1
      from public.mst_locations loc
      join public.mst_company_locations cl on cl.location_id = loc.id
     where loc.id = p_location
       and cl.company_id = p_company
       and loc.active
       and cl.active
  );
$fn$;

-- ---------------------------------------------------------------------------
-- 4 · RLS — coordinators and admins, nobody else.
-- ---------------------------------------------------------------------------
-- The customer never reads these tables. Their whole screen is served by SECURITY DEFINER
-- RPCs (P3/P5), which is what keeps the ticked-ledger list off the wire entirely -- Q11 says
-- "the customer never sees this list", and the cheapest way to honour that is for it never
-- to be sent.
alter table public.fms_dispatch_customer_orgs   enable row level security;
alter table public.fms_dispatch_customer_logins enable row level security;

drop policy if exists fms_dispatch_customer_orgs_select on public.fms_dispatch_customer_orgs;
create policy fms_dispatch_customer_orgs_select on public.fms_dispatch_customer_orgs
  for select to authenticated
  using ((select public.fms_dispatch_is_coordinator((select auth.uid()))));

drop policy if exists fms_dispatch_customer_orgs_write on public.fms_dispatch_customer_orgs;
create policy fms_dispatch_customer_orgs_write on public.fms_dispatch_customer_orgs
  for all to authenticated
  using      ((select public.fms_dispatch_is_coordinator((select auth.uid()))))
  with check ((select public.fms_dispatch_is_coordinator((select auth.uid()))));

drop policy if exists fms_dispatch_customer_logins_select on public.fms_dispatch_customer_logins;
create policy fms_dispatch_customer_logins_select on public.fms_dispatch_customer_logins
  for select to authenticated
  using ((select public.fms_dispatch_is_coordinator((select auth.uid()))));

drop policy if exists fms_dispatch_customer_logins_write on public.fms_dispatch_customer_logins;
create policy fms_dispatch_customer_logins_write on public.fms_dispatch_customer_logins
  for all to authenticated
  using      ((select public.fms_dispatch_is_coordinator((select auth.uid()))))
  with check ((select public.fms_dispatch_is_coordinator((select auth.uid()))));

-- ---------------------------------------------------------------------------
-- 5 · Is this customer finished? One answer, used by the screen AND by the save.
-- ---------------------------------------------------------------------------
-- Deliberately a function over VALUES rather than over a saved row, so the Setup screen can
-- ask "would this be ready?" before saving and the RPC can ask "is this ready?" while
-- saving, and the two can never disagree.
create or replace function public.fms_dispatch_customer_org_readiness(
  p_party_ids uuid[], p_notify_user_ids uuid[], p_primary_party_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select jsonb_build_object(
    'missing', coalesce(jsonb_agg(m order by m), '[]'::jsonb),
    'item_count', (
      select count(distinct i.name)
        from public.mst_party_items pi
        join public.mst_items i on i.id = pi.item_id
       where pi.party_id = any (coalesce(p_party_ids, '{}'::uuid[]))
         and i.active
    )
  )
  from (
    select 'ledgers' as m
     where coalesce(cardinality(p_party_ids), 0) = 0
    union all
    select 'primary_ledger'
     where p_primary_party_id is null
        or not (p_primary_party_id = any (coalesce(p_party_ids, '{}'::uuid[])))
    union all
    select 'recipients'
     where coalesce(cardinality(p_notify_user_ids), 0) = 0
    union all
    select 'items'
     where not exists (
       select 1 from public.mst_party_items pi
        join public.mst_items i on i.id = pi.item_id
        where pi.party_id = any (coalesce(p_party_ids, '{}'::uuid[])) and i.active
     )
  ) s;
$fn$;

comment on function public.fms_dispatch_customer_org_readiness(uuid[], uuid[], uuid) is
  'What is still missing before this customer can be switched on, as a jsonb list. Takes '
  'VALUES rather than an org id so the Setup screen can ask before saving and the save RPC '
  'can ask while saving, and the two can never disagree.';

-- ---------------------------------------------------------------------------
-- 6 · The one way to write a customer.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_save_customer_org(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_id       uuid := nullif(trim(p->>'id'), '')::uuid;
  v_name     text := nullif(trim(p->>'display_name'), '');
  v_parties  uuid[];
  v_notify   uuid[];
  v_primary  uuid := nullif(trim(p->>'primary_party_id'), '')::uuid;
  v_loc      uuid := nullif(trim(p->>'default_location_id'), '')::uuid;
  v_type     text := nullif(lower(trim(p->>'default_dispatch_type')), '');
  v_active   boolean := coalesce((p->>'active')::boolean, false);
  v_ready    jsonb;
  v_missing  text;
  v_bad      text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then
    raise exception 'Only an admin or a process coordinator can set up customer logins';
  end if;
  if v_name is null then raise exception 'Give the customer a name -- this is what they see on their own screen'; end if;

  select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_parties
    from jsonb_array_elements_text(coalesce(p->'party_ids', '[]'::jsonb)) t(x);
  select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_notify
    from jsonb_array_elements_text(coalesce(p->'notify_user_ids', '[]'::jsonb)) t(x);

  -- --- the ticked ledgers -------------------------------------------------
  select string_agg(x::text, ', ') into v_bad
    from unnest(v_parties) x
   where not exists (select 1 from public.mst_parties mp
                      where mp.id = x and mp.is_customer and mp.active);
  if v_bad is not null then
    raise exception 'One of the ticked ledgers is not an active customer ledger (%)', v_bad;
  end if;

  -- A ledger with no company could never be chosen at credit check.
  select string_agg(mp.name, ', ') into v_bad
    from public.mst_parties mp
   where mp.id = any (v_parties) and mp.company_id is null;
  if v_bad is not null then
    raise exception 'This ledger has no billing company, so credit check could never choose it: %', v_bad;
  end if;

  -- ⚠ THE ONE NOBODY WOULD THINK TO ADD. Two ticked ledgers in the same book make
  --   "which customer is this?" ambiguous at credit check, and the re-point in P4 a coin toss.
  select string_agg(c.name, ', ') into v_bad
    from (select mp.company_id, count(*) n
            from public.mst_parties mp
           where mp.id = any (v_parties)
           group by mp.company_id having count(*) > 1) d
    join public.mst_companies c on c.id = d.company_id;
  if v_bad is not null then
    raise exception 'Two ticked ledgers belong to the same billing company (%). Tick only one per company, or credit check cannot tell them apart.', v_bad;
  end if;

  if v_primary is not null and not (v_primary = any (v_parties)) then
    raise exception 'The main ledger must be one of the ticked ledgers';
  end if;

  -- --- who we tell (Q8) ---------------------------------------------------
  select string_agg(coalesce(pr.name, x::text), ', ') into v_bad
    from unnest(v_notify) x
    left join public.profiles pr on pr.id = x
   where pr.id is null
      or coalesce(pr.is_external, false)
      or not public.module_can_edit(x, 'order-to-dispatch');
  if v_bad is not null then
    raise exception 'These people cannot be told about this customer''s orders -- they need edit access to Order to Dispatch: %', v_bad;
  end if;
  -- (The P2 read arm is defined BY notify_user_ids, so a named recipient satisfies it by
  --  construction. Edit access to the module is the part that is not automatic.)

  -- --- the optional pre-fills --------------------------------------------
  if v_type is not null and v_type not in ('local','transport') then
    raise exception 'Dispatch type must be Local or Transport';
  end if;
  if v_loc is not null and not exists (
       select 1 from public.mst_parties mp
        where mp.id = any (v_parties)
          and public.fms_dispatch_location_is_active_for_company(v_loc, mp.company_id))
  then
    raise exception 'That dispatch location is not an active site of any of the ticked ledgers'' companies';
  end if;

  -- --- readiness, and only when switching ON ------------------------------
  if v_active then
    v_ready := public.fms_dispatch_customer_org_readiness(v_parties, v_notify, v_primary);
    if jsonb_array_length(v_ready->'missing') > 0 then
      select string_agg(
               case x when 'ledgers'        then 'no ledgers are ticked'
                      when 'primary_ledger' then 'no main ledger is chosen'
                      when 'recipients'     then 'nobody is set to be told about their orders'
                      when 'items'          then 'none of the ticked ledgers has a single item mapped to it, so their order screen would be empty'
                      else x end, '; ')
        into v_missing
        from jsonb_array_elements_text(v_ready->'missing') t(x);
      raise exception 'This customer is not ready to switch on: %', v_missing;
    end if;
  end if;

  -- --- write --------------------------------------------------------------
  if v_id is null then
    insert into public.fms_dispatch_customer_orgs (
      display_name, party_ids, primary_party_id, customer_location,
      notify_user_ids, default_location_id, default_dispatch_type, active,
      created_by, updated_by)
    values (
      v_name, v_parties, v_primary, nullif(trim(p->>'customer_location'), ''),
      v_notify, v_loc, v_type, v_active, v_uid, v_uid)
    returning id into v_id;
  else
    update public.fms_dispatch_customer_orgs
       set display_name          = v_name,
           party_ids             = v_parties,
           primary_party_id      = v_primary,
           customer_location     = nullif(trim(p->>'customer_location'), ''),
           notify_user_ids       = v_notify,
           default_location_id   = v_loc,
           default_dispatch_type = v_type,
           active                = v_active,
           updated_at            = now(),
           updated_by            = v_uid
     where id = v_id;
    if not found then raise exception 'That customer no longer exists'; end if;
  end if;

  return v_id;
end $fn$;

-- ---------------------------------------------------------------------------
-- 7 · Attaching a login to a customer.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_link_customer_login(p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_profile uuid := nullif(trim(p->>'profile_id'), '')::uuid;
  v_org     uuid := nullif(trim(p->>'org_id'), '')::uuid;
  v_active  boolean := coalesce((p->>'active')::boolean, true);
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then
    raise exception 'Only an admin or a process coordinator can set up customer logins';
  end if;
  if v_profile is null or v_org is null then raise exception 'A login and a customer are both required'; end if;
  if not exists (select 1 from public.fms_dispatch_customer_orgs where id = v_org) then
    raise exception 'That customer no longer exists';
  end if;

  -- ⚠ Refusing a STAFF profile here is the whole point. Linking one would hand a colleague
  --   the customer's ordering screen and, worse, silence every internal notification they
  --   are meant to receive, because P3 filters announcements by exactly this table.
  if not exists (select 1 from public.profiles where id = v_profile and coalesce(is_external, false)) then
    raise exception 'That login is one of our own staff accounts. Only an external (customer) account can be linked.';
  end if;

  insert into public.fms_dispatch_customer_logins (profile_id, org_id, active, created_by)
  values (v_profile, v_org, v_active, v_uid)
  on conflict (profile_id) do update
    set org_id = excluded.org_id,
        active = excluded.active;
end $fn$;

-- ---------------------------------------------------------------------------
-- 8 · What the Setup screen reads.
-- ---------------------------------------------------------------------------
-- One call, enriched server-side: the item count and the readiness verdict both need
-- queries the browser has no business running, and keeping readiness on the server is what
-- stops the screen and the save RPC disagreeing about what "ready" means.
create or replace function public.fms_dispatch_customer_orgs_admin()
returns table (
  id uuid, display_name text, party_ids uuid[], party_names text[],
  primary_party_id uuid, primary_party_name text, customer_location text,
  notify_user_ids uuid[], notify_names text[],
  default_location_id uuid, default_dispatch_type text,
  active boolean, login_count integer, item_count integer, missing text[]
)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select g.id, g.display_name, g.party_ids,
         (select coalesce(array_agg(mp.name order by c.name), '{}')
            from public.mst_parties mp left join public.mst_companies c on c.id = mp.company_id
           where mp.id = any (g.party_ids)),
         g.primary_party_id,
         (select mp.name from public.mst_parties mp where mp.id = g.primary_party_id),
         g.customer_location,
         g.notify_user_ids,
         (select coalesce(array_agg(pr.name order by pr.name), '{}')
            from public.profiles pr where pr.id = any (g.notify_user_ids)),
         g.default_location_id, g.default_dispatch_type, g.active,
         (select count(*)::integer from public.fms_dispatch_customer_logins l
           where l.org_id = g.id and l.active),
         (r.value->>'item_count')::integer,
         (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(r.value->'missing') t(x))
    from public.fms_dispatch_customer_orgs g
    cross join lateral (
      select public.fms_dispatch_customer_org_readiness(
               g.party_ids, g.notify_user_ids, g.primary_party_id) as value
    ) r
   where public.fms_dispatch_is_coordinator(auth.uid())
   order by g.display_name;
$fn$;

revoke execute on function public.fms_dispatch_save_customer_org(jsonb)      from public, anon;
revoke execute on function public.fms_dispatch_link_customer_login(jsonb)    from public, anon;
revoke execute on function public.fms_dispatch_customer_orgs_admin()         from public, anon;
revoke execute on function public.fms_dispatch_customer_org_readiness(uuid[], uuid[], uuid) from public, anon;
revoke execute on function public.fms_dispatch_customer_org_of(uuid)         from public, anon;
revoke execute on function public.fms_dispatch_location_is_active_for_company(uuid, uuid) from public, anon;

grant execute on function public.fms_dispatch_save_customer_org(jsonb)      to authenticated, service_role;
grant execute on function public.fms_dispatch_link_customer_login(jsonb)    to authenticated, service_role;
grant execute on function public.fms_dispatch_customer_orgs_admin()         to authenticated, service_role;
grant execute on function public.fms_dispatch_customer_org_readiness(uuid[], uuid[], uuid) to authenticated, service_role;
grant execute on function public.fms_dispatch_customer_org_of(uuid)         to authenticated, service_role;
grant execute on function public.fms_dispatch_location_is_active_for_company(uuid, uuid) to authenticated, service_role;

commit;
