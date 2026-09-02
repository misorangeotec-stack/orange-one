import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import DateRangeFilter, {
  EMPTY_RANGE, dateInRange, isRangeActive, rangeLabel, type DateRange,
} from "@/shared/components/ui/DateRangeFilter";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useOcpiStore } from "../../store";
import { OCPI_MASTERS_QK, fetchOcpiMasters } from "../../data/ocpiMasters";
import { exportDealRegister } from "../../lib/exportRegister";
import { exportTemplateComparison } from "../../lib/exportTemplateComparison";
import { STATUS_LABEL } from "../../lib/format";
import DealsTable from "../deals/DealsTable";
import type { OcpiStatus } from "../../types";

/**
 * Derived, never re-listed. A hand-written array of statuses type-checks happily
 * when an eleventh is added, so a new status would silently drop out of the
 * filter and become unfindable here. `STATUS_LABEL` is exhaustive over
 * `OcpiStatus`, so taking its keys cannot drift.
 */
const STATUSES = Object.keys(STATUS_LABEL) as OcpiStatus[];

/**
 * The Deal Register — filter, look, export.
 *
 * ⚠ THE TABLE IS THE SAME `DealsTable` the three lists use. A register with its
 *   own columns would be a fourth place to keep in step, and the first thing to
 *   fall behind would be the one people print.
 *
 * ⚠ THE EXPORT CARRIES THE FILTERS, in words, on its About sheet. A spreadsheet
 *   mailed to a director with no note of what was excluded is how "we only did
 *   eleven deals last quarter" gets said out loud.
 */
export default function DealRegister() {
  const s = useOcpiStore();

  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);
  const [status, setStatus] = useState<OcpiStatus | "">("");
  const [machineId, setMachineId] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [customer, setCustomer] = useState("");

  const { data: masters } = useQuery({
    queryKey: OCPI_MASTERS_QK,
    queryFn: fetchOcpiMasters,
    staleTime: 30 * 60 * 1000,
  });
  const { data: people } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60 * 1000,
  });

  // Matched as a CONTAINS, not an equals: people quote a customer partially off
  // a mail thread far more often than they retype the ledger name in full.
  const custQuery = customer.trim().toLowerCase();

  const rows = useMemo(
    () =>
      s.deals.filter(
        (d) =>
          (!isRangeActive(range) || dateInRange(d.createdAt, range)) &&
          (!status || d.status === status) &&
          (!machineId || d.machineId === machineId) &&
          (!salesperson || d.salespersonName === salesperson) &&
          (!custQuery || (d.customerName ?? "").toLowerCase().includes(custQuery)),
      ),
    [s.deals, range, status, machineId, salesperson, custQuery],
  );

  const salespeople = useMemo(
    () => Array.from(new Set(s.deals.map((d) => d.salespersonName).filter(Boolean) as string[])).sort(),
    [s.deals],
  );

  const filters = useMemo(() => {
    const out: string[] = [];
    if (isRangeActive(range)) out.push(`Raised: ${rangeLabel(range)}`);
    if (status) out.push(`Status: ${STATUS_LABEL[status]}`);
    if (machineId) out.push(`Machine: ${s.machineById(machineId)?.name ?? machineId}`);
    if (salesperson) out.push(`Salesperson: ${salesperson}`);
    if (custQuery) out.push(`Customer contains: ${customer.trim()}`);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, status, machineId, salesperson, custQuery, customer, s.machines]);

  /**
   * The template comparison workbook (OCPI-5).
   *
   * Everything it needs is already in the module snapshot — machines, their
   * sections and the categories — so it reads nothing new and writes nothing.
   */
  function downloadTemplates() {
    return exportTemplateComparison({
      categories: s.machineCategories,
      machines: s.machines,
      sections: s.machineSections,
    });
  }

  function download() {
    return exportDealRegister(
      rows,
      {
        machineById: s.machineById,
        companyName: (id) =>
          (id ? masters?.companies.find((c) => c.id === id)?.name : "") ?? "",
        personName: (id) => (id ? people?.find((p) => p.id === id)?.name ?? "" : ""),
      },
      filters,
    );
  }

  const clear = () => {
    setRange(EMPTY_RANGE);
    setStatus("");
    setMachineId("");
    setSalesperson("");
    setCustomer("");
  };

  const anyFilter = filters.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">Deal Register</h1>
          <p className="mt-0.5 text-[13.5px] text-grey-2">
            Every deal, at every stage. Filter it, then take the spreadsheet.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            ⚠ NOT A SCREEN, AND NOT A FILTER ON THIS ONE (OCPI-5). The ask is a
              spreadsheet with a tab per machine category and one column per
              machine — a ten-column diff grid is a spreadsheet's job, not a
              table's. It shares nothing with the register above it except the
              page, which is where a person already comes to take a file away.
          */}
          <Button variant="ghost" onClick={() => void downloadTemplates()} disabled={s.machines.length === 0}>
            Template comparison
          </Button>
          <Button onClick={() => void download()} disabled={rows.length === 0}>
            Export {rows.length} {rows.length === 1 ? "deal" : "deals"}
          </Button>
        </div>
      </div>

      <p className="-mt-1 text-[12.5px] text-grey-2">
        Template comparison lays every machine's order-confirmation template side by side, one tab per
        category, and marks the lines that differ, are missing, or only one machine carries.
      </p>

      <Card className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FieldLabel label="Raised between">
            <DateRangeFilter value={range} onChange={setRange} />
          </FieldLabel>
          <FieldLabel label="Status">
            <Combobox
              value={status}
              onChange={(v) => setStatus(v as OcpiStatus | "")}
              options={STATUSES.map((k) => ({ value: k, label: STATUS_LABEL[k] }))}
              placeholder="Any status"
              searchable
              clearable
            />
          </FieldLabel>
          <FieldLabel label="Machine">
            <Combobox
              value={machineId}
              onChange={setMachineId}
              options={s.machines.map((m) => ({ value: m.id, label: m.name }))}
              placeholder="Any machine"
              searchable
              clearable
            />
          </FieldLabel>
          <FieldLabel label="Salesperson">
            <Combobox
              value={salesperson}
              onChange={setSalesperson}
              options={salespeople.map((n) => ({ value: n, label: n }))}
              placeholder="Anyone"
              searchable
              clearable
            />
          </FieldLabel>
          <FieldLabel label="Customer" hint="matches any part of the name">
            <TextInput
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="e.g. Shree"
            />
          </FieldLabel>
        </div>

        {anyFilter && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-grey-2">{filters.join(" · ")}</span>
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      <DealsTable
        rows={rows}
        emptyTitle="No deals yet"
        emptyMessage="A deal appears here as soon as somebody saves a quotation draft."
      />
    </div>
  );
}
