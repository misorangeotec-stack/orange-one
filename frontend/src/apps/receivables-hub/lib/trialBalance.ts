/**
 * Trial Balance, per company, from the ConnectWave (Tally) mirror.
 *
 * Tally's group-level Trial Balance shows a Debit AND a Credit on the same group row — it sums the
 * debit-balance ledgers and the credit-balance ledgers of the subtree separately rather than netting
 * them. `v_fs_line` (which the Balance Sheet and P&L read) carries only a single signed net per line
 * and is only two levels deep, so it cannot reproduce that. This report is therefore built from
 * `v_ledger_detail` — one row per ledger, each with its own Dr/Cr sign and full group_chain — and the
 * split is taken at leaf-ledger level and rolled up.
 *
 * Verified against a live Tally screenshot (ORANGE O TEC ENTERPRISES PVT LTD, F.Y.2026-27): all 14
 * group rows and the Grand Total (₹57,84,66,598.73 both sides) match to the paisa after the four
 * adjustments below.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { classify, type FsCompany, type FsFinding, type FsNode } from "./financialStatements";

export interface TbNode {
  name: string;
  kind: "group" | "ledger";
  depth: number;
  /** Σ of leaf closings ≥ 0 in this subtree (positive = Dr, per v_ledger_detail's sign flip). */
  debit: number;
  /** Σ of −(leaf closings < 0) in this subtree. */
  credit: number;
  /** Tally's own net for a TOP-LEVEL group, from v_fs_line. null below the top level, or when
   *  Tally has no matching row (some ledger groupings do not appear in v_fs_line at all). */
  tallyNet: number | null;
  ledgerGuid: string | null;
  children: TbNode[];
  /** Rows created by an adjustment rather than by a ledger (Opening Stock, Profit & Loss A/c). */
  synthetic?: boolean;
}

export interface TbView {
  /** Top-level groups, ordered by their v_fs_line seq (unknown groups sort last, alphabetically). */
  rows: TbNode[];
  totalDebit: number;
  totalCredit: number;
  /** totalDebit − totalCredit. 0 on a healthy book; shown, never hidden. */
  difference: number;
}

export interface TbLedgerRow {
  tenantId: string;
  guid: string;
  ledger: string;
  subGroup: string | null;
  grouping: string | null;
  closing: number;
  groupChain: string[];
}

interface RawLedger {
  tenant_id: string;
  guid: string;
  ledger: string;
  sub_group: string | null;
  grouping: string | null;
  closing: number | string | null;
  group_chain: string[] | null;
}

/** Ledgers whose grouping is exactly this are excluded — the Profit & Loss A/c ledger, whose closing
 *  carries the current-period result. Tally's TB shows the brought-forward figure instead (see below). */
const PL_GROUPING = "Primary";
const PL_ACCOUNT = "Profit & Loss A/c";
const UNGROUPED = "Ungrouped";

/**
 * Load every ledger for the given companies from `v_ledger_detail`.
 *
 * KEYSET pagination, one tenant at a time. `v_ledger_detail` joins the recursive `v_group_chain` CTE,
 * and OFFSET paging (`.range()`) re-scans that CTE for every skipped row — measured at 3.0s on the
 * 5,050-ledger book, over the 3s anon statement_timeout. Keyset on `guid` (unique within a tenant, the
 * table PK) drops the same page to ~0.6s. Do NOT switch this to `.range()` to match fetchAllLines.
 *
 * The tenant is the BARE company guid — never the `~<fy>` FY-split sibling, whose master carries a
 * different (wrong-period) closing balance for the same ledger.
 */
export async function loadTrialBalanceLedgers(
  companyGuids: string[],
): Promise<Record<string, TbLedgerRow[]>> {
  const cw = getConnectwaveSupabase();
  const PAGE = 1000;

  const perCompany = await Promise.all(
    companyGuids.map(async (guid) => {
      const tenant = `acct_orange::${guid}`;
      const rows: TbLedgerRow[] = [];
      let last = "";
      for (;;) {
        const { data, error } = await cw
          .from("v_ledger_detail")
          .select("tenant_id,guid,ledger,sub_group,grouping,closing,group_chain")
          .eq("tenant_id", tenant)
          .gt("guid", last)
          .order("guid", { ascending: true })
          .limit(PAGE);
        if (error) throw new Error(error.message);
        const page = (data ?? []) as RawLedger[];
        for (const r of page) {
          rows.push({
            tenantId: r.tenant_id,
            guid: r.guid,
            ledger: r.ledger,
            subGroup: r.sub_group,
            grouping: r.grouping,
            closing: Number(r.closing) || 0,
            groupChain: r.group_chain ?? [],
          });
        }
        if (page.length < PAGE) break;
        last = page[page.length - 1].guid;
      }
      return [guid, rows] as const;
    }),
  );

  return Object.fromEntries(perCompany);
}

