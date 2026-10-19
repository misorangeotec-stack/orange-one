import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { matchesSearch } from "@/shared/lib/search";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { cn } from "@/shared/lib/cn";
import { COMPANIES, companyName, fmtDate, fmtInr, fmtQty, fmtStamp } from "../lib/stock";
import { canReview, diffValue, PV_QUERY, reviewCounts, STATUS_LABEL, usePv, type CountRow, type CountStatus } from "../lib/pv";
import { Diff, inputCls, PageHead, PvUnavailable, StatusPill, tdCls, thCls, Tile } from "../components/parts";

/**
 * REVIEW — the admin's side. Submitted counts arrive here with their difference against the
 * Tally closing frozen at count time. Accept closes the round; Recount sends it back to the
 * verifier with a reason. "History" is every round ever counted, for export.
 */

type Tab = "submitted" | "returned" | "accepted";

export default function Review() {
  const { user, isAdmin: admin, canEditModule } = useSession();
  const qc = useQueryClient();
  const pvQ = usePv();
  // Step 3 rights (Settings). Named isAdmin to keep the checks below short.
  const isAdmin = canReview(user.id, admin, canEditModule("physical-verification"), pvQ.data);
  const people = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 10 * 60_000 });
  const nameOf = (id: string | null | undefined) => (id ? people.data?.find((p) => p.id === id)?.name ?? "—" : "—");

  const [tab, setTab] = useState<Tab>("submitted");
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const allCounts = pvQ.data?.counts ?? [];
  const counts = useMemo(() => (company ? allCounts.filter((c) => c.companyGuid === company) : allCounts), [allCounts, company]);
  const multiCompany = new Set(allCounts.map((c) => c.companyGuid)).size > 1;
  const byTab = (t: Tab) => counts.filter((c) => c.status === t);
  const rows = useMemo(() => counts
    .filter((c) => c.status === tab && matchesSearch(search, `${c.item} ${c.subGroup ?? ""} ${c.group ?? ""}`))
    .sort((a, b) => (b.submittedAt ?? b.reviewedAt ?? "").localeCompare(a.submittedAt ?? a.reviewedAt ?? "")),
  [counts, tab, search]);

  const short = rows.filter((c) => (c.difference ?? 0) < 0);
  const extra = rows.filter((c) => (c.difference ?? 0) > 0);
  const sumVal = (list: CountRow[]) => list.reduce((a, c) => a + (diffValue(c.difference, c.closingRate) ?? 0), 0);

  const allPicked = rows.length > 0 && rows.every((c) => picked.has(c.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(rows.map((c) => c.id)));
  const ids = rows.filter((c) => picked.has(c.id)).map((c) => c.id);

  const act = async (action: "accept" | "recount") => {
    if (action === "recount" && !reason.trim()) { setNote({ ok: false, text: "Write why it needs a recount." }); return; }
    setBusy(true); setNote(null);
    try {
      const n = await reviewCounts(ids, action, reason);
      await qc.invalidateQueries({ queryKey: PV_QUERY });
      setPicked(new Set()); setReason("");
      setNote({ ok: true, text: action === "accept" ? `${n} accepted.` : `${n} sent back for recount.` });
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
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-5">
      <PageHead
        kicker="Physical Verification · Review"
        title="Review counts"
        sub="Physical vs Tally closing at count time. Accept closes it; Recount sends it back to the verifier."
        right={<Button variant="ghost" size="sm" onClick={exportList} disabled={!rows.length}>Export Excel</Button>}
      />
      {pvQ.isError && <PvUnavailable error={pvQ.error} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Items in this list" value={rows.length} />
        <Tile label="Matching" value={rows.length - short.length - extra.length} tone="text-ryg-green" />
        <Tile label={`Short · ${fmtInr(sumVal(short))}`} value={short.length} tone="text-ryg-red" />
        <Tile label={`Extra · ${fmtInr(sumVal(extra))}`} value={extra.length} tone="text-[#B7791F]" />
      </div>

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
          {isAdmin && tab === "submitted" && ids.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-[12.5px] text-navy">{ids.length} selected</b>
              <Button size="sm" onClick={() => act("accept")} disabled={busy}>Accept</Button>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for recount"
                className={cn(inputCls, "w-56")} />
              <Button size="sm" variant="ghost" onClick={() => act("recount")} disabled={busy}>Send for recount</Button>
            </div>
          )}
          {note && <span className={cn("text-[12.5px]", note.ok ? "text-ryg-green" : "text-ryg-red")}>{note.text}</span>}
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
        </div>

        <div className="max-h-[66vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                {isAdmin && tab === "submitted" && (
                  <th className={cn(thCls, "w-8")}>
                    <input type="checkbox" className="accent-orange" checked={allPicked} onChange={toggleAll} />
                  </th>
                )}
                <th className={thCls}>Date</th>
                <th className={thCls}>Stock item</th>
                <th className={thCls}>Unit</th>
                <th className={cn(thCls, "text-right")}>Closing</th>
                <th className={cn(thCls, "text-right")}>Physical</th>
                <th className={cn(thCls, "text-right")}>Difference</th>
                <th className={cn(thCls, "text-right")}>Value</th>
                <th className={thCls}>Verifier</th>
                <th className={thCls}>Remarks</th>
                <th className={thCls}>{tab === "submitted" ? "Submitted" : "Reviewed"}</th>
                <th className={thCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={cn(picked.has(c.id) ? "bg-orange/[0.06]" : "hover:bg-page/60")}>
                  {isAdmin && tab === "submitted" && (
                    <td className={tdCls}><input type="checkbox" className="accent-orange" checked={picked.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  )}
                  <td className={tdCls}>{fmtDate(c.verifyDate)}</td>
                  <td className={cn(tdCls, "whitespace-normal")}>
                    <div className="font-medium text-navy">{c.item}</div>
                    <div className="text-[11px] text-grey">{[multiCompany ? companyName(c.companyGuid) : null, c.subGroup, c.group].filter((g, i, a) => g && a.indexOf(g) === i).join(" · ")}</div>
                  </td>
                  <td className={tdCls}>{c.unit}</td>
                  <td className={cn(tdCls, "text-right tabular-nums")} title={`Tally as at ${fmtStamp(c.tallyAsAt)}`}>{fmtQty(c.closingQty)}</td>
                  <td className={cn(tdCls, "text-right tabular-nums font-semibold")}>{fmtQty(c.physicalQty)}</td>
                  <td className={cn(tdCls, "text-right")}><Diff value={c.difference} /></td>
                  <td className={cn(tdCls, "text-right tabular-nums text-grey")}>{fmtInr(diffValue(c.difference, c.closingRate))}</td>
                  <td className={tdCls}>{nameOf(c.countedBy ?? c.assignedTo)}</td>
                  <td className={cn(tdCls, "max-w-[260px] whitespace-normal text-grey")}>
                    {c.verifierRemarks}
                    {c.reviewRemarks && <div className="text-[11.5px] text-ryg-red">Admin: {c.reviewRemarks}</div>}
                  </td>
                  <td className={cn(tdCls, "text-grey")}>{fmtStamp(tab === "submitted" ? c.submittedAt : c.reviewedAt)}</td>
                  <td className={tdCls}><StatusPill status={c.status} /></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={12} className="p-10 text-center text-[13px] text-grey">Nothing here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
