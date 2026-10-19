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
import {
  COMPANIES, companyName, DEFAULT_PRIMARY, fmtDate, fmtInr, fmtQty, fmtStamp, itemKey, OTEC_SURAT_GUID, type StockItem,
} from "../lib/stock";
import { canSchedule, PV_QUERY, scheduleItems, STATUS_LABEL, unscheduleItems, usePv, useStock, type CountRow } from "../lib/pv";
import { centralLink, CENTRAL_QUERY, saveCentralField, useCentral } from "../lib/central";
import type { ImsLink } from "@/apps/bushra-central-master/lib/imsLink";
import { Diff, inputCls, PageHead, PvUnavailable, StatusPill, Tile } from "../components/parts";

/**
 * MASTER — one company's items holding stock, with Tally's closing. Opens on PRINTING INK.
 *
 * COMPANY (asked 19-10-2026): a picker beside Sub group switches between Otec Surat, Otec
 * Noida, Enterprises Surat and Enterprises Noida. One company at a time — each is its own
 * Tally book — and the choice is remembered in this browser.
 *
 * Every column heading sorts and filters (Excel style); Primary group and Sub group also sit
 * above the table. The admin ticks items, picks a verification date and a verifier, and sets
 * it. On that date the items appear on the verifier's Count page — and nothing else does.
 *
 * LINE BY LINE TOO (asked 17-10-2026): the Verification date and Verifier cells are boxes, so
 * one item can be given its own date without ticking it. Ticking + "Set date" still works.
 * Central group / Central category come from Bushra Central Master and save back into it;
 * both are also filters in the bar, so a category can be picked and dated in one go.
 */

type Filter = "all" | "none" | "scheduled" | "submitted" | "returned" | "accepted";

interface Row {
  s: StockItem;
  open: CountRow | null;
  last: CountRow | null;
  /** The item's Bushra Central Master row; missing when Central Masters does not carry it. */
  link: ImsLink | undefined;
}

/** A date the picker is still being typed into (year 0002, 0020 …) is not a date yet. */
const isWholeDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000;

const statusOf = (r: Row): Filter => r.open?.status ?? (r.last ? "accepted" : "none");
// "No date" = no open round; "Verified" = no open round and a past accepted count.
const inFilter = (r: Row, f: Filter) => f === "all" || (f === "none" ? !r.open : statusOf(r) === f);

const F: { v: Filter; label: string }[] = [
  { v: "all", label: "All" }, { v: "none", label: "No date" }, { v: "scheduled", label: "To count" },
  { v: "submitted", label: "Awaiting review" }, { v: "returned", label: "Recount" }, { v: "accepted", label: "Verified" },
];

const STATUS_TEXT = (r: Row) => (r.open ? STATUS_LABEL[r.open.status] : r.last ? "Verified" : "Not scheduled");

const barFilterCls = "h-8 rounded-lg px-2.5 py-0 text-[12px]";
const barLabelCls = "text-[11px] font-semibold uppercase tracking-wide text-grey";

const COMPANY_KEY = "physical-verification:company";
const readCompany = () => {
  try {
    const v = localStorage.getItem(COMPANY_KEY);
    return COMPANIES.some((c) => c.guid === v) ? v! : OTEC_SURAT_GUID;
  } catch { return OTEC_SURAT_GUID; }
};
const cellInputCls = cn(inputCls, "h-7 px-1.5 text-[12px]");

/** A line's date box: saves as soon as a whole date is picked; clearing it and leaving removes the date. */
function LineDate({ saved, disabled, title, onCommit }: {
  saved: string; disabled: boolean; title: string; onCommit: (d: string) => void;
}) {
  const [v, setV] = useState(saved);
  useEffect(() => setV(saved), [saved]);
  return (
    <input type="date" value={v} disabled={disabled} title={title}
      onChange={(e) => { setV(e.target.value); if (isWholeDate(e.target.value)) onCommit(e.target.value); }}
      onBlur={() => { if (!v) { if (saved) onCommit(""); } else if (!isWholeDate(v)) setV(saved); }}
      className={cn(cellInputCls, "w-[130px]", !v && "text-grey-2")} />
  );
}

