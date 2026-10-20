import { useBackState } from "@/shared/lib/backState";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { matchesSearch } from "@/shared/lib/search";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { cn } from "@/shared/lib/cn";
import {
  ActiveFilters, QTY_BANDS, qtyBand, SortFilterBody, SortFilterHead, TableTools, useSortFilter, type Col,
} from "@/apps/ink-expiry/components/SortFilterHead";
import { DEFAULT_PRIMARY, fmtDate, fmtInr, fmtQty, fmtStamp, OTEC_SURAT_NAME, type StockItem } from "../lib/stock";
import { canSchedule, PV_QUERY, scheduleItems, STATUS_LABEL, unscheduleItems, usePv, useStock, type CountRow } from "../lib/pv";
import { Diff, inputCls, PageHead, PvUnavailable, StatusPill, Tile } from "../components/parts";

/**
 * MASTER — Otec Surat's items holding stock, with Tally's closing. Opens on PRINTING INK.
 *
 * Every column heading sorts and filters (Excel style); Primary group and Sub group also sit
 * above the table. The admin ticks items, picks a verification date and a verifier, and sets
 * it. On that date the items appear on the verifier's Count page — and nothing else does.
 */

type Filter = "all" | "none" | "scheduled" | "submitted" | "returned" | "accepted";

interface Row {
  s: StockItem;
  open: CountRow | null;
  last: CountRow | null;
}

const statusOf = (r: Row): Filter => r.open?.status ?? (r.last ? "accepted" : "none");
// "No date" = no open round; "Verified" = no open round and a past accepted count.
const inFilter = (r: Row, f: Filter) => f === "all" || (f === "none" ? !r.open : statusOf(r) === f);

const F: { v: Filter; label: string }[] = [
  { v: "all", label: "All" }, { v: "none", label: "No date" }, { v: "scheduled", label: "To count" },
  { v: "submitted", label: "Awaiting review" }, { v: "returned", label: "Recount" }, { v: "accepted", label: "Verified" },
];

const STATUS_TEXT = (r: Row) => (r.open ? STATUS_LABEL[r.open.status] : r.last ? "Verified" : "Not scheduled");

const barFilterCls = "h-8 rounded-lg px-2.5 py-0 text-[12px]";

