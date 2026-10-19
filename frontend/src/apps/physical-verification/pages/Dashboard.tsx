import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { cn } from "@/shared/lib/cn";
import { COMPANIES, companyName, fmtDate, fmtInr, fmtQty } from "../lib/stock";
import { diffValue, STATUS_LABEL, usePv, type CountRow, type CountStatus } from "../lib/pv";
import { Diff, inputCls, PageHead, PvUnavailable, StatusPill } from "../components/parts";

/**
 * DASHBOARD — how far the physical verification has got, and what it found.
 *
 *   progress     every scheduled round: verified / awaiting review / sent for recount / to count
 *   difference   every COUNTED round (submitted or accepted): matching, SHORT (physical less than
 *                Tally — the negative side) and EXTRA (physical more than Tally), in qty and ₹
 *   lists        the short items and the extra items, biggest ₹ first
 *   sub group    progress and differences per sub group
 *
 * ₹ = difference × Tally's closing rate frozen at count time.
 */

/** Status order and colours — the app's own status tokens, always shown with a text label. */
const STAGES: { key: CountStatus; label: string; bar: string }[] = [
  { key: "accepted", label: "Verified", bar: "bg-ryg-green" },
  { key: "submitted", label: "Awaiting review", bar: "bg-blue" },
  { key: "returned", label: "Sent for recount", bar: "bg-ryg-red" },
  { key: "scheduled", label: "To count", bar: "bg-grey-2" },
];

const SHORT_BAR = "bg-ryg-red";
const EXTRA_BAR = "bg-[#D69E2E]";

const counted = (c: CountRow) => (c.status === "submitted" || c.status === "accepted") && c.difference !== null;
const isShort = (c: CountRow) => counted(c) && (c.difference ?? 0) < -0.0005;
const isExtra = (c: CountRow) => counted(c) && (c.difference ?? 0) > 0.0005;
const val = (c: CountRow) => diffValue(c.difference, c.closingRate) ?? 0;

function StatTile({ label, value, sub, tone, onClick, active }: {
  label: string; value: string | number; sub?: string; tone?: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className={cn("rounded-card border bg-white px-4 py-3 text-left transition",
        onClick && "hover:border-orange/50", active ? "border-orange ring-1 ring-orange/30" : "border-line")}>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-grey">{label}</div>
      <div className={cn("text-[24px] font-bold leading-tight tabular-nums text-navy", tone)}>{value}</div>
      {sub && <div className="text-[11.5px] text-grey">{sub}</div>}
    </button>
  );
}

