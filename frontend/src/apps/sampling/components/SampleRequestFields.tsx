import type { ReactNode } from "react";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn } from "@/shared/components/ui/LineGrid";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { SAMPLING_SOURCE_LABEL } from "../types";
import type { Direction, ReceiveVia, RequirementType, TransportBorne } from "../types";
import { outwardSourceOf } from "../lib/format";
import {
  isSampleBlank,
  makeEmptySample,
  type SampleRequestFormApi,
  type SampleRow,
} from "../pages/requests/useSampleRequestForm";

/**
 * The sample source FOLLOWS the direction — "Import" is meaningless when we are
 * the ones sending. Picking a direction clears whatever source was chosen, so a
 * value from the other set can never survive a change of mind.
 */
const INWARD_VIA_OPTIONS: ComboOption[] = [
  { value: "import", label: "Import" },
  { value: "domestic", label: "Domestic" },
];
const OUTWARD_VIA_OPTIONS: ComboOption[] = [
  { value: "export", label: "Export" },
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
const LAB_OPTIONS: ComboOption[] = [
  { value: "true", label: "Yes — send for lab testing" },
  { value: "false", label: "No — collect and hand over" },
];

/**
 * A titled group of fields on a responsive two-column grid. The heading sits on
 * its own ruled row so it reads as a section break, never merging with the first
 * field's label.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="border-b border-line pb-2">
        {/* Accent is a left border on the heading text itself, so it always sits
            exactly in line with the title (never above it). */}
        <h3 className={`${SECTION_HEADING_CLASS} border-l-[3px] border-orange pl-2.5 leading-none`}>{title}</h3>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-5 gap-y-4">{children}</div>
    </section>
  );
}

/** The colour/quantity grid — one row per sample (every direction/type). */
function SamplesGrid({ form }: { form: SampleRequestFormApi }) {
  const gridLabel = form.isOutward ? "Colour & quantity to send" : "Colour & quantity to collect";
  const columns: LineGridColumn<SampleRow>[] = [
    {
      key: "colour",
      header: "Colour",
      className: "w-1/2",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as (el: HTMLInputElement | null) => void}
          className="w-full px-2.5 py-1.5 text-[13.5px]"
          placeholder="e.g. Cyan"
          value={row.colour}
          onChange={(e) => api.patch({ colour: e.target.value })}
          onKeyDown={api.keyHandler}
        />
      ),
    },
    {
      key: "quantity",
      header: "Quantity",
      className: "w-1/2",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as (el: HTMLInputElement | null) => void}
          className="w-full px-2.5 py-1.5 text-[13.5px]"
          placeholder="e.g. 500 ml"
          value={row.quantity}
          onChange={(e) => api.patch({ quantity: e.target.value })}
          onKeyDown={api.keyHandler}
        />
      ),
    },
  ];
  return (
    <div className="sm:col-span-2 space-y-1.5">
      <span className="block text-[13px] font-medium text-navy">{gridLabel}</span>
      <LineGrid
        rows={form.sampleItems}
        onRowsChange={form.setSampleItems}
        columns={columns}
        makeEmptyRow={makeEmptySample}
        isRowBlank={isSampleBlank}
      />
    </div>
  );
}

/**
 * The intake fields, grouped into Basics · Sample details · Outcome.
 *
 * `direction` is asked FIRST and gates everything after it — the sample source's
 * options, and which Sample-details fields appear. Inward (and, within it,
 * `requirementType`) collects colour/quantity samples + a picked collector + who
 * to hand to + transport. Outward instead collects the party IN FULL — company,
 * address, contact person, contact mobile — plus who will send it, all required.
 * State lives in useSampleRequestForm.
 */
