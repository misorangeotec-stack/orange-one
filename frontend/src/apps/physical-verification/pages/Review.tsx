import { useBackState } from "@/shared/lib/backState";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { matchesSearch } from "@/shared/lib/search";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { cn } from "@/shared/lib/cn";
import {
  ActiveFilters, SortFilterBody, SortFilterHead, TableTools, useSortFilter, type Col,
} from "@/apps/ink-expiry/components/SortFilterHead";
import { COMPANIES, companyName, fmtDate, fmtInr, fmtQty, fmtStamp, itemKey } from "../lib/stock";
import {
  canReview, diffValue, lotTotal, PV_QUERY, reviewRows, STATUS_LABEL, usePv, type CountRow, type CountStatus, type LotClosing,
} from "../lib/pv";
import { lotCompare, NO_LOT, useLots } from "../lib/lots";
import { Diff, inputCls, PageHead, PvUnavailable, StatusPill, Tile } from "../components/parts";

/**
 * REVIEW — submitted counts against Tally's closing frozen at count time.
 *
 * 20-10-2026 (asked):
 *   • Every column sorts, filters and can be hidden (Columns) — remarks run long.
 *   • Lots side by side: the counter's lots and Tally's lots, each with its quantity, and the
 *     difference lot by lot. Tally's lots are its lot-wise CLOSING, tied to the closing on the
 *     row (lib/lots.ts) — frozen at count time, or rebuilt as at the count date for older rows.
 *   • Tick → Accept & submit → a pop-up asks a remark for each item. Matching items need none
 *     and are closed; items with a difference need one and go on to 4 · Post to Tally.
 *     Send for recount needs a remark for every item.
 */

type Tab = "submitted" | "returned" | "accepted";
type Action = "accept" | "recount";

const hasDiff = (c: CountRow) => Math.abs(c.difference ?? 0) >= 0.0005;

