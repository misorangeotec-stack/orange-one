# TASK — Embed Orange Receivables Hub behind the Orange One login

**Goal:** Bring the standalone Receivables Hub dashboard into Orange One as a gated app module (`/outstanding-dashboard`), behind the existing Supabase login, reading live data from the Hub's own Supabase via a second read-only client. No changes to the original Receivables Hub project or the Tally→Sheets→Supabase pipeline.

**Branch:** `feature/receivables-hub-port`
**Plan file:** `C:\Users\etech\.claude\plans\now-i-want-you-cheerful-horizon.md`

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

---

## 0. Setup
- [x] Create feature branch `feature/receivables-hub-port` in Orange One
- [x] Explore all three projects + confirm approach with user
- [x] Create this live tracker (TASK.md)

## 1. Dependencies (`frontend/package.json`)
- [x] Add all `@radix-ui/react-*` packages used by shadcn/ui
- [x] Add UI/runtime deps: class-variance-authority, clsx, tailwind-merge, tailwindcss-animate, lucide-react, recharts, cmdk, date-fns, react-day-picker, react-hook-form, @hookform/resolvers, zod, input-otp, embla-carousel-react, react-resizable-panels, vaul, sonner, next-themes
- [x] Add export deps: file-saver, jszip, xlsx, jspdf, html2canvas (+ @types/file-saver dev)
- [x] Bump react-router-dom to ^6.30.1
- [x] Run `npm install` in `frontend/` (183 packages added)
- [x] (Deferred — NOT added: @anthropic-ai/sdk, react-markdown, remark-gfm — chat is out of scope for phase 1)

## 2. Build config (`frontend/vite.config.ts` + `tsconfig.json`)
- [x] Add `@hub` alias → `./src/apps/receivables-hub` (vite + tsconfig paths)
- [x] Add `resolve.dedupe` for react/react-dom/jsx-runtime
- [x] Merge Hub Tailwind theme into the inline config (colors, borderRadius, boxShadow, keyframes/animation, container, darkMode)
- [x] Set `borderColor.DEFAULT` = `hsl(var(--border))` (for portaled Radix components)
- [x] Register `tailwindcss-animate` plugin
- [x] Keep Poppins as global font (Hub now also uses Poppins — see look-and-feel note)

## 3. CSS tokens (`frontend/src/index.css`)
- [x] Add Hub shadcn HSL tokens to global `:root` (all except `--navy`, which stays OO hex)
- [x] Convert OO `--card` to HSL value (no consumers, safe)
- [x] Add `.dark` block
- [x] Scope `.hub-root` (color/background); **look-and-feel aligned to Orange One**: primary accent set to OO orange (#FF6A1F) and font set to Poppins (instead of Plus Jakarta)
- [~] Verify OO landing/core styling unchanged (build green; live visual check pending — see §8)

## 4. Copy Hub UI → `frontend/src/apps/receivables-hub/`
- [x] Copy `components/ui/**` (all shadcn components)
- [x] Copy non-ui components (UserSidebar, NavLink, CTAButton, InfoCard, SectionHeader, FilterChips, FYMultiSelect, RiskMultiSelect, RiskLegendPopover, SalesPersonMultiSelect, SaleTypeMultiSelect, SaleTypeReconciliationTable, ActivityLegendPopover)
- [x] Copy `layouts/UserLayout.tsx` (chat stripped out)
- [x] Copy phase-1 pages (Dashboard, CustomerRiskRegister, SalespersonAnalysis, SalespersonCollectionReport, CustomerDetail, ImportDashboard, Reports, SavedViews, Profile, Settings, NotFound, salesperson/**)
- [x] Copy `lib/**` (minus chat libs) incl. utils (`cn`), useAppData, supabaseFetcher, receivables, types, fyContext, export*, import*
- [x] Copy `hooks/` (use-mobile, use-toast) + `assets/logo.png`
- [x] Rewrite `@/components|lib|hooks|pages` → `@hub/...` across all copied files
- [x] (Excluded: App.tsx, main.tsx, index.css, configs, public/data, tests, Index/Access, all admin pages+AdminLayout+AppSidebar, chat/**) — EximDashboard/Alerts copied but NOT routed

## 5. Second Supabase client (data-only)
- [x] Create `lib/receivablesSupabase.ts` (persistSession:false, autoRefreshToken:false, new env vars)
- [x] Repoint `supabaseFetcher.ts` to it
- [x] Add env vars to `frontend/.env.local`: VITE_RECEIVABLES_SUPABASE_URL, VITE_RECEIVABLES_SUPABASE_ANON_KEY, VITE_DATA_SOURCE=supabase
- [x] Receivables anon key wired (public anon key, reused from Hub frontend env)

## 6. App module wiring
- [x] Create `ReceivablesHubApp.tsx` (internal Routes, basePath-relative, `.hub-root` wrapper, FYProvider/TooltipProvider/Toasters)
- [x] Create `meta.tsx` (id `outstanding-dashboard`, status `live`, basePath `/outstanding-dashboard`)
- [x] Register in `registry.tsx` (replaced the coming-soon placeholder)
- [x] Relativize `/dashboard*` links → `/outstanding-dashboard*` (UserSidebar + all page files)

## 7. Build / typecheck handling
- [x] tsc strategy: fixed 11 vendored type errors with type-only changes (all in receivables-hub, 0 in OO core); OO core stays strict
- [x] `npm run build` passes green (`tsc && vite build`, 3397 modules, 18s)

## 8. Verification
- [x] `vite build` + strict `tsc` pass — all imports resolve, types check, CSS/Tailwind compile
- [~] `npm run dev` — server boots (running on :5179); live click-through pending (browser profile locked + needs login)
- [ ] Auth gate: logged-out `/outstanding-dashboard` → `/login`  *(USER to confirm in browser)*
- [ ] Module gate: ungranted user → `/home` + no card; granted/admin → card + access  *(USER)*
- [ ] Data loads from `lkwtvcpeamkzzqkfnkuc.supabase.co` (KPIs/charts/tables populate)  *(USER)*
- [ ] Routing: every sidebar item + deep links work (no `/dashboard` 404s)  *(USER)*
- [ ] Styling isolation: Hub themed correctly AND OO landing/login/home/task-mgmt unchanged; Radix portals themed  *(USER)*
- [ ] Session isolation: sign out blocks access; receivables client writes no auth to localStorage  *(USER)*

## 9. Wrap-up
- [ ] Grant module access to target users via `/admin`
- [ ] After parity verified: retire standalone Hub deployment (hosting only — repo untouched)
- [ ] Commit + push to backup remote

---

### Notes / decisions
- Data stays in the Hub's existing Supabase (`lkwtvcpeamkzzqkfnkuc`); auth stays on OO's (`coshondiqdhorwvibrwu`). No data migration.
- Phase 1 = core dashboards only. AI chat + Hub admin deferred (chat exposes Anthropic key in browser).
- **HARD CONSTRAINT:** the original Orange Receivables Hub project is a read-only source — copy out only, never edit in place.
