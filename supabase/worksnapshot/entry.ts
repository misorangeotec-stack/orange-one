/**
 * ONE PERSON'S WORK, COMPUTED ON THE SERVER — the same way the screen computes it.
 *
 * ── Why this file exists ───────────────────────────────────────────────────────
 * My Work Today (`core/workspace/MyWorkToday.tsx`) is assembled entirely in the
 * browser. Each FMS step's due date is DERIVED in TypeScript from working-day SLAs
 * (`shared/lib/stepSla.ts` + each module's `fms_*_config`) and never stored, so no
 * cron job and no SQL query can see it. That is why the daily snapshot mail could
 * only ever count Task Management, and why it kept disagreeing with the screen.
 *
 * The fix is not to re-derive those numbers in SQL — that is a second source of
 * truth, and it has already produced two wrong reports. It is to run the app's own
 * code on the server. Everything below the "IMPORTED, NOT COPIED" line is the
 * screen's actual logic, compiled unchanged by build.mjs.
 *
 * ── NOTHING HERE IS A COPY OF THE SCREEN'S RULES ──────────────────────────────
 * For a while it was. Each provider wrapped its rule in a React hook, hooks cannot
 * run on a server, so the fifteen lines inside each `useMemo` were restated in
 * this file — ten times, each block citing the provider it mirrored. They agreed,
 * because they were copied carefully and checked against real screens. That is not
 * a property that survives six months of edits.
 *
 * So the rules moved OUT of the providers into `core/workspace/mywork/items/`, and
 * both readers import them: the providers render from those files, this file
 * computes from them. One copy. Change a rule and the screen and the mail change
 * together, because they are the same lines.
 *
 * What remains here is assembly only — which datasets to load, which builder to
 * call, and how to bucket and total the result. If you find yourself writing a
 * `.filter()` in this file, it belongs in items/ instead.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────────
 * All ten providers on My Work Today are wired. That is not a thing to keep in
 * your head: build.mjs reads the app's provider registry and REFUSES TO BUILD if
 * one appears there that is not in COVERED_APP_IDS below. Adding a module to the
 * home screen and forgetting the mail is therefore impossible to do quietly,
 * which is the failure that actually happens.
 *
 * Anything a person holds that this build cannot count is named in the mail
 * rather than left out of the total.
 *
 * ── Timezone ──────────────────────────────────────────────────────────────────
 * `todayLocalIso()`, `localDateIso()` and `addWorkingDays()` all read the HOST
 * clock, and Supabase's edge runtime is pinned to UTC — a `TZ` secret does not
 * reach it and `Deno.env.set` throws `NotSupported`. India is UTC+5:30 with no
 * DST, so the correction is a constant and it is applied at the module boundary:
 * `istWorkingDays.ts` replaces `shared/lib/workingDays` in the bundle. Everything
 * downstream then computes Indian dates without a single app file changing.
 * `assertIstClock()` proves it at runtime rather than trusting the wiring.
 */

