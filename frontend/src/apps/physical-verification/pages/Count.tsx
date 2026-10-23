import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownLeft, X } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { cn } from "@/shared/lib/cn";
import { companyName, fmtDate, fmtQty, fmtStamp, itemKey } from "../lib/stock";
import { lotTotal, PV_QUERY, saveCounts, STATUS_LABEL, usePv, useStocks, type CountRow, type LotLine } from "../lib/pv";
import { fetchLots, useLots } from "../lib/lots";
import { inputCls, PageHead, PvUnavailable, StatusPill, tdCls, thCls } from "../components/parts";

/**
 * COUNT — the verifier's page.
 *
 * Shows ONLY the items scheduled for this person whose verification date has come (and anything
 * sent back for a recount).
 *
 * BLIND COUNT (asked 19-10-2026): Tally's closing and the difference are NOT shown here — the
 * verifier enters what is on the shelf. The closing is still frozen on the row at each save, for
 * the review.
 *
 * LOT BY LOT: after the total, the verifier splits it by lot no. A new blank lot line keeps
 * opening until the lots add up to the total; Submit takes only items whose lots match it.
 */

interface LotDraft { lot: string; qty: string }
interface Draft { qty: string; remarks: string; lots: LotDraft[] }

const parseQty = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const EMPTY: Draft = { qty: "", remarks: "", lots: [] };
const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;

