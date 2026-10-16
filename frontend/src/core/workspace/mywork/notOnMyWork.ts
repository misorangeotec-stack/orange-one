/**
 * Apps that are deliberately NOT on My Control Center, each with the reason.
 *
 * ⚠ EVERY APP MUST BE IN ONE OF TWO PLACES — a provider in ./registry.ts, or this
 *   list. `npm run build` runs scripts/check-mywork-coverage.mjs first and REFUSES
 *   TO BUILD when an app in apps/registry.tsx is in neither. Rule (decided
 *   14-10-2026 by the user): any module that gives a named person work — a step
 *   owner, an approver, a verifier set in its Setup — shows on that person's
 *   Control Center while they have something in it, and its card hides when they
 *   have nothing. So a new app with assigned work gets a provider; only an app with
 *   no per-person pending work belongs here.
 *
 * Keys are app ids (the manifest `id`, e.g. "outstanding-dashboard" for the
 * Receivables Hub folder).
 */
export const NOT_ON_MY_WORK: Record<string, string> = {
  "fms-control-center": "a lens on other apps' work — including it would count everything twice",
  "process-coordinator": "a lens on other apps' work (who is sitting on what)",
  "leads-dashboard": "app_leads has no status and no due date — nothing can be pending or overdue",
  "outstanding-dashboard": "follow-ups provider is built but held back — see the comment in ./registry.ts",
  "kra-kpi": "scorecard of work already done",
  "hr-reports": "read-only HR reports",
  "reports": "report catalogue",
  "master-report": "usage report and its morning mail",
  "ink-expiry": "expiry dashboard read from ConnectWave",
  "ink-mis": "shared planning sheet — no one is assigned a row",
  "rm-mis": "shared planning sheet — no one is assigned a row",
  "bushra-central-master": "private mirror of the item master",
  "all-drafts": "the reader's own saved drafts, not work given to them",
  "customer-orders": "customers' own portal; the staff side shows through Order to Dispatch",
  "daily-report": "bank balances are entered by whoever holds the grant — no named person",
  "announcements": "publishing tool",
  "knowledge-base": "questions sent to HR have no named answerer",
  "training-videos": "reference links",
  // ⚠ OPEN, not decided-against (16-10-2026). Inquiries name a salesperson, but have no
  //   follow-up date and no fixed closed status (statuses are a master list), and they
  //   live in the portal's own Supabase project. Needs the user to say which statuses
  //   mean "still open" before it can get a provider.
  "machine-resale": "inquiries have a salesperson but no follow-up date or fixed open/closed status — awaiting a decision",
};
