import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import RequestMasterModal from "./RequestMasterModal";
import type { RequestType } from "../types";
import type { SupplyRequestFormApi } from "../pages/requests/useSupplyRequestForm";

const LOCATIONS: ComboOption[] = [
  { value: "Plant", label: "Plant" },
  { value: "Office", label: "Office" },
];
const TYPES: ComboOption[] = [
  { value: "new_requirement", label: "New requirement" },
  { value: "services_maintenance", label: "Services / Maintenance" },
];

/**
 * The intake fields — Company · Location · Department · (for someone else?) ·
 * Type → then either Category → Item or Service type → Reason → Quantity. Shared
 * by New Request and Edit Request; the routing hint previews live from the
 * category. All state lives in useSupplyRequestForm.
 */
export default function SupplyRequestFields({ form }: { form: SupplyRequestFormApi }) {
  const {
    companyId, setCompanyId, location, setLocation, departmentId, setDepartmentId,
    onBehalf, setOnBehalf, beneficiaryName, setBeneficiaryName, beneficiaryUserId, setBeneficiaryUserId,
    requestType, setRequestType, categoryId, setCategoryId, itemId, setItemId, otherItem, setOtherItem,
    serviceTypeId, setServiceTypeId, otherService, setOtherService, reason, setReason, quantity, setQuantity,
    raisingItem, setRaisingItem, err,
    companyOptions, deptOptions, categoryOptions, itemOptions, serviceOptions, peopleOptions,
    resolvedDept, beneficiaryDept, isOtherItem, isOtherService, routeHint,
  } = form;

  return (
    <>
      <FieldLabel label="Company" required>
        <Combobox value={companyId} onChange={setCompanyId} options={companyOptions} placeholder="Select company" autoAdvance />
      </FieldLabel>
      <FieldLabel label="Location" required>
        <Combobox value={location} onChange={setLocation} options={LOCATIONS} placeholder="Plant or Office" autoAdvance />
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

      {/* Sits AFTER the beneficiary, because it follows from them. */}
      {resolvedDept ? (
        <FieldLabel label="Department" hint={beneficiaryDept ? "from their profile" : "from your profile"}>
          <div className="w-full rounded-xl border border-line bg-page/60 px-3.5 py-2.5 text-[13.5px] text-navy">
            {resolvedDept.name}
          </div>
          <p className="text-[11.5px] text-grey-2 mt-1">
            Approval goes to this department's HOD. To change it, ask an admin to update the profile.
          </p>
        </FieldLabel>
      ) : (
        <FieldLabel label="Department" required hint="no department on the profile">
          <Combobox value={departmentId} onChange={setDepartmentId} options={deptOptions} placeholder="Select department" autoAdvance />
        </FieldLabel>
      )}

      <FieldLabel label="Type of request" required>
        <Combobox value={requestType} onChange={(v) => setRequestType(v as RequestType)} options={TYPES} placeholder="Select" autoAdvance />
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
                onCreate={() => setRaisingItem(true)}
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

      <RequestMasterModal
        open={raisingItem}
        onClose={() => setRaisingItem(false)}
        masterType="item"
        lockType
        prefill={categoryId ? { category_id: categoryId } : undefined}
      />
    </>
  );
}
