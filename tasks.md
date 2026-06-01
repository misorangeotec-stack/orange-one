# Orange One — Task Management Frontend · Build Tasks

Tracking the rebuild of the Task Management frontend as a unified React app.
**Workflow:** build one phase at a time → check it off → user audits in the browser → proceed.
Full plan: `C:\Users\etech\.claude\plans\now-the-main-thing-cached-rossum.md`

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · 🔍 = awaiting user audit

---

## STAGE A — Frontend (UI only, mock data, on-theme to index.html)

### Phase 1 — Foundation + entry screens  ✅ built · 🔍 awaiting audit
- [x] **0. Scaffold** Vite + React + TS + Tailwind in `frontend/`; clean module structure (core/shared/apps); theme ported from landing; configs minimized to root essentials
- [x] **1. Landing `/`** — faithful rebuild of index.html (palette, Poppins, animations); Login / Open Workspace / Task Management buttons wired
- [x] **2. Login** screen (+ link to Forgot Password)
- [x] ~~3. Forgot/Reset Password screens~~ — removed per user: password reset lives in-app (Profile, later) or via admin; no public reset/forgot on login
- [x] **4. Workspace Home** (registry-driven app launcher cards)
- [ ] ⏳ **Add dark-background logo file** → `frontend/public/assets/orange-one-logo-dark.png` (provided by user); wiring already done
- [x] 🔍 **Audit Phase 1** — approved by user ✅
- [x] _Committed + pushed to GitHub (backup)_

### Phase 2 — App shell + dashboard  ✅ built · 🔍 awaiting audit
- [x] **5. App Shell** — dark sidebar (role-aware nav), sticky topbar (notifications bell + user menu + dev "View as" role switcher), mobile drawer
- [x] **6. Dashboard** — employee / HOD / admin variants (stat cards, today/team/dept panels, RYG bar, status donut, activity feed)
- [x] _Mock data shaped like Supabase (real users/depts) + session context + selectors mirroring RLS_
- [x] 🔍 **Audit Phase 2** — approved by user ✅
- [x] _Committed + pushed to GitHub_

### Phase 3 — Core task screens  ✅ built · 🔍 awaiting audit
- [x] **Mock task store** — live mutations (create/start/revise/shift/complete/remark) + weekly revision-limit rule + mention fan-out
- [x] **7. Tasks list** — My Tasks with All/Today/Follow-ups/Pending tabs (counts) + search
- [x] **8. Create Task** — role-aware assignee options, dept auto-fill, due date
- [x] **9. Task Detail** — description, details sidebar (revisions left, follow-up, shift links), activity timeline + @mention remark composer
- [x] **10. Action modals** — Revise (follow-up + note, disabled at limit), Shift to next week (linked task), Mark Complete (note)
- [x] _Shared UI: Modal, Tabs, Form controls, EmptyState_
- [x] 🔍 **Audit Phase 3** — log in → Task Management → My Tasks. Try: open a task → Start / Revise / Shift / Complete; post an @mention remark; create a task. (`?role=` to switch views)
- [x] _Committed + pushed to GitHub_

### Phase 4 — Manager & admin task views  ✅ built · 🔍 awaiting audit
- [x] **Reusable TaskBrowser** — stats strip + filters (search / person / department / status / week) + list with assignee avatars
- [x] **11. Team Tasks** (HOD / sub-HOD) — direct reports' tasks, filter by team member
- [x] **12. All Tasks** (admin) — org-wide, filter by department + person
- [x] 🔍 **Audit Phase 4** (review with Phase 3) — `?role=hod` → Team Tasks; `?role=admin` → All Tasks
- [x] _Committed + pushed to GitHub_

### Phase 5 — Recurring tasks  ✅ built · 🔍 awaiting audit
- [x] **13. Recurring list** — daily/weekly templates, frequency text, assignee, active/pause toggle, edit + delete (confirm)
- [x] **Create/Edit Recurring** — title, description, assignee, Daily/Weekly toggle, weekday picker (weekly), active toggle
- [x] _Store extended with recurring CRUD; HOD/admin scoped_
- [x] 🔍 **Audit Phase 5** — `?role=hod` or `admin` → Recurring
- [x] _Committed + pushed to GitHub_

