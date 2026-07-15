import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { useSuppliesStore } from "../../store";
import RequestMasterModal from "../../components/RequestMasterModal";
import type { RequestType } from "../../types";

const LOCATIONS: ComboOption[] = [
  { value: "Plant", label: "Plant" },
  { value: "Office", label: "Office" },
];
const TYPES: ComboOption[] = [
  { value: "new_requirement", label: "New requirement" },
  { value: "services_maintenance", label: "Services / Maintenance" },
];

/**
 * The in-app intake form — the branching MS-Form rebuilt natively.
 *
 * Company · Location · Department · (for someone else?) · Type → then either
 * Category → Item → Reason → Quantity (New requirement) or Service type → Reason →
 * Quantity (Services/Maintenance). The routing is previewed live from the category.
 */
export default function NewRequest() {
  const s = useSuppliesStore();
  const session = useSession();
  const navigate = useNavigate();

  const [companyId, setCompanyId] = useState("");
  const [location, setLocation] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [onBehalf, setOnBehalf] = useState(false);
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [beneficiaryUserId, setBeneficiaryUserId] = useState("");
  const [requestType, setRequestType] = useState<RequestType>("new_requirement");
  const [categoryId, setCategoryId] = useState("");
  const [itemId, setItemId] = useState("");
  const [otherItem, setOtherItem] = useState("");
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [otherService, setOtherService] = useState("");
  const [reason, setReason] = useState("");
  const [quantity, setQuantity] = useState("");

  const [raisingItem, setRaisingItem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const companyOptions: ComboOption[] = s.activeCompanies.map((c) => ({ value: c.id, label: c.name }));
  const deptOptions: ComboOption[] = s.activeDepartments.map((d) => ({ value: d.id, label: d.name }));
  const categoryOptions: ComboOption[] = s.activeCategories.map((c) => ({
    value: c.id,
    label: c.name,
    sublabel: c.requiresApproval ? "Needs first + second approval" : "Straight to handover",
  }));
  const itemOptions: ComboOption[] = useMemo(
    () => (categoryId ? s.itemsForCategory(categoryId).map((i) => ({ value: i.id, label: i.name })) : []),
    [categoryId, s],
  );
  const serviceOptions: ComboOption[] = s.activeServiceTypes.map((t) => ({ value: t.id, label: t.name }));
  const peopleOptions: ComboOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles],
  );

  const chosenCategory = s.categoryById(categoryId);
  const chosenItem = itemId ? s.itemsForCategory(categoryId).find((i) => i.id === itemId) : undefined;
  const isOtherItem = (chosenItem?.name ?? "").toLowerCase() === "other";
  const chosenService = serviceTypeId ? s.serviceTypeById(serviceTypeId) : undefined;
  const isOtherService = (chosenService?.name ?? "").toLowerCase() === "other";

  const routeHint =
    requestType === "services_maintenance"
      ? "Services/Maintenance requests go straight to handover — no approvals."
      : chosenCategory
        ? chosenCategory.requiresApproval
          ? "This category needs first approval (HOD) and second approval (Management), then handover."
          : "This category goes straight to handover — no approvals."
        : null;

  const submit = async () => {
    setErr(null);
    // Client-side pre-checks mirror the RPC.
    if (!companyId) return setErr("Company is required.");
    if (!location) return setErr("Location is required.");
    if (!departmentId) return setErr("Department is required.");
    if (onBehalf && !beneficiaryName.trim()) return setErr("Name of the person you're requesting for is required.");
    if (!quantity.trim()) return setErr("Quantity is required.");

    let itemName: string | null = null;
    if (requestType === "new_requirement") {
      if (!categoryId) return setErr("Category is required.");
      if (!itemId) return setErr("Item is required.");
      itemName = isOtherItem ? otherItem.trim() : (chosenItem?.name ?? null);
      if (isOtherItem && !itemName) return setErr("Please specify the item.");
    } else {
      if (!serviceTypeId) return setErr("Service type is required.");
      itemName = isOtherService ? otherService.trim() : (chosenService?.name ?? null);
      if (isOtherService && !itemName) return setErr("Please specify the service.");
    }

    setBusy(true);
    try {
      const id = await s.submitRequest({
        companyId,
        location: location as "Plant" | "Office",
        departmentId,
        requestedForName: onBehalf ? beneficiaryName.trim() : session.user.name,
        requestedForUserId: onBehalf ? (beneficiaryUserId || null) : session.user.id,
        requestType,
        categoryId: requestType === "new_requirement" ? categoryId : null,
        serviceTypeId: requestType === "services_maintenance" ? serviceTypeId : null,
        itemName,
        quantity: quantity.trim(),
        reason: reason.trim() || null,
      });
      navigate(`/office-supplies/requests/${id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Raise a supply request</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Tell us what you need. Computer &amp; tech accessories go through two approvals; stationery, maintenance and
          services go straight to the handover team.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <FieldLabel label="Company" required>
          <Combobox value={companyId} onChange={setCompanyId} options={companyOptions} placeholder="Select company" autoAdvance />
        </FieldLabel>
        <FieldLabel label="Location" required>
          <Combobox value={location} onChange={setLocation} options={LOCATIONS} placeholder="Plant or Office" autoAdvance />
        </FieldLabel>
        <FieldLabel label="Department" required>
          <Combobox value={departmentId} onChange={setDepartmentId} options={deptOptions} placeholder="Select department" autoAdvance />
        </FieldLabel>

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input type="checkbox" checked={onBehalf} onChange={(e) => setOnBehalf(e.target.checked)} className="w-4 h-4 accent-orange" />
          <span className="text-[13px] text-navy">I'm requesting this for someone else</span>
        </label>
        {onBehalf && (
          <div className="space-y-4 rounded-xl bg-page/60 p-3.5">
            <FieldLabel label="Requested for (name)" required>
              <TextInput value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} placeholder="Full name" />
            </FieldLabel>
            <FieldLabel label="Link to a portal user" hint="optional — so they get notified">
              <Combobox value={beneficiaryUserId} onChange={setBeneficiaryUserId} options={peopleOptions} placeholder="Select a colleague" />
            </FieldLabel>
          </div>
        )}

        <FieldLabel label="Type of request" required>
          <Combobox
            value={requestType}
            onChange={(v) => setRequestType(v as RequestType)}
            options={TYPES}
            placeholder="Select"
            autoAdvance
          />
        </FieldLabel>

        {requestType === "new_requirement" ? (
          <>
            <FieldLabel label="Category" required>
              <Combobox
                value={categoryId}
                onChange={(v) => {
                  setCategoryId(v);
                  setItemId("");
                  setOtherItem("");
                }}
                options={categoryOptions}
                placeholder="Select category"
                autoAdvance
              />
            </FieldLabel>
            {categoryId && (
              <FieldLabel label="Item" required>
                <Combobox
                  value={itemId}
                  onChange={setItemId}
                  options={itemOptions}
                  placeholder="Select item"
                  onCreate={() => {
                    setRaisingItem(true);
                  }}
                  createLabel={(q) => `Request "${q}" as a new item`}
                  autoAdvance
                />
              </FieldLabel>
            )}
            {isOtherItem && (
              <FieldLabel label="Specify the item" required>
                <TextInput value={otherItem} onChange={(e) => setOtherItem(e.target.value)} placeholder="What exactly do you need?" />
              </FieldLabel>
            )}
          </>
        ) : (
          <>
            <FieldLabel label="Service required for" required>
              <Combobox value={serviceTypeId} onChange={setServiceTypeId} options={serviceOptions} placeholder="Select a service" autoAdvance />
            </FieldLabel>
            {isOtherService && (
              <FieldLabel label="Specify the service" required>
                <TextInput value={otherService} onChange={(e) => setOtherService(e.target.value)} placeholder="Describe the service needed" />
              </FieldLabel>
            )}
          </>
        )}

        <FieldLabel label="Reason">
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this needed?" />
        </FieldLabel>
        <FieldLabel label="Quantity" required>
          <TextInput value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 1, 2 boxes, 24 pcs" />
        </FieldLabel>

        {routeHint && (
          <p className="rounded-xl bg-orange-soft/40 px-3.5 py-2.5 text-[12.5px] text-navy border border-orange/20">
            {routeHint}
          </p>
        )}
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}

        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </Card>

      <RequestMasterModal
        open={raisingItem}
        onClose={() => setRaisingItem(false)}
        masterType="item"
        lockType
        prefill={categoryId ? { category_id: categoryId } : undefined}
      />
    </div>
  );
}