/** A Bushra Central Master field: a box for its editors (saves on Enter / leaving it), text for everyone else. */
function CentralCell({ saved, linked, canEdit, disabled, list, onSave }: {
  saved: string; linked: boolean; canEdit: boolean; disabled: boolean; list: string; onSave: (v: string) => void;
}) {
  const [v, setV] = useState(saved);
  useEffect(() => setV(saved), [saved]);
  if (!linked) return <span className="text-[11.5px] text-grey-2" title="This item is not in Central Masters">Not in Central</span>;
  if (!canEdit) return <span>{saved || <span className="text-grey-2">—</span>}</span>;
  return (
    <input value={v} list={list} disabled={disabled} placeholder="—"
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setV(saved);
      }}
      // Blank is not saved — the box goes back to Central's value.
      onBlur={() => { if (!v.trim()) setV(saved); else if (v.trim() !== saved.trim()) onSave(v); }}
      className={cn(cellInputCls, "w-full min-w-[120px]")} />
  );
}

export default function Master() {
  const { user, isAdmin: admin, canEditModule } = useSession();
  const qc = useQueryClient();
  const [company, setCompany] = useState(readCompany);
  const stockQ = useStock(company);
  const pvQ = usePv();
  const pv = pvQ.data;
  // Step 1 rights (Settings), not only admins. Named isAdmin below to keep the checks short.
  const isAdmin = canSchedule(user.id, admin, canEditModule("physical-verification"), pv);
  const centralQ = useCentral();
  const canEditCentral = (admin || canEditModule("bushra-central-master")) && (centralQ.data?.canSave ?? false);
  const people = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 10 * 60_000 });
  const nameOf = (id: string | null | undefined) => (id ? people.data?.find((p) => p.id === id)?.name ?? "—" : "—");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(todayLocalIso());
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const rows: Row[] = useMemo(() => (stockQ.data ?? []).map((s) => ({
    s, open: pv?.open.get(itemKey(s.companyGuid, s.item)) ?? null, last: pv?.lastAccepted.get(itemKey(s.companyGuid, s.item)) ?? null,
    link: centralLink(centralQ.data?.byKey, s.companyGuid, s.item),
  })), [stockQ.data, pv, centralQ.data]);
  const searched = useMemo(() => rows.filter((r) => matchesSearch(search,
    `${r.s.item} ${r.s.primaryGroup} ${r.s.subGroup} ${r.s.group} ${r.link?.values.groupName ?? ""} ${r.link?.values.category ?? ""}`)),
  [rows, search]);

  // Suggestion lists for the two Central boxes.
  const centralGroups = useMemo(() => [...new Set([...(centralQ.data?.byKey.values() ?? [])]
    .map((l) => l.values.groupName.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [centralQ.data]);
  const centralCats = centralQ.data?.categories ?? [];

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
    {
      key: "cgroup", label: "Central group", text: (r) => r.link?.values.groupName ?? "", sort: (r) => r.link?.values.groupName || null,
      render: (r) => centralCell(r, "groupName", "pv-central-groups"),
    },
    {
      key: "ccat", label: "Central category", text: (r) => r.link?.values.category ?? "", sort: (r) => r.link?.values.category || null,
      render: (r) => centralCell(r, "category", "pv-central-cats"),
    },
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
      render: (r) => (lineEditable(r)
        ? (
          <LineDate saved={r.open?.verifyDate.slice(0, 10) ?? ""} disabled={lineBusy.has(r.s.item)} onCommit={(d) => setLineDate(r, d)}
            title={r.open?.status === "returned" ? "Sent back for recount — a new date re-schedules the recount." : "Pick a date to schedule this item"} />
        )
        : <span>{r.open ? fmtDate(r.open.verifyDate) : ""}</span>),
    },
    {
      key: "verifier", label: "Verifier", text: (r) => (r.open ? nameOf(r.open.assignedTo) : ""), sort: (r) => (r.open ? nameOf(r.open.assignedTo) : null),
      render: (r) => (lineEditable(r)
        ? (
          <select value={lineWho(r)} disabled={lineBusy.has(r.s.item)} onChange={(e) => setLineVerifier(r, e.target.value)}
            className={cn(cellInputCls, "w-full min-w-[110px]")}>
            <option value="">{verifierOpts.length ? "Pick…" : "Add in Settings"}</option>
            {verifierOpts.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )
        : <span>{r.open ? nameOf(r.open.assignedTo) : ""}</span>),
    },
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
    if (seeded || !rows.length || stockQ.isFetching) return;
    if (rows.some((r) => r.s.primaryGroup === DEFAULT_PRIMARY)) ctl.setFilters((f) => ({ ...f, primary: [DEFAULT_PRIMARY] }));
    setSeeded(true);
  }, [rows, seeded, ctl, stockQ.isFetching]);

  /** Another company is another list: ticks, line picks and filters start again (on Printing Ink). */
  function switchCompany(guid: string) {
    if (guid === company) return;
    setCompany(guid);
    try { localStorage.setItem(COMPANY_KEY, guid); } catch { /* this visit only */ }
    setPicked(new Set());
    setLineAssignee({});
    setNote(null);
    ctl.setFilters({});
    setSeeded(false);
  }

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

  /* ---------------------------------------------------------- line by line -- */

  const [lineBusy, setLineBusy] = useState<Set<string>>(new Set());
  /** Verifier picked on a line that has no date yet — used when its date is set. */
  const [lineAssignee, setLineAssignee] = useState<Record<string, string>>({});
  // A count awaiting review is the reviewer's; the database skips it, so no boxes are offered.
  function lineEditable(r: Row) { return isAdmin && r.open?.status !== "submitted"; }
  function lineWho(r: Row) { return r.open?.assignedTo ?? lineAssignee[r.s.item] ?? who; }

  async function runLine(r: Row, fn: () => Promise<string>) {
    setLineBusy((b) => new Set(b).add(r.s.item)); setNote(null);
    try {
      const text = await fn();
      await qc.invalidateQueries({ queryKey: PV_QUERY });
      setNote({ ok: true, text });
    } catch (e) {
      setNote({ ok: false, text: `${r.s.item}: ${(e as Error).message}` });
    } finally {
      setLineBusy((b) => { const n = new Set(b); n.delete(r.s.item); return n; });
    }
  }

  function setLineDate(r: Row, d: string) {
    if (d === (r.open?.verifyDate.slice(0, 10) ?? "")) return;
    if (!d) {
      if (r.open?.status !== "scheduled") return;
      void runLine(r, async () => { await unscheduleItems([r.open!.id]); return `Date removed from ${r.s.item}.`; });
      return;
    }
    const v = lineWho(r);
    if (!v) { setNote({ ok: false, text: `${r.s.item}: pick the verifier on that line first.` }); return; }
    void runLine(r, async () => {
      const n = await scheduleItems([r.s], d, v);
      return n ? `${r.s.item} set for ${fmtDate(d)} — ${nameOf(v)}.` : `${r.s.item} skipped: its count is awaiting review.`;
    });
  }

  function setLineVerifier(r: Row, v: string) {
    if (!r.open) { setLineAssignee((a) => ({ ...a, [r.s.item]: v })); return; }
    if (!v || v === r.open.assignedTo) return;
    const d = r.open.verifyDate.slice(0, 10);
    void runLine(r, async () => { await scheduleItems([r.s], d, v); return `${r.s.item} now with ${nameOf(v)}.`; });
  }

  /* ------------------------------------------------- Bushra Central Master -- */

  const [centralBusy, setCentralBusy] = useState<string | null>(null);
  async function saveCentral(r: Row, field: "groupName" | "category", value: string) {
    if (!r.link) return;
    setCentralBusy(r.s.item); setNote(null);
    try {
      await saveCentralField(r.link, field, value, user.id);
      await qc.invalidateQueries({ queryKey: CENTRAL_QUERY });
      setNote({ ok: true, text: `${r.s.item}: ${field === "groupName" ? "group" : "category"} saved in Bushra Central Master.` });
    } catch (e) {
      setNote({ ok: false, text: `${r.s.item}: ${(e as Error).message}` });
    } finally {
      setCentralBusy(null);
    }
  }
  function centralCell(r: Row, field: "groupName" | "category", list: string) {
    return (
      <CentralCell saved={r.link?.values[field] ?? ""} linked={!!r.link} canEdit={canEditCentral}
        disabled={centralBusy === r.s.item} list={list} onSave={(v) => void saveCentral(r, field, v)} />
    );
  }

  const exportList = () => exportRowsToXlsx({
    fileName: "Physical_Verification_Master",
    sheetName: "Master",
    title: `Physical Verification — ${companyName(company)} master`,
    rows: shown,
    filters: [
      ...Object.entries(ctl.filters).filter(([, v]) => v.length)
        .map(([k, v]) => `${cols.find((c) => c.key === k)?.label ?? k}: ${v.join(", ")}`),
      filter !== "all" ? `Status: ${F.find((f) => f.v === filter)?.label}` : "",
      search ? `Search: ${search}` : "",
    ].filter(Boolean),
    notes: [`Closing stock is Tally's, as at ${fmtStamp(asAt)} (ConnectWave sync).`, "Provision Ink groups and items without stock are left out."],
    columns: [
      { header: "Company", width: 18, value: () => companyName(company) },
      { header: "Stock item", width: 40, value: (r) => r.s.item },
      { header: "Central group", width: 22, value: (r) => r.link?.values.groupName ?? "" },
      { header: "Central category", width: 22, value: (r) => r.link?.values.category ?? "" },
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
        title={`${companyName(company)} — stock master`}
        sub={<>Items holding closing stock in Tally, as at <b>{fmtStamp(asAt)}</b>. Pick a date on any line, or tick items and set one date for all of them.</>}
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
      {centralQ.data?.note && <div className="text-[12px] text-[#B7791F]">{centralQ.data.note}</div>}
      <datalist id="pv-central-groups">{centralGroups.map((g) => <option key={g} value={g} />)}</datalist>
      <datalist id="pv-central-cats">{centralCats.map((c) => <option key={c} value={c} />)}</datalist>
      {note && <div className={cn("text-[12.5px]", note.ok ? "text-ryg-green" : "text-ryg-red")}>{note.text}</div>}

      <Card className="overflow-hidden">
        {/* Filter bar: Primary / Sub group drive the SAME filters as their column headings. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <span className={barLabelCls}>Primary group</span>
          <MultiSelect values={ctl.filters.primary ?? []} onChange={(v) => setColFilter("primary", v)}
            options={optionsFor("primary")} placeholder="All" searchable className="w-52" triggerClassName={barFilterCls} />
          <span className={cn(barLabelCls, "ml-2")}>Sub group</span>
          <MultiSelect values={ctl.filters.sub ?? []} onChange={(v) => setColFilter("sub", v)}
            options={optionsFor("sub")} placeholder="All" searchable className="w-52" triggerClassName={barFilterCls} />
          <span className={cn(barLabelCls, "ml-2")}>Company</span>
          <select value={company} onChange={(e) => switchCompany(e.target.value)} disabled={busy}
            className={cn(inputCls, "h-8 w-44 py-0 text-[12px] font-semibold text-navy")}>
            {COMPANIES.map((c) => <option key={c.guid} value={c.guid}>{c.name}</option>)}
          </select>
        </div>
        {/* Bushra Central Master's own group / category — the same filters as those column headings. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <span className={barLabelCls}>Central group</span>
          <MultiSelect values={ctl.filters.cgroup ?? []} onChange={(v) => setColFilter("cgroup", v)}
            options={optionsFor("cgroup")} placeholder="All" searchable className="w-52" triggerClassName={barFilterCls} />
          <span className={cn(barLabelCls, "ml-2")}>Central category</span>
          <MultiSelect values={ctl.filters.ccat ?? []} onChange={(v) => setColFilter("ccat", v)}
            options={optionsFor("ccat")} placeholder="All" searchable className="w-52" triggerClassName={barFilterCls} />
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
