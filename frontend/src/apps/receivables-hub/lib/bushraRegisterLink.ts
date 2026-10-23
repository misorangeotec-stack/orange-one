/**
 * THE SALES REGISTER IS THE ONE REPORT (asked 10-10-2026). Every Sales dashboard — the nine product
 * slices, Orange vs Non-Orange, Salesperson, Active / In-active Ink — reads the same Bushra Sales
 * Register; this file is how a dashboard OPENS that register on its own lines.
 *
 *   VIEWS     the register's "View" row: All lines, then one per Sales dashboard, each with that
 *             dashboard's own `include` rule — the Ink view and the Ink dashboard can never disagree.
 *   DIMS      a dashboard's filters, carried in the link and applied with the dashboards' own
 *             readers (lib/bushraSalesFigures.ts DIMS), plus Salesperson / Customer Group / Orange.
 *
 * Kept free of React and the browser, like lib/bushraSalesFigures.ts.
 */
import { SALES_DASHBOARDS } from "./bushraSalesDashboards";
import { DIMS, type DimKey } from "./bushraSalesFigures";
import type { BushraRegisterRow } from "./bushraSalesRegister";

/** A register line with the hub masters' answers beside it (lib/useRegisterExtras.ts). */
export type RegisterLine = BushraRegisterRow & {
  /** The customer ledger's salesperson tag in Masters, or "(Not assigned)". */
  salesperson: string;
  /** The hub Customer Group, or the ledger itself when it has none. */
  customer_group: string;
  /** Orange / Non-Orange / Unclassified — the Orange vs Non-Orange page's answer, hand-set buckets included. */
  orange: string;
};

export interface RegisterView { id: string; label: string; include: (r: BushraRegisterRow) => boolean }
export const ALL_VIEW = "all";
export const REGISTER_VIEWS: RegisterView[] = [
  { id: ALL_VIEW, label: "All lines", include: () => true },
  ...SALES_DASHBOARDS.map((p) => ({
    id: p.id,
    label: p.id === "bushra-sales-dashboard" ? "Sales" : p.title,
    include: p.include,
  })),
];
export const viewById = (id: string | null | undefined) => REGISTER_VIEWS.find((v) => v.id === id) ?? REGISTER_VIEWS[0];

export type RegisterDim = DimKey | "salesperson" | "customerGroup" | "orange";
export const REGISTER_DIM: Record<RegisterDim, { label: string; get: (r: RegisterLine) => string }> = {
  month: { label: "Month", get: DIMS.month },
  location: { label: "Location", get: DIMS.location },
  company: { label: "Company", get: DIMS.company },
  type: { label: "Type", get: DIMS.type },
  salesType: { label: "Product", get: DIMS.salesType },
  category: { label: "Category", get: DIMS.category },
  inkType: { label: "Ink Type", get: DIMS.inkType },
  group: { label: "Group", get: DIMS.group },
  colour: { label: "Colour", get: DIMS.colour },
  party: { label: "Customer", get: DIMS.party },
  salesperson: { label: "Salesperson", get: (r) => r.salesperson },
  customerGroup: { label: "Customer Group", get: (r) => r.customer_group },
  orange: { label: "Orange / Non-Orange", get: (r) => r.orange },
};
const DIM_KEYS = Object.keys(REGISTER_DIM) as RegisterDim[];

export interface RegisterLinkOpts {
  view?: string;
  /** YYYYMMDD — the window to open on. */
  from?: string;
  to?: string;
  dims?: Partial<Record<RegisterDim, string[]>>;
}

/** The register's URL, carrying a dashboard's view, window and filters. `base` is the reports app's base path. */
export function registerHref(base: string, o: RegisterLinkOpts): string {
  const q = new URLSearchParams();
  if (o.view && o.view !== ALL_VIEW) q.set("view", o.view);
  if (o.from) q.set("from", o.from);
  if (o.to) q.set("to", o.to);
  const dims = Object.fromEntries(Object.entries(o.dims ?? {}).filter(([, v]) => v && v.length));
  if (Object.keys(dims).length) q.set("d", JSON.stringify(dims));
  const s = q.toString();
  return `${base}/bushra-sales-register${s ? `?${s}` : ""}`;
}

/** What a link asked for. Anything malformed is dropped, never thrown — a bad link opens the plain register. */
export function parseRegisterLink(sp: URLSearchParams): RegisterLinkOpts {
  const ymd = (v: string | null) => (v && /^\d{8}$/.test(v) ? v : undefined);
  let dims: Partial<Record<RegisterDim, string[]>> = {};
  try {
    const raw = JSON.parse(sp.get("d") ?? "{}") as Record<string, unknown>;
    dims = Object.fromEntries(Object.entries(raw)
      .filter(([k, v]) => DIM_KEYS.includes(k as RegisterDim) && Array.isArray(v))
      .map(([k, v]) => [k, (v as unknown[]).filter((x): x is string => typeof x === "string")]));
  } catch { /* ignore */ }
  return { view: sp.get("view") ?? undefined, from: ymd(sp.get("from")), to: ymd(sp.get("to")), dims };
}

/** Keeps a line when it matches every carried filter. */
export const matchesDims = (r: RegisterLine, dims: Partial<Record<RegisterDim, string[]>>) =>
  DIM_KEYS.every((k) => !dims[k]?.length || dims[k]!.includes(REGISTER_DIM[k].get(r)));
