import { useEffect, useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";
import { useSession } from "@/core/platform/session";
import { useSamplingStore } from "../../store";
import type { RequestInput } from "../../data/samplingWrites";
import type { Direction, ReceiveVia, RequirementType, TransportBorne } from "../../types";

/** One editable colour/quantity row. */
export interface SampleRow extends LineGridRow {
  colour: string;
  quantity: string;
}
export const makeEmptySample = (): SampleRow => ({ uid: newUid(), colour: "", quantity: "" });
export const isSampleBlank = (r: SampleRow): boolean => !r.colour.trim() && !r.quantity.trim();

/** Tri-state Yes/No for the lab-testing gate (blank = the user hasn't chosen). */
export type LabChoice = "" | "true" | "false";

/**
 * The intake form's state + derivation for a new sampling request.
 *
 * The colour/quantity grid is collected for EVERY direction/type. Inward requests
 * (both requirement types) also carry a lab-testing Yes/No gate, a picked collector
 * (from the collector master) and — when lab testing is NOT required — a hand-over
 * recipient (Self + the recipient master). Outward drops those.
 */
export function useSampleRequestForm() {
  const s = useSamplingStore();
  const session = useSession();
  const selfId = session.user?.id ?? "";

  const [companyId, setCompanyId] = useState("");
  const [receiveVia, setReceiveVia] = useState<ReceiveVia | "">("");
  const [direction, setDirection] = useState<Direction | "">("");
  const [requirementType, setRequirementType] = useState<RequirementType | "">("");
  const [requesterName, setRequesterName] = useState(session.user?.name ?? "");
  const [partyName, setPartyName] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [sampleItems, setSampleItems] = useState<SampleRow[]>([makeEmptySample()]);
  const [labTestingRequired, setLabTestingRequired] = useState<LabChoice>("");
  const [collectorId, setCollectorId] = useState("");
  const [handoverRecipientId, setHandoverRecipientId] = useState(selfId);
  const [transportBorne, setTransportBorne] = useState<TransportBorne | "">("");
  const [desiredResult, setDesiredResult] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const companyOptions: ComboOption[] = s.activeCompanies.map((c) => ({ value: c.id, label: c.name }));
  // Collectors come from the curated master (each maps to an app user).
  const collectorOptions: ComboOption[] = s.activeCollectors.map((c) => ({ value: c.userId, label: c.name }));
  // Recipients = Self + the curated recipient master (deduped against Self).
  const recipientOptions: ComboOption[] = [
    ...(selfId ? [{ value: selfId, label: "Self (me)" }] : []),
    ...s.activeRecipients.filter((r) => r.userId !== selfId).map((r) => ({ value: r.userId, label: r.name })),
  ];

  const isInward = direction === "inward";
  const isOutward = direction === "outward";
  const isCompetitor = isInward && requirementType === "competitor";
  const labNotRequired = isInward && labTestingRequired === "false";

  // Auto-select the sole collector so the user needn't pick when there's one option.
  useEffect(() => {
    if (isInward && !collectorId && collectorOptions.length === 1) setCollectorId(collectorOptions[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInward, collectorOptions.length]);

  /** The chosen recipient's display name (Self → the current user's name). */
  const recipientName = (id: string): string | null => {
    if (!id) return null;
    if (id === selfId) return session.user?.name ?? "Self";
    return s.activeRecipients.find((r) => r.userId === id)?.name ?? null;
  };

  /** Validate and assemble the RPC payload, or return an error message. */
  const build = (): { input: RequestInput } | { error: string } => {
    if (!companyId) return { error: "Company is required." };
    if (!receiveVia) return { error: "Sample source (Import / Domestic) is required." };
    if (!direction) return { error: "Direction (Inward / Outward) is required." };
    if (isInward && !requirementType) return { error: "Requirement type is required for an inward sample." };
    if (!productDesc.trim()) return { error: "Product / description is required." };
    if (isInward && labTestingRequired === "") return { error: "Please choose whether lab testing is required." };
    if (isInward && !collectorId) return { error: "Please choose who will collect the sample." };

    const filledSamples = sampleItems
      .filter((r) => !isSampleBlank(r))
      .map((r) => ({ colour: r.colour.trim(), quantity: r.quantity.trim() }));

    // Kept for EVERY inward request now: the lab branch needs it too (it receives
    // the sample, sends it to the lab, and defaults the result hand-over).
    const recipientId = isInward ? handoverRecipientId || selfId : "";

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
        collectorId: isInward ? collectorId || null : null,
        handoverName: null,
        labTestingRequired: isInward ? labTestingRequired === "true" : null,
        handoverRecipientId: recipientId || null,
        handoverRecipientName: recipientId ? recipientName(recipientId) : null,
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
    labTestingRequired, setLabTestingRequired,
    collectorId, setCollectorId,
    handoverRecipientId, setHandoverRecipientId,
    transportBorne, setTransportBorne,
    desiredResult, setDesiredResult,
    additionalInfo, setAdditionalInfo,
    err, setErr,
    // derived
    companyOptions, collectorOptions, recipientOptions,
    isInward, isOutward, isCompetitor, labNotRequired,
    // action
    build,
  };
}

export type SampleRequestFormApi = ReturnType<typeof useSampleRequestForm>;
