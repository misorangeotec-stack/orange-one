-- ===========================================================================
-- HR Recruitment FMS — SEED the JD masters for Orange O Tec.
--
-- The three masters added in 20260815120000 are useless empty: a HOD opening the
-- rebuilt MRF form on day one must find their job title already in the list and
-- the job description already written. This seeds them from what the company
-- actually does — industrial digital textile printing machinery: manufacture and
-- Noida assembly, import and distribution of the Colorix / Homer / Kiian /
-- Huntsman lines, an in-house ink range (reactive, sublimation, pigment, UV,
-- disperse), label and publication presses, and a pan-India installation and
-- service network.
--
-- Departments are matched BY NAME against public.departments with a LEFT join:
-- a rename or a missing department leaves department_id null (HR sets it on the
-- Masters page) instead of failing the migration.
--
-- Everything is `on conflict do nothing` / name-matched, so re-running is safe
-- and NOTHING HR has already edited is overwritten — the template update at the
-- bottom is guarded on `default_role_summary is null` for exactly that reason.
--
-- These are starting values, not an enum. Every row is editable, deactivatable
-- and extendable from New Recruitment -> Masters.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. SKILLS — one flat list; `category` becomes the group header in the form's
--    two skill pickers.
-- ---------------------------------------------------------------------------

-- Technical & domain: the machines, the chemistry, and the commercial/back-office
-- craft each department actually hires for.
insert into public.fms_hr_skills (name, category, sort_order) values
  ('Digital textile printing operations',        'technical', 10),
  ('Sublimation printing',                       'technical', 11),
  ('Direct-to-fabric printing',                  'technical', 12),
  ('Pigment printing',                           'technical', 13),
  ('Reactive printing',                          'technical', 14),
  ('Calendering & heat transfer',                'technical', 15),
  ('Label / narrow-web printing',                'technical', 16),
  ('Publication inkjet press operation',         'technical', 17),
  ('Printhead handling - Kyocera',               'technical', 20),
  ('Printhead handling - Epson',                 'technical', 21),
  ('Printhead handling - Ricoh',                 'technical', 22),
  ('Nozzle diagnostics & purging',               'technical', 23),
  ('Ink delivery systems (pumps, dampers, filters)', 'technical', 24),
  ('RIP software operation',                     'technical', 30),
  ('ICC profiling & colour management',          'technical', 31),
  ('Pantone / shade matching',                   'technical', 32),
  ('Machine installation & commissioning',       'technical', 40),
  ('Preventive maintenance & AMC servicing',     'technical', 41),
  ('Field breakdown troubleshooting',            'technical', 42),
  ('Mechanical assembly & alignment',            'technical', 43),
  ('Electrical panel wiring',                    'technical', 44),
  ('PLC / servo / motion control',               'technical', 45),
  ('Pneumatics & belt drives',                   'technical', 46),
  ('Board-level & firmware diagnostics',         'technical', 47),
  ('Textile pre-treatment, steaming & washing',  'technical', 50),
  ('Fabric & substrate knowledge',               'technical', 51),
  ('Ink chemistry & formulation',                'technical', 52),
  ('Ink QC (viscosity, pH, lab testing)',        'technical', 53),
  ('Consumables & sublimation paper knowledge',  'technical', 54),
  ('Capital equipment sales',                    'technical', 60),
  ('Technical / solution selling',               'technical', 61),
  ('Dealer & channel management',                'technical', 62),
  ('Exhibition selling (ITMACH, Gartex, GarFab)','technical', 63),
  ('Customer demo & trial running',              'technical', 64),
  ('Import documentation (BOE, BL, LC)',         'technical', 70),
  ('Customs clearance & HS classification',      'technical', 71),
  ('Export documentation',                       'technical', 72),
  ('Freight forwarding & logistics',             'technical', 73),
  ('Vendor development & procurement',           'technical', 74),
  ('Spare parts planning',                       'technical', 75),
  ('Production planning & control',              'technical', 76),
  ('Quality inspection',                         'technical', 77),
  ('Stores & warehouse management',              'technical', 78),
  ('Order-to-dispatch coordination',             'technical', 79),
  ('Accounts payable / receivable',              'technical', 80),
  ('GST, TDS & statutory compliance',            'technical', 81),
  ('Costing & MIS reporting',                    'technical', 82),
  ('Collections & credit control',               'technical', 83),
  ('Payroll, PF & ESIC',                         'technical', 84),
  ('Recruitment & sourcing',                     'technical', 85),
  ('Digital marketing & lead generation',        'technical', 90),
  ('Content & product marketing',                'technical', 91),
  ('Frontend development',                       'technical', 92),
  ('Backend & database development',             'technical', 93),
  ('ERP / FMS support',                          'technical', 94),
  ('Data analysis & dashboards',                 'technical', 95)
