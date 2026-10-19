import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, X } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { matchesSearch } from "@/shared/lib/search";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { cn } from "@/shared/lib/cn";
import { fmtDate, fmtInr, fmtQty, fmtStamp, OTEC_SURAT_NAME } from "../lib/stock";
import {
  canPost, diffValue, markPosted, PV_QUERY, saveTallyAlloc, toPost, unpost, usePv, type CountRow, type TallyAlloc,
} from "../lib/pv";
import {
  allocReady, allocTotal, buildStockJournalXml, DEFAULT_GODOWN, downloadText, KNOWN_GODOWNS, suggestAlloc, useLots,
} from "../lib/tally";
import { Diff, inputCls, PageHead, PvUnavailable, tdCls, thCls, Tile } from "../components/parts";

/**
 * STEP 4 · POST TO TALLY — accepted counts with a difference, into Tally as a Stock Journal.
 *
 *   1. Check the godown + batch on each line (suggested from the item's biggest lot; split a
 *      line with "+" when the difference sits in more than one batch). "Save lines" keeps them.
 *   2. Tick lines → "Download Tally file" → in Tally (Otec Surat open): Import → Transactions.
 *   3. Type the voucher no. Tally gave it → "Mark posted". The lines move to "Posted".
 *
 * Short goes out of stock (source side), extra comes in (destination side). See lib/tally.ts.
 */

type Tab = "pending" | "posted";
const VT_KEY = "physical-verification:voucher-type";
const readVt = () => { try { return localStorage.getItem(VT_KEY) || "Stock Journal"; } catch { return "Stock Journal"; } };