/** Tally's authoritative net per top-level group, deduped. `v_fs_line` can carry the same top level
 *  twice (e.g. "Suspense A/c" and "SUSPENSE A/C", both parent 'Primary', identical amount); summing
 *  them would invent a phantom gap. Keep the row named exactly like the group, else the lowest seq. */
function tallyNetByTopLevel(fsRoots: FsNode[]): Map<string, number> {
  const out = new Map<string, number>();
  // fsRoots is already in seq order, so the first occurrence is the lowest seq.
  for (const r of fsRoots) {
    if (!out.has(r.topLevel) || r.name === r.topLevel) out.set(r.topLevel, r.tally);
  }
  return out;
}

/** Seq of each top-level group, for ordering. Unknown groups get Infinity (sort last). */
function seqByTopLevel(fsRoots: FsNode[]): Map<string, number> {
  const out = new Map<string, number>();
  fsRoots.forEach((r, i) => {
    if (!out.has(r.topLevel)) out.set(r.topLevel, i);
  });
  return out;
}

/**
 * Build the trial-balance tree for one company.
 *
 * Every leaf contributes its own closing to a Debit or Credit bucket by sign, and that split is
 * accumulated up every ancestor — so a group row shows the Dr and Cr totals of its whole subtree,
 * exactly as Tally prints them.
 */