### Refinements (post Phase 3/4, applied)
- [x] Searchable dropdowns (Combobox) everywhere
- [x] Task actions: distinct buttons (Mark in progress / Revise / Mark complete); reschedule moved to Due date in Details (future-week date auto-shifts)

### Phase 6 — Reports (Red/Yellow/Green)  ✅ built · 🔍 awaiting audit
- [x] **14. Reports** — role-gated tabs Weekly / Employee / Team / Department; planned-vs-actual tiles, per-person RYG, status donut, avg RYG; contextual selectors (person/HOD/department)
- [x] **15. Activity History** — filterable audit trail (by action type + person), role-scoped, timeline with task links
- [x] _Report stat helpers (reportFor) in selectors_
- [x] 🔍 **Audit Phase 6** — `?role=admin` → Reports (try tabs) + Activity

### Phase 7 — Admin setup  ✅ built · 🔍 awaiting audit
- [x] **Directory promoted into store** — profiles + departments are now live/editable; admin mutators (add/edit/delete dept + user); directory helpers (profileById/directReportIds/assignableUsers/visibleTasks) moved to store; all consumers refactored
- [x] **16. Setup** — sub-nav shell + Onboarding checklist (live progress), Department Management (add/edit/delete), User Management (filters + role badges), Add/Edit User (role picker, department, multi-HOD reporting), Hierarchy mapping (teams + unmapped)
- [x] 🔍 **Audit Phase 7** — `?role=admin` → Setup
- [x] _Committed + pushed to GitHub_

### Phase 8 — Settings + utility  ✅ built · 🔍 awaiting audit
- [x] **17. Settings** — Profile (edit own details + in-app change password), Organization (workspace name / week-start / max-revisions, admin), Permissions (read-only role matrix, admin)
- [x] **18. Utility** — Empty states (reused), Access Denied (+ RequireRole guards on manager/admin routes), in-app 404
- [x] _Workspace settings promoted into store (live max-revisions feeds the revision rule)_
- [x] 🔍 **Audit Phase 8 / full frontend review**
- [x] _Committed + pushed to GitHub_

> 🎉 **STAGE A (frontend) COMPLETE** — all 34 screens built, on-theme, interactive with mock data. Next: Stage B (Supabase wiring).

---

## STAGE A.5 — Portal platform layer + per-user module access  ✅ built · 🔍 awaiting audit
Pulls identity/admin out of Task Management into the portal core so module access can be granted per user.
- [x] **Launcher trimmed** — workspace shows Task Management (live) + Outstanding Dashboard ("Coming soon", named) + one generic "More apps coming soon" tile; other named placeholders removed
- [x] **Identity lifted to `core/platform/`** — types, seed data, session, and a directory store (`useDirectory`) moved out of task-management; Task store now re-exposes the directory via pass-through so its existing consumers are unchanged; providers wrap the whole app in `main.tsx`
- [x] **`moduleAccess: string[]` on Profile** — denormalised read-model (like role/hodIds); `session.hasModule(appId)` (admins bypass)
- [x] **Core Admin area `/admin`** (admin-only) — Onboarding, Departments, Users + Add/Edit User (with module-access selector), Hierarchy, **Module Access matrix** (users × apps); reached via an Admin gear on the launcher
- [x] **Core account `/account`** — personal profile + password, for all users
- [x] **Access enforced** — launcher only shows apps the user can open; each live-app route is guarded (`RequireModule` → /home); admins see everything
- [x] _Task Management keeps only task-specific settings (Organization rules + Permissions matrix); its Setup screens were removed (moved to /admin)_
- [x] 🔍 **Audit Stage A.5** — log in → workspace (3 tiles) → Admin gear → manage users + module access; `?role=employee` to verify gating

---

## STAGE B — Backend wiring (in progress)
**Safety rule (user-critical): the live data is production. Only additive/read operations; never drop/alter/delete/truncate existing tables or rows without explicit per-action approval. Strategy: READ-ONLY first — migrate views to live data; defer all writes.**

