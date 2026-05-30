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
- [ ] 🔍 **Audit Phase 3** — log in → Task Management → My Tasks. Try: open a task → Start / Revise / Shift / Complete; post an @mention remark; create a task. (`?role=` to switch views)
- [x] _Committed + pushed to GitHub_

### Phase 4 — Manager & admin task views  ✅ built · 🔍 awaiting audit
- [x] **Reusable TaskBrowser** — stats strip + filters (search / person / department / status / week) + list with assignee avatars
- [x] **11. Team Tasks** (HOD / sub-HOD) — direct reports' tasks, filter by team member
- [x] **12. All Tasks** (admin) — org-wide, filter by department + person
- [ ] 🔍 **Audit Phase 4** (review with Phase 3) — `?role=hod` → Team Tasks; `?role=admin` → All Tasks
- [x] _Committed + pushed to GitHub_

### Phase 5 — Recurring tasks  ✅ built · 🔍 awaiting audit
- [x] **13. Recurring list** — daily/weekly templates, frequency text, assignee, active/pause toggle, edit + delete (confirm)
- [x] **Create/Edit Recurring** — title, description, assignee, Daily/Weekly toggle, weekday picker (weekly), active toggle
- [x] _Store extended with recurring CRUD; HOD/admin scoped_
- [ ] 🔍 **Audit Phase 5** — `?role=hod` or `admin` → Recurring
- [x] _Committed + pushed to GitHub_

### Refinements (post Phase 3/4, applied)
- [x] Searchable dropdowns (Combobox) everywhere
- [x] Task actions: distinct buttons (Mark in progress / Revise / Mark complete); reschedule moved to Due date in Details (future-week date auto-shifts)

### Phase 6 — Reports (Red/Yellow/Green)  ✅ built · 🔍 awaiting audit
- [x] **14. Reports** — role-gated tabs Weekly / Employee / Team / Department; planned-vs-actual tiles, per-person RYG, status donut, avg RYG; contextual selectors (person/HOD/department)
- [x] **15. Activity History** — filterable audit trail (by action type + person), role-scoped, timeline with task links
- [x] _Report stat helpers (reportFor) in selectors_
- [ ] 🔍 **Audit Phase 6** — `?role=admin` → Reports (try tabs) + Activity

### Phase 7 — Admin setup  ✅ built · 🔍 awaiting audit
- [x] **Directory promoted into store** — profiles + departments are now live/editable; admin mutators (add/edit/delete dept + user); directory helpers (profileById/directReportIds/assignableUsers/visibleTasks) moved to store; all consumers refactored
- [x] **16. Setup** — sub-nav shell + Onboarding checklist (live progress), Department Management (add/edit/delete), User Management (filters + role badges), Add/Edit User (role picker, department, multi-HOD reporting), Hierarchy mapping (teams + unmapped)
- [ ] 🔍 **Audit Phase 7** — `?role=admin` → Setup
- [x] _Committed + pushed to GitHub_

### Phase 8 — Settings + utility  ✅ built · 🔍 awaiting audit
- [x] **17. Settings** — Profile (edit own details + in-app change password), Organization (workspace name / week-start / max-revisions, admin), Permissions (read-only role matrix, admin)
- [x] **18. Utility** — Empty states (reused), Access Denied (+ RequireRole guards on manager/admin routes), in-app 404
- [x] _Workspace settings promoted into store (live max-revisions feeds the revision rule)_
- [ ] 🔍 **Audit Phase 8 / full frontend review**
- [x] _Committed + pushed to GitHub_

> 🎉 **STAGE A (frontend) COMPLETE** — all 34 screens built, on-theme, interactive with mock data. Next: Stage B (Supabase wiring).

---

## STAGE B — Backend wiring (after frontend approved)
- [ ] Add supabase-js (anon key + RLS) + TanStack Query; generate TS types from schema
- [ ] AuthProvider / useAuth + route guards (RequireAuth / RequireRole)
- [ ] Per-entity data modules + query/mutation hooks; replace mock data with live queries
- [ ] Business rules: revision limit (2/week), shift-to-next-week linkage, complete, @mention fan-out
- [ ] Recurring-instance generation strategy (confirm approach)
- [ ] RYG weekly plans + notifications (realtime bell)
- [ ] Decide + (with approval) add Postgres RPCs for atomic shift / mention writes
- [ ] Env wiring (`.env.local` VITE_ vars); end-to-end verification per screen

---

_Last updated: Phase 1 in progress._
