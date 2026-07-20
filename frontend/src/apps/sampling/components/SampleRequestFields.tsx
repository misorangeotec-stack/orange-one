import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import type { Direction, ReceiveVia, RequirementType, TransportBorne } from "../types";
import type { SampleRequestFormApi } from "../pages/requests/useSampleRequestForm";

const VIA_OPTIONS: ComboOption[] = [
  { value: "import", label: "Import" },
  { value: "domestic", label: "Domestic" },
];
const DIRECTION_OPTIONS: ComboOption[] = [
  { value: "inward", label: "Inward — a sample is coming to us" },
  { value: "outward", label: "Outward — we send a sample out" },
];
const REQUIREMENT_OPTIONS: ComboOption[] = [
  { value: "competitor", label: "Competitor Sample Testing" },
  { value: "new_product", label: "New Supplier / Product Testing" },
];
const YES_NO: ComboOption[] = [
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];

/**
 * The intake fields — Company · Sample source · Direction, then a branch:
 *   inward + competitor : party / product / colour&qty / collector / handover / transport
 *   inward + new product: supplier / product description & quantity
 *   outward             : customer / product to send / transport (receiver)
 * All party/product/people fields are free text. State lives in useSampleRequestForm.
 */
export default function SampleRequestFields({ form }: { form: SampleRequestFormApi }) {
  const {
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
    err,
    companyOptions, isInward, isOutward, isCompetitor,
  } = form;

  const partyLabel = isOutward
    ? "Customer / Company (send sample to)"
    : isCompetitor
      ? "Customer / Company (sample received from)"
      : "Supplier Name";
  const productLabel = isCompetitor
    ? "Product Name"
    : isOutward
      ? "Product Description & Quantity to send"
      : "Product Description & Quantity";
  const transportLabel = isOutward ? "Transport borne by the receiver?" : "Transport borne by the supplier?";

  return (
    <>
      <FieldLabel label="Company" required>
        <Combobox value={companyId} onChange={setCompanyId} options={companyOptions} placeholder="Select company" autoAdvance />
      </FieldLabel>
      <FieldLabel label="Sample source" required hint="how the sample moves">
        <Combobox
          value={receiveVia}
          onChange={(v) => setReceiveVia(v as ReceiveVia)}
          options={VIA_OPTIONS}
          placeholder="Import or Domestic"
          autoAdvance
        />
      </FieldLabel>
      <FieldLabel label="Direction" required>
        <Combobox
          value={direction}
          onChange={(v) => {
            setDirection(v as Direction);
            setRequirementType("");
          }}
          options={DIRECTION_OPTIONS}
          placeholder="Inward or Outward"
          autoAdvance
        />
      </FieldLabel>

      <FieldLabel label="Requester name" hint="defaults to you">
        <TextInput value={requesterName} onChange={(e) => setRequesterName(e.target.value)} placeholder="Who is raising this?" />
      </FieldLabel>

      {isInward && (
        <FieldLabel label="Requirement type" required>
          <Combobox
            value={requirementType}
            onChange={(v) => setRequirementType(v as RequirementType)}
            options={REQUIREMENT_OPTIONS}
            placeholder="What is this sample for?"
            autoAdvance
          />
        </FieldLabel>
      )}

      {direction && (isOutward || requirementType) && (
        <>
          <FieldLabel label={partyLabel}>
            <TextInput value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Name" />
          </FieldLabel>

          <FieldLabel label={productLabel} required>
            <TextArea rows={2} value={productDesc} onChange={(e) => setProductDesc(e.target.value)} placeholder="What is being sampled?" />
          </FieldLabel>

          {isCompetitor && (
            <>
              <FieldLabel label="Colour & Quantity to collect">
                <TextInput value={colourQty} onChange={(e) => setColourQty(e.target.value)} placeholder="e.g. Cyan, 500 ml" />
              </FieldLabel>
              <FieldLabel label="Who will collect the sample">
                <TextInput value={collectorName} onChange={(e) => setCollectorName(e.target.value)} placeholder="Name" />
              </FieldLabel>
              <FieldLabel label="Whom to hand the competitor sample to">
                <TextInput value={handoverName} onChange={(e) => setHandoverName(e.target.value)} placeholder="Name" />
              </FieldLabel>
            </>
          )}

          {(isCompetitor || isOutward) && (
            <FieldLabel label={transportLabel}>
              <Combobox
                value={transportBorne}
                onChange={(v) => setTransportBorne(v as TransportBorne)}
                options={YES_NO}
                placeholder="Yes or No"
              />
            </FieldLabel>
          )}

          <FieldLabel label="Desired result">
            <TextArea rows={2} value={desiredResult} onChange={(e) => setDesiredResult(e.target.value)} placeholder="What outcome are you looking for?" />
          </FieldLabel>
          <FieldLabel label="Additional information">
            <TextArea rows={2} value={additionalInfo} onChange={(e) => setAdditionalInfo(e.target.value)} placeholder="Anything else the team should know" />
          </FieldLabel>
        </>
      )}

      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
    </>
  );
}
