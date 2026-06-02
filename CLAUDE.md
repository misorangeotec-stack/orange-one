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
- **Auth + identity** → project `coshondiqdhorwvibrwu`, the primary client at `core/platform/supabase.ts` (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
- **Receivables data** → a *different* project `lkwtvcpeamkzzqkfnkuc`, read via a **second, read-only client** at `apps/receivables-hub/lib/receivablesSupabase.ts` (`VITE_RECEIVABLES_SUPABASE_URL` / `VITE_RECEIVABLES_SUPABASE_ANON_KEY`, `persistSession:false`). That project is populated by an **external Python pipeline** (Tally → Google Sheets → `process_data.py`) that lives in a separate "Orange Receivables Hub" repo — **not** in this codebase. The dashboard only reads it.

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
- **Deploy ordering matters:** if a change reads a new Supabase column, apply the migration **before** the frontend goes live, or the directory/data load will error. Set new Vite env vars in Vercel **before** merging to `master`.
- The portal shell (`core/shared/components/layout/`: `AppShell`, `Topbar`, `UserMenu`) is shared across apps; reuse it rather than building per-app chrome.

## The dormant WAT scaffold (root)
`tools/` (`config.py`, `supabase_client.py`) and `workflows/` (a template + README) are an early "Workflows/Agents/Tools" Python scaffold; `requirements.txt` is mostly commented out. It is **not** part of the running product — treat the React app in `frontend/` as the system of record unless a task explicitly targets these Python tools.