export default function Tally() {
  const { user, isAdmin, canEditModule } = useSession();
  const qc = useQueryClient();
  const pvQ = usePv();
  const mayPost = canPost(user.id, isAdmin, canEditModule("physical-verification"), pvQ.data);
  const people = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 10 * 60_000 });
  const nameOf = (id: string | null | undefined) => (id ? people.data?.find((p) => p.id === id)?.name ?? "—" : "—");

  const [tab, setTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, TallyAlloc[]>>({});
  const [vchDate, setVchDate] = useState(todayLocalIso());
  const [voucherType, setVoucherType] = useState(readVt);
  const [vchNo, setVchNo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const counts = pvQ.data?.counts ?? [];
  const pending = useMemo(() => counts.filter(toPost), [counts]);
  const posted = useMemo(() => counts.filter((c) => !!c.tallyPostedAt), [counts]);
  const rows = useMemo(() => (tab === "pending" ? pending : posted)
    .filter((c) => matchesSearch(search, `${c.item} ${c.subGroup ?? ""} ${c.group ?? ""} ${c.tallyVoucherNo ?? ""}`))
    .sort((a, b) => (tab === "pending"
      ? (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? "")
      : (b.tallyPostedAt ?? "").localeCompare(a.tallyPostedAt ?? ""))),
  [tab, pending, posted, search]);

  const lotsQ = useLots(pending.map((c) => c.item));
  const lots = lotsQ.data;

  /** What a line shows: typed this session, else saved, else the suggestion. */
  const allocOf = (c: CountRow): TallyAlloc[] => drafts[c.id] ?? c.tallyAlloc ?? suggestAlloc(c, lots?.get(c.item));
  const setAlloc = (c: CountRow, a: TallyAlloc[]) => setDrafts((d) => ({ ...d, [c.id]: a }));
  const dirty = Object.keys(drafts).filter((id) => pending.some((c) => c.id === id));

  useEffect(() => { try { localStorage.setItem(VT_KEY, voucherType); } catch { /* per-browser only */ } }, [voucherType]);

  const pickedRows = rows.filter((c) => picked.has(c.id));
  const allPicked = rows.length > 0 && rows.every((c) => picked.has(c.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(rows.map((c) => c.id)));
  const notReady = pickedRows.filter((c) => !allocReady(c, allocOf(c)));

  const short = rows.filter((c) => (c.difference ?? 0) < 0);
  const extra = rows.filter((c) => (c.difference ?? 0) > 0);
  const sumVal = (list: CountRow[]) => list.reduce((a, c) => a + (diffValue(c.difference, c.closingRate) ?? 0), 0);

  const run = async (fn: () => Promise<string>, clearPicked = true) => {
    setBusy(true); setNote(null);
    try {
      const text = await fn();
      await qc.invalidateQueries({ queryKey: PV_QUERY });
      if (clearPicked) setPicked(new Set());
      setNote({ ok: true, text });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** Saves typed lines; with `ids`, also every picked line still on its suggestion (so posting finds it stored). */
  const persist = async (ids: string[] = []) => {
    const want = new Set([...dirty, ...ids]);
    const list = pending.filter((c) => want.has(c.id)).map((c) => ({ id: c.id, alloc: allocOf(c) }));
    if (list.length) await saveTallyAlloc(list);
    setDrafts({});
    return list.length;
  };

  const saveLines = () => run(async () => `${await persist()} line(s) saved.`, false);

  const download = () => {
    if (notReady.length) {
      setNote({ ok: false, text: `Godown / qty must add up to the difference on: ${notReady.map((c) => c.item).join(", ")}` });
      return;
    }
    void run(async () => {
      await persist(pickedRows.map((c) => c.id));
      const xml = buildStockJournalXml(pickedRows.map((c) => ({ count: c, alloc: allocOf(c) })), {
        date: vchDate,
        voucherType,
        narration: `Physical verification difference — ${pickedRows.length} item(s), counted ${[...new Set(pickedRows.map((c) => fmtDate(c.verifyDate)))].join(", ")}`,
      });
      downloadText(`PV_Stock_Journal_${vchDate}.xml`, xml);
      return "Tally file downloaded. Import it in Tally (Otec Surat open), then type the voucher no. and Mark posted.";
    }, false);
  };

  const post = () => {
    if (notReady.length) { setNote({ ok: false, text: `Not ready: ${notReady.map((c) => c.item).join(", ")}` }); return; }
    void run(async () => {
      await persist(pickedRows.map((c) => c.id));
      const n = await markPosted(pickedRows.map((c) => c.id), vchNo, vchDate);
      setVchNo("");
      return `${n} line(s) marked posted — voucher ${vchNo.trim()}.`;
    });
  };

  const undo = () => run(async () => {
    const n = await unpost(pickedRows.map((c) => c.id), reason);
    setReason("");
    return `${n} line(s) back in "To post".`;
  });

  const exportList = () => exportRowsToXlsx({
    fileName: `Physical_Verification_Tally_${tab}`,
    sheetName: tab === "pending" ? "To post" : "Posted",
    title: `Physical Verification — ${OTEC_SURAT_NAME}, Stock Journal ${tab === "pending" ? "to post" : "posted"}`,
    rows: rows.flatMap((c) => allocOf(c).map((a, i) => ({ c, a, first: i === 0 }))),
    notes: ["Short = goes OUT of stock (source side); Extra = comes IN (destination side).",
      "Rate = Tally's closing rate frozen when the count was saved."],
    columns: [
      { header: "Stock item", width: 40, value: (r) => r.c.item },
      { header: "Unit", width: 7, value: (r) => r.c.unit ?? "" },
      { header: "Side", width: 9, value: (r) => ((r.c.difference ?? 0) < 0 ? "OUT (short)" : "IN (extra)") },
      { header: "Godown", width: 22, value: (r) => r.a.godown },
      { header: "Batch", width: 18, value: (r) => r.a.batch },
      { header: "Qty", width: 10, value: (r) => r.a.qty },
      { header: "Rate", width: 10, value: (r) => r.c.closingRate ?? "" },
      { header: "Amount", width: 12, value: (r) => Math.round(r.a.qty * (r.c.closingRate ?? 0) * 100) / 100 },
      { header: "Difference (item)", width: 14, value: (r) => (r.first ? r.c.difference ?? "" : "") },
      { header: "Verification date", width: 14, value: (r) => fmtDate(r.c.verifyDate) },
      { header: "Voucher no.", width: 14, value: (r) => r.c.tallyVoucherNo ?? "" },
      { header: "Voucher date", width: 13, value: (r) => fmtDate(r.c.tallyVoucherDate) },
      { header: "Posted by", width: 18, value: (r) => (r.c.tallyPostedBy ? nameOf(r.c.tallyPostedBy) : "") },
    ],
  });

  const godownList = useMemo(() => [...new Set([
    ...KNOWN_GODOWNS, ...[...(lots?.values() ?? [])].flat().map((l) => l.godown).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b)), [lots]);

  const editable = mayPost && tab === "pending";

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-5">
      <PageHead
        kicker="Physical Verification · Post to Tally"
        title="Post differences to Tally"
        sub={<>Accepted counts with a difference, as a <b>Stock Journal</b>: short goes out of stock, extra comes in.
          Check godown + batch, download the Tally file, import it in Tally, then mark posted with Tally's voucher no.</>}
        right={<Button variant="ghost" size="sm" onClick={exportList} disabled={!rows.length}>Export Excel</Button>}
      />
      {pvQ.isError && <PvUnavailable error={pvQ.error} />}
      {lotsQ.isError && <div className="text-[12px] text-[#B7791F]">Lots could not be read from Tally ({(lotsQ.error as Error).message}); type the batch by hand.</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Lines in this list" value={rows.length} />
        <Tile label={`Short (OUT) · ${fmtInr(sumVal(short))}`} value={short.length} tone="text-ryg-red" />
        <Tile label={`Extra (IN) · ${fmtInr(sumVal(extra))}`} value={extra.length} tone="text-[#B7791F]" />
        <Tile label="Selected" value={pickedRows.length} />
      </div>

      {mayPost && pickedRows.length > 0 && (
        <Card className="sticky top-2 z-30 flex flex-wrap items-center gap-3 border-orange/40 bg-orange/[0.04] px-4 py-2.5">
          <b className="text-[13px] text-navy">{pickedRows.length} selected</b>
          {tab === "pending" ? (
            <>
              <label className="flex items-center gap-1.5 text-[12px] text-grey">
                Voucher date
                <input type="date" value={vchDate} onChange={(e) => setVchDate(e.target.value)} className={inputCls} />
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-grey" title="The voucher type's name exactly as in Tally (Otec Surat uses 'Stock Journal').">
                Voucher type
                <input value={voucherType} onChange={(e) => setVoucherType(e.target.value)} className={cn(inputCls, "w-36")} />
              </label>
              <Button size="sm" variant="ghost" onClick={download} disabled={busy}>Download Tally file</Button>
              <span className="h-5 w-px bg-line" />
              <label className="flex items-center gap-1.5 text-[12px] text-grey">
                Tally voucher no.
                <input value={vchNo} onChange={(e) => setVchNo(e.target.value)} placeholder="after import" className={cn(inputCls, "w-28")} />
              </label>
              <Button size="sm" onClick={post} disabled={busy || !vchNo.trim()}>Mark posted</Button>
              {notReady.length > 0 && <span className="text-[11.5px] text-ryg-red">{notReady.length} not adding up</span>}
            </>
          ) : isAdmin ? (
            <>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why undo (e.g. voucher deleted in Tally)"
                className={cn(inputCls, "w-72")} />
              <Button size="sm" variant="ghost" onClick={undo} disabled={busy || !reason.trim()}>Undo posted</Button>
            </>
          ) : <span className="text-[12px] text-grey">Only admins can undo a posting.</span>}
          <button className="ml-auto text-[12px] text-grey hover:text-navy" onClick={() => setPicked(new Set())}>Clear</button>
        </Card>
      )}
      {note && <div className={cn("text-[12.5px]", note.ok ? "text-ryg-green" : "text-ryg-red")}>{note.text}</div>}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="flex gap-1 rounded-xl bg-page p-1">
            {([["pending", "To post", pending.length], ["posted", "Posted", posted.length]] as const).map(([v, label, n]) => (
              <button key={v} onClick={() => { setTab(v); setPicked(new Set()); }}
                className={cn("rounded-lg px-2.5 py-1 text-[12px] font-semibold",
                  tab === v ? "bg-white text-navy shadow-sm ring-1 ring-line" : "text-grey hover:text-navy")}>
                {label} <span className="ml-0.5 text-[11px] text-orange tabular-nums">{n}</span>
              </button>
            ))}
          </div>
          {editable && dirty.length > 0 && (
            <Button size="sm" variant="ghost" onClick={saveLines} disabled={busy}>Save lines ({dirty.length})</Button>
          )}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-grey-2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item or voucher no."
              className={cn(inputCls, "w-56 pl-8")} />
          </div>
        </div>

        <datalist id="pv-godowns">{godownList.map((g) => <option key={g} value={g} />)}</datalist>

        <div className="max-h-[66vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                {mayPost && (
                  <th className={cn(thCls, "w-8")}>
                    <input type="checkbox" className="accent-orange" checked={allPicked} onChange={toggleAll} />
                  </th>
                )}
                <th className={thCls}>Stock item</th>
                <th className={thCls}>Unit</th>
                <th className={cn(thCls, "text-right")}>Difference</th>
                <th className={thCls}>Side</th>
                <th className={cn(thCls, "text-right")}>Rate</th>
                <th className={cn(thCls, "text-right")}>Value</th>
                <th className={cn(thCls, "min-w-[420px]")}>Godown · Batch · Qty</th>
                <th className={thCls}>{tab === "pending" ? "Counted" : "Voucher"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const a = allocOf(c);
                const ok = allocReady(c, a);
                const itemLots = lots?.get(c.item) ?? [];
                return (
                  <tr key={c.id} className={cn("align-top", picked.has(c.id) ? "bg-orange/[0.06]" : "hover:bg-page/60")}>
                    {mayPost && (
                      <td className={tdCls}><input type="checkbox" className="accent-orange" checked={picked.has(c.id)} onChange={() => toggle(c.id)} /></td>
                    )}
                    <td className={cn(tdCls, "whitespace-normal")}>
                      <div className="font-medium text-navy">{c.item}</div>
                      <div className="text-[11px] text-grey">{[c.subGroup, c.group].filter((g, i, l) => g && l.indexOf(g) === i).join(" · ")}</div>
                    </td>
                    <td className={tdCls}>{c.unit}</td>
                    <td className={cn(tdCls, "text-right")}><Diff value={c.difference} /></td>
                    <td className={cn(tdCls, "text-[12px] font-semibold", (c.difference ?? 0) < 0 ? "text-ryg-red" : "text-[#B7791F]")}>
                      {(c.difference ?? 0) < 0 ? "OUT" : "IN"}
                    </td>
                    <td className={cn(tdCls, "text-right tabular-nums text-grey")}>{c.closingRate === null ? "—" : fmtQty(c.closingRate)}</td>
                    <td className={cn(tdCls, "text-right tabular-nums text-grey")}>{fmtInr(diffValue(c.difference, c.closingRate))}</td>
                    <td className={tdCls}>
                      {editable ? (
                        <AllocEditor alloc={a} lots={itemLots.map((l) => `${l.batch}`)} lotHint={itemLots}
                          ok={ok} target={Math.abs(c.difference ?? 0)} onChange={(v) => setAlloc(c, v)} id={c.id} />
                      ) : (
                        <div className="space-y-0.5 text-[12px]">
                          {a.map((x, i) => <div key={i}>{x.godown} · <b>{x.batch || "Primary Batch"}</b> · {fmtQty(x.qty)}</div>)}
                        </div>
                      )}
                    </td>
                    <td className={cn(tdCls, "text-[12px] text-grey")}>
                      {tab === "pending"
                        ? <>{fmtDate(c.verifyDate)}<div className="text-[11px]">accepted {fmtStamp(c.reviewedAt)}</div></>
                        : <><b className="text-navy">{c.tallyVoucherNo}</b> · {fmtDate(c.tallyVoucherDate)}
                          <div className="text-[11px]">{nameOf(c.tallyPostedBy)} · {fmtStamp(c.tallyPostedAt)}</div></>}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="p-10 text-center text-[13px] text-grey">
                  {tab === "pending" ? "Nothing to post — accepted counts that match Tally need no entry." : "Nothing posted yet."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {!mayPost && <div className="text-[12px] text-grey">Only the step 4 people in Settings can post to Tally.</div>}
    </div>
  );
}

/** The godown / batch / qty lines of one item. "+" splits the difference over another batch. */
function AllocEditor({ alloc, lots, lotHint, ok, target, onChange, id }: {
  alloc: TallyAlloc[]; lots: string[]; lotHint: { batch: string; balance: number; godown: string }[];
  ok: boolean; target: number; onChange: (a: TallyAlloc[]) => void; id: string;
}) {
  const set = (i: number, patch: Partial<TallyAlloc>) => onChange(alloc.map((x, j) => {
    if (j !== i) return x;
    const next = { ...x, ...patch };
    // Picking a known lot also brings its godown.
    if (patch.batch !== undefined) {
      const lot = lotHint.find((l) => l.batch === patch.batch);
      if (lot?.godown) next.godown = lot.godown;
    }
    return next;
  }));
  const left = target - allocTotal(alloc);
  const cell = cn(inputCls, "h-7 px-1.5 text-[12px]");
  return (
    <div className="space-y-1">
      <datalist id={`pv-lots-${id}`}>
        {lotHint.map((l) => <option key={l.batch} value={l.batch}>{`${fmtQty(l.balance)} in ${l.godown || "—"}`}</option>)}
      </datalist>
      {alloc.map((x, i) => (
        <div key={i} className="flex items-center gap-1">
          <input value={x.godown} list="pv-godowns" onChange={(e) => set(i, { godown: e.target.value })}
            placeholder={DEFAULT_GODOWN} className={cn(cell, "w-36")} title="Godown" />
          <input value={x.batch} list={`pv-lots-${id}`} onChange={(e) => set(i, { batch: e.target.value })}
            placeholder={lots.length ? "Batch" : "Primary Batch"} className={cn(cell, "w-32")} title="Batch / lot" />
          <input type="number" min={0} step="any" value={Number.isFinite(x.qty) ? x.qty : ""}
            onChange={(e) => set(i, { qty: e.target.value === "" ? 0 : Number(e.target.value) })}
            className={cn(cell, "w-20 text-right tabular-nums")} title="Qty" />
          {alloc.length > 1 && (
            <button className="text-grey hover:text-ryg-red" title="Remove this line" onClick={() => onChange(alloc.filter((_, j) => j !== i))}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 text-[11px]">
        <button className="flex items-center gap-0.5 font-semibold text-orange hover:underline"
          onClick={() => onChange([...alloc, { godown: alloc[0]?.godown ?? DEFAULT_GODOWN, batch: "", qty: Math.max(0, Math.round(left * 1000) / 1000) }])}>
          <Plus className="h-3 w-3" /> split
        </button>
        {ok
          ? <span className="text-ryg-green">adds up</span>
          : <span className="text-ryg-red">{Math.abs(left) < 0.0005 ? "needs a godown" : `${left > 0 ? "short by" : "over by"} ${fmtQty(Math.abs(left))}`}</span>}
        {!lots.length && <span className="text-grey-2">no lot found in Tally</span>}
      </div>
    </div>
  );
}