// ── IMPORTED, NOT COPIED — this is the screen's real logic ────────────────────
import { appName, appBasePath } from "@/apps/appInfo";
import { bucketOf, todayLocalIso, type Bucket } from "@/shared/lib/dueBuckets";
import { toIst } from "./istWorkingDays";
import { dueIsoFrom } from "./istStepSla";
import { isMineByStepOwners, stepOwnerIdsFor, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { WorkItem } from "@/core/workspace/mywork/types";

import { fetchTaskData, type TaskData } from "@/apps/task-management/data/fetchTaskData";
import { fetchHrData, type HrData } from "@/apps/hr-recruitment/data/hrFetch";
import { fetchExitData, type ExitData } from "@/apps/hr-exit/data/exitFetch";
import { fetchProcurementData, type ProcurementData } from "@/apps/procurement/data/procFetch";
import { fetchImportData, type ImportData } from "@/apps/import/data/importFetch";
import { fetchSuppliesData, type SuppliesData } from "@/apps/office-supplies/data/suppliesFetch";
import { fetchSamplingData, type SamplingData } from "@/apps/sampling/data/samplingFetch";
import { fetchProductionData, type ProductionData } from "@/apps/production-entry/data/productionFetch";
import { fetchDispatchData, type DispatchData } from "@/apps/order-to-dispatch/data/dispatchFetch";
import { fetchAssetData, type AssetData } from "@/apps/asset-maintenance/data/assetFetch";

// THE RULES THEMSELVES — the same files My Work Today renders from. Not copies.
import { taskWorkItems } from "@/core/workspace/mywork/items/tasks";
import { purchaseWorkItems } from "@/core/workspace/mywork/items/purchase";
import { importWorkItems } from "@/core/workspace/mywork/items/import";
import { hrWorkItems } from "@/core/workspace/mywork/items/hr";
import { hrExitWorkItems } from "@/core/workspace/mywork/items/hrExit";
import { officeSuppliesWorkItems } from "@/core/workspace/mywork/items/officeSupplies";
import { samplingWorkItems } from "@/core/workspace/mywork/items/sampling";
import { productionWorkItems } from "@/core/workspace/mywork/items/productionEntry";
import { dispatchWorkItems } from "@/core/workspace/mywork/items/orderToDispatch";
import { assetWorkItems } from "@/core/workspace/mywork/items/assetMaintenance";

// ── What a caller gets back ───────────────────────────────────────────────────

/** One module's line on the mail, mirroring the per-source group on the screen. */
export interface SourceSummary {
  /** Provider key — "tasks", "hr", "hr-exit". Matches `WorkItem.source`. */
  key: string;
  appId: string;
  /** Module name as the reader sees it: "New Recruitment", not "hr-recruitment". */
  module: string;
  path: string;
  items: number;
  overdue: number;
  dueToday: number;
  next2: number;
  noDate: number;
}

/** The four tiles at the top of My Work Today, in the same order and arithmetic. */
export interface Tiles {
  overdue: number;
  dueToday: number;
  /** "Next 2 days" is tomorrow + the day after — one tile, two buckets. */
  next2: number;
  noDate: number;
}

export interface WorkSnapshot {
  userId: string;
  forDate: string;
  totalItems: number;
  tiles: Tiles;
  sources: SourceSummary[];
  /** Worst-first, capped. The counts above are the truth; this is the detail. */
  items: WorkItem[];
  /** App ids this build can count. Anything else must be named as not counted. */
  coveredAppIds: string[];
}

/** Everything the wired modules need, fetched once and shared by every user. */
export interface Datasets {
  tasks?: TaskData;
  hr?: HrData;
  exit?: ExitData;
  proc?: ProcurementData;
  imp?: ImportData;
  sup?: SuppliesData;
  samp?: SamplingData;
  prod?: ProductionData;
  disp?: DispatchData;
  asset?: AssetData;
}

/**
 * ⚠ THIS LIST IS CHECKED AGAINST THE APP AT BUILD TIME. build.mjs reads
 * core/workspace/mywork/registry.ts and refuses to build if a provider exists
 * there that is not named here — so a module added to My Work Today can never
 * quietly go missing from the mail. To exclude one deliberately, put it in
 * DELIBERATELY_UNCOVERED with a reason.
 */
export const COVERED_APP_IDS = [
  "task-management",
  "procurement",
  "import",
  "hr-recruitment",
  "hr-exit",
  "office-supplies",
  "sampling",
  "production-entry",
  "order-to-dispatch",
  "asset-maintenance",
] as const;
export type CoveredAppId = (typeof COVERED_APP_IDS)[number];

/**
 * Providers that exist on the screen but are deliberately not mailed. Empty
 * today; it exists so that "not wired yet" and "decided against" are different
 * states rather than both looking like an oversight.
 */
export const DELIBERATELY_UNCOVERED: Record<string, string> = {};

// ── Clock ─────────────────────────────────────────────────────────────────────

/** Today in India, in the same local form every due date here is written in. */
export const todayIso = (): string => todayLocalIso(toIst(new Date()));

/**
 * Prove the clock correction is actually wired, rather than assuming it.
 *
 * `todayIso()` goes through the shim; `Intl` with an explicit zone does not. If
 * the two ever disagree, the alias in build.mjs has come loose and every date in
 * the report is a day out — visible only as items that are overdue slightly too
 * early. Comparing them is one line and turns that into a refusal.
 */
export function assertIstClock(): void {
  const viaIntl = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (todayIso() !== viaIntl) {
    throw new Error(
      `work-snapshot clock is wrong: computed ${todayIso()}, India is on ${viaIntl}. ` +
        `The istWorkingDays alias in supabase/worksnapshot/build.mjs is not taking effect.`,
    );
  }
}

/**
 * `same_day_cutoff` IS now handled — by istStepSla.ts, which shifts the anchor
 * before reading its hour. This assertion was what caught the gap: it refused to
 * run rather than answering Order to Dispatch's "before 12 noon" rule in UTC
 * hours, which would have moved half a day's orders to the wrong date.
 *
 * Kept as a live check that the fix is actually wired: a cut-off SLA is only
 * safe while the aliased dueIsoFrom is in the bundle, and this proves it is
 * rather than assuming it.
 */
function assertCutoffHandled(maps: Array<Record<string, { unit?: string }> | undefined>): void {
  const hasCutoff = maps.some((m) =>
    Object.values(m ?? {}).some((sla) => sla?.unit === "same_day_cutoff"),
  );
  if (!hasCutoff) return;

  // 12:00 IST exactly = 06:30 UTC. Under the correct clock this is AT the
  // default cut-off and rolls to the next working day; on a UTC clock it reads
  // as 06:30, which is before the cut-off, and does not.
  const noonIst = "2026-08-17T06:30:00Z"; // a Monday
  const rolled = dueIsoFrom(noonIst, { unit: "same_day_cutoff", days: 0 } as never);
  const sameDay = dueIsoFrom(noonIst, { unit: "working_days", days: 0 } as never);
  if (rolled === sameDay) {
    throw new Error(
      "same_day_cutoff SLAs are in use but the IST-aware dueIsoFrom is not active — " +
        "the istStepSla alias in supabase/worksnapshot/build.mjs is not taking effect. " +
        "Cut-off deadlines would be judged in UTC hours.",
    );
  }
}

// ── Loading ───────────────────────────────────────────────────────────────────

/**
 * Load each module's whole dataset ONCE.
 *
 * The browser fetches per user because it only has that user's session. Here one
 * pass serves everybody: forty people times ten modules is ten reads, not four
 * hundred. It is also why the ownership filters below must be exact — nothing
 * else narrows this data down to one person.
 */
export async function loadDatasets(appIds: readonly string[]): Promise<Datasets> {
  const want = new Set(appIds);
  const out: Datasets = {};
  await Promise.all([
    want.has("task-management") ? fetchTaskData().then((d) => void (out.tasks = d)) : null,
    want.has("hr-recruitment") ? fetchHrData().then((d) => void (out.hr = d)) : null,
    want.has("hr-exit") ? fetchExitData().then((d) => void (out.exit = d)) : null,
    want.has("procurement") ? fetchProcurementData().then((d) => void (out.proc = d)) : null,
    want.has("import") ? fetchImportData().then((d) => void (out.imp = d)) : null,
    want.has("office-supplies") ? fetchSuppliesData().then((d) => void (out.sup = d)) : null,
    want.has("sampling") ? fetchSamplingData().then((d) => void (out.samp = d)) : null,
    want.has("production-entry") ? fetchProductionData().then((d) => void (out.prod = d)) : null,
    want.has("order-to-dispatch") ? fetchDispatchData().then((d) => void (out.disp = d)) : null,
    want.has("asset-maintenance") ? fetchAssetData().then((d) => void (out.asset = d)) : null,
  ]);
  assertCutoffHandled([
    out.hr?.config?.stepSla as never,
    out.exit?.config?.stepSla as never,
    out.sup?.config?.stepSla as never,
    out.samp?.config?.stepSla as never,
    out.prod?.config?.stepSla as never,
    out.disp?.config?.stepSla as never,
    out.asset?.config?.stepSla as never,
  ]);
  return out;
}

// ── Assembly ──────────────────────────────────────────────────────────────────

/** Provider key → app id. The keys are the providers' own, not the app ids. */
const SOURCE_APP: Record<string, string> = {
  tasks: "task-management",
  purchase: "procurement",
  import: "import",
  hr: "hr-recruitment",
  "hr-exit": "hr-exit",
  "office-supplies": "office-supplies",
  sampling: "sampling",
  "production-entry": "production-entry",
  "order-to-dispatch": "order-to-dispatch",
  "asset-maintenance": "asset-maintenance",
};

/** Provider display order, matching core/workspace/mywork/registry.ts:34-46. */
const SOURCE_ORDER = [
  "tasks",
  "purchase",
  "import",
  "hr",
  "hr-exit",
  "office-supplies",
  "sampling",
  "production-entry",
  "order-to-dispatch",
  "asset-maintenance",
];

/**
 * ⚠ THE ADMIN TRAP. Providers return the WHOLE book when `isAdmin`, and the screen
 * then narrows to `assignment === "direct"` (MyWorkToday.tsx:161, :198). Skip that
 * second filter and an admin's mail would list every open item in the company.
 * A non-admin is unaffected: their providers already returned only their own rows,
 * and every one of those is tagged "direct".
 */
export function computeSnapshot(
  data: Datasets,
  userId: string,
  isAdmin: boolean,
  appIds: readonly string[],
  maxItems = 40,
): WorkSnapshot {
  const has = new Set(appIds);
  const today = todayIso();

  let all: WorkItem[] = [];
  if (data.tasks && has.has("task-management")) all = all.concat(taskWorkItems(data.tasks, userId));
  if (data.proc && has.has("procurement")) all = all.concat(purchaseWorkItems(data.proc, userId, isAdmin));
  if (data.imp && has.has("import")) all = all.concat(importWorkItems(data.imp, userId, isAdmin));
  if (data.hr && has.has("hr-recruitment")) all = all.concat(hrWorkItems(data.hr, userId, isAdmin));
  if (data.exit && has.has("hr-exit")) all = all.concat(hrExitWorkItems(data.exit, userId, isAdmin));
  if (data.sup && has.has("office-supplies")) all = all.concat(officeSuppliesWorkItems(data.sup, userId, isAdmin));
  if (data.samp && has.has("sampling")) all = all.concat(samplingWorkItems(data.samp, userId, isAdmin));
  if (data.prod && has.has("production-entry")) all = all.concat(productionWorkItems(data.prod, userId, isAdmin));
  if (data.disp && has.has("order-to-dispatch")) all = all.concat(dispatchWorkItems(data.disp, userId, isAdmin));
  if (data.asset && has.has("asset-maintenance")) all = all.concat(assetWorkItems(data.asset, userId, isAdmin));

  const scoped = isAdmin ? all.filter((i) => i.assignment === "direct") : all;

  const tiles: Tiles = { overdue: 0, dueToday: 0, next2: 0, noDate: 0 };
  const per = new Map<string, SourceSummary>();

  for (const item of scoped) {
    const b: Bucket | null = bucketOf(item.dueIso, today);
    if (b === "delayed") tiles.overdue++;
    else if (b === "today") tiles.dueToday++;
    else if (b === "tomorrow" || b === "dayAfter") tiles.next2++;
    else if (b === "noDate") tiles.noDate++;

    const appId = SOURCE_APP[item.source] ?? item.source;
    let s = per.get(item.source);
    if (!s) {
      s = {
        key: item.source,
        appId,
        module: item.sourceLabel || appId,
        path: appBasePath(appId),
        items: 0,
        overdue: 0,
        dueToday: 0,
        next2: 0,
        noDate: 0,
      };
      per.set(item.source, s);
    }
    s.items++;
    if (b === "delayed") s.overdue++;
    else if (b === "today") s.dueToday++;
    else if (b === "tomorrow" || b === "dayAfter") s.next2++;
    else if (b === "noDate") s.noDate++;
  }

  // Worst first: overdue by how late, then dated, then undated. The mail lists a
  // capped slice, so the cap must take the rows that matter rather than the head
  // of an arbitrary order.
  const sorted = [...scoped].sort((a, b) => {
    const ax = a.dueIso ?? "9999-12-31";
    const bx = b.dueIso ?? "9999-12-31";
    return ax === bx ? a.ref.localeCompare(b.ref) : ax < bx ? -1 : 1;
  });

  const sources = [...per.values()].sort(
    (a, b) => SOURCE_ORDER.indexOf(a.key) - SOURCE_ORDER.indexOf(b.key),
  );

  return {
    userId,
    forDate: today,
    totalItems: scoped.length,
    tiles,
    sources,
    items: sorted.slice(0, maxItems),
    coveredAppIds: [...COVERED_APP_IDS],
  };
}