on conflict (name) do nothing;

insert into public.fms_hr_skills (name, category, sort_order) values
  ('Tally Prime',                       'tool', 10),
  ('SAP',                               'tool', 11),
  ('Excel (advanced)',                  'tool', 12),
  ('Google Sheets',                     'tool', 13),
  ('Adobe Photoshop',                   'tool', 20),
  ('Adobe Illustrator',                 'tool', 21),
  ('CorelDRAW',                         'tool', 22),
  ('Canva',                             'tool', 23),
  ('NeoStampa RIP',                     'tool', 30),
  ('Wasatch SoftRIP',                   'tool', 31),
  ('ErgoSoft RIP',                      'tool', 32),
  ('Caldera RIP',                       'tool', 33),
  ('i1Profiler / ICC tools',            'tool', 34),
  ('AutoCAD',                           'tool', 40),
  ('SolidWorks',                        'tool', 41),
  ('PLC software (Siemens / Delta / Mitsubishi)', 'tool', 42),
  ('Multimeter & oscilloscope',         'tool', 43),
  ('CRM (Zoho / Salesforce / HubSpot)', 'tool', 50),
  ('Orange One portal',                 'tool', 51),
  ('Power BI / Looker Studio',          'tool', 52),
  ('Google Ads / Meta Ads',             'tool', 53),
  ('IndiaMART & WhatsApp Business',     'tool', 54),
  ('Git',                               'tool', 60),
  ('React / TypeScript',                'tool', 61),
  ('Supabase / PostgreSQL',             'tool', 62),
  ('Python',                            'tool', 63)
on conflict (name) do nothing;

insert into public.fms_hr_skills (name, category, sort_order) values
  ('Communication (verbal & written)',        'soft', 10),
  ('Customer handling & escalation',          'soft', 11),
  ('Ownership & accountability',              'soft', 12),
  ('Problem solving under pressure',          'soft', 13),
  ('Team leadership & mentoring',             'soft', 14),
  ('Cross-functional collaboration',          'soft', 15),
  ('Time management & prioritisation',        'soft', 16),
  ('Adaptability & learning agility',         'soft', 17),
  ('Negotiation',                             'soft', 18),
  ('Attention to detail',                     'soft', 19),
  ('Reporting & documentation discipline',    'soft', 20),
  ('Willingness to travel (pan-India field work)', 'soft', 21)
on conflict (name) do nothing;

-- A pan-India installation and service network makes this a real hiring
-- criterion, not a nicety: an engineer covering Tirupur or Jetpur needs the
-- local language to run a handover on the shop floor.
insert into public.fms_hr_skills (name, category, sort_order) values
  ('English',   'language', 10),
  ('Hindi',     'language', 11),
  ('Gujarati',  'language', 12),
  ('Marathi',   'language', 13),
  ('Tamil',     'language', 14),
  ('Telugu',    'language', 15),
  ('Bengali',   'language', 16)
on conflict (name) do nothing;

insert into public.fms_hr_skills (name, category, sort_order) values
  ('OEM printhead service certification (Kyocera)',   'certification', 10),
  ('OEM machine training (Colorix / Homer / MS)',     'certification', 11),
  ('PLC & automation training',                       'certification', 12),
  ('Electrical supervisor licence (Gujarat)',         'certification', 13),
  ('Forklift operator licence',                       'certification', 14),
  ('Six Sigma Green Belt',                            'certification', 20),
  ('ISO 9001 internal auditor',                       'certification', 21),
  ('Tally certification',                             'certification', 22),
  ('Google / Meta digital marketing certification',   'certification', 23),
  ('Driving licence - two-wheeler',                   'certification', 30),
  ('Driving licence - four-wheeler',                  'certification', 31),
  ('Valid passport (overseas OEM training)',          'certification', 32)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. QUALIFICATIONS