/** The lot lines worth saving: anything typed in. */
const cleanLots = (lots: LotDraft[]): LotLine[] => lots
  .filter((l) => l.lot.trim() || l.qty.trim())
  .map((l) => ({ lot: l.lot.trim(), qty: parseQty(l.qty) }));

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
  // Closing stock only for the companies that have rows still to count (frozen at save, never shown).
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

  // Lot NAMES as suggestions only — the quantities stay hidden.
  const lotsQ = useLots(due.map((c) => ({ companyGuid: c.companyGuid, item: c.item, closing: null })));

  // Seed the boxes from what is already saved on each row.
  useEffect(() => {
    setDrafts((d) => {
      const n = { ...d };
      for (const c of due) {
        if (!n[c.id]) {
          n[c.id] = {
            qty: c.physicalQty === null ? "" : String(c.physicalQty),
            remarks: c.verifierRemarks ?? "",
            lots: c.lotCounts.map((l) => ({ lot: l.lot, qty: l.qty === null ? "" : String(l.qty) })),
          };
        }
      }
      return n;
    });
  }, [due]);

  const draftOf = (c: CountRow): Draft => drafts[c.id] ?? EMPTY;
  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? EMPTY), ...patch } }));

  const isDirty = (c: CountRow) => {
    const d = draftOf(c);
    return parseQty(d.qty) !== c.physicalQty || (d.remarks.trim() || null) !== (c.verifierRemarks ?? null) ||
      JSON.stringify(cleanLots(d.lots)) !== JSON.stringify(c.lotCounts);
  };
  const qtyBad = (d: Draft) => Number.isNaN(parseQty(d.qty)) || (parseQty(d.qty) ?? 0) < 0;
  const lotsBad = (d: Draft) => d.lots.some((l) => Number.isNaN(parseQty(l.qty)) || (parseQty(l.qty) ?? 0) < 0);
  /** Ready to submit: a total, and (when it is above 0) complete lot lines adding up to it. */
  const isReady = (d: Draft) => {
    const q = parseQty(d.qty);
    if (q === null || Number.isNaN(q) || q < 0 || lotsBad(d)) return false;
    const lots = cleanLots(d.lots);
    if (q === 0) return lots.every((l) => !l.qty);
    return lots.length > 0 && lots.every((l) => l.lot && l.qty !== null && l.qty > 0) && near(lotTotal(lots), q);
  };

  const bad = due.filter((c) => qtyBad(draftOf(c)) || lotsBad(draftOf(c)));
  const dirty = due.filter(isDirty);
  const ready = due.filter((c) => isReady(draftOf(c)));

  const run = async (rows: CountRow[], submit: boolean) => {
    if (bad.length) { setNote({ ok: false, text: `Fix the quantities for ${bad[0].item} — numbers only.` }); return; }
    if (!rows.length) return;
    if (submit && !window.confirm(`Submit ${rows.length} item${rows.length === 1 ? "" : "s"} for review? You cannot change them after this.`)) return;
    setBusy(true); setNote(null);
    try {
      // Fresh Tally closing and lot balances at the moment of saving — frozen on the row. The lot
      // read is capped at 8 s (Enterprises Surat's lot table can time out); without it the count
      // still saves and the row keeps its earlier lot snapshot.
      // Lots are tied to the fresh closing, so they add up to exactly what Tally shows.
      const by = await stock.refetch();
      const lotsNow = await Promise.race([
        fetchLots(rows.map((c) => ({
          companyGuid: c.companyGuid, item: c.item, closing: by.get(itemKey(c.companyGuid, c.item))?.closingQty ?? 0,
        }))).catch(() => null),
        new Promise<null>((res) => setTimeout(() => res(null), 8000)),
      ]);
      const n = await saveCounts(rows.map((c) => ({
        id: c.id,
        physicalQty: parseQty(draftOf(c).qty),
        remarks: draftOf(c).remarks,
        lots: cleanLots(draftOf(c).lots),
        stock: by.get(itemKey(c.companyGuid, c.item)),
        lotClosing: lotsNow ? lotsNow.get(itemKey(c.companyGuid, c.item)) ?? [] : null,
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
    notes: ["Write the physical total, then each lot no. with its quantity; the lots must add up to the total."],
    columns: [
      { header: "Verification date", width: 14, value: (c) => fmtDate(c.verifyDate) },
      { header: "Company", width: 18, value: (c) => companyName(c.companyGuid) },
      { header: "Stock item", width: 40, value: (c) => c.item },
      { header: "Sub group", width: 22, value: (c) => c.subGroup ?? "" },
      { header: "Stock group", width: 24, value: (c) => c.group ?? "" },
      { header: "Unit", width: 7, value: (c) => c.unit ?? "" },
      { header: "Physical stock (total)", width: 16, value: () => "" },
      { header: "Lot no. 1", width: 14, value: () => "" },
      { header: "Qty 1", width: 9, value: () => "" },
      { header: "Lot no. 2", width: 14, value: () => "" },
      { header: "Qty 2", width: 9, value: () => "" },
      { header: "Lot no. 3", width: 14, value: () => "" },
      { header: "Qty 3", width: 9, value: () => "" },
      { header: "Remarks", width: 30, value: () => "" },
    ],
  });

  const returned = due.filter((c) => c.status === "returned");

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5">
      <PageHead
        kicker="Physical Verification · Count"
        title="Physical stock count"
        sub={<>Enter the physical stock you counted, then split it by lot no. <b>Save</b> keeps it; <b>Submit</b> sends items whose lots add up to the total.</>}
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
                  <th className={cn(thCls, "text-right")}>Physical stock</th>
                  <th className={cn(thCls, "min-w-[300px]")}>Lot no. · Qty</th>
                  <th className={thCls}>Remarks</th>
                  {isAdmin && <th className={thCls}>Verifier</th>}
                </tr>
              </thead>
              <tbody>
                {due.map((c) => {
                  const d = draftOf(c);
                  const q = parseQty(d.qty);
                  const names = (lotsQ.data?.get(itemKey(c.companyGuid, c.item)) ?? []).map((l) => l.lot);
                  return (
                    <tr key={c.id} className={cn("align-top", c.status === "returned" && "bg-ryg-red/[0.03]")}>
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
                      <td className={cn(tdCls, "text-right")}>
                        <input value={d.qty} inputMode="decimal" disabled={!mayEdit} placeholder="Total"
                          onChange={(e) => setDraft(c.id, { qty: e.target.value })}
                          className={cn(inputCls, "w-28 text-right tabular-nums",
                            qtyBad(d) ? "border-ryg-red" : isDirty(c) && "border-orange/60 bg-orange/[0.04]")} />
                      </td>
                      <td className={tdCls}>
                        <LotEditor id={c.id} lots={d.lots} total={q} names={names} disabled={!mayEdit}
                          onChange={(lots) => setDraft(c.id, { lots })} />
                      </td>
                      <td className={tdCls}>
                        <input value={d.remarks} disabled={!mayEdit} placeholder="Optional"
                          onChange={(e) => setDraft(c.id, { remarks: e.target.value })}
                          className={cn(inputCls, "w-48")} />
                      </td>
                      {isAdmin && <td className={cn(tdCls, "text-grey")}>{nameOf(c.assignedTo)}</td>}
                    </tr>
                  );
                })}
                {due.length === 0 && (
                  <tr><td colSpan={9} className="p-10 text-center text-[13px] text-grey">
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
                  <th className={cn(thCls, "text-right")}>Physical</th>
                  <th className={thCls}>Lots</th>
                  <th className={thCls}>Remarks</th>
                  <th className={thCls}>Submitted</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {done.map((c) => (
                  <tr key={c.id} className="align-top">
                    <td className={tdCls}>{fmtDate(c.verifyDate)}</td>
                    <td className={cn(tdCls, "whitespace-normal")}>
                      <div className="font-medium text-navy">{c.item}</div>
                      {multiCompany && <div className="text-[11px] text-grey">{companyName(c.companyGuid)}</div>}
                    </td>
                    <td className={tdCls}>{c.unit}</td>
                    <td className={cn(tdCls, "text-right tabular-nums")}>{fmtQty(c.physicalQty)}</td>
                    <td className={cn(tdCls, "text-[12px]")}>
                      {c.lotCounts.length ? c.lotCounts.map((l, i) => <div key={i}>{l.lot} · {fmtQty(l.qty)}</div>) : <span className="text-grey-2">—</span>}
                    </td>
                    <td className={cn(tdCls, "text-grey")}>{c.verifierRemarks ?? ""}</td>
                    <td className={cn(tdCls, "text-grey")}>{fmtStamp(c.submittedAt)}</td>
                    <td className={tdCls} title={STATUS_LABEL[c.status]}><StatusPill status={c.status} /></td>
                  </tr>
                ))}
                {done.length === 0 && (
                  <tr><td colSpan={8} className="p-10 text-center text-[13px] text-grey">Nothing submitted yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * The lot lines of one item. Typed lines, plus ONE blank line while the lots are still short of
 * the total (or no total yet) — so the next lot can always be added until the count is complete.
 */
function LotEditor({ id, lots, total, names, disabled, onChange }: {
  id: string; lots: LotDraft[]; total: number | null; names: string[]; disabled: boolean; onChange: (l: LotDraft[]) => void;
}) {
  const typed = lots.filter((l) => l.lot.trim() || l.qty.trim());
  const sum = typed.reduce((s, l) => s + (parseQty(l.qty) || 0), 0);
  const t = total === null || Number.isNaN(total) ? null : total;
  const complete = t !== null && t > 0 && near(sum, t);
  const showBlank = !disabled && !complete && t !== 0;
  const lines = showBlank ? [...typed, { lot: "", qty: "" }] : typed;
  const set = (i: number, patch: Partial<LotDraft>) => {
    const next = lines.map((l, j) => (j === i ? { ...l, ...patch } : l));
    onChange(next.filter((l) => l.lot.trim() || l.qty.trim()));
  };
  const cell = cn(inputCls, "h-7 px-1.5 text-[12px]");
  if (t === 0 && !typed.length) return <span className="text-[11.5px] text-grey">Nothing on the shelf — no lots needed.</span>;
  return (
    <div className="space-y-1">
      <datalist id={`pv-lotnames-${id}`}>{names.map((n) => <option key={n} value={n} />)}</datalist>
      {lines.map((l, i) => (
        <div key={i} className="flex items-center gap-1">
          <input value={l.lot} list={`pv-lotnames-${id}`} disabled={disabled} placeholder="Lot no."
            onChange={(e) => set(i, { lot: e.target.value })} className={cn(cell, "w-36")} />
          <input value={l.qty} inputMode="decimal" disabled={disabled} placeholder="Qty"
            onChange={(e) => set(i, { qty: e.target.value })}
            className={cn(cell, "w-24 text-right tabular-nums",
              (Number.isNaN(parseQty(l.qty)) || (parseQty(l.qty) ?? 0) < 0) && "border-ryg-red")} />
          {i < typed.length && !disabled && (
            <button className="text-grey hover:text-ryg-red" title="Remove this lot"
              onClick={() => onChange(typed.filter((_, j) => j !== i))}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      <div className="text-[11px]">
        {t === null ? <span className="text-grey">Enter the total first.</span>
          : complete ? <span className="font-semibold text-ryg-green">Lots add up to {fmtQty(t)} ✓</span>
          : <span className={sum > (t ?? 0) ? "text-ryg-red" : "text-[#B7791F]"}>
            Lots {fmtQty(sum)} of {fmtQty(t)} — {sum > (t ?? 0) ? `over by ${fmtQty(sum - (t ?? 0))}` : `${fmtQty((t ?? 0) - sum)} left`}
          </span>}
      </div>
    </div>
  );
}