export default function SampleRequestFields({ form }: { form: SampleRequestFormApi }) {
  const {
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
    labTestingRequired, setLabTestingRequired,
    collectorId, setCollectorId,
    handoverRecipientId, setHandoverRecipientId,
    transportBorne, setTransportBorne,
    desiredResult, setDesiredResult,
    additionalInfo, setAdditionalInfo,
    err,
    companyOptions, collectorOptions, recipientOptions, senderOptions,
    senderSourceReady,
    isInward, isOutward, isCompetitor,
  } = form;

  const partyLabel = isOutward
    ? "Company name (send sample to)"
    : isCompetitor
      ? "Customer / Company (sample received from)"
      : "Supplier Name";
  const productLabel = isCompetitor
    ? "Product Name"
    : isOutward
      ? "Product Description & Quantity to send"
      : "Product Description & Quantity";
  const transportLabel = isOutward ? "Transport borne by the receiver?" : "Transport borne by the supplier?";

  const detailsReady = direction && (isOutward || requirementType);

  return (
    <div className="space-y-7">
      <Section title="Basics">
        <FieldLabel label="Company" required>
          <Combobox value={companyId} onChange={setCompanyId} options={companyOptions} placeholder="Select company" autoAdvance />
        </FieldLabel>
        {/* Direction comes BEFORE the source — it decides the source's options. */}
        <FieldLabel label="Direction" required>
          <ChoiceButtons
            value={direction}
            onChange={(v) => {
              setDirection(v as Direction);
              setRequirementType("");
              // A source chosen for the other direction must not survive: Import
              // is inward-only, Export is outward-only.
              setReceiveVia("");
            }}
            options={DIRECTION_OPTIONS}
            autoAdvance
            ariaLabel="Direction"
          />
        </FieldLabel>
        <FieldLabel label="Sample source" required>
          <ChoiceButtons
            value={receiveVia}
            onChange={(v) => setReceiveVia(v as ReceiveVia)}
            options={isOutward ? OUTWARD_VIA_OPTIONS : INWARD_VIA_OPTIONS}
            disabled={!direction}
            autoAdvance
            ariaLabel="Sample source"
          />
        </FieldLabel>
        {isInward && (
          <FieldLabel label="Requirement type" required>
            <ChoiceButtons
              value={requirementType}
              onChange={(v) => setRequirementType(v as RequirementType)}
              options={REQUIREMENT_OPTIONS}
              autoAdvance
              ariaLabel="Requirement type"
            />
          </FieldLabel>
        )}
        <FieldLabel label="Requester name">
          <TextInput value={requesterName} onChange={(e) => setRequesterName(e.target.value)} placeholder="Who is raising this?" />
        </FieldLabel>
      </Section>

      {detailsReady && (
        <Section title="Sample details">
          <FieldLabel label={partyLabel} required={isOutward}>
            <TextInput
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              placeholder={isOutward ? "e.g. Acme Printing Pvt Ltd" : "Name"}
            />
          </FieldLabel>

          {/* Outward carries the party IN FULL: whoever ships the sample needs an
              address and someone to call, and the request needs to say who is
              sending it. All required — the submit RPC re-checks each one. */}
          {isOutward && (
            <>
              <FieldLabel label="Contact person" required>
                <TextInput
                  value={partyContactName}
                  onChange={(e) => setPartyContactName(e.target.value)}
                  placeholder="Who to ask for"
                />
              </FieldLabel>
              <FieldLabel label="Contact mobile" required>
                <TextInput
                  value={partyContactMobile}
                  onChange={(e) => setPartyContactMobile(e.target.value)}
                  placeholder="Mobile number"
                />
              </FieldLabel>
              {/* The list is the SAMPLE SENT owners from Setup → Step Owners for
                  this request's source, so it cannot be built until Sample source
                  is chosen — hence the disabled state, mirroring how Sample source
                  itself waits on Direction above. */}
              <FieldLabel label="Who will send the sample" required hint="from Setup → Step Owners">
                <Combobox
                  value={senderId}
                  onChange={setSenderId}
                  options={senderOptions}
                  placeholder={
                    !senderSourceReady
                      ? "Choose the sample source first"
                      : senderOptions.length
                        ? "Select a sender"
                        : `No Sample Sent owners set up for ${SAMPLING_SOURCE_LABEL[outwardSourceOf(receiveVia as ReceiveVia)]} — set them in Setup → Step Owners`
                  }
                  disabled={!senderSourceReady}
                  searchable
                />
              </FieldLabel>
              {/* Full width and last in the group: an address is the one wide
                  value here, and spanning it keeps the two contact fields on a
                  row together rather than split across it. */}
              <div className="sm:col-span-2">
                <FieldLabel label="Address" required>
                  <TextArea
                    rows={2}
                    value={partyAddress}
                    onChange={(e) => setPartyAddress(e.target.value)}
                    placeholder="Where the sample is being sent"
                  />
                </FieldLabel>
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <FieldLabel label={productLabel} required>
              <TextArea rows={2} value={productDesc} onChange={(e) => setProductDesc(e.target.value)} placeholder="What is being sampled?" />
            </FieldLabel>
          </div>

          <SamplesGrid form={form} />

          {isInward && (
            <>
              <FieldLabel label="Lab testing required?" required>
                <ChoiceButtons
                  value={labTestingRequired}
                  onChange={(v) => setLabTestingRequired(v as typeof labTestingRequired)}
                  options={LAB_OPTIONS}
                  autoAdvance
                  ariaLabel="Lab testing required?"
                />
              </FieldLabel>
              {/* OPTIONAL — and silent about it: no asterisk, no hint. Left blank
                  (the default), it submits a null collector and the request skips
                  the collect step entirely; `clearable` is the way back to blank. */}
              <FieldLabel label="Who will collect the sample">
                <Combobox
                  value={collectorId}
                  onChange={setCollectorId}
                  options={collectorOptions}
                  placeholder="Select a collector"
                  searchable
                  clearable
                />
              </FieldLabel>
              {/* Asked on BOTH inward branches now: on the no-lab path this person
                  closes the request, and on the lab path they receive the sample,
                  send it to the lab, and are the default recipient of the result. */}
              <FieldLabel label="Whom to hand over the sample to">
                <Combobox
                  value={handoverRecipientId}
                  onChange={setHandoverRecipientId}
                  options={recipientOptions}
                  placeholder="Select a recipient"
                  searchable
                />
              </FieldLabel>
            </>
          )}

          {(isCompetitor || isOutward) && (
            <FieldLabel label={transportLabel}>
              <ChoiceButtons
                value={transportBorne}
                onChange={(v) => setTransportBorne(v as TransportBorne)}
                options={YES_NO}
                ariaLabel={transportLabel}
              />
            </FieldLabel>
          )}
        </Section>
      )}

      {detailsReady && (
        <Section title="Outcome">
          <div className="sm:col-span-2">
            <FieldLabel label="Desired result">
              <TextArea rows={2} value={desiredResult} onChange={(e) => setDesiredResult(e.target.value)} placeholder="What outcome are you looking for?" />
            </FieldLabel>
          </div>
          <div className="sm:col-span-2">
            <FieldLabel label="Additional information">
              <TextArea rows={2} value={additionalInfo} onChange={(e) => setAdditionalInfo(e.target.value)} placeholder="Anything else the team should know" />
            </FieldLabel>
          </div>
        </Section>
      )}

      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
    </div>
  );
}