-- ---------------------------------------------------------------------------
insert into public.fms_hr_qualifications (name, sort_order) values
  ('No formal qualification required',             1),
  ('Below 10th',                                   5),
  ('10th / SSC',                                  10),
  ('12th / HSC',                                  11),
  ('ITI - Fitter',                                20),
  ('ITI - Electrician',                           21),
  ('ITI - Electronics',                           22),
  ('Diploma - Mechanical',                        30),
  ('Diploma - Electrical',                        31),
  ('Diploma - Electronics & Communication',       32),
  ('Diploma - Textile Technology',                33),
  ('Diploma - Computer / IT',                     34),
  ('B.E./B.Tech - Mechanical',                    40),
  ('B.E./B.Tech - Electrical',                    41),
  ('B.E./B.Tech - Electronics / Instrumentation', 42),
  ('B.E./B.Tech - Textile Technology',            43),
  ('B.E./B.Tech - Computer Science / IT',         44),
  ('B.Sc - Chemistry',                            50),
  ('B.Sc - Other Science',                        51),
  ('B.Com',                                       52),
  ('BBA',                                         53),
  ('BA',                                          54),
  ('MCA',                                         55),
  ('M.E./M.Tech',                                 60),
  ('M.Sc - Chemistry',                            61),
  ('M.Com',                                       62),
  ('MBA - Marketing',                             70),
  ('MBA - Finance',                               71),
  ('MBA - HR',                                    72),
  ('MBA - Operations / Supply Chain',             73),
  ('CA / CA Inter',                               80),
  ('CS',                                          81),
  ('ICWA / CMA',                                  82),
  ('Any graduate',                                90)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. JOB TITLES — the job title list, each defaulted to its department.
