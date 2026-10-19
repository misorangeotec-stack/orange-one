import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownLeft } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { cn } from "@/shared/lib/cn";
import { companyName, fmtDate, fmtQty, fmtStamp, itemKey } from "../lib/stock";
import { PV_QUERY, saveCounts, STATUS_LABEL, usePv, useStocks, type CountRow } from "../lib/pv";
import { Diff, inputCls, PageHead, PvUnavailable, StatusPill, tdCls, thCls } from "../components/parts";

/**
 * COUNT — the verifier's page.
 *
 * Shows ONLY the items the admin scheduled for this person whose verification date has come
 * (and anything sent back for a recount). The verifier types the physical stock; Difference =
 * Physical − Closing works itself out. Save keeps a draft; Submit sends the counted rows to
 * the admin. Each save freezes Tally's closing of that moment on the row.
 *
 * Admins see every verifier's due items, with a picker to narrow to one.
 *
 * The rows can come from any of the four companies; each reads its own company's closing.
 */

interface Draft { qty: string; remarks: string }

const parseQty = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export default function Count() {
  const { user, isAdmin, canEditModule } = useSession();
  const qc = useQueryClient();
  const pvQ = usePv();
  const people = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 10 * 60_000 });
  const nameOf = (id: string | null | undefined) => (id ? people.data?.find((p) => p.id === id)?.name ?? "—" : "—");
  const today = todayLocalIso();
  const mayEdit = isAdmin || canEditModule("physical-verification");

  const [who, setWho] = useState<string>(isAdmin ? "" : user.id);
  const [tab, setTab] = useState<"todo" | "done">("todo");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const counts = pvQ.data?.counts ?? [];
  // Closing stock only for the companies that have rows still to count.
  const stock = useStocks(counts.filter((c) => c.status === "scheduled" || c.status === "returned").map((c) => c.companyGuid));
  const multiCompany = new Set(counts.map((c) => c.companyGuid)).size > 1;
  const mine = (c: CountRow) => (who ? c.assignedTo === who : isAdmin || c.assignedTo === user.id);

  const due = useMemo(() => counts
    .filter((c) => mine(c) && (c.status === "scheduled" || c.status === "returned") && c.verifyDate <= today)
    .sort((a, b) => (a.status === "returned" ? 0 : 1) - (b.status === "returned" ? 0 : 1) ||
      a.verifyDate.localeCompare(b.verifyDate) || a.companyGuid.localeCompare(b.companyGuid) || a.item.localeCompare(b.item)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [counts, who, today, user.id, isAdmin]);
  const later = counts.filter((c) => mine(c) && c.status === "scheduled" && c.verifyDate > today);
  const done = useMemo(() => counts
    .filter((c) => mine(c) && (c.status === "submitted" || c.status === "accepted"))
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [counts, who, user.id, isAdmin]);

  // Seed the boxes from what is already saved on each row.
  useEffect(() => {
    setDrafts((d) => {
      const n = { ...d };
      for (const c of due) {
        if (!n[c.id]) n[c.id] = { qty: c.physicalQty === null ? "" : String(c.physicalQty), remarks: c.verifierRemarks ?? "" };
      }
      return n;
    });
  }, [due]);

  const draftOf = (c: CountRow): Draft => drafts[c.id] ?? { qty: "", remarks: "" };
  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? { qty: "", remarks: "" }), ...patch } }));

  const liveClosing = (c: CountRow) => stock.by.get(itemKey(c.companyGuid, c.item))?.closingQty ?? (stock.loaded ? 0 : c.closingQty);
  const isDirty = (c: CountRow) => {
    const d = draftOf(c);
    return parseQty(d.qty) !== c.physicalQty || (d.remarks.trim() || null) !== (c.verifierRemarks ?? null);
  };
  const bad = due.filter((c) => Number.isNaN(parseQty(draftOf(c).qty)) || (parseQty(draftOf(c).qty) ?? 0) < 0);
  const dirty = due.filter(isDirty);
  const ready = due.filter((c) => { const q = parseQty(draftOf(c).qty); return q !== null && !Number.isNaN(q) && q >= 0; });

  const run = async (rows: CountRow[], submit: boolean) => {
    if (bad.length) { setNote({ ok: false, text: `Fix the physical stock for ${bad[0].item} — numbers only.` }); return; }
    if (!rows.length) return;
    if (submit && !window.confirm(`Submit ${rows.length} item${rows.length === 1 ? "" : "s"} to the admin? You cannot change them after this.`)) return;
    setBusy(true); setNote(null);
    try {
      // Fresh Tally closing at the moment of saving — that is the figure frozen on the row.
      const by = await stock.refetch();
      const n = await saveCounts(rows.map((c) => ({
        id: c.id, physicalQty: parseQty(draftOf(c).qty), remarks: draftOf(c).remarks, stock: by.get(itemKey(c.companyGuid, c.item)),
      })), submit);
      await qc.invalidateQueries({ queryKey: PV_QUERY });
      if (submit) setDrafts((d) => { const x = { ...d }; rows.forEach((c) => delete x[c.id]); return x; });
      setNote({ ok: true, text: submit ? `${n} item${n === 1 ? "" : "s"} submitted for review.` : `Saved ${n} item${n === 1 ? "" : "s"}.` });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const verifiers = useMemo(() => [...new Set(counts.map((c) => c.assignedTo).filter((id): id is string => !!id))]
    .map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [counts, people.data]);

  const exportSheet = () => exportRowsToXlsx({
    fileName: "Physical_Verification_Count_Sheet",
    sheetName: "Count sheet",
    title: `Physical Verification — ${[...new Set(due.map((c) => companyName(c.companyGuid)))].join(", ")} count sheet`,
    rows: due,
    notes: ["Write the physical stock in the blank column, then enter it on the Count page."],
    columns: [
      { header: "Verification date", width: 14, value: (c) => fmtDate(c.verifyDate) },
      { header: "Company", width: 18, value: (c) => companyName(c.companyGuid) },
      { header: "Stock item", width: 40, value: (c) => c.item },
      { header: "Sub group", width: 22, value: (c) => c.subGroup ?? "" },
      { header: "Stock group", width: 24, value: (c) => c.group ?? "" },
      { header: "Unit", width: 7, value: (c) => c.unit ?? "" },
      { header: "Closing stock", width: 13, value: (c) => liveClosing(c) ?? "" },
      { header: "Physical stock", width: 14, value: () => "" },
      { header: "Remarks", width: 30, value: () => "" },
    ],
  });

  const returned = due.filter((c) => c.status === "returned");

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5">
      <PageHead
        kicker="Physical Verification · Count"
        title="Physical stock count"
        sub={<>Enter the physical stock you counted. Difference = Physical − Closing. <b>Save</b> keeps it, <b>Submit</b> sends it to the admin.</>}
        right={<>
          {isAdmin && (
            <select value={who} onChange={(e) => setWho(e.target.value)} className={inputCls}>
              <option value="">All verifiers</option>
              {verifiers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          <Button variant="ghost" size="sm" onClick={exportSheet} disabled={!due.length}>Print / Excel sheet</Button>
        </>}
      />

      {pvQ.isError && <PvUnavailable error={pvQ.error} />}
      {stock.error && <Card className="p-4 text-[13px] text-ryg-red">Could not read Tally stock: {stock.error.message}</Card>}

      {returned.length > 0 && (
        <div className="flex items-center gap-3 rounded-card border border-ryg-red/30 bg-ryg-red/5 px-4 py-2.5 text-[13px]">
          <CornerDownLeft className="h-4 w-4 text-ryg-red" />
          <span><b className="text-ryg-red">{returned.length} item{returned.length === 1 ? "" : "s"} sent back for recount</b> — the reason is under the item name.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-page p-1">
          {([["todo", `To count (${due.length})`], ["done", `Submitted (${done.length})`]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)}
              className={cn("rounded-lg px-3 py-1 text-[12.5px] font-semibold",
                tab === v ? "bg-white text-navy shadow-sm ring-1 ring-line" : "text-grey hover:text-navy")}>{l}</button>
          ))}
        </div>
        {later.length > 0 && tab === "todo" && (
          <span className="text-[12px] text-grey">
            {later.length} more item{later.length === 1 ? "" : "s"} from {fmtDate(later.map((c) => c.verifyDate).sort()[0])}.
          </span>
        )}
        {tab === "todo" && mayEdit && (
          <div className="ml-auto flex items-center gap-2">
            {note && <span className={cn("text-[12.5px]", note.ok ? "text-ryg-green" : "text-ryg-red")}>{note.text}</span>}
            <Button size="sm" variant="ghost" onClick={() => run(dirty, false)} disabled={busy || !dirty.length}>
              Save{dirty.length ? ` (${dirty.length})` : ""}
            </Button>
            <Button size="sm" onClick={() => run(ready, true)} disabled={busy || !ready.length}>
              {busy ? "Working…" : `Submit${ready.length ? ` (${ready.length})` : ""}`}
            </Button>
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          {tab === "todo" ? (
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Stock item</th>
                  <th className={thCls}>Sub group</th>
                  <th className={thCls}>Stock group</th>
                  <th className={thCls}>Unit</th>
                  <th className={cn(thCls, "text-right")}>Closing stock</th>
                  <th className={cn(thCls, "text-right")}>Physical stock</th>
                  <th className={cn(thCls, "text-right")}>Difference</th>
                  <th className={thCls}>Remarks</th>
                  {isAdmin && <th className={thCls}>Verifier</th>}
                </tr>
              </thead>
              <tbody>
                {due.map((c) => {
                  const d = draftOf(c);
                  const q = parseQty(d.qty);
                  const closing = liveClosing(c);
                  const diff = q === null || Number.isNaN(q) || closing === null ? null : q - closing;
                  return (
                    <tr key={c.id} className={cn(c.status === "returned" && "bg-ryg-red/[0.03]")}>
                      <td className={cn(tdCls, "font-semibold")}>{fmtDate(c.verifyDate)}</td>
                      <td className={cn(tdCls, "whitespace-normal")}>
                        <div className="font-medium text-navy">{c.item}</div>
                        {multiCompany && <div className="text-[11px] text-grey">{companyName(c.companyGuid)}</div>}
                        {c.status === "returned" && (
                          <div className="text-[11.5px] text-ryg-red">Recount: {c.reviewRemarks}</div>
                        )}
                      </td>
                      <td className={tdCls}>{c.subGroup}</td>
                      <td className={cn(tdCls, "text-grey")}>{c.group}</td>
                      <td className={tdCls}>{c.unit}</td>
                      <td className={cn(tdCls, "text-right tabular-nums")}>{fmtQty(closing)}</td>
                      <td className={cn(tdCls, "text-right")}>
                        <input value={d.qty} inputMode="decimal" disabled={!mayEdit}
                          onChange={(e) => setDraft(c.id, { qty: e.target.value })}
                          className={cn(inputCls, "w-28 text-right tabular-nums",
                            Number.isNaN(q) || (q ?? 0) < 0 ? "border-ryg-red" : isDirty(c) && "border-orange/60 bg-orange/[0.04]")} />
                      </td>
                      <td className={cn(tdCls, "text-right")}><Diff value={diff} /></td>
                      <td className={tdCls}>
                        <input value={d.remarks} disabled={!mayEdit} placeholder="Optional"
                          onChange={(e) => setDraft(c.id, { remarks: e.target.value })}
                          className={cn(inputCls, "w-56")} />
                      </td>
                      {isAdmin && <td className={cn(tdCls, "text-grey")}>{nameOf(c.assignedTo)}</td>}
                    </tr>
                  );
                })}
                {due.length === 0 && (
                  <tr><td colSpan={10} className="p-10 text-center text-[13px] text-grey">
                    {pvQ.isLoading ? "Loading…" : "Nothing to count today."}
                  </td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Stock item</th>
                  <th className={thCls}>Unit</th>
                  <th className={cn(thCls, "text-right")}>Closing (at count)</th>
                  <th className={cn(thCls, "text-right")}>Physical</th>
                  <th className={cn(thCls, "text-right")}>Difference</th>
                  <th className={thCls}>Remarks</th>
                  <th className={thCls}>Submitted</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {done.map((c) => (
                  <tr key={c.id}>
                    <td className={tdCls}>{fmtDate(c.verifyDate)}</td>
                    <td className={cn(tdCls, "whitespace-normal")}>
                      <div className="font-medium text-navy">{c.item}</div>
                      {multiCompany && <div className="text-[11px] text-grey">{companyName(c.companyGuid)}</div>}
                    </td>
                    <td className={tdCls}>{c.unit}</td>
                    <td className={cn(tdCls, "text-right tabular-nums")}>{fmtQty(c.closingQty)}</td>
                    <td className={cn(tdCls, "text-right tabular-nums")}>{fmtQty(c.physicalQty)}</td>
                    <td className={cn(tdCls, "text-right")}><Diff value={c.difference} /></td>
                    <td className={cn(tdCls, "text-grey")}>{c.verifierRemarks ?? ""}</td>
                    <td className={cn(tdCls, "text-grey")}>{fmtStamp(c.submittedAt)}</td>
                    <td className={tdCls} title={STATUS_LABEL[c.status]}><StatusPill status={c.status} /></td>
                  </tr>
                ))}
                {done.length === 0 && (
                  <tr><td colSpan={9} className="p-10 text-center text-[13px] text-grey">Nothing submitted yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