/** One stacked progress bar with a 2px gap between segments and a label under each. */
function ProgressBar({ parts, total }: { parts: { label: string; n: number; bar: string }[]; total: number }) {
  return (
    <div>
      <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full bg-page">
        {parts.filter((p) => p.n > 0).map((p) => (
          <div key={p.label} className={cn("h-full first:rounded-l-full last:rounded-r-full", p.bar)}
            style={{ width: `${(p.n / Math.max(total, 1)) * 100}%` }}
            title={`${p.label}: ${p.n} of ${total} (${Math.round((p.n / Math.max(total, 1)) * 100)}%)`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5 text-[12px] text-ink">
            <i className={cn("inline-block h-2.5 w-2.5 rounded-sm", p.bar)} />
            {p.label} <b className="tabular-nums">{p.n}</b>
            <span className="text-grey">({Math.round((p.n / Math.max(total, 1)) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Short or extra items, biggest ₹ first, each with a bar scaled to the biggest in the list. */
function DiffList({ title, hint, rows, bar, nameOf }: {
  title: string; hint: string; rows: CountRow[]; bar: string; nameOf: (id: string | null) => string;
}) {
  const max = Math.max(...rows.map((c) => Math.abs(val(c))), 1);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-2.5">
        <div className="text-[14px] font-bold text-navy">{title} <span className="text-grey">({rows.length})</span></div>
        <div className="text-[11.5px] text-grey">{hint}</div>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-grey">
              {["Stock item", "Tally", "Physical", "Difference", "Value", "Status"].map((h, i) => (
                <th key={h} className={cn("sticky top-0 z-10 border-b border-line bg-page px-2.5 py-1.5 font-semibold", i > 0 && i < 5 && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-page/60"
                title={`${c.item}\nVerified ${fmtDate(c.verifyDate)} by ${nameOf(c.countedBy ?? c.assignedTo)}${c.verifierRemarks ? `\nRemarks: ${c.verifierRemarks}` : ""}`}>
                <td className="border-b border-line/70 px-2.5 py-1.5">
                  <div className="font-medium text-navy">{c.item}</div>
                  <div className="text-[10.5px] text-grey">{c.subGroup ?? c.group} · {fmtDate(c.verifyDate)}</div>
                </td>
                <td className="border-b border-line/70 px-2.5 py-1.5 text-right tabular-nums">{fmtQty(c.closingQty)}</td>
                <td className="border-b border-line/70 px-2.5 py-1.5 text-right tabular-nums">{fmtQty(c.physicalQty)}</td>
                <td className="border-b border-line/70 px-2.5 py-1.5 text-right"><Diff value={c.difference} /></td>
                <td className="w-[150px] border-b border-line/70 px-2.5 py-1.5">
                  <div className="flex items-center justify-end gap-2">
                    <span className="tabular-nums text-ink">{fmtInr(Math.abs(val(c)))}</span>
                    <span className="block h-2 w-16 rounded-full bg-page">
                      <span className={cn("block h-2 rounded-full", bar)} style={{ width: `${(Math.abs(val(c)) / max) * 100}%` }} />
                    </span>
                  </div>
                </td>
                <td className="border-b border-line/70 px-2.5 py-1.5"><StatusPill status={c.status} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-grey">None.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const pvQ = usePv();
  const people = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 10 * 60_000 });
  const nameOf = (id: string | null) => (id ? people.data?.find((p) => p.id === id)?.name ?? "—" : "—");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sub, setSub] = useState("");
  const [who, setWho] = useState("");
  const [company, setCompany] = useState("");
  const [stage, setStage] = useState<CountStatus | "">("");

  const everything = pvQ.data?.counts ?? [];
  const all = useMemo(() => (company ? everything.filter((c) => c.companyGuid === company) : everything), [everything, company]);
  const subs = useMemo(() => [...new Set(all.map((c) => c.subGroup ?? c.group ?? ""))].filter(Boolean).sort(), [all]);
  const verifiers = useMemo(() => [...new Set(all.map((c) => c.assignedTo).filter((id): id is string => !!id))], [all]);

  const rows = useMemo(() => all.filter((c) =>
    (!from || c.verifyDate >= from) && (!to || c.verifyDate <= to) &&
    (!sub || (c.subGroup ?? c.group) === sub) && (!who || c.assignedTo === who)), [all, from, to, sub, who]);

  const n = (s: CountStatus) => rows.filter((c) => c.status === s).length;
  const done = n("submitted") + n("accepted");
  const pending = n("scheduled") + n("returned");
  const countedRows = rows.filter(counted);
  const short = rows.filter(isShort).sort((a, b) => val(a) - val(b));
  const extra = rows.filter(isExtra).sort((a, b) => val(b) - val(a));
  const matching = countedRows.length - short.length - extra.length;
  const shortVal = short.reduce((a, c) => a + val(c), 0);
  const extraVal = extra.reduce((a, c) => a + val(c), 0);
  const shortQty = short.reduce((a, c) => a + (c.difference ?? 0), 0);
  const extraQty = extra.reduce((a, c) => a + (c.difference ?? 0), 0);

  const bySub = useMemo(() => {
    const m = new Map<string, CountRow[]>();
    for (const c of rows) {
      const k = c.subGroup ?? c.group ?? "(none)";
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()].map(([k, list]) => ({
      k, list,
      done: list.filter((c) => c.status === "submitted" || c.status === "accepted").length,
      short: list.filter(isShort), extra: list.filter(isExtra),
      net: list.filter(counted).reduce((a, c) => a + val(c), 0),
    })).sort((a, b) => a.net - b.net);
  }, [rows]);

  // "Pending to count" opens both the never-counted and the sent-back-for-recount items.
  const listRows = stage ? rows.filter((c) => c.status === stage || (stage === "scheduled" && c.status === "returned")) : [];

  const exportAll = () => exportRowsToXlsx({
    fileName: "Physical_Verification_Dashboard",
    sheetName: "Counts",
    title: `Physical Verification — ${company ? companyName(company) : "all companies"} dashboard`,
    rows: [...rows].sort((a, b) => val(a) - val(b)),
    filters: [company ? `Company: ${companyName(company)}` : "", from ? `From ${fmtDate(from)}` : "", to ? `To ${fmtDate(to)}` : "", sub ? `Sub group: ${sub}` : "", who ? `Verifier: ${nameOf(who)}` : ""].filter(Boolean),
    notes: ["Difference = Physical − Tally closing at count time. Negative = SHORT (physical less), positive = EXTRA.",
      "Value = difference × Tally closing rate at count time."],
    columns: [
      { header: "Verification date", width: 14, value: (c) => fmtDate(c.verifyDate) },
      { header: "Company", width: 18, value: (c) => companyName(c.companyGuid) },
      { header: "Stock item", width: 40, value: (c) => c.item },
      { header: "Sub group", width: 22, value: (c) => c.subGroup ?? "" },
      { header: "Stock group", width: 24, value: (c) => c.group ?? "" },
      { header: "Status", width: 15, value: (c) => STATUS_LABEL[c.status] },
      { header: "Tally closing", width: 12, value: (c) => c.closingQty ?? "" },
      { header: "Physical", width: 12, value: (c) => c.physicalQty ?? "" },
      { header: "Difference", width: 12, value: (c) => c.difference ?? "" },
      { header: "Result", width: 10, value: (c) => (!counted(c) ? "" : isShort(c) ? "Short" : isExtra(c) ? "Extra" : "Matches") },
      { header: "Difference value", width: 14, value: (c) => (counted(c) ? Math.round(val(c)) : "") },
      { header: "Verifier", width: 20, value: (c) => nameOf(c.countedBy ?? c.assignedTo) },
      { header: "Remarks", width: 30, value: (c) => c.verifierRemarks ?? "" },
    ],
  });

  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-5">
      <PageHead
        kicker="Physical Verification · Dashboard"
        title="Verification dashboard"
        sub={<>{company ? companyName(company) : "All four companies"} — how many items are verified or pending, and where physical stock differs from Tally.</>}
        right={<Button variant="ghost" size="sm" onClick={exportAll} disabled={!rows.length}>Export Excel</Button>}
      />
      {pvQ.isError && <PvUnavailable error={pvQ.error} />}

      {/* Filters — one row, above everything they drive. */}
      <Card className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <label className="flex items-center gap-1.5 text-[12px] text-grey">Verification date
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          to
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </label>
        <select value={company} onChange={(e) => { setCompany(e.target.value); setSub(""); }} className={inputCls}>
          <option value="">All companies</option>
          {COMPANIES.map((co) => <option key={co.guid} value={co.guid}>{co.name}</option>)}
        </select>
        <select value={sub} onChange={(e) => setSub(e.target.value)} className={inputCls}>
          <option value="">All sub groups</option>
          {subs.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={who} onChange={(e) => setWho(e.target.value)} className={inputCls}>
          <option value="">All verifiers</option>
          {verifiers.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
        </select>
        {(from || to || sub || who || company) && (
          <button onClick={() => { setFrom(""); setTo(""); setSub(""); setWho(""); setCompany(""); }}
            className="text-[12px] font-semibold text-orange hover:underline">Reset filters</button>
        )}
      </Card>

      {pvQ.isLoading ? (
        <Card className="p-12 text-center text-[13px] text-grey">Loading…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center text-[13px] text-grey">No items scheduled yet{from || to || sub || who ? " for these filters" : ""}. Set verification dates on the Master.</Card>
      ) : (
        <>
          {/* ------------------------------------------------ progress */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="Items scheduled" value={rows.length} sub="all verification rounds" />
            <StatTile label="Done" value={done} sub={`${pct(done, rows.length)} counted`} tone="text-ryg-green" />
            <StatTile label="Pending to count" value={pending} sub={`${n("returned")} sent for recount`} tone="text-orange"
              onClick={() => setStage(stage === "scheduled" ? "" : "scheduled")} active={stage === "scheduled"} />
            <StatTile label="Awaiting review" value={n("submitted")} sub="counted, not yet accepted" tone="text-blue"
              onClick={() => setStage(stage === "submitted" ? "" : "submitted")} active={stage === "submitted"} />
            <StatTile label="Verified" value={n("accepted")} sub="accepted by review" tone="text-ryg-green"
              onClick={() => setStage(stage === "accepted" ? "" : "accepted")} active={stage === "accepted"} />
          </div>

          <Card className="px-4 py-3.5">
            <div className="mb-2 text-[13px] font-bold text-navy">Progress</div>
            <ProgressBar total={rows.length} parts={STAGES.map((s) => ({ label: s.label, n: n(s.key), bar: s.bar }))} />
          </Card>

          {stage && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <b className="text-[13px] text-navy">{stage === "scheduled" ? "Pending to count" : STATUS_LABEL[stage]} — {listRows.length} items</b>
                <button onClick={() => setStage("")} className="text-[12px] text-grey hover:text-navy">Close</button>
              </div>
              <div className="max-h-[300px] overflow-auto">
                <table className="w-full text-[12px]">
                  <tbody>
                    {listRows.map((c) => (
                      <tr key={c.id} className="border-b border-line/70">
                        <td className="px-3 py-1.5 font-medium text-navy">{c.item}</td>
                        <td className="px-3 py-1.5 text-grey">{c.subGroup ?? c.group}</td>
                        <td className="px-3 py-1.5">{fmtDate(c.verifyDate)}</td>
                        <td className="px-3 py-1.5">{nameOf(c.assignedTo)}</td>
                        <td className="px-3 py-1.5 text-right"><Diff value={c.difference} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ---------------------------------------------- difference */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <StatTile label="Matching" value={matching} sub={`of ${countedRows.length} counted — physical = Tally`} tone="text-ryg-green" />
            <StatTile label="Short (negative) — physical less" value={short.length}
              sub={`${fmtQty(Math.round(shortQty * 1000) / 1000)} qty · ${fmtInr(Math.abs(shortVal))}`} tone="text-ryg-red" />
            <StatTile label="Extra — physical more" value={extra.length}
              sub={`+${fmtQty(Math.round(extraQty * 1000) / 1000)} qty · ${fmtInr(extraVal)}`} tone="text-[#B7791F]" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DiffList title="Short items — physical LESS than Tally" hint="Negative difference, biggest ₹ first. Hover a row for who counted it and remarks."
              rows={short} bar={SHORT_BAR} nameOf={nameOf} />
            <DiffList title="Extra items — physical MORE than Tally" hint="Positive difference, biggest ₹ first."
              rows={extra} bar={EXTRA_BAR} nameOf={nameOf} />
          </div>

          {/* ---------------------------------------------- by sub group */}
          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-2.5">
              <div className="text-[14px] font-bold text-navy">By sub group</div>
              <div className="text-[11.5px] text-grey">Done vs scheduled, and the net ₹ difference (most negative first).</div>
            </div>
            <div className="overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-grey">
                    {["Sub group", "Progress", "Done", "Pending", "Short", "Extra", "Net value"].map((h, i) => (
                      <th key={h} className={cn("border-b border-line bg-page px-3 py-1.5 font-semibold", i > 1 && "text-right")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bySub.map((g) => (
                    <tr key={g.k} className="hover:bg-page/60">
                      <td className="border-b border-line/70 px-3 py-1.5 font-medium text-navy">{g.k}</td>
                      <td className="w-[220px] border-b border-line/70 px-3 py-1.5">
                        <div className="h-2 w-full rounded-full bg-page" title={`${g.done} of ${g.list.length} done`}>
                          <div className="h-2 rounded-full bg-ryg-green" style={{ width: `${(g.done / g.list.length) * 100}%` }} />
                        </div>
                      </td>
                      <td className="border-b border-line/70 px-3 py-1.5 text-right tabular-nums">{g.done} / {g.list.length}</td>
                      <td className="border-b border-line/70 px-3 py-1.5 text-right tabular-nums">{g.list.length - g.done}</td>
                      <td className="border-b border-line/70 px-3 py-1.5 text-right tabular-nums text-ryg-red">{g.short.length || ""}</td>
                      <td className="border-b border-line/70 px-3 py-1.5 text-right tabular-nums text-[#B7791F]">{g.extra.length || ""}</td>
                      <td className={cn("border-b border-line/70 px-3 py-1.5 text-right font-semibold tabular-nums",
                        g.net < 0 ? "text-ryg-red" : g.net > 0 ? "text-[#B7791F]" : "text-grey")}>
                        {g.net ? `${g.net > 0 ? "+" : "−"}${fmtInr(Math.abs(g.net))}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
