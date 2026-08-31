import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Tabs from "@/shared/components/ui/Tabs";
import MasterCrud, { type MasterColumn } from "@/shared/components/ui/MasterCrud";
import { useTravelStore } from "../../store";
import { masterFields, emptyValuesFor, missingRequired } from "../../lib/masterFields";
import { money } from "../../lib/format";
import {
  EXPENSE_KIND_LABEL,
  type TravelCity, type TravelPurpose, type TravelExpenseCategory,
  type TravelHotel, type TravelNamedMaster, type TravelMasterType,
} from "../../types";

type Tab = Exclude<TravelMasterType, "rate_card">;

const TABS: { key: Tab; label: string; singular: string }[] = [
  { key: "city",             label: "Cities",             singular: "City" },
  { key: "purpose",          label: "Purposes",           singular: "Purpose" },
  { key: "expense_category", label: "Expense categories", singular: "Expense category" },
  { key: "airline",          label: "Airlines",           singular: "Airline" },
  { key: "hotel",            label: "Hotels",             singular: "Hotel" },
  { key: "bus_operator",     label: "Bus operators",      singular: "Bus operator" },
];

const TIER_TEXT: Record<number, string> = { 1: "Tier 1", 2: "Tier 2", 3: "Tier 3" };

/**
 * The lists the trip form and the expense claim choose from.
 *
 * Every tab is a `MasterCrud`, so each gets sort on every column, a cascading
 * filter under every column, an Excel round trip and deactivate-never-delete
 * without any of it being written here.
 *
 * ⚠ THE RATE CARD IS NOT A TAB HERE, on purpose. A 4×3 grid of caps that a
 *   Director signs off is not a list of names, and flattening it into rows
 *   ("TC-C / Tier 1 / 1750") would make it unreadable exactly where it matters
 *   most. It has its own screen — the same reasoning that gave OCPI's machine
 *   templates a real editor instead of a JSON blob in a textarea.
 */
