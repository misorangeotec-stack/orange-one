/**
 * INK MIS — the ink planning dashboard.
 *
 * The Hub port of the planner's Excel sheet. One line per ink, stock merged across the four
 * books, the hand-entered pipeline alongside it, and the cover maths that decides what to order.
 *
 * FIVE VIEWS, one tab each: Combined, then each book on its own. Combined is the default
 * because that is the decision the planner actually makes — ink is moved between books, so a
 * shortage in one book is only a shortage if the group as a whole is short.
 *
 * ─── WHAT IS TALLY'S AND WHAT IS THE PLANNER'S ───────────────────────────────────────────
 *
 * The four stock columns and the consumption figure come from Tally through ConnectWave and
 * cannot be edited here. Everything else on the row — the averages, lead time, safety factor
 * and every consignment — is the planner's own. The column header group says which is which,
 * because a planner who mistakes a typed number for a Tally number will trust it too much.
 *
 * ─── THE FORMULAS, TAKEN FROM THE SHEET ──────────────────────────────────────────────────
 *
 *   Month max level  = three-month average × lead time × safety factor
 *   Daily max level  = per-day average     × lead time × safety factor
 *   Days cover       = stock ÷ per-day average
 *   Days with ETA    = (stock + ETA + at port) ÷ per-day average
 *   Cover %          = stock ÷ month max level
 *
 * All five were reproduced from the planner's own figures before this screen was written, so
 * the numbers here should match the sheet cell for cell given the same inputs.
 *
 * BOTH AVERAGES COME FROM THE SALES REGISTER, filled by a button rather than recomputed on
 * every render, so a planner's override for a launch or a one-off run survives. The rule and
 * the evidence for it are in lib/inkMis.ts — in short, branch and related sales are the group
 * moving ink to itself and must be excluded, and the per-day divisor is working days ELAPSED
 * this month, not the whole month. Per-day is NOT the three-month average over ninety.
 *
 * ETD IS EXCLUDED FROM COVER. Only ETA and AT PORT count towards the total, matching the
 * sheet's "ETA + AT PORT + STOCK". Goods that have not left the supplier are not cover.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Download, Pencil, RefreshCw, Search, Ship, Wand2,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { salesFyOptions } from "@hub/lib/salesReport";
import {
  DEFAULT_THRESHOLDS, EMPTY_PLAN, INK_COMPANIES, deriveInkRow, fmtDays, fmtPct, fmtQty,
  loadAliases, loadHolidays, loadInkConsumption, loadInkPositions, loadPlans, loadShipments,
  loadThresholds, saveAliases, saveHolidays, savePlans, saveThresholds, workingDaysElapsed,
  type InkAliases, type InkBand, type InkPlan, type InkRow, type InkThresholds,
} from "@hub/lib/inkMis";

const BASE = "/outstanding-dashboard";

/** The sheet's conditional formatting, kept close to the original so the screen reads the
 *  same way at a glance: red is a shortage, purple is money sitting still. */
const BAND_CLASS: Record<InkBand, string> = {
  low: "bg-red-100 text-red-900 font-semibold",
  mid: "bg-amber-100 text-amber-900 font-semibold",
  normal: "bg-emerald-50 text-emerald-900",
  excess: "bg-fuchsia-100 text-fuchsia-900",
  none: "",
};

const BAND_LABEL: Record<InkBand, string> = {
  low: "Below 33%",
  mid: "33–66%",
  normal: "Normal",
  excess: "Excess",
  none: "Not planned",
};

