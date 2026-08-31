-- ===========================================================================
-- TRAVEL DESK FMS — DEMO SEED.
--
-- Parks one trip at EVERY status the module can reach, so every screen, every
-- queue, every panel, every report and every dashboard tile has something real
-- in it and the module can be clicked through end to end.
--
-- ---------------------------------------------------------------------------
-- HOW THIS IS BUILT, AND WHY IT MATTERS
--
-- Every state change below goes through THE REAL RPC, called AS A REAL PERSON
-- (`set_config('request.jwt.claims', …)` makes `auth.uid()` answer, so
-- `fms_travel_can_act()` is genuinely exercised). Nothing is inserted straight
-- into fms_travel_trips — it has no write policy at all, by design. Running this
-- file is therefore itself an end-to-end test of the module: if an authorization
-- rule or a transition guard is wrong, THE SEED FAILS rather than quietly
-- manufacturing a state the app could never reach.
--
-- Raw UPDATEs are used for THREE things only:
--   1. RENUMBERING to the TRV-DEMO-nn series (the RPC issues the real
--      TRV-<FY>-nnnn number, because that is what really happens);
--   2. BACKDATING the timestamps the RPCs stamped with now(), so the demo looks
--      aged and some items are genuinely overdue;
--   3. ONE `fms_travel_legs.entitled_fare` (see §16 note below).
-- No workflow state is written by hand.
--
-- ---------------------------------------------------------------------------
-- ⭐ THE CAST IS FOUR PORTAL ADMINS, AND THAT IS A DELIBERATE RESTRAINT.
--
-- `fms_travel_can_act()` opens with `module_can_edit(uid, 'travel-desk')`, and
-- there is not one `app_access` row for travel-desk in this database — the
-- module has not been granted to anybody yet, because TRAVEL-DESK.md says go-live
-- is blocked on HR (H1). Impersonating the *real* Travel Desk (Tanisha Tikde),
-- the *real* CFO (Ritesh Tulsyan) or a real HOD would therefore need this seed to
-- hand out production access to a dozen named people — a permission change
-- nobody asked for, and one that would put an unfinished module on their
-- launcher.
--
-- So the four actors are people who ALREADY have edit rights everywhere, and are
-- cast in the roles they actually hold:
--
--   Shweta Chanchad  · Executive Assistant  → raises trips on behalf of the
--                                             traveller, books, processes
--                                             cancellations, files claims.
--                                             (PRD §3 explicitly allows this.)
--   Aayush Rathi     · Director             → reporting-manager approvals and
--                                             claim approvals.
--   Karan Toshniwal  · Director             → Director approvals.
--   Yash Agarwal     · CAIO                 → stands in for Finance: advance
--                                             approval and disbursement, claim
--                                             verification, settlement.
--
-- All four are coordinators by virtue of being admins (`fms_travel_is_coordinator`
-- returns `is_admin(uid)`), which is exactly the escape hatch the module was
-- built with. When real step owners and real app_access grants are configured in
-- Setup, the same trips will route to them; nothing here has to change.
--
-- THE TRAVELLERS ARE REAL DIRECTORY EMPLOYEES, chosen to span bands 3 to 9, so
-- the band → travel category map, the §3.2 approval fork (band ≥ 6 also needs a
-- Director) and every cap in the rate card are all exercised on live data. No
-- traveller is one of the four actors: `fms_travel_decide` and
-- `fms_travel_decide_claim` both refuse to let anybody approve their own trip,
-- and that guard is left standing.
--
-- ---------------------------------------------------------------------------
-- IDENTIFIABLE + REVERSIBLE. Every submitted demo trip is numbered TRV-DEMO-nn.
-- The one DRAFT carries no number at all (numbers are minted on submit, never on
-- draft save — that is the point of the draft), so it is marked instead in the
-- one field a reader sees on it: its purpose remarks carry `[TRV-DEMO-DRAFT]`.
-- `fms_travel_demo_teardown.sql` deletes exactly those and nothing else, so it
-- can never touch a real trip (a real trip is TRV-<FY>-nnnn and can never match).
--
-- RE-RUNNABLE: it clears its own TRV-DEMO-% rows first.
--
-- WHAT IT ALSO WRITES:
--   • fms_travel_hotels        — 12 hotels (the master was EMPTY; a hotel leg
--                                needs one, and the booking form's hotel picker
--                                would otherwise have nothing in it)
--   • fms_travel_bus_operators — 5 operators (same reason)
--   • fms_travel_employee_settings — a base city for each demo traveller,
--                                `on conflict do nothing`, so a preference a
--                                real person already set is never overwritten
-- Those three are real master data the module needs, not demo content, and the
-- teardown LEAVES them. To clear them by hand as well:
--     delete from public.fms_travel_hotels;
--     delete from public.fms_travel_bus_operators;
--     delete from public.fms_travel_employee_settings where user_id in (…);
--
-- It also leaves THREE MASTER REQUESTS (one pending, one approved, one rejected)
-- so the governance review queue and its history are not empty. Those DO carry
-- the demo marker in their payload and ARE removed by the teardown.
--
-- ⚠ THE COUNTER IS HANDED BACK. The RPCs consume TRV-<FY>-0001…nnnn; the last
--   step of this file winds that counter back to the highest number a REAL trip
--   is actually holding, so the demo does not burn twenty numbers — and does not
--   hand out one that is already taken. (It deleted the row outright until
--   24-Aug-2026, when a real trip turned out to exist; see step 7.)
--
-- ⚠ EMAIL. `fms_travel_announce` writes an `email_outbox` row per recipient when
--   `email_module_enabled('travel-desk')` is true. It is FALSE today and this
--   file REFUSES TO RUN if somebody has turned it on — ~120 notifications would
--   otherwise become ~120 real emails to real colleagues about trips that never
--   happened.
--
-- ⚠ §16 (booked above band entitlement) needs `fms_travel_legs.entitled_fare`,
--   and NOTHING WRITES THAT COLUMN — not `fms_travel_save_leg`, not the booking
--   panel. One value is therefore set by a raw UPDATE at the end, purely so the
--   Policy Exceptions report has a §16 row to render. That gap is real and is
--   worth closing separately; this file does not pretend to close it.
--
-- Nothing here creates a user, a department, a city, a purpose, an expense
-- category, an airline, a rate card, an app_access grant, a step-owner row or a
-- coordinator. Those are all decisions about named people and live policy.
--
--   psql "$SUPABASE_DB_URL" -f supabase/seed/fms_travel_demo_seed.sql
-- ===========================================================================

