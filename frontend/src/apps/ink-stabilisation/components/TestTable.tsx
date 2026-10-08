import { useMemo, useState } from "react";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { daysBetween, fmtDate } from "../lib/schedule";
import { RESULT_LABEL, STATUS_LABEL, type FlowData, type FlowTest } from "../lib/flow";
import { fmtStamp, ResultPill, StatusPill } from "./FlowParts";
import { categoryLabel } from "./PendingByCategory";

/**
 * The one table both queues use: a row per test, click to open.
 *
 * A filter sits under every column heading. Each one lists only the values the OTHER
 * filters still leave, so picking an item never offers a lot that item does not have.
 */

type ColKey = "due" | "test" | "company" | "item" | "lot" | "prod" | "submitted" | "holder" | "result" | "files" | "status";

const filterClass =
  "h-8 w-full min-w-0 rounded-lg border border-line bg-white px-2 text-[12px] text-ink " +
  "focus:outline-none focus:ring-2 focus:ring-orange/25 focus:border-orange/50";

export default function TestTable({
  rows, flow, today, onOpen, actionLabel, showSubmitted, showCompany, showHolder, extraAction, resetKey,
}: {
  rows: FlowTest[];
  flow: FlowData | undefined;
  today: string;
  onOpen: (t: FlowTest) => void;
  actionLabel: (t: FlowTest) => string;
  showSubmitted?: boolean;
  /** Closing stock pages: a Company column. */
  showCompany?: boolean;
  /** Management review: who the test is with (an assignee, or Management). */
  showHolder?: boolean;
  /** A second row button beside the main one — Management review's Reassign. */
  extraAction?: { label: string; show: (t: FlowTest) => boolean; onClick: (t: FlowTest) => void };
  resetKey: string;
}) {
  const person = useOrgPersonById();
  const [filters, setFilters] = useState<Partial<Record<ColKey, string[]>>>({});

  const filesOf = (t: FlowTest) => (t.record ? flow?.docs.get(t.record.id)?.length ?? 0 : 0);
  const holderOf = (t: FlowTest) =>
    t.status !== "submitted" ? "—" : t.record?.assignedTo ? person(t.record.assignedTo)?.name ?? "Someone" : "Management";

  /** The text a column filters on — the same text the cell shows. */
  const valueOf = (t: FlowTest, k: ColKey): string => {
    switch (k) {
      case "due": return fmtDate(t.due);
      case "test": return `Test ${t.no}`;
      case "company": return t.lot.company ?? "Enterprises Surat";
      case "holder": return holderOf(t);
      case "item": return t.lot.item;
      case "lot": return t.lot.lot;
      case "prod": return fmtDate(t.lot.prod);
      case "submitted": return person(t.record?.submittedBy ?? null)?.name ?? "—";
      case "result": return t.record?.result ? RESULT_LABEL[t.record.result] : "—";
      case "files": return filesOf(t) ? "With files" : "No files";
      case "status": return STATUS_LABEL[t.status];
    }
  };

  const cols: { key: ColKey; label: string; sortByDate?: boolean }[] = [
    { key: "due", label: "Due date", sortByDate: true },
    { key: "test", label: "Test" },
    ...(showCompany ? [{ key: "company" as const, label: "Company" }] : []),
    { key: "item", label: "Stock item" },
    { key: "lot", label: "Lot no." },
    { key: "prod", label: showCompany ? "Prod. / purchase" : "Production", sortByDate: true },
    ...(showSubmitted ? [{ key: "submitted" as const, label: "Submitted" }] : []),
    ...(showHolder ? [{ key: "holder" as const, label: "With" }] : []),
    { key: "result", label: "Lab result" },
    { key: "files", label: "Files" },
    { key: "status", label: "Status" },
  ];

  const passes = (t: FlowTest, except?: ColKey) =>
    cols.every((c) => c.key === except || !filters[c.key]?.length || filters[c.key]!.includes(valueOf(t, c.key)));

  const filtered = useMemo(() => rows.filter((t) => passes(t)), [rows, filters, flow]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = (c: { key: ColKey; sortByDate?: boolean }) => {
    const seen = new Map<string, string>(); // value -> sort key
    for (const t of rows) {
      if (!passes(t, c.key)) continue;
      const v = valueOf(t, c.key);
      if (!seen.has(v)) seen.set(v, c.key === "due" ? t.due : c.key === "prod" ? t.lot.prod : v);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([v]) => ({ value: v, label: v }));
  };

  const active = Object.values(filters).some((v) => v?.length);
  const pg = usePagination(filtered, { pageSize: 50, resetKey: `${resetKey}|${JSON.stringify(filters)}` });
  const th = "px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-grey whitespace-nowrap";
  const td = "px-3 py-2 text-[12.5px] whitespace-nowrap";

  return (
    <>
      {active && (
        <div className="flex items-center gap-2 px-4 pb-2 text-[12px] text-grey">
          Column filters on — {filtered.length} of {rows.length} shown.
          <button className="font-semibold text-orange hover:underline" onClick={() => setFilters({})}>Clear filters</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-y border-line bg-page">
            <tr>
              {cols.map((c) => <th key={c.key} className={th}>{c.label}</th>)}
              <th className={th} />
            </tr>
            <tr className="border-t border-line bg-page/40">
              {cols.map((c) => (
                <th key={c.key} className="min-w-[110px] px-1.5 py-1.5 font-normal">
                  <MultiSelect
                    values={filters[c.key] ?? []}
                    onChange={(next) => setFilters((f) => ({ ...f, [c.key]: next }))}
                    options={options(c)}
                    placeholder="All"
                    searchable
                    triggerClassName={filterClass}
                  />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {pg.pageItems.map((t) => {
              const late = t.status !== "closed" && t.status !== "submitted" && t.due < today;
              const files = filesOf(t);
              return (
                <tr key={t.key} className="cursor-pointer border-b border-line transition hover:bg-orange/[0.04]" onClick={() => onOpen(t)}>
                  <td className={td}>
                    <div className="font-semibold text-ink">{fmtDate(t.due)}</div>
                    {late && <div className="text-[11px] text-ryg-red">{daysBetween(t.due, today)} d past due</div>}
                  </td>
                  <td className={td}>Test {t.no}</td>
                  {showCompany && <td className={`${td} text-grey`}>{t.lot.company ?? "Enterprises Surat"}</td>}
                  <td className={td}>
                    <div className="font-medium text-ink">{t.lot.item}</div>
                    <div className="text-[11px] text-grey">{categoryLabel(t.lot.category)} · {t.lot.family}</div>
                  </td>
                  <td className={`${td} font-mono`}>{t.lot.lot}</td>
                  <td className={td}>{fmtDate(t.lot.prod)}</td>
                  {showSubmitted && (
                    <td className={td}>
                      <div>{person(t.record?.submittedBy ?? null)?.name ?? "—"}</div>
                      <div className="text-[11px] text-grey">{fmtStamp(t.record?.submittedAt ?? null)}</div>
                    </td>
                  )}
                  {showHolder && (
                    <td className={td}>
                      <span className={t.record?.assignedTo && t.status === "submitted" ? "font-semibold text-orange" : "text-grey"}>{holderOf(t)}</span>
                    </td>
                  )}
                  <td className={td}>
                    <ResultPill result={t.record?.result} />
                    {t.record?.labPerson && <div className="text-[11px] text-grey">{t.record.labPerson}</div>}
                  </td>
                  <td className={td}>{files || "—"}</td>
                  <td className={td}><StatusPill status={t.status} /></td>
                  <td className={`${td} text-right`}>
                    {extraAction?.show(t) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); extraAction.onClick(t); }}
                        className="mr-2 inline-flex rounded-button border border-orange px-3 py-1.5 text-[12px] font-bold text-orange hover:bg-orange/10">
                        {extraAction.label}
                      </button>
                    )}
                    {actionLabel(t) === "View" ? (
                      <span className="text-[12.5px] font-semibold text-grey hover:text-navy">View →</span>
                    ) : (
                      <span className="inline-flex rounded-button bg-orange px-3 py-1.5 text-[12px] font-bold text-white shadow-cta">
                        {actionLabel(t)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {pg.pageItems.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="px-4 py-10 text-center text-[13px] text-grey">Nothing here.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination state={pg} rowsLabel="tests" pageSizeOptions={[50, 100, 250]} />
    </>
  );
}
