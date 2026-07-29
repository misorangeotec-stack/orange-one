import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { SectionHeading } from "@/shared/components/ui/Readout";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { useAssetStore } from "../store";
import DocLink from "./DocLink";
import type { Asset, ScheduleType } from "../types";

/**
 * A `type`, not an `interface`, deliberately: only a type alias gets an implicit
 * index signature, and these values are handed straight to an RPC typed
 * `Record<string, unknown>`.
 */
export type AssetFormValues = {
  name: string;
  category_id: string;
  make_id: string;
  model: string;
  serial_no: string;
  company_id: string;
  location_id: string;
  department_id: string;
  custodian_user_id: string;
  purchase_date: string;
  purchase_cost: string;
  vendor_id: string;
  invoice_no: string;
  warranty_months: string;
  condition_id: string;
  usage_unit_id: string;
  current_usage: string;
  usage_as_on: string;
  remarks: string;
};

const EMPTY: AssetFormValues = {
  name: "", category_id: "", make_id: "", model: "", serial_no: "",
  company_id: "", location_id: "", department_id: "", custodian_user_id: "",
  purchase_date: "", purchase_cost: "", vendor_id: "", invoice_no: "",
  warranty_months: "", condition_id: "", usage_unit_id: "", current_usage: "",
  usage_as_on: "", remarks: "",
};

export const valuesFromAsset = (a: Asset): AssetFormValues => ({
  name: a.name,
  category_id: a.categoryId ?? "",
  make_id: a.makeId ?? "",
  model: a.model ?? "",
  serial_no: a.serialNo ?? "",
  company_id: a.companyId ?? "",
  location_id: a.locationId ?? "",
  department_id: a.departmentId ?? "",
  custodian_user_id: a.custodianUserId ?? "",
  purchase_date: a.purchaseDate ?? "",
  purchase_cost: a.purchaseCost === null ? "" : String(a.purchaseCost),
  vendor_id: a.vendorId ?? "",
  invoice_no: a.invoiceNo ?? "",
  warranty_months: a.warrantyMonths === null ? "" : String(a.warrantyMonths),
  condition_id: a.conditionId ?? "",
  usage_unit_id: a.usageUnitId ?? "",
  current_usage: a.currentUsage === null ? "" : String(a.currentUsage),
  usage_as_on: a.usageAsOn ?? "",
  remarks: a.remarks ?? "",
});

/**
 * The asset intake form, shared by New and Edit.
 *
 * ON CREATE it also collects which SCHEDULE TRACKS the asset starts with — the
 * category's `defaultScheduleTypeIds` tick themselves, so adding a Vehicle
 * pre-offers Insurance + PUC + RC + Service. That is deliberate: an asset entered
 * without a single track is invisible to the reminder engine, and a register that
 * silently never reminds is worse than no register.
 *
 * ON EDIT the tracks are NOT here — they live on the asset detail page, where each
 * has its own dates and history.
 */