do $seed$
declare
  -- ---- the cast (all four already hold portal admin) -----------------------
  u_shweta uuid := 'a92994f8-9a5a-44a2-a486-682aad7e934c'; -- Shweta Chanchad · EA        · the desk: raises, books, cancels, files claims
  u_aayush uuid := '853f57a4-fd21-4730-9666-09c2855fc815'; -- Aayush Rathi    · Director   · manager + claim approvals
  u_karan  uuid := 'e3977634-30a3-4a1e-9d5f-4db93b327457'; -- Karan Toshniwal · Director   · Director approvals
  u_yash   uuid := '7cd18ada-d6a7-4636-9edd-2f6aeeedd373'; -- Yash Agarwal    · CAIO       · stands in for Finance

  -- ---- the travellers (real directory employees, bands 3 → 9) --------------
  t_samadhan uuid := '8db68b13-ff1c-4101-9508-6c21edebc625'; -- band 3 · Supply Chain
  t_murli    uuid := '47ef2c78-3943-4d2b-a64a-d9039434e124'; -- band 3 · Supply Chain
  t_nitesh   uuid := 'a4a50ee9-f878-4a25-97eb-f3a3412ba8a2'; -- band 3 · Accounting & Finance
  t_manisha  uuid := '0311ce96-d58a-4d2a-b580-d186d4d3673a'; -- band 3 · Accounting & Finance
  t_tanisha  uuid := 'e7d30aca-5518-4322-873d-6d5146536c49'; -- band 3 · Human Resources
  t_yashj    uuid := 'bf164ac0-e945-427b-9a99-89a3f5018956'; -- band 4 · Accounting & Finance
  t_jayshree uuid := 'bb096b8e-bbae-4476-ae6b-89111fbad4bd'; -- band 4 · Accounting & Finance
  t_vinit    uuid := '06ad5969-3dfb-4e4a-b28f-bd6e2174fd7c'; -- band 6 · After Sales service
  t_vinod    uuid := 'd030747e-d54c-4488-a338-e03ea97f8e3f'; -- band 6 · Sales
  t_shoham   uuid := '8f6eb01f-f9c2-49db-b115-bbae00ffe8ce'; -- band 6 · Sales
  t_bharats  uuid := 'fc832c56-1f34-4fb3-b2bf-b47da7e93976'; -- band 6 · Ink Manufacturing
  t_rohan    uuid := '0a5b2a81-f741-4dcc-8ac5-570e27ad3cf8'; -- band 6 · Supply Chain
  t_khurshid uuid := 'c21dc403-59a5-4ad4-a30c-1e698eda3ad0'; -- band 7 · Sales
  t_sourabh  uuid := 'ce16b549-3709-426d-9462-bf53e6b9abed'; -- band 7 · After Sales service
  t_hemants  uuid := 'a05b476d-6eb5-46a2-b179-d09f8e795a7b'; -- band 7 · Sales
  t_prashant uuid := 'e0b7e237-ab65-4d76-b495-38e9ca020dee'; -- band 7 · After Sales service
  t_umesh    uuid := '695b41c7-e1f0-448e-867d-58f6f5702dd2'; -- band 8 · Sales
  t_purav    uuid := 'e78e65f1-5922-448a-b458-03c229159dea'; -- band 8 · Sales
  t_mehul    uuid := '1b0e0996-bfd1-4bc5-a5e6-3a6bc1eb2725'; -- band 8 · Sales
  t_manmohan uuid := '2bb57d03-d165-4bba-b5ce-eaa744838682'; -- band 9 · Sales
  t_nakul    uuid := '2d75ca4e-dac9-45e2-82bc-d379bc5d6fc4'; -- band 9 · Sales

  -- ---- cities (already seeded by 20261005120200 — this file creates none) --
  c_ahm uuid := '581403e6-04cc-4b10-9b1e-c50522564430'; -- Ahmedabad   T1 (the base)
  c_mum uuid := 'f769afc9-1673-4b4f-a92c-95ba361a4e38'; -- Mumbai      T1
  c_del uuid := '7cf307de-2e8d-4166-a46f-69f596aa7154'; -- Delhi (NCR) T1
  c_blr uuid := 'ca14ffab-1924-40c4-8325-d2ce93cf7ab0'; -- Bengaluru   T1
  c_chn uuid := 'eb9a4e6e-a4b6-4e99-a40a-2d15877fb5c2'; -- Chennai     T1
  c_hyd uuid := 'e25d20f1-614a-4d16-8355-9080db9b27e2'; -- Hyderabad   T1
  c_kol uuid := '490feb46-8a36-4598-8de8-4926970c33e3'; -- Kolkata     T1
  c_pun uuid := '919dd9a1-3684-496e-a195-eaacbcb7a1a7'; -- Pune        T1
  c_sur uuid := '62d17a1d-4db4-425e-a73b-a315b7148813'; -- Surat       T2
  c_vad uuid := 'e65f1c19-a040-444f-a095-426f9036b0f1'; -- Vadodara    T2
  c_ind uuid := '86cba33c-5684-44be-a28c-62760a50f58d'; -- Indore      T2
  c_jai uuid := '1758ec38-cb8d-40a1-8563-cdd134b42b2a'; -- Jaipur      T2
  c_nag uuid := '2e7a688a-a9f8-45f6-827b-70dd267a8b3d'; -- Nagpur      T2
  c_coi uuid := '4cb1cda1-78be-4c1c-8baf-0d7c544cf92a'; -- Coimbatore  T2
  c_rjt uuid := '32fb58a6-151d-4eda-aa73-1c37f1ae75af'; -- Rajkot      T2
  c_nas uuid := 'c13f5d53-7291-4633-acca-08187cfded62'; -- Nashik      T3
  c_tir uuid := 'b92b58f0-a636-4de7-953d-aa8da8575b98'; -- Tirupur     T3
  c_koc uuid := '25e3f4da-e0c3-4512-83ca-8b481ad4790d'; -- Kochi       T3

  -- ---- purposes ------------------------------------------------------------
  p_cust   uuid := '7fa4ceae-56f5-4828-940d-6bc55ae43758'; -- Customer Visit
  p_compl  uuid := 'fed81196-e27d-4f99-ba0f-09d0a9d939ba'; -- Customer Complaint
  p_sales  uuid := 'fba98166-33de-4066-b545-3db39b1c76c1'; -- Sales Meeting
  p_new    uuid := '0902074d-473f-4385-a041-3068a27c3185'; -- New Customer Meeting
  p_exhib  uuid := 'de750235-7680-4e83-9252-c9817d11812e'; -- Exhibition
  p_branch uuid := '7c5ceb05-09e7-4c06-a918-aee0a5ee946a'; -- Branch Visit
  p_conf   uuid := 'ad566258-b45a-43e3-aa4e-2f3fc2071898'; -- Conference
  p_govt   uuid := '64275ee9-46b5-462e-9b91-a53223945732'; -- Government Work
  p_other  uuid := '28721724-4fbc-42ac-8e78-cacdbbdc8fa7'; -- Others (requires remarks)

  -- ---- expense categories --------------------------------------------------
  e_air   uuid := '4cc788a1-5c77-4665-9619-2206e9de82e4'; -- Air Ticket            (transport)
  e_train uuid := '3be46e56-9019-42e7-b02f-636edac164fd'; -- Train Ticket          (transport)
  e_bus   uuid := '8b78cada-c3e7-4a43-8f18-75280f50ec93'; -- Bus Ticket            (transport)
  e_xfer  uuid := '4d392bdc-780d-43c5-a219-0e73f66bdb3f'; -- Airport/Stn Transfer  (transfer,  receipt > 300)
  e_hotel uuid := '72f6531e-32b5-4c8f-863b-1cf58d8438f1'; -- Hotel room charges    (hotel)
  e_local uuid := '4e158851-1904-438e-8fc8-5e1c658f90e5'; -- Local Conveyance      (conveyance, receipt > 300)
  e_fuel  uuid := '77bd0e4b-6900-4592-8898-ad17006d36d5'; -- Own Vehicle fuel/km   (mileage)
  e_toll  uuid := 'b98608ff-cc01-4992-8bb9-ee7633e87cbe'; -- Toll & Parking        (transfer,  receipt > 200)
  e_bmeal uuid := '3a3c76ff-04b4-4ab6-b523-c48c80b6c138'; -- Business Meal         (meal, guests required)
  e_tmeal uuid := '5e53fc2b-55db-4ed4-baf7-7e544f5fb4e2'; -- Team Meal             (meal, receipt > 200)
  e_refr  uuid := '3b59dd2b-34db-41da-8498-e8799643c1a9'; -- Refreshments          (meal, self-dec 200)
  e_late  uuid := '118e1315-163a-4558-88a8-08ca16338542'; -- Late-night Meal       (meal, self-dec 300)
  e_bagg  uuid := '0c5126e5-937e-478c-bdbe-5bcc0b23d6eb'; -- Excess Baggage        (fee)
  e_cfee  uuid := '8385f816-8518-4ee5-8c9a-2e9c9aa677fd'; -- Conference Fee        (fee)
  e_misc  uuid := 'bbbf3262-7e2e-401a-afce-4609951fb298'; -- Miscellaneous         (misc, self-dec 200)
  e_alc   uuid := '46bfa652-525e-4b1f-a63c-92c9f4bf364d'; -- Alcohol & Tobacco     (§15 refusal)
  e_pent  uuid := '71167c4c-c47f-4d36-b765-c9b629d0d3c8'; -- Personal Entertainment(§15 refusal)

  -- ---- airlines ------------------------------------------------------------
  a_indigo uuid := '4f42edbf-e68b-4ec7-95aa-539e160dc504';
  a_ai     uuid := 'd06e1ee4-055d-4af8-b082-b0b1f2e82ce2';
  a_akasa  uuid := '7221b629-74c8-461f-b1d1-8b00e35c4323';
  a_spice  uuid := '8f85d4b5-90a8-487d-b7f6-c62579480e32';
  a_vist   uuid := '07c5ad21-8e15-4a82-992c-3fa01f59aecf';

  -- ---- hotels + operators this file seeds ----------------------------------
  h_ahm1 uuid; h_ahm2 uuid; h_del1 uuid; h_del2 uuid; h_mum1 uuid; h_mum2 uuid;
  h_blr1 uuid; h_ind1 uuid; h_hyd1 uuid; h_chn1 uuid; h_jai1 uuid; h_sur1 uuid;
  h_kol1 uuid;
  b_vrl  uuid;

  -- ---- the trips -----------------------------------------------------------
  x01 uuid; x02 uuid; x03 uuid; x04 uuid; x05 uuid; x06 uuid; x07 uuid;
  x08 uuid; x09 uuid; x10 uuid; x11 uuid; x12 uuid; x13 uuid; x14 uuid;
  x15 uuid; x16 uuid; x17 uuid; x18 uuid; x19 uuid; x20 uuid; xdr uuid;

  v_fy      text := public.fms_travel_fy_code(current_date);
  v_card    uuid := public.fms_travel_effective_rate_card(current_date);
  v_net     numeric;
  v_line    uuid;
  v_lega    uuid;   -- a leg this file needs to come back to (a refund lands later)
  v_legb    uuid;
  v_seq     integer;
  v_email   boolean;
  v_all     uuid[];
  rec       record;