export default function InkMis() {
  const fyOptions = useMemo(() => salesFyOptions(), []);
  const fy = fyOptions[0];

  const [tab, setTab] = useState<string>("combined");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [plans, setPlans] = useState<Record<string, InkPlan>>(() => loadPlans());
  const [thresholds, setThresholds] = useState<InkThresholds>(() => loadThresholds());
  const [aliases, setAliases] = useState<InkAliases>(() => loadAliases());
  const [holidays, setHolidays] = useState<string[]>(() => loadHolidays());

  // Consignments are read once on mount. The entry screen is a separate route, so there is no
  // in-page edit that could leave this stale; arriving back here remounts and re-reads.
  const [shipments] = useState(() => loadShipments());

  useEffect(() => savePlans(plans), [plans]);
  useEffect(() => saveThresholds(thresholds), [thresholds]);
  useEffect(() => saveAliases(aliases), [aliases]);
  useEffect(() => saveHolidays(holidays), [holidays]);

  // Aliases are part of the key: assigning one re-merges the table, which is the whole point.
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["inkMis", "positions", fy, aliases],
    queryFn: () => loadInkPositions(fy, undefined, undefined, aliases),
    staleTime: 5 * 60 * 1000,
  });

  const positions = useMemo(() => data?.rows ?? [], [data]);
  const unmapped = data?.unmapped ?? [];

  /* --------------------------------------------------- fill averages from Tally */

  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<string | null>(null);

  /**
   * Fill both averages from the Sales Register, which is where the planner reads them today.
   *
   *   three-month average = the three complete months before this one, over 3
   *   per-day average     = this month so far, over the working days elapsed
   *
   * Offered as a button rather than a derived column, because the planner overrides a figure
   * for a launch or a one-off run and a column that silently recomputed would wipe that.
   * Only the two averages are touched; lead time and safety factor are left alone.
   */
  const fillAverages = async () => {
    setFilling(true);
    setFillNote(null);
    try {
      const map = data?.nameToCode ?? new Map<string, string>();
      const consumption = await loadInkConsumption(map, new Date(), new Set(holidays));
      setPlans((prev) => {
        const next = { ...prev };
        for (const [code, c] of consumption) {
          next[code] = {
            ...(next[code] ?? EMPTY_PLAN),
            threeMonthAvg: c.threeMonthAvg,
            perDayAvg: c.perDayAvg,
          };
        }
        return next;
      });
      setFillNote(
        `Filled ${consumption.size} inks. Per-day average is this month over ` +
          `${workingDaysElapsed(new Date(), new Set(holidays))} working days.`,
      );
    } catch (e) {
      setFillNote(e instanceof Error ? e.message : "Could not read the Sales Register.");
    } finally {
      setFilling(false);
    }
  };

  /* ------------------------------------------------------------------ the rows */

  const companyKey = tab === "combined" ? null : tab;

  const rows: InkRow[] = useMemo(() => {
    const built = positions.map((p) =>
      deriveInkRow(p, plans[p.itemCode] ?? EMPTY_PLAN, shipments, thresholds, companyKey),
    );
    // A book only shows the inks it actually carries or expects; the other books' codes would
    // be dead rows. Combined shows everything.
    const scoped = companyKey
      ? built.filter((r) => r.stock !== 0 || r.incoming !== 0 || r.etd !== 0)
      : built;
    const q = search.trim().toUpperCase();
    if (!q) return scoped;
    return scoped.filter(
      (r) => r.itemCode.includes(q) || r.description.toUpperCase().includes(q),
    );
  }, [positions, plans, shipments, thresholds, companyKey, search]);

  /** Consignment columns, one per shipment, mirroring the sheet. Scoped to the book in view. */
  const shipmentCols = useMemo(
    () =>
      shipments
        .filter((s) => !companyKey || s.company === companyKey)
        .filter((s) => s.lines.some((l) => l.itemCode))
        .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")),
    [shipments, companyKey],
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({
          stock: t.stock + r.stock,
          etd: t.etd + r.etd,
          eta: t.eta + r.eta,
          atPort: t.atPort + r.atPort,
          total: t.total + r.total,
        }),
        { stock: 0, etd: 0, eta: 0, atPort: 0, total: 0 },
      ),
    [rows],
  );

  const reorderCount = rows.filter((r) => r.band === "low" || r.band === "mid").length;

  const setPlan = (code: string, patch: Partial<InkPlan>) =>
    setPlans((prev) => ({ ...prev, [code]: { ...(prev[code] ?? EMPTY_PLAN), ...patch } }));

  /* --------------------------------------------------------------------- export */

  const exportCsv = () => {
    const head = [
      "Group", "Item code", "Description", "Remark",
      "3-month avg", "Per day avg", "Lead time", "Safety factor",
      "Days cover", "Days cover with ETA", "Month max level", "Daily max level",
      ...(companyKey ? [] : INK_COMPANIES.map((c) => c.label)),
      "Stock", ...shipmentCols.map((s) => `${s.status} ${s.reference || "(no ref)"} ${s.date}`),
      "ETD", "ETA + at port", "Total",
    ];
    const body = rows.map((r) => [
      r.group, r.itemCode, r.description, r.remark,
      r.plan.threeMonthAvg, r.plan.perDayAvg, r.plan.leadTime, r.plan.safetyFactor,
      r.daysCover ?? "", r.daysCoverWithIncoming ?? "", r.monthMaxLevel, r.dailyMaxLevel,
      ...(companyKey ? [] : INK_COMPANIES.map((c) => r.byCompany[c.key] ?? 0)),
      r.stock,
      ...shipmentCols.map((s) =>
        s.lines.filter((l) => l.itemCode === r.itemCode).reduce((t, l) => t + l.qty, 0) || "",
      ),
      r.etd, r.incoming, r.total,
    ]);
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [head, ...body].map((line) => line.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `INK MIS ${tab} ${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ----------------------------------------------------------------------- view */

  const tabs = [{ key: "combined", label: "Combined" }, ...INK_COMPANIES.map((c) => ({ key: c.key, label: c.label }))];

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ink MIS</h1>
          <p className="text-sm text-muted-foreground">
            Stock from Tally across four books, merged on item code, against the pipeline you
            maintain by hand.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <Button size="sm" asChild>
            <Link to={`${BASE}/reports/ink-pipeline`}>
              <Ship className="mr-2 h-4 w-4" /> ETD / ETA entry
            </Link>
          </Button>
        </div>
      </div>

      {/* Tabs — combined plus one per book. */}
      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === t.key
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary strip. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Inks listed", value: String(rows.length) },
          { label: "Stock", value: fmtQty(totals.stock) },
          { label: "ETA + at port", value: fmtQty(totals.eta + totals.atPort) },
          { label: "On order (ETD)", value: fmtQty(totals.etd) },
          { label: "Needs ordering", value: String(reorderCount) },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-64 pl-8"
            placeholder="Search code or description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant={editing ? "default" : "outline"}
          size="sm"
          onClick={() => setEditing((v) => !v)}
        >
          <Pencil className="mr-2 h-4 w-4" /> {editing ? "Done editing" : "Edit planning inputs"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void fillAverages()} disabled={filling}>
          <Wand2 className="mr-2 h-4 w-4" />
          {filling ? "Reading the Sales Register…" : "Fill averages from Sales Register"}
        </Button>
        {(["low", "mid", "normal", "excess"] as InkBand[]).map((b) => (
          <span key={b} className={`rounded px-2 py-1 text-xs ${BAND_CLASS[b]}`}>
            {BAND_LABEL[b]}
          </span>
        ))}
      </div>

      {fillNote && (
        <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
          {fillNote}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          Could not load stock: {error instanceof Error ? error.message : "unknown error"}
        </div>
      )}

      {unmapped.length > 0 && (
        <details className="rounded-md border border-amber-300 bg-amber-50 text-sm text-amber-900">
          <summary className="flex cursor-pointer items-center gap-2 p-3">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <strong>{unmapped.length}</strong> stock line
              {unmapped.length === 1 ? "" : "s"} carry no item code in Tally and are missing from
              the table. Open to map them.
            </span>
          </summary>
          <div className="space-y-3 border-t border-amber-300 p-3">
            <p>
              Give one of these a code and it joins that line immediately. This mapping is saved
              in this browser only. Adding the code to the item master in Tally is the real fix
              and helps everyone.
            </p>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {unmapped.map((u) => (
                <div key={u.key} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[20rem] flex-1 truncate" title={u.item}>
                    {u.item}
                  </span>
                  <span className="w-36 shrink-0 text-xs">{u.company}</span>
                  <span className="w-20 shrink-0 text-right tabular-nums">{fmtQty(u.qty)}</span>
                  <Input
                    className="h-8 w-52 bg-background"
                    placeholder="Map to item code"
                    defaultValue={aliases[u.key] ?? ""}
                    onBlur={(e) => {
                      const code = e.target.value.trim().toUpperCase();
                      setAliases((prev) => {
                        const next = { ...prev };
                        if (code) next[u.key] = code;
                        else delete next[u.key];
                        return next;
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </details>
      )}

      <ScrollableTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[10rem]">Group</TableHead>
              <TableHead className="min-w-[9rem]">Item code</TableHead>
              <TableHead className="min-w-[16rem]">Description</TableHead>
              <TableHead className="min-w-[11rem]">Remark</TableHead>
              <TableHead className="text-right">3-month avg</TableHead>
              <TableHead className="text-right">Per day avg</TableHead>
              <TableHead className="text-right">Lead time</TableHead>
              <TableHead className="text-right">Safety</TableHead>
              <TableHead className="text-right">Days cover</TableHead>
              <TableHead className="text-right">With ETA</TableHead>
              <TableHead className="text-right">Month max</TableHead>
              <TableHead className="text-right">Daily max</TableHead>
              {!companyKey &&
                INK_COMPANIES.map((c) => (
                  <TableHead key={c.key} className="text-right">
                    {c.label}
                  </TableHead>
                ))}
              <TableHead className="text-right font-semibold">Stock</TableHead>
              {shipmentCols.map((s) => (
                <TableHead key={s.id} className="text-right">
                  <div className="text-[10px] uppercase text-muted-foreground">{s.status}</div>
                  <div>{s.reference || "(no ref)"}</div>
                  <div className="text-[10px] font-normal text-muted-foreground">
                    {s.date || "no date"}
                  </div>
                </TableHead>
              ))}
              <TableHead className="text-right">ETA + at port</TableHead>
              <TableHead className="text-right font-semibold">Total</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={20} className="py-10 text-center text-muted-foreground">
                  Loading ink stock from ConnectWave…
                </TableCell>
              </TableRow>
            )}

            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={20} className="py-10 text-center text-muted-foreground">
                  No inks to show.
                </TableCell>
              </TableRow>
            )}

            {rows.map((r) => (
              <TableRow key={r.itemCode}>
                <TableCell className="text-xs">{r.group}</TableCell>
                <TableCell className="font-medium">{r.itemCode}</TableCell>
                <TableCell>{r.description}</TableCell>
                <TableCell>
                  {r.remark && (
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        r.remark === "EXCESS STOCK"
                          ? "bg-fuchsia-100 text-fuchsia-900"
                          : "bg-red-100 text-red-900"
                      }`}
                    >
                      {r.remark}
                    </span>
                  )}
                </TableCell>

                {/* Planner inputs — the four editable cells. */}
                {(
                  [
                    ["threeMonthAvg", r.plan.threeMonthAvg],
                    ["perDayAvg", r.plan.perDayAvg],
                    ["leadTime", r.plan.leadTime],
                    ["safetyFactor", r.plan.safetyFactor],
                  ] as [keyof InkPlan, number][]
                ).map(([field, value]) => (
                  <TableCell key={field} className="text-right tabular-nums">
                    {editing ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        className="h-8 w-20 text-right"
                        value={value || ""}
                        onChange={(e) =>
                          setPlan(r.itemCode, { [field]: Number(e.target.value) || 0 })
                        }
                      />
                    ) : (
                      fmtDays(value || null)
                    )}
                  </TableCell>
                ))}

                <TableCell className="text-right tabular-nums">{fmtDays(r.daysCover)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtDays(r.daysCoverWithIncoming)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(r.monthMaxLevel)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(r.dailyMaxLevel)}</TableCell>

                {!companyKey &&
                  INK_COMPANIES.map((c) => (
                    <TableCell key={c.key} className="text-right tabular-nums">
                      {fmtQty(r.byCompany[c.key])}
                    </TableCell>
                  ))}

                <TableCell className={`text-right tabular-nums ${BAND_CLASS[r.band]}`}>
                  {fmtQty(r.stock)}
                  {r.coverPct !== null && (
                    <div className="text-[10px] font-normal opacity-70">{fmtPct(r.coverPct)}</div>
                  )}
                </TableCell>

                {shipmentCols.map((s) => {
                  const q = s.lines
                    .filter((l) => l.itemCode === r.itemCode)
                    .reduce((t, l) => t + l.qty, 0);
                  return (
                    <TableCell key={s.id} className="text-right tabular-nums">
                      {q ? fmtQty(q) : ""}
                    </TableCell>
                  );
                })}

                <TableCell className="text-right tabular-nums">{fmtQty(r.incoming)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmtQty(r.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>

          {rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={12} className="font-semibold">
                  Total — {rows.length} inks
                </TableCell>
                {!companyKey &&
                  INK_COMPANIES.map((c) => (
                    <TableCell key={c.key} className="text-right font-semibold tabular-nums">
                      {fmtQty(rows.reduce((t, r) => t + (r.byCompany[c.key] ?? 0), 0))}
                    </TableCell>
                  ))}
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmtQty(totals.stock)}
                </TableCell>
                {shipmentCols.map((s) => (
                  <TableCell key={s.id} className="text-right font-semibold tabular-nums">
                    {fmtQty(s.lines.reduce((t, l) => t + l.qty, 0))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmtQty(totals.eta + totals.atPort)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmtQty(totals.total)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </ScrollableTable>

      {/* Holidays. Sundays come out automatically; these are the extra closures. Kept visible
          rather than buried, because every date added raises every per-day average. */}
      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Working days — {workingDaysElapsed(new Date(), new Set(holidays))} so far this month
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-muted-foreground">
            Sundays are already excluded. Add public holidays and any other closure here, then
            fill the averages again. The per-day average divides this month's sales by the
            working days that have passed, so each date you add raises it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {holidays.length === 0 && (
              <span className="text-muted-foreground">No holidays added.</span>
            )}
            {[...holidays].sort().map((h) => (
              <span
                key={h}
                className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs"
              >
                {`${h.slice(6, 8)}-${h.slice(4, 6)}-${h.slice(0, 4)}`}
                <button
                  type="button"
                  aria-label={`Remove ${h}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setHolidays((prev) => prev.filter((d) => d !== h))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <Input
            type="date"
            className="w-48"
            onChange={(e) => {
              const ymd = e.target.value.replace(/-/g, "");
              if (!ymd) return;
              setHolidays((prev) => (prev.includes(ymd) ? prev : [...prev, ymd]));
              e.target.value = "";
            }}
          />
        </div>
      </details>

      {/* Band thresholds. Exposed because the sheet's cut-offs were read off its colouring
          rather than documented, so the planner must be able to correct them. */}
      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Colour thresholds</summary>
        <div className="mt-3 flex flex-wrap gap-4">
          {(
            [
              ["low", "Red below", thresholds.low],
              ["mid", "Amber below", thresholds.mid],
              ["excess", "Purple at or above", thresholds.excess],
              ["excessRemark", "Excess remark at or above", thresholds.excessRemark],
            ] as [keyof InkThresholds, string, number][]
          ).map(([field, label, value]) => (
            <label key={field} className="space-y-1">
              <span className="block text-xs text-muted-foreground">{label} (%)</span>
              <Input
                type="number"
                className="w-28"
                value={value}
                onChange={(e) =>
                  setThresholds((t) => ({ ...t, [field]: Number(e.target.value) || 0 }))
                }
              />
            </label>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="self-end"
            onClick={() => setThresholds(DEFAULT_THRESHOLDS)}
          >
            Reset
          </Button>
        </div>
      </details>
    </div>
  );
}
