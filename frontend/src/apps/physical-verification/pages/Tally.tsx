import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Search } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { matchesSearch } from "@/shared/lib/search";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { cn } from "@/shared/lib/cn";
import { COMPANIES, companyName, fmtDate, fmtInr, fmtQty, fmtStamp, OTEC_SURAT_GUID } from "../lib/stock";
import { canPost, closeInTally, diffValue, PV_QUERY, tallyDocUrl, toPost, unpost, usePv, type CountRow } from "../lib/pv";
import { Diff, inputCls, PageHead, PvUnavailable, tdCls, thCls, Tile } from "../components/parts";

/**
 * STEP 4 · POST TO TALLY — accepted counts that still have a difference.
 *
 * Asked 19-10-2026: the Tally person adjusts the stock in Tally by hand (physical vs system),
 * then ticks the lines, types Tally's voucher no. + date, attaches the voucher and submits.
 * That CLOSES the lines. No import file. Admins can reopen a closed line with a reason.
 *
 * One company at a time — one Tally voucher is one company's book.
 */

type Tab = "pending" | "posted";

export default function Tally() {
  const { user, isAdmin, canEditModule } = useSession();
  const qc = useQueryClient();
  const pvQ = usePv();
  const mayPost = canPost(user.id, isAdmin, canEditModule("physical-verification"), pvQ.data);
  const people = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 10 * 60_000 });
  const nameOf = (id: string | null | undefined) => (id ? people.data?.find((p) => p.id === id)?.name ?? "—" : "—");

  const [tab, setTab] = useState<Tab>("pending");
  const [chosen, setChosen] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [vchDate, setVchDate] = useState(todayLocalIso());
  const [vchNo, setVchNo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const allCounts = pvQ.data?.counts ?? [];
  // Until someone picks, open on the first company with lines waiting.
  const company = chosen ?? COMPANIES.find((co) => allCounts.some((c) => c.companyGuid === co.guid && toPost(c)))?.guid ?? OTEC_SURAT_GUID;
  const coName = companyName(company);
  const toPostIn = (guid: string) => allCounts.filter((c) => c.companyGuid === guid && toPost(c)).length;
  const counts = useMemo(() => allCounts.filter((c) => c.companyGuid === company), [allCounts, company]);
  const pending = useMemo(() => counts.filter(toPost), [counts]);
  const posted = useMemo(() => counts.filter((c) => !!c.tallyPostedAt), [counts]);
  const rows = useMemo(() => (tab === "pending" ? pending : posted)
    .filter((c) => matchesSearch(search, `${c.item} ${c.subGroup ?? ""} ${c.group ?? ""} ${c.tallyVoucherNo ?? ""}`))
    .sort((a, b) => (tab === "pending"
      ? (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? "")
      : (b.tallyPostedAt ?? "").localeCompare(a.tallyPostedAt ?? ""))),
  [tab, pending, posted, search]);

  const pickedRows = rows.filter((c) => picked.has(c.id));
  const allPicked = rows.length > 0 && rows.every((c) => picked.has(c.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(rows.map((c) => c.id)));

  const short = rows.filter((c) => (c.difference ?? 0) < 0);
  const extra = rows.filter((c) => (c.difference ?? 0) > 0);
  const sumVal = (list: CountRow[]) => list.reduce((a, c) => a + (diffValue(c.difference, c.closingRate) ?? 0), 0);

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

  const close = () => {
    if (!file) { setNote({ ok: false, text: "Attach the Tally voucher." }); return; }
    void run(async () => {
      const n = await closeInTally(pickedRows.map((c) => c.id), vchNo, vchDate, file);
      const no = vchNo.trim();
      setVchNo(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return `${n} line(s) closed under Tally voucher ${no}.`;
    });
  };

  const reopen = () => run(async () => {
    const n = await unpost(pickedRows.map((c) => c.id), reason);
    setReason("");
    return `${n} line(s) reopened — back in "To post".`;
  });

  const openDoc = async (path: string) => {
    try { window.open(await tallyDocUrl(path), "_blank", "noopener"); }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); }
  };

  const exportList = () => exportRowsToXlsx({
    fileName: `Physical_Verification_Tally_${tab}`,
    sheetName: tab === "pending" ? "To post" : "Closed",
    title: `Physical Verification — ${coName}, ${tab === "pending" ? "differences to adjust in Tally" : "closed in Tally"}`,
    rows,
    notes: ["Short = physical below Tally (reduce stock); Extra = physical above Tally (add stock).",
      "Lots counted = the verifier's lot-wise count."],
    columns: [
      { header: "Stock item", width: 40, value: (c) => c.item },
      { header: "Unit", width: 7, value: (c) => c.unit ?? "" },
      { header: "Tally closing", width: 13, value: (c) => c.closingQty ?? "" },
      { header: "Physical", width: 12, value: (c) => c.physicalQty ?? "" },
      { header: "Difference", width: 12, value: (c) => c.difference ?? "" },
      { header: "Value", width: 12, value: (c) => Math.round(diffValue(c.difference, c.closingRate) ?? 0) },
      { header: "Lots counted", width: 34, value: (c) => c.lotCounts.map((l) => `${l.lot}: ${l.qty ?? ""}`).join("; ") },
      { header: "Review remark", width: 30, value: (c) => c.reviewRemarks ?? "" },
      { header: "Voucher no.", width: 14, value: (c) => c.tallyVoucherNo ?? "" },
      { header: "Voucher date", width: 13, value: (c) => fmtDate(c.tallyVoucherDate) },
      { header: "Closed by", width: 18, value: (c) => (c.tallyPostedBy ? nameOf(c.tallyPostedBy) : "") },
    ],
  });

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-5">
      <PageHead
        kicker="Physical Verification · Post to Tally"
        title="Adjust differences in Tally"
        sub={<>Accepted counts that still differ from Tally. Adjust the stock in Tally ({coName}) so physical matches system,
          then tick the lines, enter the <b>voucher no.</b>, attach the voucher and <b>Submit</b> — that closes them.</>}
        right={<Button variant="ghost" size="sm" onClick={exportList} disabled={!rows.length}>Export Excel</Button>}
      />
      {pvQ.isError && <PvUnavailable error={pvQ.error} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Lines in this list" value={rows.length} />
        <Tile label={`Short · ${fmtInr(sumVal(short))}`} value={short.length} tone="text-ryg-red" />
        <Tile label={`Extra · ${fmtInr(sumVal(extra))}`} value={extra.length} tone="text-[#B7791F]" />
        <Tile label="Selected" value={pickedRows.length} />
      </div>

      {mayPost && pickedRows.length > 0 && (
        <Card className="sticky top-2 z-30 flex flex-wrap items-center gap-3 border-orange/40 bg-orange/[0.04] px-4 py-2.5">
          <b className="text-[13px] text-navy">{pickedRows.length} selected</b>
          {tab === "pending" ? (
            <>
              <label className="flex items-center gap-1.5 text-[12px] text-grey">
                Tally voucher no.
                <input value={vchNo} onChange={(e) => setVchNo(e.target.value)} className={cn(inputCls, "w-28")} />
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-grey">
                Voucher date
                <input type="date" value={vchDate} onChange={(e) => setVchDate(e.target.value)} className={inputCls} />
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-grey">
                <Paperclip className="h-3.5 w-3.5" />
                <span className={cn("max-w-[180px] truncate", file ? "font-semibold text-navy" : "")}>{file ? file.name : "Attach voucher"}</span>
                <input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf,.xlsx,.xls,.doc,.docx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <Button size="sm" onClick={close} disabled={busy || !vchNo.trim() || !vchDate || !file}>
                {busy ? "Saving…" : "Submit & close"}
              </Button>
            </>
          ) : isAdmin ? (
            <>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why reopen (e.g. voucher deleted in Tally)"
                className={cn(inputCls, "w-72")} />
              <Button size="sm" variant="ghost" onClick={reopen} disabled={busy || !reason.trim()}>Reopen</Button>
            </>
          ) : <span className="text-[12px] text-grey">Only admins can reopen a closed line.</span>}
          <button className="ml-auto text-[12px] text-grey hover:text-navy" onClick={() => setPicked(new Set())}>Clear</button>
        </Card>
      )}
      {note && <div className={cn("text-[12.5px]", note.ok ? "text-ryg-green" : "text-ryg-red")}>{note.text}</div>}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="flex gap-1 rounded-xl bg-page p-1">
            {([["pending", "To post", pending.length], ["posted", "Closed", posted.length]] as const).map(([v, label, n]) => (
              <button key={v} onClick={() => { setTab(v); setPicked(new Set()); }}
                className={cn("rounded-lg px-2.5 py-1 text-[12px] font-semibold",
                  tab === v ? "bg-white text-navy shadow-sm ring-1 ring-line" : "text-grey hover:text-navy")}>
                {label} <span className="ml-0.5 text-[11px] text-orange tabular-nums">{n}</span>
              </button>
            ))}
          </div>
          <select value={company} onChange={(e) => { setChosen(e.target.value); setPicked(new Set()); }}
            className={cn(inputCls, "h-8 py-0 text-[12px] font-semibold text-navy")}>
            {COMPANIES.map((co) => <option key={co.guid} value={co.guid}>{co.name}{toPostIn(co.guid) ? ` (${toPostIn(co.guid)})` : ""}</option>)}
          </select>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-grey-2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item or voucher no."
              className={cn(inputCls, "w-56 pl-8")} />
          </div>
        </div>

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
                <th className={cn(thCls, "text-right")}>Tally closing</th>
                <th className={cn(thCls, "text-right")}>Physical</th>
                <th className={cn(thCls, "text-right")}>Difference</th>
                <th className={cn(thCls, "text-right")}>Value</th>
                <th className={thCls}>Lots counted</th>
                <th className={thCls}>Review remark</th>
                <th className={thCls}>{tab === "pending" ? "Accepted" : "Tally voucher"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={cn("align-top", picked.has(c.id) ? "bg-orange/[0.06]" : "hover:bg-page/60")}>
                  {mayPost && (
                    <td className={tdCls}><input type="checkbox" className="accent-orange" checked={picked.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  )}
                  <td className={cn(tdCls, "whitespace-normal")}>
                    <div className="font-medium text-navy">{c.item}</div>
                    <div className="text-[11px] text-grey">{[c.subGroup, c.group].filter((g, i, l) => g && l.indexOf(g) === i).join(" · ")}</div>
                  </td>
                  <td className={tdCls}>{c.unit}</td>
                  <td className={cn(tdCls, "text-right tabular-nums")}>{fmtQty(c.closingQty)}</td>
                  <td className={cn(tdCls, "text-right tabular-nums font-semibold")}>{fmtQty(c.physicalQty)}</td>
                  <td className={cn(tdCls, "text-right")}><Diff value={c.difference} /></td>
                  <td className={cn(tdCls, "text-right tabular-nums text-grey")}>{fmtInr(diffValue(c.difference, c.closingRate))}</td>
                  <td className={cn(tdCls, "text-[12px]")}>
                    {c.lotCounts.length ? c.lotCounts.map((l, i) => <div key={i}>{l.lot} · {fmtQty(l.qty)}</div>) : <span className="text-grey-2">—</span>}
                  </td>
                  <td className={cn(tdCls, "max-w-[240px] whitespace-normal text-[12px] text-grey")}>{c.reviewRemarks}</td>
                  <td className={cn(tdCls, "text-[12px] text-grey")}>
                    {tab === "pending"
                      ? <>{fmtStamp(c.reviewedAt)}<div className="text-[11px]">counted {fmtDate(c.verifyDate)}</div></>
                      : <>
                        <b className="text-navy">{c.tallyVoucherNo}</b> · {fmtDate(c.tallyVoucherDate)}
                        {c.tallyAttachment && (
                          <button className="ml-1 inline-flex items-center gap-0.5 text-orange hover:underline" onClick={() => void openDoc(c.tallyAttachment!)}>
                            <Paperclip className="h-3 w-3" />{c.tallyAttachmentName ?? "attachment"}
                          </button>
                        )}
                        <div className="text-[11px]">{nameOf(c.tallyPostedBy)} · {fmtStamp(c.tallyPostedAt)}</div>
                      </>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={10} className="p-10 text-center text-[13px] text-grey">
                  {tab === "pending" ? "Nothing to adjust — accepted counts that match Tally are already closed." : "Nothing closed yet."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {!mayPost && <div className="text-[12px] text-grey">Only the step 4 people in Settings can close lines in Tally.</div>}
    </div>
  );
}
