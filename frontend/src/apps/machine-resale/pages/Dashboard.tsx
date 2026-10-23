import { useMemo } from "react";
import KpiRow from "@/shared/components/dashboard/KpiRow";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { PageHeader } from "../components/Pills";
import { thisWeekIst } from "../lib/format";
import { B } from "../nav";
import { useMrStore } from "../store";

interface PersonRow {
  key: string;
  name: string;
  total: number;
  fresh: number;
  open: number;
  won: number;
  lost: number;
}

export default function Dashboard() {
  const s = useMrStore();
  const week = useMemo(() => thisWeekIst(), []);

  const statusName = (id: string | null) => s.masterById(id)?.value ?? "";
  const count = (st: string) => s.machines.filter((m) => m.status === st).length;
  const newThisWeek = s.inquiries.filter((i) => {
    const t = new Date(i.createdAt).getTime();
    return t >= week.from.getTime() && t < week.to.getTime();
  }).length;
  // "Not yet answered" is literal: still at New, nobody has moved it on.
  const unanswered = s.inquiries.filter((i) => statusName(i.statusId) === "New").length;

  const people = useMemo<PersonRow[]>(() => {
    const by = new Map<string, PersonRow>();
    for (const i of s.inquiries) {
      const key = i.salespersonId ?? `name:${i.salespersonName ?? ""}`;
      const row = by.get(key) ?? { key, name: i.salespersonName ?? "", total: 0, fresh: 0, open: 0, won: 0, lost: 0 };
      const st = s.masterById(i.statusId)?.value ?? "";
      row.total += 1;
      if (st === "New") row.fresh += 1;
      else if (st === "Closed won") row.won += 1;
      else if (st === "Closed lost") row.lost += 1;
      else row.open += 1;
      by.set(key, row);
    }
    return [...by.values()];
  }, [s]);

  const numCol = (key: keyof PersonRow & string, header: string): QueueColumn<PersonRow> => ({
    key,
    header,
    align: "right",
    cell: (r) => <span className="tabular-nums">{r[key]}</span>,
    sortValue: (r) => r[key] as number,
    exportValue: (r) => r[key] as number,
    filter: { kind: "number", get: (r) => r[key] as number },
  });

  const columns: QueueColumn<PersonRow>[] = [
    {
      key: "name",
      header: "Salesperson",
      cell: (r) => <span className="font-medium text-navy">{r.name || "(No salesperson)"}</span>,
      sortValue: (r) => r.name,
      exportValue: (r) => r.name,
      filter: { kind: "select", get: (r) => r.name },
    },
    numCol("total", "Inquiries"),
    numCol("fresh", "New"),
    numCol("open", "In follow-up"),
    numCol("won", "Closed won"),
    numCol("lost", "Closed lost"),
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Machine Resale" sub="Pre-owned printers on the resale website, and the inquiries they bring in." />
      <KpiRow
        tiles={[
          { key: "active", label: "Active machines", value: count("active"), hint: "On the website now", href: `${B}/machines` },
          { key: "inactive", label: "Inactive machines", value: count("inactive"), hint: "Hidden from the website", href: `${B}/machines` },
          { key: "sold", label: "Sold machines", value: count("sold"), hint: "Shown with a Sold ribbon", href: `${B}/machines` },
          { key: "week", label: "New inquiries this week", value: newThisWeek, hint: week.label, href: `${B}/inquiries` },
          { key: "new", label: "Not yet answered", value: unanswered, hint: "Inquiries still at New", tone: unanswered ? "red" : undefined, href: `${B}/inquiries` },
        ]}
      />
      <div>
        <h2 className="mb-2 text-[15px] font-bold text-navy">Inquiries per salesperson</h2>
        <QueueTable<PersonRow>
          rows={people}
          rowKey={(r) => r.key}
          columns={columns}
          rowsLabel="salespeople"
          initialSort={{ key: "total", dir: "desc" }}
          emptyTitle="No inquiries yet"
          emptyMessage="Inquiries from the website, and any added by hand, are counted here."
          exportName="Inquiries_per_salesperson"
        />
      </div>
    </div>
  );
}
