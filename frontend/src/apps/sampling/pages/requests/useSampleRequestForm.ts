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
 * DIRECTION IS THE FIRST BRANCH, and it drives the sample source: inward is
 * Import / Domestic, outward is Export / Domestic. Changing direction clears the
 * source (see SampleRequestFields) so a source picked for the other direction
 * can never survive.
 *
 * The colour/quantity grid is collected for EVERY direction/type. Inward requests
 * (both requirement types) also carry a lab-testing Yes/No gate, a picked collector
 * (from the collector master) and a hand-over recipient (Self + the recipient
 * master). Outward drops those and instead carries the full party block — company
 * name, address, contact person, contact mobile — plus a sender from the sender
 * master, all five REQUIRED (re-checked by fms_sampling_submit_request).
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
  // Outward-only party block.
  const [partyAddress, setPartyAddress] = useState("");
  const [partyContactName, setPartyContactName] = useState("");
  const [partyContactMobile, setPartyContactMobile] = useState("");
  const [senderId, setSenderId] = useState("");
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
  // Senders come from the curated master. Like collectors, the option's value is
  // the USER id, not the master row id — that is what fms_sampling_can_act
  // compares `sender_id` against on send_sample.
  const senderOptions: ComboOption[] = s.activeSenders.map((x) => ({ value: x.userId, label: x.name }));

  const isInward = direction === "inward";
  const isOutward = direction === "outward";
  const isCompetitor = isInward && requirementType === "competitor";
  const labNotRequired = isInward && labTestingRequired === "false";

  // Auto-select the sole collector so the user needn't pick when there's one option.
  useEffect(() => {
    if (isInward && !collectorId && collectorOptions.length === 1) setCollectorId(collectorOptions[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInward, collectorOptions.length]);

  // Same courtesy on the outward side.
  useEffect(() => {
    if (isOutward && !senderId && senderOptions.length === 1) setSenderId(senderOptions[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOutward, senderOptions.length]);

  /** The chosen recipient's display name (Self → the current user's name). */
  const recipientName = (id: string): string | null => {
    if (!id) return null;
    if (id === selfId) return session.user?.name ?? "Self";
    return s.activeRecipients.find((r) => r.userId === id)?.name ?? null;
  };

  /** The chosen sender's display name, from the master. */
  const senderName = (id: string): string | null =>
    id ? s.activeSenders.find((x) => x.userId === id)?.name ?? null : null;

  /** Validate and assemble the RPC payload, or return an error message. */
  const build = (): { input: RequestInput } | { error: string } => {
    if (!companyId) return { error: "Company is required." };
    // Direction is checked BEFORE the source: the source's very options depend on it.
    if (!direction) return { error: "Direction (Inward / Outward) is required." };
    if (!receiveVia) {
      return { error: `Sample source (${isOutward ? "Export / Domestic" : "Import / Domestic"}) is required.` };
    }
    if (isInward && receiveVia === "export") return { error: "An inward sample cannot be an Export source." };
    if (isOutward && receiveVia === "import") return { error: "An outward sample cannot be an Import source." };
    if (isInward && !requirementType) return { error: "Requirement type is required for an inward sample." };
    if (isOutward) {
      if (!partyName.trim()) return { error: "Company name is required — who is the sample going to?" };
      if (!partyAddress.trim()) return { error: "Company address is required." };
      if (!partyContactName.trim()) return { error: "Contact person is required." };
      if (!partyContactMobile.trim()) return { error: "Contact mobile is required." };
      if (!senderId) return { error: "Please choose who will send the sample." };
    }
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
        // The rest of the party block + the sender are outward-only.
        partyAddress: isOutward ? partyAddress.trim() || null : null,
        partyContactName: isOutward ? partyContactName.trim() || null : null,
        partyContactMobile: isOutward ? partyContactMobile.trim() || null : null,
        senderId: isOutward ? senderId || null : null,
        senderName: isOutward ? senderName(senderId) : null,
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
    partyAddress, setPartyAddress,
    partyContactName, setPartyContactName,
    partyContactMobile, setPartyContactMobile,
    senderId, setSenderId,
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
    companyOptions, collectorOptions, recipientOptions, senderOptions,
    isInward, isOutward, isCompetitor, labNotRequired,
    // action
    build,
  };
}

export type SampleRequestFormApi = ReturnType<typeof useSampleRequestForm>;
