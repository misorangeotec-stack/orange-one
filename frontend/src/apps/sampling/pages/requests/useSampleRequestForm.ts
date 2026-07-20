import { useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { useSession } from "@/core/platform/session";
import { useSamplingStore } from "../../store";
import type { RequestInput } from "../../data/samplingWrites";
import type { Direction, ReceiveVia, RequirementType, TransportBorne } from "../../types";

/**
 * The intake form's state + derivation for a new sampling request.
 *
 * The form branches on `direction` (and, for inward, on `requirementType`): the
 * competitor path collects colour/quantity + who collects + who to hand to +
 * transport, the new-product path is leaner, and the outward path drops the
 * competitor fields and asks who bears transport on the receiver's side. All
 * party/product/people fields are FREE TEXT; only Company + the enums are pickers.
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
  const [colourQty, setColourQty] = useState("");
  const [collectorName, setCollectorName] = useState("");
  const [handoverName, setHandoverName] = useState("");
  const [transportBorne, setTransportBorne] = useState<TransportBorne | "">("");
  const [desiredResult, setDesiredResult] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const companyOptions: ComboOption[] = s.activeCompanies.map((c) => ({ value: c.id, label: c.name }));

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

    return {
      input: {
        companyId,
        receiveVia: receiveVia as ReceiveVia,
        direction: direction as Direction,
        requirementType: isInward ? (requirementType as RequirementType) : null,
        requesterName: requesterName.trim() || (session.user?.name ?? "Requester"),
        partyName: partyName.trim() || null,
        productDesc: productDesc.trim(),
        colourQty: isCompetitor ? colourQty.trim() || null : null,
        collectorName: isCompetitor ? collectorName.trim() || null : null,
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
    colourQty, setColourQty,
    collectorName, setCollectorName,
    handoverName, setHandoverName,
    transportBorne, setTransportBorne,
    desiredResult, setDesiredResult,
    additionalInfo, setAdditionalInfo,
    err, setErr,
    // derived
    companyOptions, isInward, isOutward, isCompetitor,
    // action
    build,
  };
}

export type SampleRequestFormApi = ReturnType<typeof useSampleRequestForm>;