export default function Review() {
  const { user, isAdmin: admin, canEditModule } = useSession();
  const qc = useQueryClient();
  const pvQ = usePv();
  // Step 3 rights (Settings). Named isAdmin to keep the checks below short.
  const isAdmin = canReview(user.id, admin, canEditModule("physical-verification"), pvQ.data);
  const people = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 10 * 60_000 });
  const nameOf = (id: string | null | undefined) => (id ? people.data?.find((p) => p.id === id)?.name ?? "—" : "—");

  const [tab, setTab] = useState<Tab>("submitted");
  const [search, setSearch] = useBackState("Review.search", "");
  const [company, setCompany] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Action | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const allCounts = pvQ.data?.counts ?? [];
  const counts = useMemo(() => (company ? allCounts.filter((c) => c.companyGuid === company) : allCounts), [allCounts, company]);
  const multiCompany = new Set(allCounts.map((c) => c.companyGuid)).size > 1;
  const byTab = (t: Tab) => counts.filter((c) => c.status === t);
  const searched = useMemo(() => counts
    .filter((c) => c.status === tab && matchesSearch(search, `${c.item} ${c.subGroup ?? ""} ${c.group ?? ""}`))
    .sort((a, b) => (b.submittedAt ?? b.reviewedAt ?? "").localeCompare(a.submittedAt ?? a.reviewedAt ?? "")),
  [counts, tab, search]);

  // Tally's CURRENT lots, only for rows that froze none at count time.
  const needLive = useMemo(() => searched.filter((c) => !c.lotClosing.length), [searched]);
  // Tied to the closing frozen on the row, as at the day it was counted.
  const liveQ = useLots(needLive.map((c) => ({
    companyGuid: c.companyGuid, item: c.item, closing: c.closingQty, asOf: c.tallyAsAt ?? c.countedAt,
  })));
  const tallyLots = (c: CountRow): { lots: LotClosing[]; live: boolean } => (c.lotClosing.length
    ? { lots: c.lotClosing, live: false }
    : { lots: liveQ.data?.get(itemKey(c.companyGuid, c.item)) ?? [], live: true });

  const canAct = isAdmin && tab === "submitted";
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const cols: Col<CountRow>[] = [
    ...(canAct ? [{
      key: "pick", label: "✓", filter: false, text: () => "", sort: (c: CountRow) => (picked.has(c.id) ? 0 : 1),
      render: (c: CountRow) => (
        <input type="checkbox" className="accent-orange" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
      ),
    } satisfies Col<CountRow>] : []),
    { key: "date", label: "Date", text: (c) => fmtDate(c.verifyDate), sort: (c) => c.verifyDate },
    {
      key: "item", label: "Stock item", text: (c) => c.item, sort: (c) => c.item,
      render: (c) => (
        <div className="whitespace-normal">
          <div className="font-medium text-navy">{c.item}</div>
          <div className="text-[11px] text-grey">
            {[multiCompany ? companyName(c.companyGuid) : null, c.subGroup, c.group].filter((g, i, a) => g && a.indexOf(g) === i).join(" · ")}
          </div>
        </div>
      ),
    },
    ...(multiCompany ? [{ key: "company", label: "Company", text: (c: CountRow) => companyName(c.companyGuid), sort: (c: CountRow) => companyName(c.companyGuid) }] : []),
    { key: "sub", label: "Sub group", text: (c) => c.subGroup ?? "", sort: (c) => c.subGroup ?? null },
    { key: "unit", label: "Unit", text: (c) => c.unit ?? "", sort: (c) => c.unit ?? null },
    {
      key: "closing", label: "Closing", align: "right", text: (c) => fmtQty(c.closingQty), sort: (c) => c.closingQty,
      filter: false, className: "tabular-nums",
    },
    {
      key: "physical", label: "Physical", align: "right", text: (c) => fmtQty(c.physicalQty), sort: (c) => c.physicalQty,
      filter: false, className: "tabular-nums font-semibold",
    },
    {
      key: "diff", label: "Difference", align: "right", sort: (c) => c.difference,
      text: (c) => (!hasDiff(c) ? "Matches" : (c.difference ?? 0) < 0 ? "Short" : "Extra"),
      render: (c) => <Diff value={c.difference} />,
    },
    {
      key: "value", label: "Value", align: "right", filter: false, className: "tabular-nums text-grey",
      text: (c) => fmtInr(diffValue(c.difference, c.closingRate)), sort: (c) => diffValue(c.difference, c.closingRate),
    },
    {
      key: "lots", label: "Lots · counted vs Tally", filter: false, text: () => "", sort: (c) => c.lotCounts.length,
      render: (c) => <LotTable c={c} tally={tallyLots(c)} loading={liveQ.isLoading && !c.lotClosing.length} />,
    },
    { key: "verifier", label: "Verifier", text: (c) => nameOf(c.countedBy ?? c.assignedTo), sort: (c) => nameOf(c.countedBy ?? c.assignedTo) },
    {
      key: "vremarks", label: "Verifier remarks", text: (c) => c.verifierRemarks ?? "", sort: (c) => c.verifierRemarks ?? null,
      filter: false, render: (c) => <Clip text={c.verifierRemarks} />,
    },
    {
      key: "rremarks", label: "Review remarks", text: (c) => c.reviewRemarks ?? "", sort: (c) => c.reviewRemarks ?? null,
      filter: false, render: (c) => <Clip text={c.reviewRemarks} />,
    },
    {
      key: "when", label: tab === "submitted" ? "Submitted" : "Reviewed", filter: false, className: "text-grey",
      text: (c) => fmtStamp(tab === "submitted" ? c.submittedAt : c.reviewedAt), sort: (c) => (tab === "submitted" ? c.submittedAt : c.reviewedAt),
    },
    {
      key: "status", label: "Status", text: (c) => STATUS_LABEL[c.status], sort: (c) => STATUS_LABEL[c.status],
      render: (c) => <StatusPill status={c.status} />,
    },
  ];

  const ctl = useSortFilter(searched, cols, "pv-review");
  const rows = ctl.view;

  const short = rows.filter((c) => (c.difference ?? 0) < 0);
  const extra = rows.filter((c) => (c.difference ?? 0) > 0);
  const sumVal = (list: CountRow[]) => list.reduce((a, c) => a + (diffValue(c.difference, c.closingRate) ?? 0), 0);

  const allPicked = rows.length > 0 && rows.every((c) => picked.has(c.id));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(rows.map((c) => c.id)));
  const chosen = rows.filter((c) => picked.has(c.id));

  /** Remark needed: every item sent back; on accept, only items with a difference. */
  const needsRemark = (c: CountRow, a: Action) => a === "recount" || hasDiff(c);
  const missing = dialog ? chosen.filter((c) => needsRemark(c, dialog) && !(remarks[c.id] ?? "").trim()) : [];

  const submit = async () => {
    if (!dialog || missing.length) return;
    setBusy(true); setNote(null);
    try {
      const ids = chosen.map((c) => c.id);
      const n = await reviewRows(chosen.map((c) => ({ id: c.id, remarks: remarks[c.id] ?? "" })), dialog);
      await qc.invalidateQueries({ queryKey: PV_QUERY });
      const toTally = chosen.filter(hasDiff).length;
      setPicked(new Set());
      setRemarks((r) => { const x = { ...r }; ids.forEach((id) => delete x[id]); return x; });
      setDialog(null);
      setNote({ ok: true, text: dialog === "accept"
        ? `${n} accepted — ${n - toTally} matching closed${toTally ? `, ${toTally} with a difference sent to Post to Tally` : ""}.`
        : `${n} sent back for recount.` });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const exportList = () => exportRowsToXlsx({
    fileName: `Physical_Verification_${tab}`,
    sheetName: STATUS_LABEL[tab as CountStatus],
    title: `Physical Verification — ${company ? companyName(company) : "all companies"}, ${STATUS_LABEL[tab as CountStatus]}`,
    rows,
    notes: ["Closing = Tally's closing stock at the moment the count was saved (frozen).",
      "Difference = Physical − Closing; negative = short, positive = extra. Value = difference × Tally closing rate."],
    columns: [
      { header: "Verification date", width: 14, value: (c) => fmtDate(c.verifyDate) },
      { header: "Company", width: 18, value: (c) => companyName(c.companyGuid) },
      { header: "Stock item", width: 40, value: (c) => c.item },
      { header: "Primary group", width: 18, value: (c) => c.primaryGroup ?? "" },
      { header: "Sub group", width: 22, value: (c) => c.subGroup ?? "" },
      { header: "Stock group", width: 24, value: (c) => c.group ?? "" },
      { header: "Unit", width: 7, value: (c) => c.unit ?? "" },
      { header: "Closing stock", width: 13, value: (c) => c.closingQty ?? "" },
      { header: "Physical stock", width: 13, value: (c) => c.physicalQty ?? "" },
      { header: "Lots counted", width: 30, value: (c) => c.lotCounts.map((l) => `${l.lot}: ${l.qty ?? ""}`).join("; ") },
      { header: "Lots in Tally", width: 30, value: (c) => tallyLots(c).lots.map((l) => `${l.lot}: ${l.qty}`).join("; ") },
      { header: "Difference", width: 12, value: (c) => c.difference ?? "" },
      { header: "Difference value", width: 14, value: (c) => Math.round(diffValue(c.difference, c.closingRate) ?? 0) },
      { header: "Verifier", width: 20, value: (c) => nameOf(c.countedBy ?? c.assignedTo) },
      { header: "Verifier remarks", width: 30, value: (c) => c.verifierRemarks ?? "" },
      { header: "Tally as at", width: 18, value: (c) => fmtStamp(c.tallyAsAt) },
      { header: "Submitted", width: 18, value: (c) => fmtStamp(c.submittedAt) },
      { header: "Review remarks", width: 30, value: (c) => c.reviewRemarks ?? "" },
      { header: "Reviewed", width: 18, value: (c) => fmtStamp(c.reviewedAt) },
    ],
  });

  const T: { v: Tab; label: string }[] = [
    { v: "submitted", label: "Awaiting review" }, { v: "returned", label: "Sent for recount" }, { v: "accepted", label: "Accepted (history)" },
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-5">
      <PageHead
        kicker="Physical Verification · Review"
        title="Review counts"
        sub="Physical vs Tally closing at count time, lot by lot. Matching items close on accept; items with a difference need a remark and go to Post to Tally."
        right={<Button variant="ghost" size="sm" onClick={exportList} disabled={!rows.length}>Export Excel</Button>}
      />
      {pvQ.isError && <PvUnavailable error={pvQ.error} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Items in this list" value={rows.length} />
        <Tile label="Matching" value={rows.length - short.length - extra.length} tone="text-ryg-green" />
        <Tile label={`Short · ${fmtInr(sumVal(short))}`} value={short.length} tone="text-ryg-red" />
        <Tile label={`Extra · ${fmtInr(sumVal(extra))}`} value={extra.length} tone="text-[#B7791F]" />
      </div>

      {canAct && chosen.length > 0 && (
        <Card className="sticky top-2 z-30 flex flex-wrap items-center gap-3 border-orange/40 bg-orange/[0.04] px-4 py-2.5">
          <b className="text-[13px] text-navy">{chosen.length} selected</b>
          <span className="text-[12px] text-grey">
            {chosen.filter((c) => !hasDiff(c)).length} matching · {chosen.filter(hasDiff).length} with a difference
          </span>
          <Button size="sm" onClick={() => setDialog("accept")} disabled={busy}>Accept &amp; submit</Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog("recount")} disabled={busy}>Send for recount</Button>
          <button className="ml-auto text-[12px] text-grey hover:text-navy" onClick={() => setPicked(new Set())}>Clear</button>
        </Card>
      )}
      {note && <div className={cn("text-[12.5px]", note.ok ? "text-ryg-green" : "text-ryg-red")}>{note.text}</div>}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="flex gap-1 rounded-xl bg-page p-1">
            {T.map((t) => (
              <button key={t.v} onClick={() => { setTab(t.v); setPicked(new Set()); }}
                className={cn("rounded-lg px-2.5 py-1 text-[12px] font-semibold",
                  tab === t.v ? "bg-white text-navy shadow-sm ring-1 ring-line" : "text-grey hover:text-navy")}>
                {t.label} <span className="ml-0.5 text-[11px] text-orange tabular-nums">{byTab(t.v).length}</span>
              </button>
            ))}
          </div>
          <select value={company} onChange={(e) => { setCompany(e.target.value); setPicked(new Set()); }}
            className={cn(inputCls, "ml-auto h-8 py-0 text-[12px]")}>
            <option value="">All companies</option>
            {COMPANIES.map((co) => <option key={co.guid} value={co.guid}>{co.name}</option>)}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-grey-2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item or group"
              className={cn(inputCls, "w-56 pl-8")} />
          </div>
          <TableTools cols={cols} ctl={ctl} />
        </div>
        {canAct && rows.length > 0 && (
          <div className="flex items-center border-b border-line px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-navy">
              <input type="checkbox" className="accent-orange" checked={allPicked} onChange={toggleAll} />
              Select all {rows.length} shown
            </label>
          </div>
        )}
        <ActiveFilters ctl={ctl} shown={rows.length} total={searched.length} />

        <div className="max-h-[66vh] overflow-auto">
          <table className="w-full [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20 [&_td]:align-top">
            <SortFilterHead cols={cols} ctl={ctl} />
            <SortFilterBody cols={cols} rows={rows} rowKey={(c) => c.id} empty="Nothing here." ctl={ctl} />
          </table>
        </div>
      </Card>

      <Modal
        open={!!dialog}
        onClose={() => !busy && setDialog(null)}
        size="xl"
        title={dialog === "accept" ? `Accept & submit ${chosen.length} item${chosen.length === 1 ? "" : "s"}` : `Send ${chosen.length} for recount`}
        subtitle={dialog === "accept"
          ? "Matching items close. Items with a difference need a remark and go to Post to Tally."
          : "Say what to recount on each item — the verifier sees it."}
        footer={<>
          {missing.length > 0 && <span className="mr-auto text-[12px] text-ryg-red">{missing.length} remark{missing.length === 1 ? "" : "s"} still needed</span>}
          <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || missing.length > 0}>
            {busy ? "Submitting…" : dialog === "accept" ? "Submit" : "Send back"}
          </Button>
        </>}
      >
        <div className="max-h-[60vh] space-y-2 overflow-auto">
          {dialog && chosen.map((c) => {
            const need = needsRemark(c, dialog);
            return (
              <div key={c.id} className="rounded-lg border border-line p-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                  <b className="text-navy">{c.item}</b>
                  <span className="text-grey">Closing {fmtQty(c.closingQty)} · Physical {fmtQty(c.physicalQty)}</span>
                  <Diff value={c.difference} unit={c.unit} />
                  {dialog === "accept" && (
                    <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      hasDiff(c) ? "bg-orange/10 text-orange" : "bg-ryg-green/10 text-ryg-green")}>
                      {hasDiff(c) ? "→ Post to Tally" : "→ Closed"}
                    </span>
                  )}
                </div>
                <textarea value={remarks[c.id] ?? ""} rows={2}
                  onChange={(e) => setRemarks((r) => ({ ...r, [c.id]: e.target.value }))}
                  placeholder={need ? "Remark (required)" : "Remark (optional)"}
                  className={cn(inputCls, "mt-1.5 h-auto w-full py-1.5",
                    need && !(remarks[c.id] ?? "").trim() && "border-ryg-red/60")} />
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}

/** Long text kept to two lines; the whole of it on hover. */
function Clip({ text }: { text: string | null }) {
  if (!text) return <span className="text-grey-2">—</span>;
  return <div className="line-clamp-2 max-w-[240px] whitespace-normal text-[12px] text-grey" title={text}>{text}</div>;
}

/** The counter's lots and Tally's lots, each with its quantity, and the difference lot by lot. */
function LotTable({ c, tally, loading }: { c: CountRow; tally: { lots: LotClosing[]; live: boolean }; loading: boolean }) {
  if (!c.lotCounts.length && !tally.lots.length) {
    return <span className="text-[11.5px] text-grey-2">{loading ? "Reading Tally lots…" : "No lots counted, none in Tally"}</span>;
  }
  const rows = lotCompare(c.lotCounts, tally.lots);
  const tallySum = tally.lots.reduce((s, l) => s + l.qty, 0);
  const off = c.closingQty !== null && tally.lots.length > 0 && Math.abs(tallySum - c.closingQty) > 0.0005;
  return (
    <div className="min-w-[260px] text-[11.5px]">
      <table className="w-full">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-grey">
            <th className="pr-2 text-left font-semibold">Lot</th>
            <th className="pr-2 text-right font-semibold">Counted</th>
            <th className="pr-2 text-right font-semibold">Tally closing</th>
            <th className="text-right font-semibold">Diff</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lot}>
              <td className="pr-2 font-medium text-navy">{r.lot}</td>
              <td className="pr-2 text-right tabular-nums">{r.counted === null ? <span className="text-grey-2">—</span> : fmtQty(r.counted)}</td>
              <td className="pr-2 text-right tabular-nums text-grey">{r.closing === null ? <span className="text-grey-2">—</span> : fmtQty(r.closing)}</td>
              <td className={cn("text-right font-semibold tabular-nums",
                Math.abs(r.diff) < 0.0005 ? "text-ryg-green" : r.diff < 0 ? "text-ryg-red" : "text-[#B7791F]")}>
                {r.diff > 0 ? "+" : ""}{fmtQty(Math.round(r.diff * 1000) / 1000)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-line font-semibold">
            <td className="pr-2 text-grey">Total</td>
            <td className="pr-2 text-right tabular-nums">{fmtQty(lotTotal(c.lotCounts))}</td>
            <td className="pr-2 text-right tabular-nums text-grey">{fmtQty(tallySum)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      {!c.lotCounts.length && <div className="mt-0.5 text-[10.5px] text-grey">Counted before lot-wise counting — no lots typed.</div>}
      {tally.lots.some((l) => l.lot === NO_LOT) && <div className="mt-0.5 text-[10.5px] text-grey">"(no lot record)" = closing stock Tally holds without a lot (opening stock older than the synced entries).</div>}
      {off && <div className="mt-0.5 text-[10.5px] text-[#B7791F]">Tally's lots add up to {fmtQty(tallySum)}, not its closing {fmtQty(c.closingQty)}.</div>}
    </div>
  );
}
