import { useMemo, useRef, useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { useSession } from "@/core/platform/session";
import { useSuppliesStore } from "../../store";
import type { RequestInput } from "../../data/suppliesWrites";
import type { RequestType } from "../../types";

/**
 * The intake form's state + derivation, shared by New Request and Edit Request.
 * The single-item supply form has no line grid, but it does have branching
 * (new-requirement vs service), a derived department, and an on-behalf path — so
 * both screens reuse this rather than duplicating ~100 lines of logic.
 */

export interface SupplyFormInit {
  requestId: string;
  companyId: string;
  location: string;
  onBehalf: boolean;
  beneficiaryName: string;
  beneficiaryUserId: string;
  requestType: RequestType;
  categoryId: string;
  itemId: string;
  otherItem: string;
  serviceTypeId: string;
  otherService: string;
  reason: string;
  quantity: string;
}

export function useSupplyRequestForm(init?: SupplyFormInit | null) {
  const s = useSuppliesStore();
  const session = useSession();

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
  const [err, setErr] = useState<string | null>(null);

  // Seed from an existing request exactly ONCE (the store rebuilds on every
  // invalidate()).
  const hydrated = useRef<string | null>(null);
  if (init && hydrated.current !== init.requestId) {
    hydrated.current = init.requestId;
    setCompanyId(init.companyId);
    setLocation(init.location);
    setOnBehalf(init.onBehalf);
    setBeneficiaryName(init.beneficiaryName);
    setBeneficiaryUserId(init.beneficiaryUserId);
    setRequestType(init.requestType);
    setCategoryId(init.categoryId);
    setItemId(init.itemId);
    setOtherItem(init.otherItem);
    setServiceTypeId(init.serviceTypeId);
    setOtherService(init.otherService);
    setReason(init.reason);
    setQuantity(init.quantity);
  }

  const companyOptions: ComboOption[] = s.activeCompanies.map((c) => ({ value: c.id, label: c.name }));
  const deptOptions: ComboOption[] = s.activeDepartments.map((d) => ({ value: d.id, label: d.name }));

  // The department is DERIVED, not chosen — it decides which HOD sees the request.
  // Display only; fms_supplies_submit_request / _update_request re-derive it.
  const deptForUser = (uid: string) => {
    const orgId = s.profileById(uid)?.departmentId ?? null;
    return orgId ? (s.activeDepartments.find((d) => d.orgDepartmentId === orgId) ?? null) : null;
  };
  const beneficiaryDept = onBehalf && beneficiaryUserId ? deptForUser(beneficiaryUserId) : null;
  const resolvedDept = beneficiaryDept ?? (onBehalf && beneficiaryUserId ? null : s.myDepartment);
  const effectiveDeptId = resolvedDept?.id ?? departmentId;

  const categoryOptions: ComboOption[] = s.activeCategories.map((c) => ({
    value: c.id,
    label: c.name,
    sublabel: c.requiresApproval ? "Needs first + second approval" : "Straight to handover",
  }));
  const itemOptions: ComboOption[] = useMemo(
    () => (categoryId ? s.itemsForCategory(categoryId).map((i) => ({ value: i.id, label: i.name })) : []),
    [categoryId, s]
  );
  const serviceOptions: ComboOption[] = s.activeServiceTypes.map((t) => ({ value: t.id, label: t.name }));
  const peopleOptions: ComboOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles]
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

  /** Validate and assemble the RPC payload, or return an error message. */
  const build = (): { input: RequestInput } | { error: string } => {
    if (!companyId) return { error: "Company is required." };
    if (!location) return { error: "Location is required." };
    if (!effectiveDeptId) return { error: "Department is required." };
    if (onBehalf && !beneficiaryName.trim()) return { error: "Name of the person you're requesting for is required." };
    if (!quantity.trim()) return { error: "Quantity is required." };

    let itemName: string | null = null;
    if (requestType === "new_requirement") {
      if (!categoryId) return { error: "Category is required." };
      if (!itemId) return { error: "Item is required." };
      itemName = isOtherItem ? otherItem.trim() : (chosenItem?.name ?? null);
      if (isOtherItem && !itemName) return { error: "Please specify the item." };
    } else {
      if (!serviceTypeId) return { error: "Service type is required." };
      itemName = isOtherService ? otherService.trim() : (chosenService?.name ?? null);
      if (isOtherService && !itemName) return { error: "Please specify the service." };
    }

    return {
      input: {
        companyId,
        location: location as "Plant" | "Office",
        departmentId: effectiveDeptId,
        requestedForName: onBehalf ? beneficiaryName.trim() : session.user.name,
        requestedForUserId: onBehalf ? (beneficiaryUserId || null) : session.user.id,
        requestType,
        categoryId: requestType === "new_requirement" ? categoryId : null,
        serviceTypeId: requestType === "services_maintenance" ? serviceTypeId : null,
        itemName,
        quantity: quantity.trim(),
        reason: reason.trim() || null,
      },
    };
  };

  return {
    // state
    companyId, setCompanyId, location, setLocation, departmentId, setDepartmentId,
    onBehalf, setOnBehalf, beneficiaryName, setBeneficiaryName, beneficiaryUserId, setBeneficiaryUserId,
    requestType, setRequestType, categoryId, setCategoryId, itemId, setItemId, otherItem, setOtherItem,
    serviceTypeId, setServiceTypeId, otherService, setOtherService, reason, setReason, quantity, setQuantity,
    raisingItem, setRaisingItem, err, setErr,
    // options + derived
    companyOptions, deptOptions, categoryOptions, itemOptions, serviceOptions, peopleOptions,
    resolvedDept, beneficiaryDept, isOtherItem, isOtherService, routeHint,
    // action
    build,
  };
}

export type SupplyRequestFormApi = ReturnType<typeof useSupplyRequestForm>;
