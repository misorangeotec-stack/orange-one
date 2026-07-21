import { useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";
import { useSession } from "@/core/platform/session";
import { useSamplingStore } from "../../store";
import type { RequestInput } from "../../data/samplingWrites";
import type { Direction, ReceiveVia, RequirementType, TransportBorne } from "../../types";

/** One editable colour/quantity row (competitor samples). */
export interface SampleRow extends LineGridRow {
  colour: string;
  quantity: string;
}
export const makeEmptySample = (): SampleRow => ({ uid: newUid(), colour: "", quantity: "" });
export const isSampleBlank = (r: SampleRow): boolean => !r.colour.trim() && !r.quantity.trim();

/**
 * The intake form's state + derivation for a new sampling request.
 *
 * The form branches on `direction` (and, for inward, on `requirementType`): the
 * competitor path collects a LIST of colour/quantity samples + who collects (a
 * picked employee) + who to hand to + transport, the new-product path is leaner,
 * and the outward path drops the competitor fields. Company + the enums + the
 * collector are pickers; every other party/product field is free text.
 */
export function useSampleRequestForm() {
  const s = useSamplingStore();
  const session = useSession();

  const [companyId, setCompanyId] = useState("");
  const [receiveVia, setReceiveVia] = useState<ReceiveVia | "">("");
  const [direction, setDirection] = useState<Direction | "">("");
  const [requirementType, setRequirementType] = useState<RequirementType | "">("");
  const [requesterName, setRequesterName] = useState(session.user?.name ?? "");
  const [partyName, setPartyName] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [sampleItems, setSampleItems] = useState<SampleRow[]>([makeEmptySample()]);
  const [collectorId, setCollectorId] = useState("");
  const [handoverName, setHandoverName] = useState("");
  const [transportBorne, setTransportBorne] = useState<TransportBorne | "">("");
  const [desiredResult, setDesiredResult] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const companyOptions: ComboOption[] = s.activeCompanies.map((c) => ({ value: c.id, label: c.name }));
  const collectorOptions: ComboOption[] = [...s.samplingUsers]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name }));

  const isInward = direction === "inward";
  const isOutward = direction === "outward";
  const isCompetitor = isInward && requirementType === "competitor";

  /** Validate and assemble the RPC payload, or return an error message. */
  const build = (): { input: RequestInput } | { error: string } => {
    if (!companyId) return { error: "Company is required." };
    if (!receiveVia) return { error: "Sample source (Import / Domestic) is required." };
    if (!direction) return { error: "Direction (Inward / Outward) is required." };
    if (isInward && !requirementType) return { error: "Requirement type is required for an inward sample." };
    if (!productDesc.trim()) return { error: "Product / description is required." };

    const filledSamples = isCompetitor
      ? sampleItems.filter((r) => !isSampleBlank(r)).map((r) => ({ colour: r.colour.trim(), quantity: r.quantity.trim() }))
      : [];

    return {
      input: {
        companyId,
        receiveVia: receiveVia as ReceiveVia,
        direction: direction as Direction,
        requirementType: isInward ? (requirementType as RequirementType) : null,
        requesterName: requesterName.trim() || (session.user?.name ?? "Requester"),
        partyName: partyName.trim() || null,
        productDesc: productDesc.trim(),
        sampleItems: filledSamples,
        collectorId: isCompetitor ? collectorId || null : null,
        handoverName: isCompetitor ? handoverName.trim() || null : null,
        transportBorne: isCompetitor || isOutward ? (transportBorne || null) : null,
        desiredResult: desiredResult.trim() || null,
        additionalInfo: additionalInfo.trim() || null,
      },
    };
  };

  return {
    // state
    companyId, setCompanyId,
    receiveVia, setReceiveVia,
    direction, setDirection,
    requirementType, setRequirementType,
    requesterName, setRequesterName,
    partyName, setPartyName,
    productDesc, setProductDesc,
    sampleItems, setSampleItems,
    collectorId, setCollectorId,
    handoverName, setHandoverName,
    transportBorne, setTransportBorne,
    desiredResult, setDesiredResult,
    additionalInfo, setAdditionalInfo,
    err, setErr,
    // derived
    companyOptions, collectorOptions, isInward, isOutward, isCompetitor,
    // action
    build,
  };
}

export type SampleRequestFormApi = ReturnType<typeof useSampleRequestForm>;
