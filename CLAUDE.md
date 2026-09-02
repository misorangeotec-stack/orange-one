# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Orange One is a **unified internal portal** (single-page React app) for Orange O Tec: one login that gates access to multiple business "apps" (Task Management, Outstanding Dashboard). The app lives in **`frontend/`** — that's where ~all real work happens. The repo root also holds a dormant Python "WAT" scaffold (`tools/`, `workflows/`, `requirements.txt`) and the Supabase project (`supabase/`).

## Commands

All app commands run from **`frontend/`**:

```bash
cd frontend
npm install
npm run dev        # Vite dev server on http://localhost:5173 (opens browser)
npm run build      # tsc (strict typecheck) THEN vite build → dist/
npm run preview    # serve the production build locally
```

- **There is no test runner and no lint script** in `frontend/package.json` — `build` is the gate. `npm run build` runs `tsc` in **strict** mode across all of `src`, so a type error anywhere fails the build (the vendored `apps/receivables-hub` code is kept type-clean for this reason).
- **Deploy:** Vercel deploys automatically via the GitHub integration when `master` updates (config: `frontend/vercel.json`, builds `frontend/`, SPA rewrite to `index.html`). There is no local `.vercel` link; do **not** use the Vercel CLI. Env vars live in the Vercel project settings, not git.
- **Supabase Edge Functions / migrations:** `supabase functions deploy admin-users` and apply SQL in `supabase/migrations/` via the Supabase SQL editor or `supabase db push` (needs `supabase login`).
- **Backup remote:** push milestones to `origin` (`github.com/misorangeotec-stack/orange-one`); production branch is `master`.

## Architecture (the big picture)

### Provider stack & routing
`frontend/src/main.tsx` wraps everything in: `BrowserRouter → QueryClientProvider → AuthProvider → PlatformDirectoryProvider → SessionProvider → App`. `App.tsx` defines public routes (`/`, `/login`), the signed-in portal (`/home` launcher, `/account`, `/admin/*`), and mounts every registered live app.

### The app-module system (how features are added)
Each business app is a self-contained folder under `frontend/src/apps/<name>/` that exports an **`AppManifest`** (`meta.tsx`: `id`, `name`, `basePath`, `status`, `icon`, `Component`) and is listed in **`apps/registry.tsx`**. `App.tsx` auto-mounts every `status: "live"` app at `${basePath}/*` wrapped in `<RequireAuth><RequireModule appId>`, and the workspace launcher renders one card per manifest. The app's root component renders its **own internal `<Routes>`** relative to its `basePath`. Live apps today: `task-management` and `receivables-hub` (id `outstanding-dashboard`). To add an app: create the folder + manifest, register it, done — auth/gating come for free.

### Identity & permissions (`frontend/src/core/platform/`)
- **Auth:** Supabase Auth (`auth.tsx` / `supabase.ts`). `RequireAuth` gates routes; `RequireRole` and `RequireModule` (in `App.tsx`) gate by role / app access.
- **Roles:** `admin | hod | sub_hod | employee` (`types.ts`). Admins bypass module checks and see everything.
- **Directory read-model:** `liveDirectory.ts` joins `profiles` + `user_roles` + `user_hods` + `app_access` into a denormalised `Profile[]`; `store.tsx` (`useDirectory`) exposes it and the write actions; `session.tsx` (`useSession`) derives the current user (`isAdmin`, `hasModule(appId)`, etc.).
- **Writes:** admin edits go directly to Supabase under RLS (`directoryWrites.ts`); creating/deleting users needs the auth admin API, so it runs in the **`supabase/functions/admin-users`** Edge Function (client wrapper: `adminUserApi.ts`). A user's **mobile number doubles as their initial login password** (set/re-pinned on save).
- `database.types.ts` mirrors the Supabase schema; keep it in sync when columns change.