export default function AssetForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  withTracks = false,
}: {
  initial?: Asset;
  submitLabel: string;
  onSubmit: (values: AssetFormValues, trackTypeIds: string[]) => Promise<void>;
  onCancel: () => void;
  withTracks?: boolean;
}) {
  const s = useAssetStore();
  const [v, setV] = useState<AssetFormValues>(initial ? valuesFromAsset(initial) : EMPTY);
  const [trackIds, setTrackIds] = useState<string[]>([]);
  const [touchedTracks, setTouchedTracks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof AssetFormValues, val: string) => setV((prev) => ({ ...prev, [k]: val }));

  const activeTypes = useMemo(() => s.activeOf(s.scheduleTypes) as ScheduleType[], [s]);

  // Following the category's defaults, until the user overrides them by hand.
  useEffect(() => {
    if (!withTracks || touchedTracks) return;
    const cat = s.categories.find((c) => c.id === v.category_id);
    const live = new Set(activeTypes.map((t) => t.id));
    setTrackIds((cat?.defaultScheduleTypeIds ?? []).filter((id) => live.has(id)));
  }, [v.category_id, withTracks, touchedTracks, s.categories, activeTypes]);

  const opts = (rows: { id: string; name: string }[]): ComboOption[] =>
    rows.map((r) => ({ value: r.id, label: r.name }));

  const peopleOpts: ComboOption[] = s.people.map((p) => ({ value: p.id, label: p.name }));

  const submit = async () => {
    if (busy) return;
    if (!v.name.trim()) { setError("Give the asset a name."); return; }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v, trackIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <SectionHeading>What it is</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FieldLabel label="Asset name" required hint="How people refer to it — “Honda City”, “AC — Reception”.">
            <TextInput value={v.name} onChange={(e) => set("name", e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Category" hint="Decides which tracks are pre-offered below.">
            <Combobox value={v.category_id} onChange={(x) => set("category_id", x)}
              options={opts(s.activeOf(s.categories))} placeholder="Select…" searchable />
          </FieldLabel>
          <FieldLabel label="Make">
            <Combobox value={v.make_id} onChange={(x) => set("make_id", x)}
              options={opts(s.activeOf(s.makes))} placeholder="Select…" searchable />
          </FieldLabel>
          <FieldLabel label="Model">
            <TextInput value={v.model} onChange={(e) => set("model", e.target.value)} />
          </FieldLabel>
          <FieldLabel
            label="Serial / registration no."
            hint="Registration number, machine serial, service tag. Must be unique — it is what stops the same unit being registered twice."
          >
            <TextInput value={v.serial_no} onChange={(e) => set("serial_no", e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Condition">
            <Combobox value={v.condition_id} onChange={(x) => set("condition_id", x)}
              options={opts(s.activeOf(s.conditions))} placeholder="Select…" />
          </FieldLabel>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <SectionHeading>Where it is and who looks after it</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FieldLabel label="Company">
            <Combobox value={v.company_id} onChange={(x) => set("company_id", x)}
              options={opts(s.activeOf(s.companies))} placeholder="Select…" searchable />
          </FieldLabel>
          <FieldLabel label="Location">
            <Combobox value={v.location_id} onChange={(x) => set("location_id", x)}
              options={opts(s.activeOf(s.locations))} placeholder="Select…" searchable />
          </FieldLabel>
          <FieldLabel label="Department">
            <Combobox value={v.department_id} onChange={(x) => set("department_id", x)}
              options={opts(s.departments)} placeholder="Select…" searchable />
          </FieldLabel>
          <FieldLabel
            label="Custodian"
            hint="Answerable for this asset. Gets every reminder, and can schedule and record its services without being a step owner."
          >
            <Combobox value={v.custodian_user_id} onChange={(x) => set("custodian_user_id", x)}
              options={peopleOpts} placeholder="Select…" searchable />
          </FieldLabel>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <SectionHeading>Purchase</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FieldLabel label="Purchase date">
            <TextInput type="date" value={v.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Purchase cost (₹)">
            <TextInput inputMode="decimal" value={v.purchase_cost} onChange={(e) => set("purchase_cost", e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Bought from">
            <Combobox value={v.vendor_id} onChange={(x) => set("vendor_id", x)}
              options={opts(s.activeOf(s.vendors))} placeholder="Select…" searchable />
          </FieldLabel>
          <FieldLabel label="Invoice no.">
            <TextInput value={v.invoice_no} onChange={(e) => set("invoice_no", e.target.value)} />
          </FieldLabel>
          <FieldLabel
            label="Warranty (months)"
            hint="Creates a Warranty Expiry track automatically, so the warranty reminds through the same engine as everything else."
          >
            <TextInput inputMode="numeric" value={v.warranty_months} onChange={(e) => set("warranty_months", e.target.value)} />
          </FieldLabel>
          {initial?.invoicePath && (
            <FieldLabel label="Purchase invoice">
              <DocLink path={initial.invoicePath} name={initial.invoiceName} />
            </FieldLabel>
          )}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <SectionHeading>Metering (optional)</SectionHeading>
        <p className="-mt-2 text-[12.5px] text-grey-2">
          For vehicles and machinery serviced by distance or running hours as well as by date. The
          date reminder is the automatic one; a usage-based service is raised when someone logs a
          reading, because no nightly job can know an odometer.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FieldLabel label="Usage unit">
            <Combobox value={v.usage_unit_id} onChange={(x) => set("usage_unit_id", x)}
              options={opts(s.activeOf(s.usageUnits))} placeholder="Select…" />
          </FieldLabel>
          <FieldLabel label="Current reading">
            <TextInput inputMode="decimal" value={v.current_usage} onChange={(e) => set("current_usage", e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Reading as on">
            <TextInput type="date" value={v.usage_as_on} onChange={(e) => set("usage_as_on", e.target.value)} />
          </FieldLabel>
        </div>
      </Card>

      {withTracks && (
        <Card className="space-y-3 p-5">
          <SectionHeading>What needs tracking</SectionHeading>
          <p className="-mt-1 text-[12.5px] text-grey-2">
            Pre-filled from the category. You will set each one's next due date on the asset page
            straight after saving — an asset with no tracks never reminds anybody.
          </p>
          <MultiSelect
            values={trackIds}
            onChange={(next) => { setTouchedTracks(true); setTrackIds(next); }}
            options={activeTypes.map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Select what to track…"
            searchable
          />
        </Card>
      )}

      <Card className="space-y-4 p-5">
        <FieldLabel label="Remarks">
          <TextArea rows={2} value={v.remarks} onChange={(e) => set("remarks", e.target.value)} />
        </FieldLabel>
      </Card>

      {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}