export function buildTrialBalance(ledgers: TbLedgerRow[], fsRoots: FsNode[], c: FsCompany): TbView {
  const tallyNet = tallyNetByTopLevel(fsRoots);
  const seq = seqByTopLevel(fsRoots);

  // Adjustment memo values, from the computed lines Tally carries in v_fs_line.
  const memo = (name: string) => fsRoots.find((r) => r.name === name)?.tally ?? 0;
  const openingStock = memo("Opening Stock");
  const purchBillsToCome = memo("Purchase Bills to Come");
  const salesBillsToMake = memo("Sales Bills to Make");

  const roots = new Map<string, TbNode>();
  const makeNode = (name: string, kind: TbNode["kind"], depth: number): TbNode => ({
    name, kind, depth, debit: 0, credit: 0, tallyNet: null, ledgerGuid: null, children: [],
  });

  const addToBuckets = (node: TbNode, closing: number) => {
    if (closing >= 0) node.debit += closing;
    else node.credit += -closing;
  };

  for (const l of ledgers) {
    // Drop the Profit & Loss A/c ledger — its closing includes the current period's result. Tally's TB
    // shows the brought-forward figure, which v_fs_line carries as ~0; we render that as a group row.
    if (l.grouping === PL_GROUPING) continue;

    // group_chain is stored self → parent → … → top and describes the ledger's PARENT group (the view
    // joins gc.grp = Ledger.PARENT), so the ledger itself is not in it. Reverse for top → … → parent.
    const chain = l.groupChain.length > 0 ? [...l.groupChain].reverse() : [l.grouping ?? UNGROUPED];

    let cursor: TbNode;
    const topName = chain[0];
    let root = roots.get(topName);
    if (!root) {
      root = makeNode(topName, "group", 0);
      roots.set(topName, root);
    }
    cursor = root;
    addToBuckets(cursor, l.closing);

    for (let i = 1; i < chain.length; i++) {
      let child = cursor.children.find((n) => n.kind === "group" && n.name === chain[i]);
      if (!child) {
        child = makeNode(chain[i], "group", i);
        cursor.children.push(child);
      }
      addToBuckets(child, l.closing);
      cursor = child;
    }

    // The ledger itself, as a leaf under its immediate parent group.
    const leaf = makeNode(l.ledger, "ledger", chain.length);
    leaf.ledgerGuid = l.guid;
    addToBuckets(leaf, l.closing);
    cursor.children.push(leaf);
  }

  // Adjustments. Each memo is a SIGNED delta added directly to one column of one group — it is not
  // re-bucketed by sign. Purchase Bills to Come (−₹6.79 L) REDUCES Purchase Accounts' debit and Current
  // Liabilities' credit; it does not create a credit and a debit. Verified: reproduces the screenshot's
  // Purchase Dr 11,26,61,027.46 / Cr 6,37,862.14 exactly, where re-bucketing did not.
  const bumpTop = (topName: string, dDebit: number, dCredit: number, synthName: string) => {
    let root = roots.get(topName);
    if (!root) {
      root = makeNode(topName, "group", 0);
      roots.set(topName, root);
    }
    root.debit += dDebit;
    root.credit += dCredit;
    const s = makeNode(synthName, "group", 1);
    s.synthetic = true;
    s.debit = dDebit;
    s.credit = dCredit;
    root.children.unshift(s);
  };

  // Opening Stock sits inside Current Assets on Tally's TB (Dr-positive).
  if (Math.abs(openingStock) >= 0.005) {
    bumpTop("Current Assets", openingStock, 0, "Opening Stock");
  }
  // Provisional purchase bills (Cr-negative): reduce Purchase Accounts' debit and Current Liabilities' credit.
  if (Math.abs(purchBillsToCome) >= 0.005) {
    bumpTop("Purchase Accounts", purchBillsToCome, 0, "Purchase Bills to Come");
    bumpTop("Current Liabilities", 0, purchBillsToCome, "Purchase Bills to Come");
  }
  // Provisional sales bills: symmetric counterpart — Current Assets (Dr) and Sales Accounts (Cr).
  // NOTE: UNVERIFIED placement. The screenshot's company has no Sales Bills to Make; the other three
  // books do, but the grand-total check cannot validate it (any placement preserves balance). This
  // mirrors the verified Purchase Bills to Come rule by symmetry. Confirm against a NOIDA TB screenshot.
  if (Math.abs(salesBillsToMake) >= 0.005) {
    bumpTop("Current Assets", -salesBillsToMake, 0, "Sales Bills to Make");
    bumpTop("Sales Accounts", 0, -salesBillsToMake, "Sales Bills to Make");
  }

  // The brought-forward Profit & Loss A/c row, from v_fs_line (its net is ~0 on the screenshot's book).
  const plRow = fsRoots.find((r) => r.name === PL_ACCOUNT);
  if (plRow) {
    const node = makeNode(PL_ACCOUNT, "group", 0);
    node.synthetic = true;
    if (plRow.tally >= 0) node.debit = plRow.tally;
    else node.credit = -plRow.tally;
    node.tallyNet = plRow.tally;
    roots.set(PL_ACCOUNT, node);
  }

  // Any OTHER computed memo line Tally carries — e.g. "Unadjusted Forex Gain/Loss" — is shown as its
  // own top-level row, the way Tally prints it. The three folded above (Opening Stock, Purchase/Sales
  // Bills) are excluded; everything else lands here. This is what makes an import-heavy book with a
  // forex line balance to the paisa rather than being left out-of-balance by exactly that line.
  const FOLDED = new Set(["Opening Stock", "Purchase Bills to Come", "Sales Bills to Make"]);
  for (const r of fsRoots) {
    if (r.kind !== "computed" || FOLDED.has(r.name) || roots.has(r.name)) continue;
    const node = makeNode(r.name, "group", 0);
    node.synthetic = true;
    if (r.tally >= 0) node.debit = r.tally;
    else node.credit = -r.tally;
    roots.set(r.name, node);
  }

  // Stamp each top-level group with Tally's own net, for the reconcile column.
  for (const [name, node] of roots) {
    if (tallyNet.has(name)) node.tallyNet = tallyNet.get(name)!;
  }

  const rows = [...roots.values()].sort(
    (a, b) => (seq.get(a.name) ?? Infinity) - (seq.get(b.name) ?? Infinity) || a.name.localeCompare(b.name),
  );

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  void c; // company is part of the signature for symmetry with buildBalanceSheet/buildPnl.
  return { rows, totalDebit, totalCredit, difference: totalDebit - totalCredit };
}

/**
 * Reconcile findings: where a top-level group's ledger-rolled net disagrees with Tally's own net.
 *
 * Reuses FsFinding so ReconcilePanel renders it unchanged. Groups Tally has no row for (tallyNet null)
 * are skipped — there is nothing authoritative to compare against.
 */
export function tbFindings(view: TbView, companyLabel: string): FsFinding[] {
  const out: FsFinding[] = [];
  for (const r of view.rows) {
    if (r.tallyNet === null) continue;
    const ours = r.debit - r.credit;
    const gap = r.tallyNet - ours;
    if (Math.abs(gap) < 0.005) continue;
    out.push({
      company: companyLabel,
      name: r.name,
      kind: r.kind,
      statement: classify(r.name, r.tallyNet).statement,
      path: [],
      tally: r.tallyNet,
      ours,
      gap,
    });
  }
  return out;
}
