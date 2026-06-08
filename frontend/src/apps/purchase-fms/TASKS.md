# Purchase FMS — Task Tracker

> Living checklist for the Purchase FMS module. Flip `- [ ]` → `- [x]` as each item lands.
> Purchase FMS is the **first of many FMS modules**; Phase 2 is built as a generic multi-FMS engine.

## Phase 1 — Screens (mock / in-memory data) ◀ current

### Foundation
- [x] Create this TASKS.md tracker
- [x] Read & confirm reusable patterns (task-management app, shared UI, session/directory)
- [x] `types/index.ts` — Category, Designation, StepOwner, StageState, PurchaseEntry, enums
- [x] `config/stages.ts` — STAGE_DEFS: the 9 stages × {title, what, how, when, owner, fields}
- [x] `config/categories.ts` — seed categories ↔ unit (RAW MATERIAL→KGS, PACKING→PCS, CARTRIDGE/FILTER→PCS)
- [x] `mock/seed.ts` — sample entries (incl. one mid-pipeline mirroring the sheet), step-owner map, designations
- [x] `mock/store.tsx` — FmsStoreProvider + useFmsStore (entries, masters, actions)

### Shared components
- [x] `components/StageStatusChip.tsx` — Pending / Active / Done pill
- [x] `components/EntryProgressBar.tsx` — compact done/total progress bar for list rows
- [x] `components/PipelineStepper.tsx` — horizontal numbered stepper + % progress bar
- [x] `components/StageForm.tsx` — renders a stage's field schema as inputs
- [x] `components/StageCard.tsx` — one timeline row: status, owner, dates, data / inline form
- [x] `components/StageTimeline.tsx` — vertical timeline of all 9 stages
- [x] `components/RequireRole.tsx` — app-local role gate (uses core session)
- [x] `lib/owner.ts` — resolve step owners → display names / ownership checks

### Pages
- [x] `pages/Dashboard.tsx` — KPI stat cards + recent entries with progress
- [x] `pages/EntriesList.tsx` — all entries, paginated (25/page), filters
- [x] `pages/MyQueue.tsx` — entries whose active stage is the current user's turn
- [x] `pages/NewOrder.tsx` — Stage-1 create form (category auto-unit, free-text item)
- [x] `pages/EntryDetail.tsx` — the hybrid pipeline view (stepper + timeline + inline form)
- [x] `pages/system/NotFound.tsx` + `AccessDenied.tsx`

### Settings (admin-only)
- [x] `pages/settings/SettingsLayout.tsx` — tabbed shell
- [x] `pages/settings/WorkflowSetup.tsx` — map each step → dept + designation + employee(s)
- [x] `pages/settings/Designations.tsx` — designation master CRUD (mock)
- [x] `pages/settings/Categories.tsx` — category ↔ unit master (mock)

### App shell & registration
- [x] `nav.tsx` — sidebar items
- [x] `FmsLayout.tsx` — wires AppShell (nav, user, mock notifications)
- [x] `FmsApp.tsx` — root provider + internal <Routes>
- [x] `meta.tsx` — AppManifest (id "purchase-fms", name "Purchase FMS")
- [x] Register `purchaseFmsApp` in `apps/registry.tsx`
- [x] `npm run build` passes (tsc strict)
- [x] Manual walkthrough verified (create → queue → complete stages → progress advances)
- [x] Stepper nodes scroll to the matching stage card

## Phase 1b — Reports & Analytics (admin + managers)
- [x] Enrich `mock/seed.ts` → ~24 deterministic entries (varied stages/dates/on-time/overdue)
- [x] `lib/analytics.ts` — overview, pipeline distribution, turnaround, on-time, overdue, bottleneck
- [x] `components/charts/BarList.tsx` — labeled horizontal bars
- [x] `pages/Reports.tsx` — scope banner, KPI strip, Pipeline Distribution, Turnaround & SLA, Overdue Now
- [x] Scope: admin = all stages; HOD/Sub-HOD = stages their team owns (else empty-state)
- [x] Wire `nav.tsx` (Reports, roles admin/hod/sub_hod) + `FmsApp.tsx` route (RequireRole)
- [x] `npm run build` passes (tsc strict)
- [ ] Manual walkthrough (admin sees populated charts + bottleneck + overdue list)

## Phase 2 — Database: generic multi-FMS engine ◀ SQL written; user applies manually
> Migrations: `supabase/migrations/20260608120000_add_fms_engine.sql` (engine) + `20260608120100_seed_purchase_fms.sql` (Purchase rows). Apply engine first, then seed, in the identity project (coshondiqdhorwvibrwu). Additive-only.
- [x] `designations` master table + `fms_field_options` (generic option sets)
- [x] Engine tables: `fms_workflows`, `fms_workflow_steps`, `fms_step_fields`
- [x] Instance tables: `fms_entries`, `fms_entry_stages` (`values jsonb` payload)
- [x] RLS (authenticated read; writes gated to stage owner + admin), `set_updated_at` trigger + `fms_owns_step`/`fms_is_current_owner` helpers + stage-materialise trigger
- [x] Seed the Purchase FMS workflow (9 steps + field schema) from `config/stages.ts` (+ categories, designations)

## Phase 3 — Wiring ◀ code done; RPC migration PENDING manual apply
> New migration: `supabase/migrations/20260608130000_add_fms_complete_stage.sql` (the SECURITY DEFINER advance RPC). Apply in the identity project BEFORE deploying this frontend. No new Vite env (portal already uses the identity client).
- [x] Supabase data layer replacing `mock/store.tsx` (same hook surface) — `data/fmsFetch.ts` (read) + `data/fmsWrites.ts` (writes/RPC); store now React-Query-backed; actions async; provider gates first load
- [x] Planned-date engine — `lib/plannedDate.ts` (+24 working hrs Mon–Sat; Stage-6 = day before vendor dispatch; Stage-9 = standard rule, per decision)
- [x] Notifications (derived from live entries, per decision) + my-queue routing — both run off the live persisted entries; no notifications-table migration
- [x] `database.types.ts` extended (7 fms_* tables + `fms_complete_stage`); `npm run build` passes (tsc strict)
- [ ] Deploy ordering: apply the RPC migration, then deploy frontend (merge to master)
- [ ] Manual end-to-end walkthrough (admin create → persists; owner completes stage → advances; non-owner rejected)