### Phase B1 — Foundation ✅ done
- [x] `@supabase/supabase-js` + `@tanstack/react-query` installed
- [x] Env wiring — `frontend/.env.local` (gitignored) with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- [x] Single anon-key browser client `core/platform/supabase.ts` (RLS-gated; service-role key never in bundle)
- [x] **NEW table `app_access` created** `(id, user_id → profiles.id, app_id text, created_at, unique(user_id,app_id))` + RLS mirroring `user_roles`/`user_hods` (`app_access_select`: own rows OR `is_admin`; `app_access_admin_write`: admin-only ALL). Purely additive — no existing table/data touched.
- [ ] Generate TS DB types from schema (deferred — wiring per-entity types as we migrate)

### Phase B2 — Auth gate ✅ built · 🔍 awaiting full verify
- [x] `AuthProvider`/`useAuth` (real Supabase session) + `RequireAuth` guard on /home, /account, /admin, app routes
- [x] Login wired to `signInWithPassword` (real); Sign out wired everywhere; verified: bad creds → real "Invalid login credentials"; protected routes redirect to /login
- [x] 🔍 Successful login verified (yash@orangeotec.com) — lands on the workspace.

### Phase B3a — Live identity + directory (read-only) ✅ built · 🔍 awaiting audit
- [x] React Query wired; `core/platform/liveDirectory.ts` loads profiles + departments + roles + hierarchy + app_access from Supabase (RLS-gated) and maps to the `Profile`/`Department` read-model (role precedence, hex avatar colors, hodIds, moduleAccess)
- [x] Directory provider now loads LIVE and is READ-ONLY (`canWrite=false`; mutations are inert no-ops); session derives the current user from the auth session + live directory
- [x] Dev "View as" role switcher removed; you are who you log in as
- [x] Admin (Users/Departments/Hierarchy/Module Access) shows real data with a read-only banner + disabled write controls; Account page save disabled too
- [x] Task Management held behind a "connecting to live data" notice (its tasks are still mock; restored in B3b)
- [x] Verified live: logged in as Yash → /admin shows the real 13 users (roles, departments, reporting), avatars render, writes disabled, zero console errors, **no data written**

### Phase B3b — Live tasks/reports (read-only) ✅ built · 🔍 awaiting audit
- [x] `apps/task-management/data/fetchTaskData.ts` loads tasks / task_activity / notifications / recurring_tasks / weekly_plans / workspace_settings live (RLS-gated) and maps to the frontend types
- [x] Task store now loads LIVE via React Query and is READ-ONLY (`canWrite=false`; all task mutations inert no-ops); selectors (visibleTasks, revisionInfo, weeklyPlanFor) unchanged
- [x] Task Management module re-enabled (migration gate removed); module access already backed by live `app_access` (loaded into `moduleAccess` in B3a)
- [x] Read-only enforced across the app: banner in the task shell + hidden/disabled write controls (New Task, task actions, remark composer, reschedule, recurring CRUD, weekly-plan, organization save)
- [x] Verified live as Yash: dashboard shows the real 69 tasks (stats, dept performance, status donut); My Tasks + Task Detail show real tasks, activity and @mention remarks; writes disabled; no console errors; **nothing written to the DB**

### Phase B4+ — Mutations + business rules (later, after safe write-test path agreed)
- [ ] Business rules: revision limit (2/week), shift-to-next-week linkage, complete, @mention fan-out
- [ ] Recurring-instance generation strategy (confirm approach)
- [ ] RYG weekly plans + notifications (realtime bell)
- [ ] Decide + (with approval) add Postgres RPCs for atomic shift / mention writes
- [ ] End-to-end verification per screen

---

_Last updated: Stage B in progress — B1 (foundation), B2 (auth gate), B3a (live identity + directory), B3b (live tasks/reports) all built & verified, read-only. The whole app now reads live Supabase data. Next: B4 (mutations) — only after a safe write-test path is agreed. Live data untouched._