--    LEFT join: an unmatched department name yields null, never a failure.
-- ---------------------------------------------------------------------------
insert into public.fms_hr_job_titles (name, department_id, sort_order)
select v.name, d.id, v.ord
from (values
  -- After Sales service — the largest hiring pool, and the one the pan-India
  -- installed base is served from.
  ('Service Engineer - Digital Printer',      'After Sales service',          10),
  ('Senior Service Engineer',                 'After Sales service',          11),
  ('Installation & Commissioning Engineer',   'After Sales service',          12),
  ('Field Service Technician',                'After Sales service',          13),
  ('Service Head',                            'After Sales service',          14),
  ('Service Coordinator',                     'After Sales - CRM',            20),
  ('Customer Support Executive',              'After Sales - CRM',            21),
  ('Application Engineer',                    'After Sales - Application',    30),
  ('Demo & Training Engineer',                'After Sales - Application',    31),
  -- Assembly / engineering
  ('Production Engineer - Machine Assembly',  'Research & Development',       40),
  ('Assembly Technician',                     'Research & Development',       41),
  ('Electrical & Panel Technician',           'Research & Development',       42),
  ('Design Engineer',                         'Research & Development',       43),
  ('Production Planner',                      'Research & Development',       44),
  -- Quality & ink
  ('QC Inspector',                            'Quality Lab',                  50),
  ('Quality Engineer',                        'Quality Lab',                  51),
  ('Ink Lab Chemist',                         'inK',                          55),
  ('Ink Production Executive',                'inK',                          56),
  -- Sales
  ('Sales Executive',                         'Sales',                        60),
  ('Technical Sales Engineer',                'Sales',                        61),
  ('Area Sales Manager',                      'Sales',                        62),
  ('Dealer Development Manager',              'Sales',                        63),
  ('Inside Sales / Telecaller',               'Sales',                        64),
  -- Marketing & brand
  ('Marketing Executive',                     'Marketing',                    70),
  ('Digital Marketing Executive',             'Marketing',                    71),
  ('Graphic Designer',                        'Brand Management',             72),
  ('Content Writer',                          'Brand Management',             73),
  -- Supply chain, import, stores
  ('Import Executive',                        'Supply Chain',                 80),
  ('Customs & Documentation Executive',       'Supply Chain',                 81),
  ('Logistics Coordinator',                   'Supply Chain',                 82),
  ('Purchase Executive',                      'Purchase',                     83),
  ('Purchase Manager',                        'Purchase',                     84),
  ('Store Keeper',                            'Inventory',                    85),
  ('Spare Parts Executive',                   'Spare - Print Head Warehouse', 86),
  -- Finance
  ('Accounts Executive',                      'Accounting & Finance',         90),
  ('Accounts Manager',                        'Accounting & Finance',         91),
  ('Credit Control Executive',                'Accounting & Finance',         92),
  -- Tech
  ('Software Developer',                      'AI & tech',                   100),
  ('ERP Support Executive',                   'AI & tech',                   101),
  -- People & admin
  ('HR Executive',                            'Human Resources',             110),
  ('Admin Executive',                         'Administration',              111),
  ('Office Assistant',                        'Administration',              112),
  ('Travel Desk Executive',                   'Travel Desk',                 113)
) as v(name, dept, ord)
left join public.departments d on lower(d.name) = lower(v.dept)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 4. JD TEMPLATES for the ten highest-volume roles.
--
-- This is what makes the rebuilt form short: picking one of these titles fills
-- in the whole job-description step, and the HOD reviews instead of authoring.
-- The other titles start blank and HR fills them in over time from the Masters
-- page — a job title with no template is a normal, supported state.
--
-- Skills and qualifications are matched BY NAME against the rows seeded above,
-- so a name that was edited before this ran is simply skipped rather than
-- resolving to a wrong id.
--
-- GUARDED on `default_role_summary is null`: re-running never overwrites a
-- template HR has since edited.
-- ---------------------------------------------------------------------------
with tpl(job_title, summary, responsibilities, exp_min, exp_max, quals, skills, preferred) as (
  values
  (
    'Service Engineer - Digital Printer',
    'Keep the installed base of digital textile printers running at customer sites across the region, and make sure every breakdown is closed within its committed response time.',
    E'Attend breakdown calls at customer sites and restore production within the committed response time\nCarry out scheduled preventive maintenance and AMC visits on installed printers\nDiagnose and resolve printhead, ink delivery and carriage faults on site\nPerform nozzle checks, purging, alignment and calibration after every service\nTrain the customer''s operators on daily maintenance and correct handling\nLog every visit, part consumed and root cause in the service system on the same day\nEscalate recurring or design-level faults to the service head with evidence\nSupport new installations and commissioning during peak seasons',
    2.0::numeric, 5.0::numeric,
    array['Diploma - Electronics & Communication','Diploma - Mechanical','ITI - Electronics','Diploma - Electrical'],
    array['Field breakdown troubleshooting','Printhead handling - Kyocera','Nozzle diagnostics & purging','Ink delivery systems (pumps, dampers, filters)','Preventive maintenance & AMC servicing','Digital textile printing operations','Customer handling & escalation','Willingness to travel (pan-India field work)','Hindi','English','Driving licence - two-wheeler'],
    array['Printhead handling - Epson','Printhead handling - Ricoh','Board-level & firmware diagnostics','RIP software operation','OEM printhead service certification (Kyocera)','Gujarati']
  ),
  (
    'Field Service Technician',
    'Handle first-line service and installation support in the field, working alongside the service engineers on the installed base.',
    E'Travel to customer sites for routine service, part replacement and consumable changes\nAssist the service engineer during installation, commissioning and major repairs\nCarry out mechanical and electrical checks per the service checklist\nReplace dampers, filters, belts and wipers and verify print quality afterwards\nKeep the service van''s tool kit and spare stock accounted for\nReport every job with photographs and readings in the service system\nEscalate anything beyond first-line scope the same day',
    1.0::numeric, 3.0::numeric,
    array['ITI - Electronics','ITI - Electrician','ITI - Fitter','Diploma - Mechanical'],
    array['Field breakdown troubleshooting','Mechanical assembly & alignment','Preventive maintenance & AMC servicing','Nozzle diagnostics & purging','Willingness to travel (pan-India field work)','Ownership & accountability','Hindi','Driving licence - two-wheeler'],
    array['Electrical panel wiring','Printhead handling - Kyocera','Gujarati','English']
  ),
  (
    'Installation & Commissioning Engineer',
    'Own the customer''s first experience of the machine: install it, commission it to spec, and hand it over with their operators able to run it unaided.',
    E'Plan the installation with the customer: site readiness, power, water, environment\nUnpack, position, assemble and level the machine at the customer site\nComplete electrical and pneumatic connections and run the commissioning checklist\nCalibrate the printer and build the colour profile for the customer''s fabric and ink\nRun trial production until the agreed print quality and speed are met\nTrain the operators and the customer''s maintenance staff, and record the handover\nClose the installation report and hand the account over to the service team\nFeed recurring site issues back to the assembly and design teams',
    3.0::numeric, 7.0::numeric,
    array['Diploma - Mechanical','B.E./B.Tech - Mechanical','Diploma - Electronics & Communication','B.E./B.Tech - Electronics / Instrumentation'],
    array['Machine installation & commissioning','ICC profiling & colour management','RIP software operation','Digital textile printing operations','Mechanical assembly & alignment','Electrical panel wiring','Customer demo & trial running','Communication (verbal & written)','Willingness to travel (pan-India field work)','Hindi','English'],
    array['Pantone / shade matching','Fabric & substrate knowledge','Textile pre-treatment, steaming & washing','OEM machine training (Colorix / Homer / MS)','Valid passport (overseas OEM training)']
  ),
  (
    'Production Engineer - Machine Assembly',
    'Build printers to spec on the assembly floor and make sure every machine leaves only after it has printed to standard.',
    E'Assemble printer frames, carriages, drives and ink systems to the build drawing\nWire and test electrical panels, motors and sensors\nRun the pre-dispatch print test and record the quality readings\nRaise and close non-conformities with the quality team\nMaintain the build checklist and traceability for every serial number\nWork with purchase and stores on part shortages before they stop the line\nSuggest assembly and jig improvements that cut build time or rework',
    2.0::numeric, 6.0::numeric,
    array['Diploma - Mechanical','B.E./B.Tech - Mechanical','Diploma - Electrical','B.E./B.Tech - Electrical'],
    array['Mechanical assembly & alignment','Electrical panel wiring','Quality inspection','Production planning & control','PLC / servo / motion control','Attention to detail','Reporting & documentation discipline','Hindi'],
    array['Pneumatics & belt drives','AutoCAD','SolidWorks','Digital textile printing operations','Six Sigma Green Belt']
  ),
  (
    'Assembly Technician',
    'Carry out the hands-on assembly work on the shop floor under the production engineer.',
    E'Assemble sub-units and fit them to the machine per the build sheet\nRoute and dress wiring looms and pneumatic lines\nUse hand and power tools safely and keep the work area clean\nCheck fits, clearances and alignments against the checklist\nFlag damaged or wrong parts to stores before fitting them\nHelp with packing and loading at dispatch',
    0.0::numeric, 3.0::numeric,
    array['ITI - Fitter','ITI - Electrician','10th / SSC','12th / HSC'],
    array['Mechanical assembly & alignment','Attention to detail','Ownership & accountability','Hindi'],
    array['Electrical panel wiring','Pneumatics & belt drives','Forklift operator licence','Gujarati']
  ),
  (
    'Sales Executive',
    'Generate and convert enquiries for printers, inks and consumables in the assigned territory, and keep the customer engaged after the sale.',
    E'Build the territory pipeline from enquiries, referrals, portals and exhibitions\nVisit prospects, understand their fabric and volume needs, and propose the right machine\nArrange and attend demos and sample trials at the demo centre or the customer site\nPrepare quotations and follow the deal through to order and payment\nCoordinate with logistics and service so installation happens on the promised date\nGrow ink and consumable repeat business from the installed base in the territory\nRepresent Orange O Tec at trade shows such as ITMACH, Gartex and GarFab\nKeep the CRM current: every visit, stage and next action',
    1.0::numeric, 4.0::numeric,
    array['Any graduate','BBA','B.Com','Diploma - Textile Technology'],
    array['Capital equipment sales','Customer demo & trial running','Negotiation','Communication (verbal & written)','Willingness to travel (pan-India field work)','Hindi','English','Driving licence - two-wheeler'],
    array['Technical / solution selling','Exhibition selling (ITMACH, Gartex, GarFab)','Fabric & substrate knowledge','CRM (Zoho / Salesforce / HubSpot)','Gujarati','IndiaMART & WhatsApp Business']
  ),
  (
    'Technical Sales Engineer',
    'Sell on the technology: match the customer''s fabric, volume and quality targets to the right printer, ink and workflow, and prove it in a trial.',
    E'Qualify enquiries technically: fabric, GSM, ink chemistry, daily metres, quality target\nRecommend the machine, printhead and ink combination and justify the running cost\nRun sample trials and present the print results against the customer''s benchmark\nPrepare the technical section of the proposal, including the ROI and payback\nWork with the application team on colour profiles for the customer''s substrate\nHandle technical objections through to order closure\nBrief service and application before handover so the installation has no surprises',
    3.0::numeric, 8.0::numeric,
    array['Diploma - Textile Technology','B.E./B.Tech - Textile Technology','B.E./B.Tech - Mechanical','Any graduate'],
    array['Technical / solution selling','Capital equipment sales','Digital textile printing operations','Fabric & substrate knowledge','Customer demo & trial running','ICC profiling & colour management','Communication (verbal & written)','English','Hindi','Willingness to travel (pan-India field work)'],
    array['Sublimation printing','Reactive printing','Pigment printing','Ink chemistry & formulation','Exhibition selling (ITMACH, Gartex, GarFab)','Costing & MIS reporting']
  ),
  (
    'Import Executive',
    'Move imported machines, spares and inks from the supplier to our warehouse without a day lost at the port or a rupee lost on documentation.',
    E'Raise and track import orders with overseas suppliers through to shipment\nPrepare and verify the import documentation set: invoice, packing list, BL, COO\nFile the bill of entry with the CHA and follow the clearance through to release\nClassify goods under the correct HS code and confirm the duty working\nCoordinate freight forwarders, transporters and the warehouse on delivery dates\nHandle letters of credit and bank remittances with the finance team\nReconcile landed cost against the purchase order and flag variances\nKeep the import register and statutory records audit-ready',
    2.0::numeric, 5.0::numeric,
    array['B.Com','Any graduate','MBA - Operations / Supply Chain','BBA'],
    array['Import documentation (BOE, BL, LC)','Customs clearance & HS classification','Freight forwarding & logistics','Excel (advanced)','Reporting & documentation discipline','Attention to detail','English','Hindi'],
    array['Export documentation','Tally Prime','Vendor development & procurement','Costing & MIS reporting','Gujarati']
  ),
  (
    'Accounts Executive',
    'Keep the books clean and current: bookings, reconciliations and statutory filings done on time, every month.',
    E'Book purchase, sales, expense and journal entries in Tally accurately and daily\nReconcile bank accounts, vendor ledgers and customer ledgers monthly\nPrepare GST and TDS workings and support the return filings\nRaise invoices, follow up on collections and maintain the ageing report\nProcess employee reimbursements and vendor payments per the approval matrix\nAssist with month-end closing schedules and the annual audit\nMaintain the fixed asset register and supporting documentation',
    1.0::numeric, 4.0::numeric,
    array['B.Com','M.Com','CA / CA Inter','ICWA / CMA'],
    array['Accounts payable / receivable','GST, TDS & statutory compliance','Tally Prime','Excel (advanced)','Attention to detail','Reporting & documentation discipline','Hindi','English'],
    array['Collections & credit control','Costing & MIS reporting','Payroll, PF & ESIC','Tally certification','Gujarati']
  ),
  (
    'Marketing Executive',
    'Build demand for Orange O Tec across digital and on-ground channels, and hand sales a steady flow of qualified enquiries.',
    E'Plan and run digital campaigns across Google, Meta and the trade portals\nGenerate and qualify enquiries, then route them to the right sales territory\nProduce product content: brochures, machine videos, case studies, social posts\nOwn the exhibition calendar — stall, collateral, demos and follow-up for ITMACH, Gartex and GarFab\nMaintain the website and product pages with the current range\nTrack campaign spend against enquiries generated and report monthly\nCoordinate with sales and application teams on customer success stories',
    1.0::numeric, 4.0::numeric,
    array['Any graduate','BBA','MBA - Marketing','BA'],
    array['Digital marketing & lead generation','Content & product marketing','Google Ads / Meta Ads','Canva','Communication (verbal & written)','English','Hindi'],
    array['Adobe Photoshop','Adobe Illustrator','Exhibition selling (ITMACH, Gartex, GarFab)','IndiaMART & WhatsApp Business','Power BI / Looker Studio','Google / Meta digital marketing certification']
  )
)
update public.fms_hr_job_titles d set
  default_role_summary     = t.summary,
  default_responsibilities = t.responsibilities,
  default_experience_min_years = t.exp_min,
  default_experience_max_years = t.exp_max,
  default_job_type_id      = (select id from public.fms_hr_job_types where name = 'Full-Time'),
  default_qualification_ids = coalesce(
    (select array_agg(q.id) from public.fms_hr_qualifications q where q.name = any(t.quals)), '{}'::uuid[]),
  default_skill_ids = coalesce(
    (select array_agg(s.id) from public.fms_hr_skills s where s.name = any(t.skills)), '{}'::uuid[]),
  default_preferred_skill_ids = coalesce(
    (select array_agg(s.id) from public.fms_hr_skills s where s.name = any(t.preferred)), '{}'::uuid[])
from tpl t
where d.name = t.job_title
  and d.default_role_summary is null;