### Two separate Supabase projects (important)
- **Auth + identity** → project `icutjkrqkbzwvmnfbzpr`, the primary client at `core/platform/supabase.ts` (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`). This is also where every Edge Function is deployed — `supabase functions deploy <name> --project-ref icutjkrqkbzwvmnfbzpr`. (`config.toml` says `project_id = "orange-one"`, which is a local label, **not** the ref.)
- **Receivables data** → the **ConnectWave live-Tally mirror**, project `ieeefdnyhzgrroifiqbb`, read through `apps/receivables-hub/lib/connectwaveFetcher.ts` (`VITE_CONNECTWAVE_SUPABASE_URL` / `VITE_CONNECTWAVE_SUPABASE_ANON_KEY`). This is the live source: `liveMode.tsx` defaults **Live (Tally) ON**, so every receivables screen reads ConnectWave unless an admin deliberately switches off. Order of magnitude as of 20-Aug-2026: ~1,850 customer rows and ~5,750 invoice rows.
- **⚠ The legacy receivables project `lkwtvcpeamkzzqkfnkuc` NO LONGER EXISTS** — its hostname does not resolve. `VITE_RECEIVABLES_SUPABASE_URL`, `receivablesSupabase.ts`, `supabaseFetcher.ts` and the `VITE_DATA_SOURCE=supabase` path all still point at it, and the old Python pipeline (Tally → Sheets → `process_data.py`, in the separate "Orange Receivables Hub" repo) that fed it is likewise out of the picture. Switching the hub off Live therefore lands on a dead database. Anything new must read ConnectWave; do not wire a new consumer to the legacy client. (Tracked as **RC-4** in [WORKLIST.md](WORKLIST.md).)

### The receivables-hub app (ported third-party UI)
- Ported from a standalone Vite+shadcn app. It is the **only** part of the codebase using **shadcn/ui** (`apps/receivables-hub/components/ui/`) and **Recharts**.
- Its internal imports use a dedicated **`@hub/*`** alias (→ `src/apps/receivables-hub/*`), configured in `vite.config.ts` and `tsconfig.json`, so its ~250 `@/...` imports don't collide with the portal's `@/` (→ `src`).
- **Data flow:** `lib/useAppData.ts` is the single data hook for every page; with `VITE_DATA_SOURCE=supabase` it loads from `lib/supabaseFetcher.ts` (the receivables client). `useAppData` is also the **per-salesperson scoping chokepoint**: it reads `lib/scope.tsx` (`useReceivablesScope`, derived from the user's `profiles.receivables_salespersons` tag) and filters `allCustomers` + `customerDetail` + `alerts` — admins see all, a non-admin sees only their tagged salespeople, an untagged non-admin sees nothing. This is **UI-level scoping only** (raw data still reaches the browser); true isolation would need a server-side data layer (a tracked follow-up).
- **Routed pages:** Dashboard, Risk Register, Salesperson Analysis, Salesperson Collection Report, Customer Detail (`customer/:id` + `group/:id`), Import, Reports, Saved Views, Profile, Settings (see `ReceivablesHubApp.tsx`). Admin tags a user's salesperson access in the core admin **User form** (`core/admin/UserForm.tsx`), sourcing live names via `fetchSalespersonNames()`.
- **Deliberately NOT ported from the source app** (don't assume these are bugs): the AI chat (it shipped the Anthropic key to the browser — needs a server proxy), the source app's own admin section (data sources / sync logs / column mapping / business rules / users), and the fake login + landing. `EximDashboard.tsx` and `Alerts.tsx` are **copied but not routed** (enable by adding a route if needed).
- **Data refresh:** there is **no in-app refresh button** — the receivables Supabase is refreshed entirely by the external Python pipeline (the separate, **read-only** "Orange Receivables Hub" repo: `scripts/process_data.py` → Supabase, fed by Tally→Sheets). Never edit that repo from here; the dashboard only consumes its output. Deploying the dashboard requires `VITE_RECEIVABLES_SUPABASE_URL` / `VITE_RECEIVABLES_SUPABASE_ANON_KEY` / `VITE_DATA_SOURCE=supabase` to be set in Vercel.

### Styling
There is **no `tailwind.config.js`** — the Tailwind/PostCSS config is **inlined in `vite.config.ts`**. It merges two token systems: Orange One's hex tokens (`navy`, `orange`, `sidebar`, `ink`, …) and the receivables app's shadcn HSL tokens (`primary`, `muted`, `card`, …, defined as CSS vars in `src/index.css`). Colliding names (`navy`, `sidebar`) keep Orange One's value so the portal shell stays consistent. The receivables app is wrapped in a `.hub-root` div for its scoped styles.

## Conventions that aren't obvious from the code

- **Supabase changes are additive-only.** Never mutate or drop existing tables/columns/data; add new nullable columns / new tables. Migrations go in `supabase/migrations/` (e.g. `*_add_receivables_salespersons.sql`).
- **Tables paginate at 25/page** via the shared `usePagination` + `Pagination` components; filtered stat strips reflect the *filtered* set, not the whole table.
- **EVERY GRID SORTS ON EVERY COLUMN AND FILTERS UNDER EVERY COLUMN. This is the default, not a per-screen decision.** Any table of rows — a queue, a master, a register, a report — gets a sort toggle on each column header and a searchable multi-select filter in a row directly beneath the headers. `QueueTable` has always done this; `MasterCrud` does it too, deriving both from the text each cell renders (`nodeText`), so a new masters screen needs no per-column wiring to comply. Override only where the rendered text is wrong to order by — a formatted number, a date, a severity badge — via `sortValue`, or suppress a filter with `filter: false` where every row's value is unique and the dropdown would merely restate the table. Do not ship a grid without both and wait to be asked; being asked is the bug.
- **Filter dropdowns CASCADE — each column offers only what the other filters still allow.** Build a column's option list from the rows that survive every *other* active filter, never from the raw row set. Filter Type to Ink and the Item group list must drop to the groups that actually hold an ink (565 → 201), so no combination a reader can assemble from these dropdowns can return an empty table. A column is always excluded from its **own** options, or narrowing to one value leaves that lone value in the list with no way to widen again. Both `QueueTable` and `MasterCrud` do this; an author-declared fixed `options` list is left alone, since it is a vocabulary rather than a reading of the data.
- **An empty *result* is not an empty *table*.** The full-page `EmptyState` answers "this list has no rows at all" and must be keyed on the unfiltered `rows`, never on the filtered set. Swapping it in when a filter matches nothing removes the header, the sort toggles and the filter row — taking away the one control that could undo it, so the only way back is a reload. When the filters match nothing, keep the table standing and put a single spanning row in the `tbody` saying so, with a **Clear filters** button. `QueueTable` has always done this; `MasterCrud` now does too.
- **FMS master/list views are FLAT — never pass `groupBy` to `QueueTable` by default.** The dimension you'd group by belongs as an ordinary column with `sortValue` + `filter: { kind: "select" }`; add the column if it isn't there yet. `groupBy` makes the group name the *primary* sort (`QueueTable.tsx`), so a queue sorted by Due date only sorts *within* each band and the most overdue row hides mid-page; the band also repeats a column that is usually already present. `hideGroupHeaders` is **not** the fix — it hides the bands but keeps the redundant dropdown and the duplicated leading column in the Excel export. Only use `groupBy` when banding is explicitly asked for on that screen. Exempt: dashboard summary widgets that aggregate on purpose (`order-to-dispatch/components/CompanyBreakdown.tsx`) and receivables-hub's `GroupByBuilder`, where the user composes the grouping at runtime.
- **Removing a container? Account for EVERY control inside it, one at a time — and check nothing is left orphaned.** This repo has no test runner and `noUnusedLocals` is **false**, so an unreachable control does not fail the build, does not fail `tsc`, and still *looks* present in the code. It is invisible until someone needs it. This has already happened twice in one commit: `d6c9f65` deleted Request Detail's per-line **Actions** column on the reasoning that "whole-requisition actions already live in the header" — true of Source and Approve, which had moved there, and **false of Cancel**, which never had. It took out the only way to cancel a requisition line after sourcing began (a ₹19.8L requisition sat stuck for five weeks) and, in the Import app, the only way to re-source. Both left their modal, handler, store method and RPC fully intact behind a trigger that no longer existed. **Before deleting any wrapper — a column, a toolbar, a panel, a menu — list what it contains and prove each item is either genuinely duplicated elsewhere or deliberately going away.** "Most of this is redundant" is not a finding about the rest of it. Afterwards, sweep for orphans; the tell is a state setter that is only ever called with the empty value:
  ```bash
  # from frontend/src — flags `setX` only ever called as setX(null)/setX(false).
  # Scope it to the app you touched; the whole of apps/ takes >2 min.
  APP=apps/procurement
  for f in $(find $APP -name "*.tsx"); do for s in $(grep -o "set[A-Z][A-Za-z]*" "$f" | sort -u); do
    t=$(grep -c "$s(" "$f"); n=$(grep -cE "$s\((null|false)\)" "$f")
    [ "$t" -gt 0 ] && [ "$t" -eq "$n" ] && echo "$f: $s"; done; done
  ```
  ⚠ **It reports candidates, not verdicts** — it only counts *direct* calls, so a setter handed over as a prop (`onViewPi={setViewPi}` in `PoModals.tsx`) is reachable and shows up anyway. Open each hit and look for the trigger before concluding anything; there are a handful of standing false positives across the apps. Full write-up: **FIX-4** in [WORKLIST.md](WORKLIST.md).
- **Deploy ordering matters:** if a change reads a new Supabase column, apply the migration **before** the frontend goes live, or the directory/data load will error. Set new Vite env vars in Vercel **before** merging to `master`.
- **Table filters are always searchable — never a native `<select>`.** Declare `filter: { kind: "select", get }` on the column and `QueueTable` renders a searchable, multi-value picker (`MultiSelect`) with the search box **forced on**, not just past 6 options. `select` and `multiselect` are now the *same control*; `select` survives only so the ~190 columns already declaring it needed no edit — prefer `select` in new code and never assume it is single-choice. Never hand-roll a `<select>` + `<option>` filter in a page: a live queue's customer / location / person lists run to dozens of values, and a scroll-only dropdown is unusable. This applies to every FMS, every step, every table. (Form fields inside modals are a different thing — those use `Combobox`.) Related: any custom dropdown trigger placed inside a `ScrollableTable` needs the arrow-key `stopPropagation` guard that `Combobox`/`MultiSelect` carry, or ↓ scrolls the table instead of opening the menu.
- The portal shell (`core/shared/components/layout/`: `AppShell`, `Topbar`, `UserMenu`) is shared across apps; reuse it rather than building per-app chrome.

## The dormant WAT scaffold (root)
`tools/` (`config.py`, `supabase_client.py`) and `workflows/` (a template + README) are an early "Workflows/Agents/Tools" Python scaffold; `requirements.txt` is mostly commented out. It is **not** part of the running product — treat the React app in `frontend/` as the system of record unless a task explicitly targets these Python tools.
