import { useEffect, useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";
import { useSession } from "@/core/platform/session";
import { useSamplingStore } from "../../store";
import { outwardSourceOf } from "../../lib/format";
import type { RequestInput } from "../../data/samplingWrites";
import type { Direction, ReceiveVia, RequirementType, SamplingRequest, TransportBorne } from "../../types";

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
 * (both requirement types) also carry a lab-testing Yes/No gate, an OPTIONAL
 * collector (from the collector master) and a hand-over recipient (Self + the
 * recipient master). Outward drops those and instead carries the full party
 * block — company name, address, contact person, contact mobile — plus a sender,
 * all five REQUIRED (re-checked by fms_sampling_submit_request).
 *
 * THE SENDER COMES FROM SETUP → STEP OWNERS, NOT FROM THE SENDER MASTER. Sample
 * Sent is owned separately for Domestic and Export (fms_sampling_step_source_
 * owners), and those owners are the same people the server authorizes on
 * send_sample — so offering anyone else would offer a sender who cannot act.
 * fms_sampling_senders still exists and is still edited in Masters; it simply no
 * longer feeds this field. The option value stays the USER id, which is what
 * fms_sampling_can_act compares `sender_id` against.
 *
 * THE COLLECTOR IS OPTIONAL, and leaving it BLANK skips the collect step: the
 * request is submitted straight into sample_to_lab / sample_received (see the
 * inward arm of fms_sampling_submit_request, 20260903120000). The field simply
 * starts empty and says nothing about it — the list once carried a synthetic "No
 * collection needed" first row, which only existed because Combobox had no way
 * back to blank; the field now renders `clearable` instead.
 *
 * EDITING: pass the request as `initial` and every field starts from it. Used by
 * EditRequest until the request's first step is recorded — the save goes through
 * fms_sampling_update_request, which applies the same rules and routing.
 */
export function useSampleRequestForm(initial?: SamplingRequest) {
  const s = useSamplingStore();
  const session = useSession();
  const selfId = session.user?.id ?? "";

  const [companyId, setCompanyId] = useState(initial?.companyId ?? "");
  const [receiveVia, setReceiveVia] = useState<ReceiveVia | "">(initial?.receiveVia ?? "");
  const [direction, setDirection] = useState<Direction | "">(initial?.direction ?? "");
  const [requirementType, setRequirementType] = useState<RequirementType | "">(initial?.requirementType ?? "");
  const [requesterName, setRequesterName] = useState(initial ? initial.requesterName : session.user?.name ?? "");
  const [partyName, setPartyName] = useState(initial?.partyName ?? "");
  // Outward-only party block.
  const [partyAddress, setPartyAddress] = useState(initial?.partyAddress ?? "");
  const [partyContactName, setPartyContactName] = useState(initial?.partyContactName ?? "");
  const [partyContactMobile, setPartyContactMobile] = useState(initial?.partyContactMobile ?? "");
  const [senderId, setSenderId] = useState(initial?.senderId ?? "");
  const [productDesc, setProductDesc] = useState(initial?.productDesc ?? "");
  const [sampleItems, setSampleItems] = useState<SampleRow[]>(() =>
    initial?.sampleItems.length
      ? initial.sampleItems.map((it) => ({ uid: newUid(), colour: it.colour ?? "", quantity: it.quantity ?? "" }))
      : [makeEmptySample()],
  );
  const [labTestingRequired, setLabTestingRequired] = useState<LabChoice>(
    initial?.labTestingRequired == null ? "" : initial.labTestingRequired ? "true" : "false",
  );
  // NULL starts blank rather than as "No": on an edit the two gates should read
  // the same way, and a row raised before the machine gate existed genuinely has
  // no answer on file. The server reads a missing answer as "not required".
  const [machineTestingRequired, setMachineTestingRequired] = useState<LabChoice>(
    initial?.machineTestingRequired == null ? "" : initial.machineTestingRequired ? "true" : "false",
  );
  const [collectorId, setCollectorId] = useState(initial?.collectorId ?? "");
  const [handoverRecipientId, setHandoverRecipientId] = useState(initial?.handoverRecipientId || selfId);
  const [transportBorne, setTransportBorne] = useState<TransportBorne | "">(initial?.transportBorne ?? "");
  const [desiredResult, setDesiredResult] = useState(initial?.desiredResult ?? "");
  const [additionalInfo, setAdditionalInfo] = useState(initial?.additionalInfo ?? "");
  const [err, setErr] = useState<string | null>(null);

  const companyOptions: ComboOption[] = s.activeCompanies.map((c) => ({ value: c.id, label: c.name }));
  // Collectors come from the curated master (each maps to an app user) — real
  // people only. Blank is the "nobody collects" state and needs no row of its own:
  // the field is `clearable`, so a mis-picked collector can be un-picked.
  const collectorOptions: ComboOption[] = s.activeCollectors.map((c) => ({ value: c.userId, label: c.name }));
  // Recipients = Self + the curated recipient master (deduped against Self).
  const recipientOptions: ComboOption[] = [
    ...(selfId ? [{ value: selfId, label: "Self (me)" }] : []),
    ...s.activeRecipients.filter((r) => r.userId !== selfId).map((r) => ({ value: r.userId, label: r.name })),
  ];
  // An edit keeps the people the request already names, even when they are not on
  // today's lists — the requester's own "Self" seen by a coordinator, or a
  // collector since deactivated. Without this the field would render blank.
  if (initial?.collectorId && !collectorOptions.some((o) => o.value === initial.collectorId)) {
    collectorOptions.push({ value: initial.collectorId, label: s.personName(initial.collectorId) });
  }
  if (initial?.handoverRecipientId && !recipientOptions.some((o) => o.value === initial.handoverRecipientId)) {
    recipientOptions.push({
      value: initial.handoverRecipientId,
      label: initial.handoverRecipientName ?? s.personName(initial.handoverRecipientId),
    });
  }

  const isInward = direction === "inward";
  const isOutward = direction === "outward";
  const isCompetitor = isInward && requirementType === "competitor";
  const labNotRequired = isInward && labTestingRequired === "false";

  /**
   * The senders on offer = the SAMPLE SENT owners configured in Setup → Step
   * Owners for THIS request's source. Empty until a source is picked, because
   * Domestic and Export are owned by different people and we cannot know which
   * list applies — SampleRequestFields disables the field on `senderSourceReady`.
   *
   * `outwardSourceOf` (lib/format.ts) is the TS mirror of SQL
   * fms_sampling_outward_source; never re-spell the export/domestic rule here.
   *
   * Names via s.personName (org-wide), NOT s.profileById — the directory is
   * RLS-scoped, so an owner outside the signed-in user's slice would render blank.
   */
  const senderSourceReady = isOutward && !!receiveVia;
  const senderOptions: ComboOption[] = senderSourceReady
    ? (s.stepSourceOwnerFor("send_sample", outwardSourceOf(receiveVia as ReceiveVia))?.employeeIds ?? [])
        .map((id) => ({ value: id, label: s.personName(id) }))
        .sort((a, b) => a.label.localeCompare(b.label))
    : [];

  /**
   * Keep `senderId` honest against the list it came from, and pre-fill when there
   * is only one candidate.
   *
   * The DROP half is what makes switching Domestic → Export safe: the Domestic
   * owner picked a moment ago is not on the Export list, and leaving it in place
   * would submit a sender the server refuses on send_sample. Keyed on the option
   * VALUES, not just their count — the two lists can be the same length.
   */
  const senderOptionKey = senderOptions.map((o) => o.value).join(",");
  useEffect(() => {
    if (!isOutward) return;
    if (senderId && !senderOptions.some((o) => o.value === senderId)) {
      setSenderId(senderOptions.length === 1 ? senderOptions[0].value : "");
      return;
    }
    if (!senderId && senderOptions.length === 1) setSenderId(senderOptions[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOutward, senderOptionKey]);

  /** The chosen recipient's display name (Self → the current user's name). */
  const recipientName = (id: string): string | null => {
    if (!id) return null;
    if (id === selfId) return session.user?.name ?? "Self";
    const listed = s.activeRecipients.find((r) => r.userId === id)?.name;
    if (listed) return listed;
    // A recipient kept from the request being edited (see recipientOptions).
    return id === initial?.handoverRecipientId ? initial.handoverRecipientName : null;
  };

  /**
   * The chosen sender's display name. Org-wide, because the sender is now a
   * Setup step owner who need not appear in the sender master at all — reading
   * activeSenders here would write a null `sender_name` for most of them.
   */
  const senderName = (id: string): string | null => {
    if (!id) return null;
    const nm = s.personName(id);
    return nm === "—" || nm === "Unknown user" ? null : nm;
  };

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
    if (isInward && machineTestingRequired === "") return { error: "Please choose whether machine testing is required." };
    // No collector check: it is OPTIONAL, and an empty one means "skip the
    // collect step" rather than "the user forgot". The server agrees — the inward
    // arm of fms_sampling_submit_request routes past collect instead of raising.

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
        machineTestingRequired: isInward ? machineTestingRequired === "true" : null,
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
    machineTestingRequired, setMachineTestingRequired,
    collectorId, setCollectorId,
    handoverRecipientId, setHandoverRecipientId,
    transportBorne, setTransportBorne,
    desiredResult, setDesiredResult,
    additionalInfo, setAdditionalInfo,
    err, setErr,
    // derived
    companyOptions, collectorOptions, recipientOptions, senderOptions,
    senderSourceReady,
    isInward, isOutward, isCompetitor, labNotRequired,
    // action
    build,
  };
}

export type SampleRequestFormApi = ReturnType<typeof useSampleRequestForm>;