begin
  -- =========================================================================
  -- 0 · REFUSE TO RUN IF THIS WOULD MAIL ANYBODY.
  -- =========================================================================
  select enabled into v_email from public.email_module_settings where module_id = 'travel-desk';
  if coalesce(v_email, false) then
    raise exception 'Travel Desk email is ON. This seed writes ~120 notifications, each of which would become a real email about a trip that never happened. Turn the module gate off in Setup, run this, then turn it back on.';
  end if;

  if v_card is null then
    raise exception 'There is no rate card at all, so no trip can be priced. Apply 20261005120400_seed_fms_travel_rate_card.sql first.';
  end if;
  if not exists (select 1 from public.fms_travel_cities where id = c_ahm)
     or not exists (select 1 from public.fms_travel_purposes where id = p_cust)
     or not exists (select 1 from public.fms_travel_expense_categories where id = e_hotel) then
    raise exception 'The Travel Desk masters are missing — apply 20261005120200_add_fms_travel_masters.sql first.';
  end if;

  -- =========================================================================
  -- 1 · CLEAR ANY PREVIOUS DEMO. Scoped strictly to this file's own rows.
  -- =========================================================================
  select coalesce(array_agg(id), '{}') into v_all
    from public.fms_travel_trips
   where trip_no like 'TRV-DEMO-%'
      or purpose_other_remarks like '%[TRV-DEMO-DRAFT]%';

  if cardinality(v_all) > 0 then
    -- Activity and notifications are keyed by a LOOSE entity_id (no FK), so
    -- nothing cascades them. For this module the entity is always the trip.
    delete from public.fms_travel_notifications where entity_id = any(v_all);
    delete from public.fms_travel_activity      where entity_id = any(v_all);
    -- passengers, legs, claim_lines and da_days all cascade with the trip.
    delete from public.fms_travel_trips where id = any(v_all);
  end if;

  delete from public.fms_travel_master_requests where proposed_payload->>'_demo' = 'travel';

  -- =========================================================================
  -- 2 · THE HOTEL AND BUS-OPERATOR MASTERS.
  --
  -- Both tables were EMPTY. A hotel leg wants a hotel_id, the booking panel's
  -- pickers want something to pick, and the hotel cap is checked against the
  -- city the hotel sits in — so these are real master rows, not demo content,
  -- and the teardown leaves them.
  -- =========================================================================
  insert into public.fms_travel_hotels (name, city_id, sort_order, created_by) values
    ('Courtyard by Marriott, Ahmedabad',   c_ahm,  10, u_shweta),
    ('The Fern, Ahmedabad',                c_ahm,  20, u_shweta),
    ('Lemon Tree Premier, Delhi Aerocity', c_del,  30, u_shweta),
    ('Ibis New Delhi Aerocity',            c_del,  40, u_shweta),
    ('The Orchid, Mumbai',                 c_mum,  50, u_shweta),
    ('Ginger Mumbai, Andheri East',        c_mum,  60, u_shweta),
    ('Lemon Tree Hotel, Electronics City', c_blr,  70, u_shweta),
    ('Radisson Blu, Indore',               c_ind,  80, u_shweta),
    ('Hyatt Place, Hyderabad Banjara Hills', c_hyd, 90, u_shweta),
    ('Novotel Chennai, Sipcot',            c_chn, 100, u_shweta),
    ('Sarovar Portico, Jaipur',            c_jai, 110, u_shweta),
    ('The Fern Residency, Surat',          c_sur, 120, u_shweta),
    ('The Peerless Inn, Kolkata',          c_kol, 130, u_shweta)
  on conflict (name) do nothing;

  insert into public.fms_travel_bus_operators (name, sort_order, created_by) values
    ('VRL Travels',            10, u_shweta),
    ('Patel Tours & Travels',  20, u_shweta),
    ('Neeta Tours & Travels',  30, u_shweta),
    ('SRS Travels',            40, u_shweta),
    ('Gujarat Travels',        50, u_shweta)
  on conflict (name) do nothing;

  select id into h_ahm1 from public.fms_travel_hotels where name = 'Courtyard by Marriott, Ahmedabad';
  select id into h_ahm2 from public.fms_travel_hotels where name = 'The Fern, Ahmedabad';
  select id into h_del1 from public.fms_travel_hotels where name = 'Lemon Tree Premier, Delhi Aerocity';
  select id into h_del2 from public.fms_travel_hotels where name = 'Ibis New Delhi Aerocity';
  select id into h_mum1 from public.fms_travel_hotels where name = 'The Orchid, Mumbai';
  select id into h_mum2 from public.fms_travel_hotels where name = 'Ginger Mumbai, Andheri East';
  select id into h_blr1 from public.fms_travel_hotels where name = 'Lemon Tree Hotel, Electronics City';
  select id into h_ind1 from public.fms_travel_hotels where name = 'Radisson Blu, Indore';
  select id into h_hyd1 from public.fms_travel_hotels where name = 'Hyatt Place, Hyderabad Banjara Hills';
  select id into h_chn1 from public.fms_travel_hotels where name = 'Novotel Chennai, Sipcot';
  select id into h_jai1 from public.fms_travel_hotels where name = 'Sarovar Portico, Jaipur';
  select id into h_sur1 from public.fms_travel_hotels where name = 'The Fern Residency, Surat';
  select id into h_kol1 from public.fms_travel_hotels where name = 'The Peerless Inn, Kolkata';
  select id into b_vrl  from public.fms_travel_bus_operators where name = 'VRL Travels';

  -- =========================================================================
  -- 3 · BASE CITY per demo traveller.
  --
  -- `on conflict do nothing` — a preference a real person has already set is
  -- never overwritten. Everyone here works out of Ahmedabad except the four
  -- who genuinely sit elsewhere.
  -- =========================================================================
  insert into public.fms_travel_employee_settings (user_id, base_city_id, seat_preference, meal_preference) values
    (t_samadhan, c_ahm, 'Window', null),
    (t_murli,    c_ahm, 'Aisle',  'Vegetarian'),
    (t_nitesh,   c_ahm, null,     'Vegetarian'),
    (t_manisha,  c_ahm, 'Window', 'Vegetarian'),
    (t_tanisha,  c_ahm, null,     null),
    (t_yashj,    c_ahm, 'Aisle',  null),
    (t_jayshree, c_ahm, null,     'Vegetarian'),
    (t_vinit,    c_mum, 'Aisle',  null),
    (t_vinod,    c_ahm, 'Window', null),
    (t_shoham,   c_blr, 'Aisle',  null),
    (t_bharats,  c_ahm, null,     'Vegetarian'),
    (t_rohan,    c_ahm, 'Window', 'Vegetarian'),
    (t_khurshid, c_del, 'Aisle',  null),
    (t_sourabh,  c_ahm, 'Window', null),
    (t_hemants,  c_ahm, 'Aisle',  'Vegetarian'),
    (t_prashant, c_ahm, null,     null),
    (t_umesh,    c_ahm, 'Window', null),
    (t_purav,    c_ahm, 'Aisle',  null),
    (t_mehul,    c_ahm, 'Window', 'Vegetarian'),
    (t_manmohan, c_ahm, 'Aisle',  null),
    (t_nakul,    c_ahm, 'Window', null)
  on conflict (user_id) do nothing;

  -- =========================================================================
  -- 4 · THE TRIPS. Every one is raised by Shweta on the traveller's behalf,
  --     which is PRD §3's own description of how the desk works.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);

  -- ---- DRAFT · somebody's unfinished thinking. No trip number, and that is
  --      the point: numbers are minted on submit so an abandoned draft cannot
  --      burn one. Marked in the purpose remarks because there is no number to
  --      mark. Purpose "Others" genuinely requires remarks, so the marker sits
  --      in a field the screen was always going to show.
  xdr := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_samadhan, 'traveller_name', 'Samadhan Patil',
    'purpose_id', p_other,
    'purpose_other_remarks', 'Vendor audit at the Nashik converter before the monsoon shutdown — dates still being confirmed with their plant. [TRV-DEMO-DRAFT]',
    'destination_city_id', c_nas,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date + 5)::text,
    'planned_return_date',    (current_date + 7)::text,
    'accommodation_required', true,
    'estimated_cost', 14500,
    'advance_requested', false));

  -- ---- 01 · AWAITING REPORTING-MANAGER APPROVAL, and overdue (2-working-day
  --      TAT, submitted 6 days ago). Band 3 → §3.2 needs no Director.
  x01 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_murli, 'traveller_name', 'Murlidhar Panda',
    'purpose_id', p_compl, 'destination_city_id', c_nas,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date + 5)::text,
    'planned_return_date',    (current_date + 7)::text,
    'accommodation_required', true, 'estimated_cost', 11800,
    'advance_requested', false));
  perform public.fms_travel_set_passengers(x01, jsonb_build_array(
    jsonb_build_object('full_name','Murlidhar Panda','employee_id',t_murli,
                       'gender','male','date_of_birth','1991-04-18',
                       'mobile','9825000101','is_primary',true)));
  perform public.fms_travel_submit_trip(x01);

  -- ---- 02 · AWAITING DIRECTOR APPROVAL. Band 7 → the manager has said yes and
  --      §3.2 sends it up.
  x02 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_khurshid, 'traveller_name', 'Khurshid Alam',
    'purpose_id', p_sales, 'destination_city_id', c_kol,
    'journey_type', 'round_trip', 'preferred_slot', 'evening',
    'planned_departure_date', (current_date + 6)::text,
    'planned_return_date',    (current_date + 9)::text,
    'accommodation_required', true, 'estimated_cost', 42000,
    'advance_requested', false));
  perform public.fms_travel_set_passengers(x02, jsonb_build_array(
    jsonb_build_object('full_name','Khurshid Alam','employee_id',t_khurshid,
                       'gender','male','date_of_birth','1979-11-02',
                       'mobile','9825000102','is_primary',true)));
  perform public.fms_travel_submit_trip(x02);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x02, 'approve',
    'Approved. The Howrah account is worth the trip; take the sample kit with you.');

  -- ---- 03 · RETURNED for clarification. The ball is with the traveller, so it
  --      is in NO approver queue — it shows under My Trips.
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  x03 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_nitesh, 'traveller_name', 'Nitesh Prajapati',
    'purpose_id', p_govt, 'destination_city_id', c_del,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date + 6)::text,
    'planned_return_date',    (current_date + 8)::text,
    'accommodation_required', true, 'estimated_cost', 19500,
    'advance_requested', false));
  perform public.fms_travel_submit_trip(x03);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x03, 'return',
    'Which office and which case? "Government work" with no reference number is not something I can approve. Add the hearing date and the file number and send it again.');

  -- ---- 04 · REJECTED at the Director step. Band 8.
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  x04 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_purav, 'traveller_name', 'Purav Virendrakumar Shah',
    'purpose_id', p_exhib, 'destination_city_id', c_hyd,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date + 3)::text,
    'planned_return_date',    (current_date + 6)::text,
    'accommodation_required', true, 'estimated_cost', 56000,
    'advance_requested', false));
  perform public.fms_travel_submit_trip(x04);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x04, 'approve', 'Fine by me if the Directors want the stand covered.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x04, 'reject',
    'We are not taking a stand at this edition — the spend went to the Pune show instead. Nothing to attend, so nothing to approve.');

  -- ---- 05 · AWAITING THE ADVANCE. Band 6 → both approvals done; Finance has
  --      APPROVED a figure but not yet paid it, which is exactly the state
  --      §11.1 separates: approval and disbursement are different jobs.
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  x05 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_vinit, 'traveller_name', 'Vinit Mishra',
    'purpose_id', p_compl, 'destination_city_id', c_coi,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date + 8)::text,
    'planned_return_date',    (current_date + 12)::text,
    'accommodation_required', true, 'estimated_cost', 16000,
    'advance_requested', true, 'advance_requested_amount', 9000));
  perform public.fms_travel_set_passengers(x05, jsonb_build_array(
    jsonb_build_object('full_name','Vinit Mishra','employee_id',t_vinit,
                       'gender','male','date_of_birth','1988-06-30',
                       'mobile','9825000105','is_primary',true)));
  perform public.fms_travel_submit_trip(x05);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x05, 'approve', 'Approved — the Tirupur printer has been down eleven days.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x05, 'approve', 'Go. Take the spare head with you.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_yash)::text, true);
  perform public.fms_travel_approve_advance(x05, 9000,
    'Approved at the full ask — five days in the field with hotel and local running.');

  -- ---- 06 · AWAITING BOOKING. Band 4 → no Director step, no advance asked.
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  x06 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_yashj, 'traveller_name', 'Yash Joshi',
    'purpose_id', p_branch, 'destination_city_id', c_sur,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date + 11)::text,
    'planned_return_date',    (current_date + 13)::text,
    'accommodation_required', true, 'estimated_cost', 8600,
    'advance_requested', false));
  perform public.fms_travel_submit_trip(x06);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x06, 'approve', 'Approved. Close out the Surat ledger while you are there.');

  -- ---- 07 · BOOKED and UPCOMING — departs in 9 days. This is the row the
  --      "Upcoming Travel" report and the dashboard strip exist for.
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  x07 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_vinod, 'traveller_name', 'Vinod Koshti',
    'purpose_id', p_new, 'destination_city_id', c_del,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date + 9)::text,
    'planned_return_date',    (current_date + 12)::text,
    'accommodation_required', true, 'estimated_cost', 31000,
    'advance_requested', false));
  perform public.fms_travel_set_passengers(x07, jsonb_build_array(
    jsonb_build_object('full_name','Vinod Koshti','employee_id',t_vinod,
                       'gender','male','date_of_birth','1985-02-14',
                       'mobile','9825000107','is_primary',true),
    jsonb_build_object('full_name','Jay Gulgulia','employee_id','02fc06db-ab61-4da9-bd41-62ecf87366d6',
                       'gender','male','date_of_birth','1990-09-05',
                       'mobile','9825000108','is_primary',false)));
  perform public.fms_travel_submit_trip(x07);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x07, 'approve', 'Approved — two of you for the Okhla pitch is right.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x07, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_save_leg(x07, jsonb_build_object(
    'kind','flight','direction','outbound','from_city_id',c_ahm,'to_city_id',c_del,
    'start_on',(current_date + 9)::text,'start_time','07:05','end_on',(current_date + 9)::text,'end_time','08:45',
    'airline_id',a_indigo,'booking_ref','QK7T4M','travel_class','Economy Saver',
    'ticket_cost',6250,'other_charges',400,'notes','Two seats on the same PNR.'), null);
  perform public.fms_travel_save_leg(x07, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_del,
    'start_on',(current_date + 9)::text,'end_on',(current_date + 12)::text,
    'hotel_id',h_del1,'booking_ref','LTP-884120','travel_class','Superior twin',
    'ticket_cost',9900,'other_charges',0,'notes','3 nights, twin sharing.'), null);
  perform public.fms_travel_save_leg(x07, jsonb_build_object(
    'kind','flight','direction','return','from_city_id',c_del,'to_city_id',c_ahm,
    'start_on',(current_date + 12)::text,'start_time','19:20','end_on',(current_date + 12)::text,'end_time','21:00',
    'airline_id',a_indigo,'booking_ref','QK7T4M','travel_class','Economy Saver',
    'ticket_cost',6800,'other_charges',400), null);
  perform public.fms_travel_complete_booking(x07);

  -- ---- 08 · BOOKED, the traveller is BACK, the claim is due and an ADVANCE is
  --      still out. This is the row that populates both the Claim queue and the
  --      Outstanding Advances report.
  x08 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_sourabh, 'traveller_name', 'Sourabh Rakesh Nagpal',
    'purpose_id', p_compl, 'destination_city_id', c_chn,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date - 11)::text,
    'planned_return_date',    (current_date - 7)::text,
    'accommodation_required', true, 'estimated_cost', 20000,
    'advance_requested', true, 'advance_requested_amount', 12000));
  perform public.fms_travel_set_passengers(x08, jsonb_build_array(
    jsonb_build_object('full_name','Sourabh Rakesh Nagpal','employee_id',t_sourabh,
                       'gender','male','date_of_birth','1983-07-22',
                       'mobile','9825000109','is_primary',true)));
  perform public.fms_travel_submit_trip(x08);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x08, 'approve', 'Approved. The Sipcot line has been down since Monday.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x08, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_yash)::text, true);
  perform public.fms_travel_approve_advance(x08, 12000, 'Approved. Four nights and the spares freight.');
  perform public.fms_travel_disburse_advance(x08, 12000, current_date - 14, 'NEFT', 'UTR/HDFC/2026/884120');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_save_leg(x08, jsonb_build_object(
    'kind','flight','direction','outbound','from_city_id',c_ahm,'to_city_id',c_chn,
    'start_on',(current_date - 11)::text,'start_time','06:40','end_on',(current_date - 11)::text,'end_time','09:05',
    'airline_id',a_akasa,'booking_ref','QP31LK','travel_class','Economy',
    'ticket_cost',7450,'other_charges',450), null);
  perform public.fms_travel_save_leg(x08, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_chn,
    'start_on',(current_date - 11)::text,'end_on',(current_date - 7)::text,
    'hotel_id',h_chn1,'booking_ref','NOV-551094','travel_class','Standard king',
    'ticket_cost',9600,'other_charges',0,'notes','4 nights.'), null);
  perform public.fms_travel_save_leg(x08, jsonb_build_object(
    'kind','flight','direction','return','from_city_id',c_chn,'to_city_id',c_ahm,
    'start_on',(current_date - 7)::text,'start_time','20:15','end_on',(current_date - 7)::text,'end_time','22:45',
    'airline_id',a_akasa,'booking_ref','QP31LK','travel_class','Economy',
    'ticket_cost',7900,'other_charges',450), null);
  perform public.fms_travel_complete_booking(x08);
  perform public.fms_travel_post_comment(x08,
    'Ticket and hotel voucher are on the trip. Please file the claim this week — the 12,000 advance is showing against your name until it is settled.',
    array[]::uuid[], '[]'::jsonb);

  -- ---- 09 · RETROSPECTIVE / EMERGENCY, and REGULARISED LATE. Departed 4 days
  --      ago; §3.5 reimburses a request raised more than 24 hours after
  --      departure at TC-D whatever the traveller's band. Band 8 → TC-B, so
  --      submit downgrades it and stamps tc_downgraded_from. This is the row
  --      the Policy Exceptions report is for.
  x09 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_mehul, 'traveller_name', 'Mehul Gajjar',
    'purpose_id', p_compl, 'destination_city_id', c_ind,
    'journey_type', 'round_trip', 'preferred_slot', 'night',
    'planned_departure_date', (current_date - 4)::text,
    'planned_return_date',    (current_date - 2)::text,
    'accommodation_required', true, 'estimated_cost', 13500,
    'is_emergency', true,
    'emergency_reason', 'Left at 23:00 the same night — the Indore customer''s line stopped mid-run and the shift was waiting. Raised on return, which is why it is late.',
    'advance_requested', false));
  perform public.fms_travel_submit_trip(x09);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x09, 'approve',
    'Regularising after the fact. He was right to go; the 24-hour window is what it is.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x09, 'approve', 'Approved retrospectively.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_save_leg(x09, jsonb_build_object(
    'kind','cab','direction','outbound','from_city_id',c_ahm,'to_city_id',c_ind,
    'start_on',(current_date - 4)::text,'start_time','23:00','end_on',(current_date - 3)::text,'end_time','05:30',
    'carrier_other','Shree Ganesh Cabs (Innova Crysta)','booking_ref','SGC/26/1188','travel_class','AC SUV',
    'ticket_cost',8400,'other_charges',900,'notes','Night run, booked by phone at 21:40.'), null);
  perform public.fms_travel_save_leg(x09, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_ind,
    'start_on',(current_date - 3)::text,'end_on',(current_date - 2)::text,
    'hotel_id',h_ind1,'booking_ref','RBI-220417','travel_class','Superior',
    'ticket_cost',3400,'other_charges',0,'notes','1 night.'), null);
  perform public.fms_travel_complete_booking(x09);

  -- ---- 10 · CANCELLATION REQUESTED. The trip is booked, the traveller has
  --      asked to call it off and the desk has not answered yet — so it sits at
  --      the BOOKING step and shows as work the desk owes.
  x10 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_shoham, 'traveller_name', 'Christie Shoham Joy',
    'purpose_id', p_cust, 'destination_city_id', c_pun,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date + 6)::text,
    'planned_return_date',    (current_date + 8)::text,
    'accommodation_required', true, 'estimated_cost', 18000,
    'advance_requested', false));
  perform public.fms_travel_submit_trip(x10);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x10, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x10, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_save_leg(x10, jsonb_build_object(
    'kind','flight','direction','outbound','from_city_id',c_blr,'to_city_id',c_pun,
    'start_on',(current_date + 6)::text,'start_time','08:10','end_on',(current_date + 6)::text,'end_time','09:30',
    'airline_id',a_indigo,'booking_ref','R4T99B','travel_class','Economy Saver',
    'ticket_cost',4900,'other_charges',350), null);
  perform public.fms_travel_save_leg(x10, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_pun,
    'start_on',(current_date + 6)::text,'end_on',(current_date + 8)::text,
    'carrier_other','Hotel Sagar Plaza, Pune','booking_ref','SGP-77210','travel_class','Executive',
    'ticket_cost',4400,'other_charges',0), null);
  perform public.fms_travel_save_leg(x10, jsonb_build_object(
    'kind','flight','direction','return','from_city_id',c_pun,'to_city_id',c_blr,
    'start_on',(current_date + 8)::text,'start_time','18:40','end_on',(current_date + 8)::text,'end_time','20:05',
    'airline_id',a_indigo,'booking_ref','R4T99B','travel_class','Economy Saver',
    'ticket_cost',5200,'other_charges',350), null);
  perform public.fms_travel_complete_booking(x10);
  perform public.fms_travel_request_cancellation(x10,
    'The customer has moved the trial to next month — their operator is on leave. Please cancel and tell me what it costs.');

  -- ---- 11 · CANCELLED, BUT THE MONEY IS NOT. §4.1 makes a business-reason
  --      cancellation charge reimbursable, and an advance has to come back
  --      either way — so this sits at the CLAIM step, not in `cancelled`.
  x11 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_bharats, 'traveller_name', 'Bharat Singh',
    'purpose_id', p_conf, 'destination_city_id', c_jai,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date - 12)::text,
    'planned_return_date',    (current_date - 9)::text,
    'accommodation_required', true, 'estimated_cost', 15000,
    'advance_requested', true, 'advance_requested_amount', 8000));
  perform public.fms_travel_submit_trip(x11);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x11, 'approve', 'Approved — the pigment seminar is worth two days.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x11, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_yash)::text, true);
  perform public.fms_travel_approve_advance(x11, 8000, 'Approved.');
  perform public.fms_travel_disburse_advance(x11, 8000, current_date - 18, 'NEFT', 'UTR/HDFC/2026/883004');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  v_lega := public.fms_travel_save_leg(x11, jsonb_build_object(
    'kind','flight','direction','outbound','from_city_id',c_ahm,'to_city_id',c_jai,
    'start_on',(current_date - 12)::text,'start_time','09:15','end_on',(current_date - 12)::text,'end_time','10:35',
    'airline_id',a_spice,'booking_ref','SG8821K','travel_class','Economy',
    'ticket_cost',5600,'other_charges',400), null);
  v_legb := public.fms_travel_save_leg(x11, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_jai,
    'start_on',(current_date - 12)::text,'end_on',(current_date - 9)::text,
    'hotel_id',h_jai1,'booking_ref','SPJ-330281','travel_class','Deluxe',
    'ticket_cost',6300,'other_charges',0), null);
  perform public.fms_travel_complete_booking(x11);
  perform public.fms_travel_request_cancellation(x11,
    'The organisers postponed the seminar four days before it was due to run.');
  -- ⚠ THE REFUNDS ARE RECORDED BEFORE THE CANCELLATION IS PROCESSED, and that
  --   ordering is the real one: `process_cancellation` routes the trip by what
  --   is LEFT on the legs, so a refund entered afterwards would arrive after the
  --   decision it was supposed to inform. SpiceJet refunded all but the fee; the
  --   hotel refunded in full.
  perform public.fms_travel_save_leg(x11, jsonb_build_object(
    'kind','flight','direction','outbound','from_city_id',c_ahm,'to_city_id',c_jai,
    'start_on',(current_date - 12)::text,'start_time','09:15','end_on',(current_date - 12)::text,'end_time','10:35',
    'airline_id',a_spice,'booking_ref','SG8821K','travel_class','Economy',
    'ticket_cost',5600,'other_charges',400,'refund_amount',2500,
    'notes','Refunded less a 3,500 cancellation fee.'), v_lega);
  perform public.fms_travel_save_leg(x11, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_jai,
    'start_on',(current_date - 12)::text,'end_on',(current_date - 9)::text,
    'hotel_id',h_jai1,'booking_ref','SPJ-330281','travel_class','Deluxe',
    'ticket_cost',6300,'other_charges',0,'refund_amount',6300,
    'notes','Cancelled inside the free window — refunded in full.'), v_legb);
  perform public.fms_travel_process_cancellation(x11, 'cancel', 'business',
    'Organisers postponed. The 3,500 airline fee is a business-reason charge under §4.1 and the 8,000 advance still has to come back.');

  -- ---- 12 · CANCELLED OUTRIGHT — everything refunded, no advance out, so
  --      there is genuinely nothing left to settle and the router closes it.
  x12 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_rohan, 'traveller_name', 'Rohan Jariwala',
    'purpose_id', p_cust, 'destination_city_id', c_vad,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date - 5)::text,
    'planned_return_date',    (current_date - 4)::text,
    'accommodation_required', false, 'estimated_cost', 4200,
    'advance_requested', false));
  perform public.fms_travel_submit_trip(x12);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x12, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x12, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  v_lega := public.fms_travel_save_leg(x12, jsonb_build_object(
    'kind','train','direction','outbound','from_city_id',c_ahm,'to_city_id',c_vad,
    'start_on',(current_date - 5)::text,'start_time','06:05','end_on',(current_date - 5)::text,'end_time','07:55',
    'carrier_other','12009 Shatabdi Express','booking_ref','PNR 4412008871','travel_class','CC',
    'ticket_cost',760,'other_charges',0), null);
  v_legb := public.fms_travel_save_leg(x12, jsonb_build_object(
    'kind','train','direction','return','from_city_id',c_vad,'to_city_id',c_ahm,
    'start_on',(current_date - 4)::text,'start_time','18:40','end_on',(current_date - 4)::text,'end_time','20:25',
    'carrier_other','12010 Shatabdi Express','booking_ref','PNR 4412008872','travel_class','CC',
    'ticket_cost',760,'other_charges',0), null);
  perform public.fms_travel_complete_booking(x12);
  perform public.fms_travel_request_cancellation(x12,
    'Customer pushed the meeting to their Ahmedabad office, so there is no journey any more.');
  perform public.fms_travel_save_leg(x12, jsonb_build_object(
    'kind','train','direction','outbound','from_city_id',c_ahm,'to_city_id',c_vad,
    'start_on',(current_date - 5)::text,'start_time','06:05','end_on',(current_date - 5)::text,'end_time','07:55',
    'carrier_other','12009 Shatabdi Express','booking_ref','PNR 4412008871','travel_class','CC',
    'ticket_cost',760,'other_charges',0,'refund_amount',760,
    'notes','Cancelled more than 48 hours ahead — full IRCTC refund.'), v_lega);
  perform public.fms_travel_save_leg(x12, jsonb_build_object(
    'kind','train','direction','return','from_city_id',c_vad,'to_city_id',c_ahm,
    'start_on',(current_date - 4)::text,'start_time','18:40','end_on',(current_date - 4)::text,'end_time','20:25',
    'carrier_other','12010 Shatabdi Express','booking_ref','PNR 4412008872','travel_class','CC',
    'ticket_cost',760,'other_charges',0,'refund_amount',760,
    'notes','Cancelled more than 48 hours ahead — full IRCTC refund.'), v_legb);
  perform public.fms_travel_process_cancellation(x12, 'cancel', 'business',
    'Both tickets refunded in full and no advance was drawn, so there is nothing left to claim.');

  -- ---- 13 · CANCELLED BEFORE ANYTHING WAS BOOKED — the other road to
  --      `cancelled`, and the one with no legs and no money at all.
  x13 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_tanisha, 'traveller_name', 'Tanisha Tikde',
    'purpose_id', p_conf, 'destination_city_id', c_mum,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date + 4)::text,
    'planned_return_date',    (current_date + 5)::text,
    'accommodation_required', true, 'estimated_cost', 9500,
    'advance_requested', false));
  perform public.fms_travel_submit_trip(x13);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x13, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_cancel_trip(x13,
    'The HR conclave moved online. Nothing was booked, so nothing to unwind.');

  -- ---- 14 · ON HOLD. Still open, still the business''s problem, but owing
  --      nobody an action today — so it is OUT of the queues and ON the
  --      Control Center''s Parked strip.
  x14 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_manisha, 'traveller_name', 'Manisha Rane',
    'purpose_id', p_cust, 'destination_city_id', c_rjt,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date + 5)::text,
    'planned_return_date',    (current_date + 6)::text,
    'accommodation_required', true, 'estimated_cost', 7200,
    'advance_requested', false));
  perform public.fms_travel_submit_trip(x14);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x14, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_hold_trip(x14,
    'The Rajkot customer has gone quiet on the reconciliation. Parked until they answer — do not book anything yet.');

  -- ---- 15 · AWAITING CLAIM REVIEW — the full expense claim, and the row that
  --      exercises every branch of the money engine at once: a hotel over its
  --      cap, conveyance over its cap, a business meal over §9, a no-receipt
  --      line falling back to self-declaration, and a §15 refusal that cannot
  --      be paid at any figure.
  x15 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_umesh, 'traveller_name', 'Umeshkumar Solanki',
    'purpose_id', p_cust, 'destination_city_id', c_del,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date - 14)::text,
    'planned_return_date',    (current_date - 10)::text,
    'accommodation_required', true, 'estimated_cost', 34000,
    'advance_requested', false));
  perform public.fms_travel_set_passengers(x15, jsonb_build_array(
    jsonb_build_object('full_name','Umeshkumar Solanki','employee_id',t_umesh,
                       'gender','male','date_of_birth','1976-01-09',
                       'mobile','9825000115','is_primary',true)));
  perform public.fms_travel_submit_trip(x15);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x15, 'approve', 'Approved — the Okhla renewal is due.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x15, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_save_leg(x15, jsonb_build_object(
    'kind','flight','direction','outbound','from_city_id',c_ahm,'to_city_id',c_del,
    'start_on',(current_date - 14)::text,'start_time','06:30','end_on',(current_date - 14)::text,'end_time','08:10',
    'airline_id',a_indigo,'booking_ref','K92MTZ','travel_class','Economy',
    'ticket_cost',6450,'other_charges',350), null);
  perform public.fms_travel_save_leg(x15, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_del,
    'start_on',(current_date - 14)::text,'end_on',(current_date - 10)::text,
    'hotel_id',h_del1,'booking_ref','LTP-901744','travel_class','Superior king',
    'ticket_cost',11600,'other_charges',0,'notes','4 nights over the trade week — the city was full.'), null);
  perform public.fms_travel_save_leg(x15, jsonb_build_object(
    'kind','flight','direction','return','from_city_id',c_del,'to_city_id',c_ahm,
    'start_on',(current_date - 10)::text,'start_time','19:35','end_on',(current_date - 10)::text,'end_time','21:15',
    'airline_id',a_indigo,'booking_ref','K92MTZ','travel_class','Economy',
    'ticket_cost',7100,'other_charges',350), null);
  perform public.fms_travel_complete_booking(x15);
  perform public.fms_travel_record_actual_travel(x15, jsonb_build_object(
    'actual_departure_date',(current_date - 14)::text,'actual_departure_time','06:30',
    'actual_return_date',   (current_date - 10)::text,'actual_return_time','21:15'));
  perform public.fms_travel_save_claim_draft(x15, jsonb_build_array(
    jsonb_build_object('category_id',e_hotel,'city_id',c_del,'spent_on',(current_date - 10)::text,
      'description','Lemon Tree Premier, Aerocity — 4 nights','amount',11600,'gst_amount',1760,
      'vendor','Lemon Tree Premier, Delhi Aerocity','gstin','07AABCL2345M1ZP','invoice_no','LTP/26-27/4471',
      'has_receipt',true,'nights',4),
    jsonb_build_object('category_id',e_xfer,'city_id',c_del,'spent_on',(current_date - 14)::text,
      'description','Airport transfers, both ends','amount',1180,'vendor','Uber India','has_receipt',true),
    jsonb_build_object('category_id',e_local,'city_id',c_del,'spent_on',(current_date - 11)::text,
      'description','Running between Okhla, Bawana and Aerocity','amount',7200,
      'has_receipt',true,'days',4),
    jsonb_build_object('category_id',e_bmeal,'city_id',c_del,'spent_on',(current_date - 12)::text,
      'description','Dinner with the Okhla buying team','amount',3650,'gst_amount',183,
      'vendor','Indian Accent','gstin','07AAACT1234F1ZQ','invoice_no','IA/8871',
      'has_receipt',true,'meal_kind','business','persons',4,
      'guests','Mr. Sanjay Mehta (Head - Purchase) and Ms. Rupal Shah (QA), Vipul Dyechem'),
    jsonb_build_object('category_id',e_refr,'city_id',c_del,'spent_on',(current_date - 14)::text,
      'description','Coffee and sandwich at the airport','amount',260,
      'has_receipt',false,'self_declared',true),
    jsonb_build_object('category_id',e_alc,'city_id',c_del,'spent_on',(current_date - 12)::text,
      'description','Two glasses of wine on the dinner bill','amount',900,'has_receipt',true),
    jsonb_build_object('category_id',e_bagg,'city_id',c_ahm,'spent_on',(current_date - 14)::text,
      'description','Excess baggage — 9 kg of sample tins','amount',1450,
      'vendor','IndiGo','has_receipt',true)));
  perform public.fms_travel_submit_claim(x15);

  -- ---- 16 · AWAITING CLAIM REVIEW with NOTHING TO CLAIM. §8 pays the daily
  --      allowance whether or not a single receipt exists, so "no expenses" is
  --      not "nothing owed" — the trip goes to review, not to closed.
  x16 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_nakul, 'traveller_name', 'Nakuleshwar Sharma',
    'purpose_id', p_branch, 'destination_city_id', c_mum,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date - 18)::text,
    'planned_return_date',    (current_date - 15)::text,
    'accommodation_required', true, 'estimated_cost', 26000,
    'advance_requested', false));
  perform public.fms_travel_submit_trip(x16);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x16, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x16, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_save_leg(x16, jsonb_build_object(
    'kind','flight','direction','outbound','from_city_id',c_ahm,'to_city_id',c_mum,
    'start_on',(current_date - 18)::text,'start_time','08:00','end_on',(current_date - 18)::text,'end_time','09:20',
    'airline_id',a_vist,'booking_ref','UK4410B','travel_class','Economy',
    'ticket_cost',7800,'other_charges',400), null);
  perform public.fms_travel_save_leg(x16, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_mum,
    'start_on',(current_date - 18)::text,'end_on',(current_date - 15)::text,
    'hotel_id',h_mum1,'booking_ref','ORC-661209','travel_class','Executive',
    'ticket_cost',11400,'other_charges',0,'notes','3 nights, billed to the company account.'), null);
  perform public.fms_travel_save_leg(x16, jsonb_build_object(
    'kind','flight','direction','return','from_city_id',c_mum,'to_city_id',c_ahm,
    'start_on',(current_date - 15)::text,'start_time','20:30','end_on',(current_date - 15)::text,'end_time','21:50',
    'airline_id',a_vist,'booking_ref','UK4410B','travel_class','Economy',
    'ticket_cost',8100,'other_charges',400), null);
  perform public.fms_travel_complete_booking(x16);
  perform public.fms_travel_record_actual_travel(x16, jsonb_build_object(
    'actual_departure_date',(current_date - 18)::text,'actual_departure_time','08:00',
    'actual_return_date',   (current_date - 15)::text,'actual_return_time','21:50',
    'customer_provided','meals'));
  perform public.fms_travel_no_claim(x16,
    'Everything was on the company card or paid by the branch. Only the daily allowance is due, and the customer fed us throughout, so it is at half under §8.3.');

  -- ---- 17 · AWAITING FINANCE VERIFICATION. The HOD has passed the claim; it
  --      is now Finance''s to check line by line.
  x17 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_hemants, 'traveller_name', 'HemantKumar Shukla',
    'purpose_id', p_cust, 'destination_city_id', c_sur,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date - 20)::text,
    'planned_return_date',    (current_date - 17)::text,
    'accommodation_required', true, 'estimated_cost', 15000,
    'advance_requested', false));
  perform public.fms_travel_submit_trip(x17);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x17, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x17, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_save_leg(x17, jsonb_build_object(
    'kind','train','direction','outbound','from_city_id',c_ahm,'to_city_id',c_sur,
    'start_on',(current_date - 20)::text,'start_time','05:45','end_on',(current_date - 20)::text,'end_time','09:10',
    'carrier_other','12933 Karnavati Express','booking_ref','PNR 8814220091','travel_class','3A',
    'ticket_cost',1075,'other_charges',0), null);
  perform public.fms_travel_save_leg(x17, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_sur,
    'start_on',(current_date - 20)::text,'end_on',(current_date - 17)::text,
    'hotel_id',h_sur1,'booking_ref','FRS-118820','travel_class','Deluxe',
    'ticket_cost',6900,'other_charges',0,'notes','3 nights.'), null);
  perform public.fms_travel_save_leg(x17, jsonb_build_object(
    'kind','train','direction','return','from_city_id',c_sur,'to_city_id',c_ahm,
    'start_on',(current_date - 17)::text,'start_time','17:20','end_on',(current_date - 17)::text,'end_time','20:45',
    'carrier_other','12934 Karnavati Express','booking_ref','PNR 8814220092','travel_class','3A',
    'ticket_cost',1075,'other_charges',0), null);
  perform public.fms_travel_complete_booking(x17);
  perform public.fms_travel_record_actual_travel(x17, jsonb_build_object(
    'actual_departure_date',(current_date - 20)::text,'actual_departure_time','05:45',
    'actual_return_date',   (current_date - 17)::text,'actual_return_time','20:45'));
  perform public.fms_travel_save_claim_draft(x17, jsonb_build_array(
    jsonb_build_object('category_id',e_train,'city_id',c_ahm,'spent_on',(current_date - 20)::text,
      'description','Karnavati Express 3A, both ways','amount',2150,
      'vendor','IRCTC','invoice_no','PNR 8814220091','has_receipt',true),
    jsonb_build_object('category_id',e_hotel,'city_id',c_sur,'spent_on',(current_date - 17)::text,
      'description','The Fern Residency, Surat — 3 nights','amount',6900,'gst_amount',828,
      'vendor','The Fern Residency, Surat','gstin','24AAECF7788K1ZL','invoice_no','FRS/26-27/1188',
      'has_receipt',true,'nights',3),
    jsonb_build_object('category_id',e_local,'city_id',c_sur,'spent_on',(current_date - 19)::text,
      'description','Autos and cabs around Pandesara and Sachin GIDC','amount',2400,
      'has_receipt',true,'days',3),
    jsonb_build_object('category_id',e_tmeal,'city_id',c_sur,'spent_on',(current_date - 19)::text,
      'description','Lunch with the two service engineers on site','amount',1600,
      'has_receipt',true,'meal_kind','team','persons',4),
    jsonb_build_object('category_id',e_misc,'city_id',c_sur,'spent_on',(current_date - 18)::text,
      'description','Porterage and photocopies at the customer office','amount',450,
      'has_receipt',false,'self_declared',true)));
  perform public.fms_travel_submit_claim(x17);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_claim(x17, 'approve',
    'Checked against his visit report — all five days accounted for. Over to Finance.');

  -- ---- 18 · AWAITING SETTLEMENT. Band 9 → TC-A, an advance was drawn, and
  --      Finance has SETTLED ONE LINE AT ITS OWN FIGURE with a reason. That gap
  --      between the engine''s answer and the human''s IS the Policy Exceptions
  --      report.
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  x18 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_manmohan, 'traveller_name', 'Manmohan Totla',
    'purpose_id', p_sales, 'destination_city_id', c_blr,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date - 25)::text,
    'planned_return_date',    (current_date - 21)::text,
    'accommodation_required', true, 'estimated_cost', 68000,
    'advance_requested', true, 'advance_requested_amount', 20000));
  perform public.fms_travel_set_passengers(x18, jsonb_build_array(
    jsonb_build_object('full_name','Manmohan Totla','employee_id',t_manmohan,
                       'gender','male','date_of_birth','1968-03-11',
                       'mobile','9825000118','is_primary',true)));
  perform public.fms_travel_submit_trip(x18);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x18, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x18, 'approve', 'Approved — the Bengaluru distributor renewal is the whole quarter.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_yash)::text, true);
  perform public.fms_travel_approve_advance(x18, 20000, 'Approved.');
  perform public.fms_travel_disburse_advance(x18, 20000, current_date - 28, 'NEFT', 'UTR/HDFC/2026/879210');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_save_leg(x18, jsonb_build_object(
    'kind','flight','direction','outbound','from_city_id',c_ahm,'to_city_id',c_blr,
    'start_on',(current_date - 25)::text,'start_time','07:25','end_on',(current_date - 25)::text,'end_time','09:40',
    'airline_id',a_vist,'booking_ref','UK7712C','travel_class','Business',
    'ticket_cost',18900,'other_charges',0,'notes','TC-A permits Business (§4.1).'), null);
  perform public.fms_travel_save_leg(x18, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_blr,
    'start_on',(current_date - 25)::text,'end_on',(current_date - 21)::text,
    'hotel_id',h_blr1,'booking_ref','LTB-442091','travel_class','Premier king',
    'ticket_cost',16400,'other_charges',0,'notes','4 nights.'), null);
  perform public.fms_travel_save_leg(x18, jsonb_build_object(
    'kind','flight','direction','return','from_city_id',c_blr,'to_city_id',c_ahm,
    'start_on',(current_date - 21)::text,'start_time','18:50','end_on',(current_date - 21)::text,'end_time','21:05',
    'airline_id',a_vist,'booking_ref','UK7712C','travel_class','Business',
    'ticket_cost',17600,'other_charges',0), null);
  perform public.fms_travel_complete_booking(x18);
  perform public.fms_travel_record_actual_travel(x18, jsonb_build_object(
    'actual_departure_date',(current_date - 25)::text,'actual_departure_time','07:25',
    'actual_return_date',   (current_date - 21)::text,'actual_return_time','21:05'));
  perform public.fms_travel_save_claim_draft(x18, jsonb_build_array(
    jsonb_build_object('category_id',e_air,'city_id',c_ahm,'spent_on',(current_date - 25)::text,
      'description','Vistara AMD-BLR, Business','amount',18900,'gst_amount',945,
      'vendor','Vistara','gstin','07AAFCT1234R1ZS','invoice_no','UK/26/771201',
      'has_receipt',true),
    jsonb_build_object('category_id',e_hotel,'city_id',c_blr,'spent_on',(current_date - 21)::text,
      'description','Lemon Tree, Electronics City — 4 nights','amount',16400,'gst_amount',2952,
      'vendor','Lemon Tree Hotel, Electronics City','gstin','29AABCL2345M1ZB','invoice_no','LTB/26-27/2210',
      'has_receipt',true,'nights',4),
    jsonb_build_object('category_id',e_air,'city_id',c_blr,'spent_on',(current_date - 21)::text,
      'description','Vistara BLR-AMD, Business','amount',17600,'gst_amount',880,
      'vendor','Vistara','gstin','07AAFCT1234R1ZS','invoice_no','UK/26/771202',
      'has_receipt',true),
    jsonb_build_object('category_id',e_local,'city_id',c_blr,'spent_on',(current_date - 23)::text,
      'description','Cabs between Electronics City, Peenya and the airport','amount',3900,
      'has_receipt',true,'days',4),
    jsonb_build_object('category_id',e_bmeal,'city_id',c_blr,'spent_on',(current_date - 23)::text,
      'description','Dinner with the distributor and their two directors','amount',4200,'gst_amount',210,
      'vendor','Karavalli','gstin','29AAACT4567P1ZM','invoice_no','KRV/9921',
      'has_receipt',true,'meal_kind','business','persons',4,
      'guests','Mr. Raghavendra and Mr. Prakash Rao, Deccan Inks; Mr. S. Kulkarni, their plant head')));
  perform public.fms_travel_submit_claim(x18);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_claim(x18, 'approve', 'Approved. The renewal came out of that dinner.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_yash)::text, true);
  select id into v_line from public.fms_travel_claim_lines
   where trip_id = x18 and category_id = e_bmeal limit 1;
  perform public.fms_travel_set_line_settlement(v_line, 3500,
    'The §9 cap is 3,000 for TC-A. Settled at 3,500 on the strength of the meeting note and the renewal it produced; the balance of 700 stands disallowed.');
  perform public.fms_travel_complete_finance_review(x18,
    'Verified against the folios. One line settled above the cap with a written reason; everything else is within entitlement.');

  -- ---- 19 · CLOSED, and the money went OUT. Band 4 → no Director step. An
  --      advance was drawn and the claim came to more, so the balance is paid.
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  x19 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_jayshree, 'traveller_name', 'Jayshree Patil',
    'purpose_id', p_cust, 'destination_city_id', c_mum,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date - 16)::text,
    'planned_return_date',    (current_date - 13)::text,
    'accommodation_required', true, 'estimated_cost', 14000,
    'advance_requested', true, 'advance_requested_amount', 6000));
  perform public.fms_travel_submit_trip(x19);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x19, 'approve', 'Approved — the Bhiwandi collection run.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_yash)::text, true);
  perform public.fms_travel_approve_advance(x19, 6000, 'Approved.');
  perform public.fms_travel_disburse_advance(x19, 6000, current_date - 19, 'NEFT', 'UTR/HDFC/2026/881004');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_save_leg(x19, jsonb_build_object(
    'kind','train','direction','outbound','from_city_id',c_ahm,'to_city_id',c_mum,
    'start_on',(current_date - 16)::text,'start_time','22:40','end_on',(current_date - 15)::text,'end_time','05:55',
    'carrier_other','19011 Gujarat Express','booking_ref','PNR 6612009911','travel_class','3A',
    'ticket_cost',1340,'other_charges',0), null);
  perform public.fms_travel_save_leg(x19, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_mum,
    'start_on',(current_date - 16)::text,'end_on',(current_date - 13)::text,
    'hotel_id',h_mum2,'booking_ref','GIN-330911','travel_class','Standard',
    'ticket_cost',5100,'other_charges',0,'notes','3 nights.'), null);
  perform public.fms_travel_save_leg(x19, jsonb_build_object(
    'kind','train','direction','return','from_city_id',c_mum,'to_city_id',c_ahm,
    'start_on',(current_date - 13)::text,'start_time','19:00','end_on',(current_date - 13)::text,'end_time','23:55',
    'carrier_other','19012 Gujarat Express','booking_ref','PNR 6612009912','travel_class','3A',
    'ticket_cost',1340,'other_charges',0), null);
  perform public.fms_travel_complete_booking(x19);
  perform public.fms_travel_record_actual_travel(x19, jsonb_build_object(
    'actual_departure_date',(current_date - 16)::text,'actual_departure_time','22:40',
    'actual_return_date',   (current_date - 13)::text,'actual_return_time','23:55'));
  perform public.fms_travel_save_claim_draft(x19, jsonb_build_array(
    jsonb_build_object('category_id',e_train,'city_id',c_ahm,'spent_on',(current_date - 16)::text,
      'description','Gujarat Express 3A, both ways','amount',2680,
      'vendor','IRCTC','invoice_no','PNR 6612009911','has_receipt',true),
    jsonb_build_object('category_id',e_hotel,'city_id',c_mum,'spent_on',(current_date - 13)::text,
      'description','Ginger Andheri East — 3 nights','amount',5100,'gst_amount',612,
      'vendor','Ginger Mumbai, Andheri East','gstin','27AAACR1234K1ZV','invoice_no','GIN/26-27/8814',
      'has_receipt',true,'nights',3),
    jsonb_build_object('category_id',e_local,'city_id',c_mum,'spent_on',(current_date - 15)::text,
      'description','Locals and autos to Bhiwandi and Vikhroli','amount',1900,
      'has_receipt',true,'days',3),
    jsonb_build_object('category_id',e_refr,'city_id',c_mum,'spent_on',(current_date - 16)::text,
      'description','Tea and a sandwich on the platform','amount',180,
      'has_receipt',false,'self_declared',true)));
  perform public.fms_travel_submit_claim(x19);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_claim(x19, 'approve', 'Approved — three of the four ledgers came back signed.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_yash)::text, true);
  perform public.fms_travel_complete_finance_review(x19, 'Verified. Nothing outside entitlement.');
  select net_payable into v_net from public.fms_travel_trips where id = x19;
  perform public.fms_travel_settle(x19, jsonb_build_object(
    'amount', v_net, 'paid_on', (current_date - 4)::text,
    'mode', 'NEFT', 'reference', 'UTR/HDFC/2026/889441',
    'note', 'Balance after the 6,000 advance, paid with the month-end run.'));

  -- ---- 20 · CLOSED, and the money came BACK. The claim was filed 47 days
  --      after the travel ended, so §11.3 refuses every line the Director did
  --      not sign; the advance was larger than what survived, and the
  --      difference is RECOVERED — which credits advance_recovered_amount, the
  --      column §11.2 and the Employee Exit clearance row both read.
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  x20 := public.fms_travel_save_draft(jsonb_build_object(
    'traveller_id', t_prashant, 'traveller_name', 'Prashant Panchariya',
    'purpose_id', p_compl, 'destination_city_id', c_kol,
    'journey_type', 'round_trip', 'preferred_slot', 'morning',
    'planned_departure_date', (current_date - 52)::text,
    'planned_return_date',    (current_date - 47)::text,
    'accommodation_required', true, 'estimated_cost', 40000,
    'advance_requested', true, 'advance_requested_amount', 25000));
  perform public.fms_travel_submit_trip(x20);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_manager(x20, 'approve', 'Approved — six days on the Howrah installation.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_travel_decide_director(x20, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_yash)::text, true);
  perform public.fms_travel_approve_advance(x20, 25000, 'Approved — long stay, spares freight and a hired van.');
  perform public.fms_travel_disburse_advance(x20, 25000, current_date - 55, 'NEFT', 'UTR/HDFC/2026/871188');
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_travel_save_leg(x20, jsonb_build_object(
    'kind','flight','direction','outbound','from_city_id',c_ahm,'to_city_id',c_kol,
    'start_on',(current_date - 52)::text,'start_time','06:15','end_on',(current_date - 52)::text,'end_time','09:05',
    'airline_id',a_ai,'booking_ref','AI2201X','travel_class','Economy',
    'ticket_cost',8900,'other_charges',0), null);
  perform public.fms_travel_save_leg(x20, jsonb_build_object(
    'kind','hotel','direction','local','to_city_id',c_kol,
    'start_on',(current_date - 52)::text,'end_on',(current_date - 47)::text,
    'hotel_id',h_kol1,'booking_ref','PIK-220911','travel_class','Standard',
    'ticket_cost',12500,'other_charges',0,'notes','5 nights.'), null);
  perform public.fms_travel_complete_booking(x20);
  perform public.fms_travel_record_actual_travel(x20, jsonb_build_object(
    'actual_departure_date',(current_date - 52)::text,'actual_departure_time','06:15',
    'actual_return_date',   (current_date - 47)::text,'actual_return_time','21:30'));
  perform public.fms_travel_save_claim_draft(x20, jsonb_build_array(
    jsonb_build_object('category_id',e_air,'city_id',c_ahm,'spent_on',(current_date - 52)::text,
      'description','Air India AMD-CCU','amount',8900,'gst_amount',445,
      'vendor','Air India','gstin','07AACCN1234L1ZE','invoice_no','AI/26/220101',
      'has_receipt',true,'director_approved',true),
    jsonb_build_object('category_id',e_hotel,'city_id',c_kol,'spent_on',(current_date - 47)::text,
      'description','The Peerless Inn — 5 nights','amount',12500,'gst_amount',1500,
      'vendor','The Peerless Inn, Kolkata','gstin','19AABCP7788N1ZR','invoice_no','PIK/26-27/0912',
      'has_receipt',true,'nights',5),
    jsonb_build_object('category_id',e_local,'city_id',c_kol,'spent_on',(current_date - 49)::text,
      'description','Hired van to Howrah and back, five days','amount',3200,
      'has_receipt',true,'days',5)));
  perform public.fms_travel_submit_claim(x20);
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_travel_decide_claim(x20, 'approve',
    'Approved as filed. He is seven weeks late with it and §11.3 has done what it does — the air ticket had my written sign-off, the rest does not.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_yash)::text, true);
  perform public.fms_travel_complete_finance_review(x20,
    'Verified. Only the Director-approved line survives §11.3, so the advance exceeds the settlement and the balance is recoverable.');
  select net_payable into v_net from public.fms_travel_trips where id = x20;
  perform public.fms_travel_settle(x20, jsonb_build_object(
    'amount', abs(v_net), 'paid_on', (current_date - 38)::text,
    'mode', 'Payroll deduction', 'reference', 'PAY/DED/2026-08/0114',
    'note', 'Recovered through the August payroll, as agreed with him in writing.'));

  -- =========================================================================
  -- 5 · THE MASTER GOVERNANCE QUEUE — one pending, one approved, one refused,
  --     so the review screen and its history both have something in them.
  --     `_demo` marks them for the teardown; nothing else reads that key.
  -- =========================================================================
  insert into public.fms_travel_master_requests (master_type, proposed_payload, status, requested_by, reviewed_by, review_note, created_at)
  values
    ('hotel',
     jsonb_build_object('name','Treebo Trend Hillview, Bhilwara','city_id',
        (select id from public.fms_travel_cities where name = 'Bhilwara'), '_demo','travel'),
     'pending', u_shweta, null, null, now() - interval '3 days'),
    ('city',
     jsonb_build_object('name','Silvassa','state','Dadra & Nagar Haveli','tier',3,'_demo','travel'),
     'approved', u_shweta, u_karan,
     'Added. Three converters there now, so it will be asked for again.', now() - interval '12 days'),
    ('expense_category',
     jsonb_build_object('name','Airport lounge access','kind','misc','reimbursable',true,'_demo','travel'),
     'rejected', u_shweta, u_karan,
     'Not a category we reimburse. §15 already covers personal comfort spending, and adding a head for it would read as permission.', now() - interval '9 days');

  -- =========================================================================
  -- 6 · RENUMBER TO THE DEMO SERIES + AGE THE RECORD.
  --
  -- Everything above was stamped now() by the RPCs, because that is what really
  -- happened. Here — and ONLY here — is the demo aged with raw UPDATEs, so the
  -- SLA colours, the overdue paths and the Desk Performance report have
  -- something to show. No workflow state is written.
  --
  -- ⚠ THE APPROVAL STAMPS HANG OFF `sub` AND THE CLAIM STAMPS HANG OFF THE
  --   TRAVEL END. A single uniform shift would collapse a trip that really took
  --   six weeks into one minute, and Desk Performance would then report every
  --   step as instant.
  -- =========================================================================
  update public.fms_travel_trips t set
    trip_no      = v.no,
    created_at   = v.sub - interval '3 hours',
    submitted_at = case when t.submitted_at is null then null else v.sub end,
    ma_at        = case when t.ma_at is null then null else v.sub + interval '19 hours' end,
    da_at        = case when t.da_at is null then null else v.sub + interval '1 day 21 hours' end,
    adv_at       = case when t.adv_at is null then null else v.sub + interval '2 days 23 hours' end,
    bk_at        = case when t.bk_at is null then null else v.sub + interval '3 days 20 hours' end,
    cl_at        = case when t.cl_at is null then null else
                     coalesce(t.actual_return_date, t.planned_return_date, t.planned_departure_date)::timestamptz
                       + interval '2 days 11 hours' end,
    cr_at        = case when t.cr_at is null then null else
                     coalesce(t.actual_return_date, t.planned_return_date, t.planned_departure_date)::timestamptz
                       + interval '4 days 12 hours' end,
    fr_at        = case when t.fr_at is null then null else
                     coalesce(t.actual_return_date, t.planned_return_date, t.planned_departure_date)::timestamptz
                       + interval '7 days 15 hours' end,
    st_at        = case when t.st_at is null then null else
                     coalesce(t.actual_return_date, t.planned_return_date, t.planned_departure_date)::timestamptz
                       + interval '9 days 16 hours' end,
    returned_at  = case when t.returned_at is null then null else v.sub + interval '20 hours' end,
    rejected_at  = case when t.rejected_at is null then null else v.sub + interval '1 day 22 hours' end,
    hold_at      = case when t.hold_at is null then null else v.sub + interval '4 days 9 hours' end,
    cancelled_at = case when t.cancelled_at is null then null else v.sub + interval '5 days 10 hours' end,
    tc_downgraded_at = case when t.tc_downgraded_at is null then null else v.sub end,
    edited_at    = case when t.edited_at is null then null else
                     coalesce(t.actual_return_date, t.planned_return_date, t.planned_departure_date)::timestamptz
                       + interval '2 days 9 hours' end,
    advance_recovered_at = case when t.advance_recovered_at is null then null else
                     coalesce(t.actual_return_date, t.planned_return_date, t.planned_departure_date)::timestamptz
                       + interval '9 days 16 hours' end
  from (values
    -- id    no               submitted_at
    (x01, 'TRV-DEMO-01', now() -  6 * interval '1 day'),  -- manager approval — OVERDUE
    (x02, 'TRV-DEMO-02', now() -  4 * interval '1 day'),  -- Director approval
    (x03, 'TRV-DEMO-03', now() -  8 * interval '1 day'),  -- returned for clarification
    (x04, 'TRV-DEMO-04', now() - 11 * interval '1 day'),  -- rejected
    (x05, 'TRV-DEMO-05', now() -  5 * interval '1 day'),  -- advance approved, not paid
    (x06, 'TRV-DEMO-06', now() -  3 * interval '1 day'),  -- awaiting booking
    (x07, 'TRV-DEMO-07', now() - 12 * interval '1 day'),  -- booked, UPCOMING
    (x08, 'TRV-DEMO-08', now() - 20 * interval '1 day'),  -- back, claim due, advance out
    (x09, 'TRV-DEMO-09', now() -  3 * interval '1 day'),  -- retrospective, TC downgraded
    (x10, 'TRV-DEMO-10', now() - 16 * interval '1 day'),  -- cancellation requested
    (x11, 'TRV-DEMO-11', now() - 22 * interval '1 day'),  -- cancelled, claim still owed
    (x12, 'TRV-DEMO-12', now() - 18 * interval '1 day'),  -- cancelled, fully refunded
    (x13, 'TRV-DEMO-13', now() -  9 * interval '1 day'),  -- cancelled before booking
    (x14, 'TRV-DEMO-14', now() - 13 * interval '1 day'),  -- on hold
    (x15, 'TRV-DEMO-15', now() - 24 * interval '1 day'),  -- claim under HOD review
    (x16, 'TRV-DEMO-16', now() - 26 * interval '1 day'),  -- nothing to claim, DA only
    (x17, 'TRV-DEMO-17', now() - 30 * interval '1 day'),  -- with Finance
    (x18, 'TRV-DEMO-18', now() - 36 * interval '1 day'),  -- awaiting settlement
    (x19, 'TRV-DEMO-19', now() - 26 * interval '1 day'),  -- closed, paid
    (x20, 'TRV-DEMO-20', now() - 60 * interval '1 day')   -- closed, recovered
  ) as v(id, no, sub)
  where t.id = v.id;

  -- The draft keeps NO number — that is the whole point of a draft — so it is
  -- only aged.
  update public.fms_travel_trips set created_at = now() - interval '2 days' where id = xdr;

  -- ⚠ TRIP 09 IS THE ONE EXCEPTION TO THE OFFSETS ABOVE. It was regularised
  --   AFTER the journey, so approvals and booking all happened inside three
  --   days — the generic +3d20h would date its booking in the future.
  update public.fms_travel_trips set
    ma_at = submitted_at + interval '4 hours',
    da_at = submitted_at + interval '9 hours',
    bk_at = submitted_at + interval '1 day 2 hours'
  where id = x09;

  select coalesce(array_agg(id), '{}') into v_all
    from public.fms_travel_trips
   where trip_no like 'TRV-DEMO-%' or id = xdr;

  -- The satellites follow their trip, so nothing is dated before the trip that
  -- owns it or after the step that closed it.
  update public.fms_travel_legs l set created_at = t.bk_at - interval '1 day', updated_at = t.bk_at
    from public.fms_travel_trips t
   where t.id = l.trip_id and t.id = any(v_all) and t.bk_at is not null;

  update public.fms_travel_claim_lines c set
    created_at = t.cl_at - interval '1 day',
    priced_at  = case when c.priced_at is null then null else t.cl_at end,
    finance_at = case when c.finance_at is null then null else t.fr_at end,
    updated_at = coalesce(t.fr_at, t.cl_at)
    from public.fms_travel_trips t
   where t.id = c.trip_id and t.id = any(v_all) and t.cl_at is not null;

  update public.fms_travel_da_days d set created_at = t.cl_at
    from public.fms_travel_trips t
   where t.id = d.trip_id and t.id = any(v_all) and t.cl_at is not null;

  -- The activity trail and the bell, spread evenly across each trip's own life
  -- so the thread reads in order and nothing is dated in its trip's future.
  with span as (
    select t.id, t.created_at as t0,
           greatest(t.created_at, coalesce(
             t.st_at, t.fr_at, t.cr_at, t.cl_at, t.cancelled_at, t.hold_at,
             t.rejected_at, t.returned_at, t.bk_at, t.adv_at, t.da_at,
             t.ma_at, t.submitted_at, t.created_at)) as t1
      from public.fms_travel_trips t where t.id = any(v_all)
  ), ord as (
    select a.id, s.t0, s.t1,
           row_number() over (partition by a.entity_id order by a.created_at, a.id) as n,
           count(*)     over (partition by a.entity_id) as c
      from public.fms_travel_activity a join span s on s.id = a.entity_id
  )
  update public.fms_travel_activity a
     set created_at = ord.t0 + ((ord.t1 - ord.t0) * (ord.n::numeric / greatest(ord.c, 1)))
    from ord where ord.id = a.id;

  update public.fms_travel_notifications n set created_at = a.created_at
    from public.fms_travel_activity a
   where a.entity_id = n.entity_id and a.type = n.type and n.entity_id = any(v_all);

  -- ⚠ THE ONE COLUMN NO RPC WRITES. §16 caps reimbursement at the band
  --   entitlement once somebody records what the compliant option would have
  --   cost; `fms_travel_legs.entitled_fare` is that figure and nothing in the
  --   module sets it yet. Recorded here by hand on the one Business-class leg
  --   so the Policy Exceptions report has a §16 row to render.
  update public.fms_travel_legs set entitled_fare = 11200
   where trip_id = x18 and travel_class = 'Business' and direction = 'outbound';

  -- =========================================================================
  -- 7 · HAND THE REAL SERIES BACK.
  --
  -- The RPCs consumed TRV-<FY>-0001…0020 and every demo trip was renamed above,
  -- so those numbers are free again and the counter is wound back.
  --
  -- ⚠ WOUND BACK TO THE HIGHEST **REAL** NUMBER, NOT DELETED. The first draft of
  --   this file deleted the counter row outright, on the assumption that no real
  --   trip existed yet — and on 24-Aug-2026 a real one (TRV-2627-0001) was raised
  --   three minutes before the seed ran. Deleting the row would have reset the
  --   series to 0001 and the NEXT real submit would have died on the trip_no
  --   unique index, inside an RPC, with a constraint name for an error message.
  --   Reading the live maximum costs one query and cannot be wrong.
  -- =========================================================================
  select coalesce(max((regexp_replace(trip_no, '^TRV-' || v_fy || '-', ''))::int), 0)
    into v_seq
    from public.fms_travel_trips
   where trip_no ~ ('^TRV-' || v_fy || '-[0-9]{4}$');

  if v_seq = 0 then
    delete from public.fms_travel_counters where scope = 'trip:' || v_fy;
  else
    insert into public.fms_travel_counters (scope, last_value)
    values ('trip:' || v_fy, v_seq)
    on conflict (scope) do update
      set last_value = greatest(public.fms_travel_counters.last_value, excluded.last_value),
          updated_at = now();
  end if;

  -- =========================================================================
  -- 8 · ASSERT THE POINT OF THE FILE: every reachable status is represented.
  -- =========================================================================
  for rec in
    select s.want
      from unnest(array[
        'draft','awaiting_manager_approval','awaiting_director_approval','returned',
        'rejected','awaiting_advance','awaiting_booking','booked',
        'cancellation_requested','cancelled_pending_claim','awaiting_claim_review',
        'awaiting_finance_review','awaiting_settlement','closed','on_hold','cancelled'
      ]) as s(want)
     where not exists (
       select 1 from public.fms_travel_trips t
        where t.id = any(v_all) and t.status = s.want)
  loop
    raise exception 'The demo does not park a trip at "%" — that status has no sample data.', rec.want;
  end loop;

  raise notice 'Travel Desk demo seeded: % trips (TRV-DEMO-01 … TRV-DEMO-20 plus one unnumbered draft), % passengers, % legs, % claim lines, % DA days, % activity rows.',
    cardinality(v_all),
    (select count(*) from public.fms_travel_passengers  where trip_id = any(v_all)),
    (select count(*) from public.fms_travel_legs        where trip_id = any(v_all)),
    (select count(*) from public.fms_travel_claim_lines where trip_id = any(v_all)),
    (select count(*) from public.fms_travel_da_days     where trip_id = any(v_all)),
    (select count(*) from public.fms_travel_activity    where entity_id = any(v_all));
  raise notice 'Hotels, bus operators and per-employee base cities were written and are LEFT IN PLACE on teardown (they are master data, not demo content).';
  raise notice 'The trip:%% counter was reset — the first real trip will still be TRV-%-0001.', v_fy;
end $seed$;