export default function Master() {
  const { user, isAdmin: admin, canEditModule } = useSession();
  const qc = useQueryClient();
  const stockQ = useStock();
  const pvQ = usePv();
  const pv = pvQ.data;
  // Step 1 rights (Settings), not only admins. Named isAdmin below to keep the checks short.
  const isAdmin = canSchedule(user.id, admin, canEditModule("physical-verification"), pv);
  const people = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 10 * 60_000 });
  const nameOf = (id: string | null | undefined) => (id ? people.data?.find((p) => p.id === id)?.name ?? "—" : "—");

  const [search, setSearch] = useBackState("Master.search", "");
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(todayLocalIso());
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const rows: Row[] = useMemo(() => (stockQ.data ?? []).map((s) => ({
    s, open: pv?.open.get(s.item) ?? null, last: pv?.lastAccepted.get(s.item) ?? null,
  })), [stockQ.data, pv]);
  const searched = useMemo(() => rows.filter((r) =>
    matchesSearch(search, `${r.s.item} ${r.s.primaryGroup} ${r.s.subGroup} ${r.s.group}`)), [rows, search]);

  const toggle = (item: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(item)) n.delete(item); else n.add(item);
    return n;
  });

  const cols: Col<Row>[] = [
    ...(isAdmin ? [{
      key: "pick", label: "✓", filter: false, text: () => "", sort: (r: Row) => (picked.has(r.s.item) ? 0 : 1),
      render: (r: Row) => (
        <input type="checkbox" className="accent-orange" checked={picked.has(r.s.item)} onChange={() => toggle(r.s.item)} />
      ),
    } satisfies Col<Row>] : []),
    { key: "item", label: "Stock item", text: (r) => r.s.item, sort: (r) => r.s.item, className: "font-medium text-navy" },
    { key: "primary", label: "Primary group", text: (r) => r.s.primaryGroup, sort: (r) => r.s.primaryGroup },
    { key: "sub", label: "Sub group", text: (r) => r.s.subGroup, sort: (r) => r.s.subGroup },
    { key: "group", label: "Stock group", text: (r) => r.s.group, sort: (r) => r.s.group, className: "text-grey" },
    { key: "unit", label: "Unit", text: (r) => r.s.unit, sort: (r) => r.s.unit },
    {
      key: "closing", label: "Closing stock", align: "right", text: (r) => fmtQty(r.s.closingQty), sort: (r) => r.s.closingQty,
      bucket: (r) => qtyBand(r.s.closingQty), bucketOrder: QTY_BANDS, className: "tabular-nums",
    },
    {
      key: "value", label: "Value", align: "right", text: (r) => fmtInr(r.s.closingValue), sort: (r) => r.s.closingValue,
      filter: false, className: "tabular-nums text-grey",
    },
    {
      key: "date", label: "Verification date", text: (r) => (r.open ? fmtDate(r.open.verifyDate) : ""),
      sort: (r) => r.open?.verifyDate ?? null, className: "font-semibold",
    },
    { key: "verifier", label: "Verifier", text: (r) => (r.open ? nameOf(r.open.assignedTo) : ""), sort: (r) => (r.open ? nameOf(r.open.assignedTo) : null) },
    {
      key: "status", label: "Status", text: STATUS_TEXT, sort: STATUS_TEXT,
      render: (r) => (r.open || !r.last ? <StatusPill status={r.open?.status ?? null} /> : <StatusPill status="accepted" />),
    },
    {
      key: "last", label: "Last verified", text: (r) => (r.last ? fmtDate(r.last.verifyDate) : ""), sort: (r) => r.last?.verifyDate ?? null,
      render: (r) => (r.last
        ? <span className="text-[12px]">{fmtDate(r.last.verifyDate)} · <Diff value={r.last.difference} /></span>
        : <span className="text-grey-2">—</span>),
    },
  ];

  const ctl = useSortFilter(searched, cols, "pv-master");

  // Open on Printing Ink — once the list has loaded, and only if the reader has not chosen.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || !rows.length) return;
    if (rows.some((r) => r.s.primaryGroup === DEFAULT_PRIMARY)) ctl.setFilters((f) => ({ ...f, primary: [DEFAULT_PRIMARY] }));
    setSeeded(true);
  }, [rows, seeded, ctl]);

  // Column filters first, then the status tabs — so each tab's count is of what the filters leave.
  const shown = useMemo(() => ctl.view.filter((r) => inFilter(r, filter)), [ctl.view, filter]);
  const count = (f: Filter) => ctl.view.filter((r) => inFilter(r, f)).length;

  const totalQty = shown.reduce((a, r) => a + r.s.closingQty, 0);
  const totalVal = shown.reduce((a, r) => a + r.s.closingValue, 0);
  const units = [...new Set(shown.map((r) => r.s.unit))];
  const asAt = rows.reduce<string | null>((a, r) => (r.s.builtAt && (!a || r.s.builtAt > a) ? r.s.builtAt : a), null);

  /** Options for a bar filter: the same cascading list the column heading shows. */
  const optionsFor = (key: string) => {
    const c = cols.find((x) => x.key === key);
    return c ? ctl.options(c) : [];
  };
  const setColFilter = (key: string, v: string[]) => ctl.setFilters((f) => ({ ...f, [key]: v }));

  const verifierOpts = (pv?.verifiers ?? []).map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name));
  const who = assignee || (verifierOpts.length === 1 ? verifierOpts[0].id : "");

  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.s.item));
  const toggleAll = () => setPicked((p) => {
    const n = new Set(p);
    if (allShownPicked) shown.forEach((r) => n.delete(r.s.item)); else shown.forEach((r) => n.add(r.s.item));
    return n;
  });

  const pickedRows = rows.filter((r) => picked.has(r.s.item));
  const awaiting = pickedRows.filter((r) => r.open?.status === "submitted").length;
  const removable = pickedRows.filter((r) => r.open?.status === "scheduled");

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setNote(null);
    try {
      const text = await fn();
      await qc.invalidateQueries({ queryKey: PV_QUERY });
      setPicked(new Set());
      setNote({ ok: true, text });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const setDates = () => run(async () => {
    const n = await scheduleItems(pickedRows.map((r) => r.s), date, who);
    const skipped = pickedRows.length - n;
    return `${n} item${n === 1 ? "" : "s"} set for ${fmtDate(date)} — ${nameOf(who)}.` +
      (skipped ? ` ${skipped} skipped: their count is awaiting your review.` : "");
  });

  const removeDates = () => run(async () => {
    const n = await unscheduleItems(removable.map((r) => r.open!.id));
    return `Date removed from ${n} item${n === 1 ? "" : "s"}.`;
  });

  const exportList = () => exportRowsToXlsx({
    fileName: "Physical_Verification_Master",
    sheetName: "Master",
    title: `Physical Verification — ${OTEC_SURAT_NAME} master`,
    rows: shown,
    filters: [
      ...Object.entries(ctl.filters).filter(([, v]) => v.length)
        .map(([k, v]) => `${cols.find((c) => c.key === k)?.label ?? k}: ${v.join(", ")}`),
      filter !== "all" ? `Status: ${F.find((f) => f.v === filter)?.label}` : "",
      search ? `Search: ${search}` : "",
    ].filter(Boolean),
    notes: [`Closing stock is Tally's, as at ${fmtStamp(asAt)} (ConnectWave sync).`, "Provision Ink groups and items without stock are left out."],
    columns: [
      { header: "Stock item", width: 40, value: (r) => r.s.item },
      { header: "Primary group", width: 20, value: (r) => r.s.primaryGroup },
      { header: "Sub group", width: 22, value: (r) => r.s.subGroup },
      { header: "Stock group", width: 26, value: (r) => r.s.group },
      { header: "Unit", width: 7, value: (r) => r.s.unit },
      { header: "Closing stock", width: 13, value: (r) => r.s.closingQty },
      { header: "Closing value", width: 14, value: (r) => Math.round(r.s.closingValue) },
      { header: "Verification date", width: 14, value: (r) => (r.open ? fmtDate(r.open.verifyDate) : "") },
      { header: "Verifier", width: 20, value: (r) => (r.open ? nameOf(r.open.assignedTo) : "") },
      { header: "Status", width: 15, value: STATUS_TEXT },
      { header: "Last verified", width: 13, value: (r) => (r.last ? fmtDate(r.last.verifyDate) : "") },
      { header: "Last difference", width: 13, value: (r) => r.last?.difference ?? "" },
    ],
  });

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-5">
      <PageHead
        kicker="Physical Verification · Master"
        title={`${OTEC_SURAT_NAME} — stock master`}
        sub={<>Items holding closing stock in Tally, as at <b>{fmtStamp(asAt)}</b>. Filter, tick items, set the verification date and verifier.</>}
        right={<Button variant="ghost" size="sm" onClick={exportList} disabled={!shown.length}>Export Excel</Button>}
      />

      {pvQ.isError && <PvUnavailable error={pvQ.error} />}
      {stockQ.isError && <Card className="p-4 text-[13px] text-ryg-red">Could not read Tally stock: {(stockQ.error as Error).message}</Card>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Items shown" value={shown.length.toLocaleString("en-IN")} />
        <Tile label="Closing stock" value={units.length === 1 ? `${fmtQty(Math.round(totalQty))} ${units[0]}` : `${units.length} units`} />
        <Tile label="Closing value" value={fmtInr(totalVal)} />
        <Tile label="To count / awaiting review" value={`${count("scheduled") + count("returned")} / ${count("submitted")}`} />
      </div>

      {isAdmin && picked.size > 0 && (
        <Card className="sticky top-2 z-30 flex flex-wrap items-center gap-3 border-orange/40 bg-orange/[0.04] px-4 py-2.5">
          <b className="text-[13px] text-navy">{picked.size} selected</b>
          <label className="flex items-center gap-1.5 text-[12px] text-grey">
            Verification date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-grey">
            Verifier
            <select value={who} onChange={(e) => setAssignee(e.target.value)} className={inputCls}>
              <option value="">{verifierOpts.length ? "Pick…" : "Add a verifier in Settings"}</option>
              {verifierOpts.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <Button size="sm" onClick={setDates} disabled={busy || !date || !who || !!pvQ.isError}>
            {busy ? "Saving…" : "Set date"}
          </Button>
          {removable.length > 0 && (
            <Button size="sm" variant="ghost" onClick={removeDates} disabled={busy}>
              Remove date ({removable.length})
            </Button>
          )}
          {awaiting > 0 && <span className="text-[11.5px] text-grey">{awaiting} awaiting review will be skipped.</span>}
          <button className="ml-auto text-[12px] text-grey hover:text-navy" onClick={() => setPicked(new Set())}>Clear</button>
        </Card>
      )}
      {note && <div className={cn("text-[12.5px]", note.ok ? "text-ryg-green" : "text-ryg-red")}>{note.text}</div>}

      <Card className="overflow-hidden">
        {/* Filter bar: Primary / Sub group drive the SAME filters as their column headings. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-grey">Primary group</span>
          <MultiSelect values={ctl.filters.primary ?? []} onChange={(v) => setColFilter("primary", v)}
            options={optionsFor("primary")} placeholder="All" searchable className="w-52" triggerClassName={barFilterCls} />
          <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-grey">Sub group</span>
          <MultiSelect values={ctl.filters.sub ?? []} onChange={(v) => setColFilter("sub", v)}
            options={optionsFor("sub")} placeholder="All" searchable className="w-52" triggerClassName={barFilterCls} />
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-grey-2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item or group"
              className={cn(inputCls, "w-60 pl-8")} />
          </div>
          <TableTools cols={cols} ctl={ctl} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="flex flex-wrap gap-1 rounded-xl bg-page p-1">
            {F.map((f) => (
              <button key={f.v} onClick={() => setFilter(f.v)}
                className={cn("rounded-lg px-2.5 py-1 text-[12px] font-semibold",
                  filter === f.v ? "bg-white text-navy shadow-sm ring-1 ring-line" : "text-grey hover:text-navy")}>
                {f.label} <span className="ml-0.5 text-[11px] text-orange tabular-nums">{count(f.v)}</span>
              </button>
            ))}
          </div>
          {isAdmin && shown.length > 0 && (
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-navy">
              <input type="checkbox" className="accent-orange" checked={allShownPicked} onChange={toggleAll} />
              Select all {shown.length.toLocaleString("en-IN")} shown
            </label>
          )}
        </div>
        <ActiveFilters ctl={ctl} shown={shown.length} total={rows.length} />

        {stockQ.isLoading ? (
          <div className="p-12 text-center text-[13px] text-grey">Reading closing stock from Tally (ConnectWave)…</div>
        ) : (
          <div className="max-h-[66vh] overflow-auto">
            <table className="w-full [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20">
              <SortFilterHead cols={cols} ctl={ctl} />
              <SortFilterBody cols={cols} rows={shown} rowKey={(r) => r.s.item} empty="No items match." ctl={ctl} />
            </table>
          </div>
        )}
      </Card>
      {!isAdmin && <div className="text-[12px] text-grey">Only the step 1 people in Settings can set verification dates.</div>}
    </div>
  );
}