export default function Masters() {
  const s = useTravelStore();
  const [tab, setTab] = useState<Tab>("city");

  const cityOptions = useMemo(
    () =>
      s.cities
        .filter((c) => c.active)
        .map((c) => ({ value: c.id, label: c.name, sublabel: TIER_TEXT[c.tier] })),
    [s.cities],
  );

  const ctx = useMemo(() => ({ cityOptions }), [cityOptions]);

  const singular = TABS.find((t) => t.key === tab)?.singular ?? "Row";
  const canManage = s.canManageMaster(tab);

  const common = {
    fields: masterFields(tab, ctx),
    emptyValues: emptyValuesFor(tab),
    canManage,
    createHint: canManage
      ? undefined
      : "You do not own this list. Use Master Requests to ask for a value to be added.",
    onSubmit: async (id: string | null, values: Record<string, string>, active: boolean) => {
      const missing = missingRequired(tab, values);
      if (missing) throw new Error(missing);
      await s.saveMaster(tab, id, values, active);
    },
    onToggleActive: async (row: { id: string }, active: boolean) => {
      await s.setMasterActive(tab, row.id, active);
    },
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Travel Desk masters</h1>
        <p className="mt-1 max-w-3xl text-[13.5px] text-grey-2">
          The lists a trip request and an expense claim choose from. A row is switched{" "}
          <strong>off</strong> rather than deleted, so a claim raised last quarter still reads
          correctly.
        </p>
      </div>

      <Card className="p-4">
        <Tabs
          tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
          active={tab}
          onChange={(k) => setTab(k as Tab)}
        />

        <div className="pt-4">
          {tab === "city" && (
            <>
              <p className="mb-3 text-[13px] text-grey-2">
                The <strong>tier</strong> is what prices a trip: it decides the hotel cap, the daily
                allowance and the local conveyance cap. Policy §1.3 names the Tier 1 and Tier 2
                cities; everything else is Tier 3 by that section&rsquo;s own definition. Note{" "}
                <strong>Surat is Tier 2</strong> — the head office is not a metro under this policy.
              </p>
              <MasterCrud<TravelCity>
                {...common}
                key={tab}
                singular={singular}
                rows={s.cities}
                defaultOrder={(r) => r.sortOrder}
                searchText={(r) => `${r.name} ${r.state ?? ""} ${TIER_TEXT[r.tier]}`}
                toValues={(r) => ({
                  name: r.name,
                  state: r.state ?? "",
                  tier: String(r.tier),
                })}
                columns={[
                  { header: "City", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
                  { header: "State", render: (r) => r.state ?? "—" },
                  {
                    header: "Tier",
                    render: (r) => TIER_TEXT[r.tier],
                    // Ordered by the NUMBER, not by the rendered label — which
                    // happens to sort the same way here, but would not if a tier
                    // were ever renamed.
                    sortValue: (r) => r.tier,
                    filter: { get: (r) => TIER_TEXT[r.tier] },
                  },
                ] as MasterColumn<TravelCity>[]}
              />
            </>
          )}

          {tab === "purpose" && (
            <MasterCrud<TravelPurpose>
              {...common}
              key={tab}
              singular={singular}
              rows={s.purposes}
              defaultOrder={(r) => r.sortOrder}
              searchText={(r) => r.name}
              toValues={(r) => ({ name: r.name, requires_remarks: r.requiresRemarks ? "Yes" : "No" })}
              columns={[
                { header: "Purpose", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
                {
                  header: "Needs a reason",
                  render: (r) => (r.requiresRemarks ? "Yes" : "No"),
                  filter: { get: (r) => (r.requiresRemarks ? "Yes" : "No") },
                },
              ] as MasterColumn<TravelPurpose>[]}
            />
          )}

          {tab === "expense_category" && (
            <>
              <p className="mb-3 text-[13px] text-grey-2">
                Everything Policy §15 refuses is a row here with <strong>Company pays = No</strong>,
                so the category itself declines and no approver has to be the one to say no. The
                reason is shown to whoever tries to claim it.
              </p>
              <MasterCrud<TravelExpenseCategory>
                {...common}
                key={tab}
                singular={singular}
                rows={s.expenseCategories}
                defaultOrder={(r) => r.sortOrder}
                searchText={(r) => `${r.name} ${EXPENSE_KIND_LABEL[r.kind]} ${r.refusalNote ?? ""}`}
                toValues={(r) => ({
                  name: r.name,
                  kind: r.kind,
                  reimbursable: r.reimbursable ? "Yes" : "No",
                  receipt_required_above: r.receiptRequiredAbove === null ? "" : String(r.receiptRequiredAbove),
                  self_declaration_cap: r.selfDeclarationCap === null ? "" : String(r.selfDeclarationCap),
                  needs_guest_details: r.needsGuestDetails ? "Yes" : "No",
                  refusal_note: r.refusalNote ?? "",
                })}
                columns={[
                  { header: "Category", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
                  {
                    header: "Kind",
                    render: (r) => EXPENSE_KIND_LABEL[r.kind],
                    filter: { get: (r) => EXPENSE_KIND_LABEL[r.kind] },
                  },
                  {
                    header: "Company pays",
                    render: (r) =>
                      r.reimbursable ? (
                        "Yes"
                      ) : (
                        <span className="font-semibold text-ryg-red">No</span>
                      ),
                    filter: { get: (r) => (r.reimbursable ? "Yes" : "No") },
                  },
                  {
                    header: "Receipt above",
                    render: (r) =>
                      r.receiptRequiredAbove === null ? "Always" : money(r.receiptRequiredAbove),
                    // Sorted by the figure. "Always" is the strictest rule, so it
                    // sorts as zero rather than to the bottom alphabetically.
                    sortValue: (r) => r.receiptRequiredAbove ?? 0,
                  },
                  {
                    header: "Self-declared up to",
                    render: (r) => (r.selfDeclarationCap === null ? "—" : money(r.selfDeclarationCap)),
                    sortValue: (r) => r.selfDeclarationCap ?? -1,
                  },
                ] as MasterColumn<TravelExpenseCategory>[]}
              />
            </>
          )}

          {tab === "airline" && (
            <MasterCrud<TravelNamedMaster>
              {...common}
              key={tab}
              singular={singular}
              rows={s.airlines}
              defaultOrder={(r) => r.sortOrder}
              searchText={(r) => r.name}
              toValues={(r) => ({ name: r.name })}
              columns={[
                { header: "Airline", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
              ] as MasterColumn<TravelNamedMaster>[]}
            />
          )}

          {tab === "hotel" && (
            <MasterCrud<TravelHotel>
              {...common}
              key={tab}
              singular={singular}
              rows={s.hotels}
              defaultOrder={(r) => r.sortOrder}
              searchText={(r) => `${r.name} ${s.cityById(r.cityId)?.name ?? ""}`}
              toValues={(r) => ({ name: r.name, city_id: r.cityId ?? "" })}
              columns={[
                { header: "Hotel", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
                {
                  header: "City",
                  render: (r) => s.cityById(r.cityId)?.name ?? "—",
                  filter: { get: (r) => s.cityById(r.cityId)?.name ?? "—" },
                },
              ] as MasterColumn<TravelHotel>[]}
            />
          )}

          {tab === "bus_operator" && (
            <MasterCrud<TravelNamedMaster>
              {...common}
              key={tab}
              singular={singular}
              rows={s.busOperators}
              defaultOrder={(r) => r.sortOrder}
              searchText={(r) => r.name}
              toValues={(r) => ({ name: r.name })}
              columns={[
                { header: "Operator", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
              ] as MasterColumn<TravelNamedMaster>[]}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
