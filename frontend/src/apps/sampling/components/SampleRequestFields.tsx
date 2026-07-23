import type { ReactNode } from "react";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn } from "@/shared/components/ui/LineGrid";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import type { Direction, ReceiveVia, RequirementType, TransportBorne } from "../types";
import {
  isSampleBlank,
  makeEmptySample,
  type SampleRequestFormApi,
  type SampleRow,
} from "../pages/requests/useSampleRequestForm";

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
 * The intake fields, grouped into Basics · Sample details · Outcome. The form
 * branches on `direction` (and, for inward, `requirementType`): the competitor
 * path collects a list of colour/quantity samples + a picked collector + who to
 * hand to + transport; the new-product path is leaner; outward drops the
 * competitor fields. State lives in useSampleRequestForm.
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
    labTestingRequired, setLabTestingRequired,
    collectorId, setCollectorId,
    handoverRecipientId, setHandoverRecipientId,
    transportBorne, setTransportBorne,
    desiredResult, setDesiredResult,
    additionalInfo, setAdditionalInfo,
    err,
    companyOptions, collectorOptions, recipientOptions,
    isInward, isOutward, isCompetitor, labNotRequired,
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

  const detailsReady = direction && (isOutward || requirementType);

  return (
    <div className="space-y-7">
      <Section title="Basics">
        <FieldLabel label="Company" required>
          <Combobox value={companyId} onChange={setCompanyId} options={companyOptions} placeholder="Select company" autoAdvance />
        </FieldLabel>
        <FieldLabel label="Sample source" required>
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
        <FieldLabel label="Requester name">
          <TextInput value={requesterName} onChange={(e) => setRequesterName(e.target.value)} placeholder="Who is raising this?" />
        </FieldLabel>
      </Section>

      {detailsReady && (
        <Section title="Sample details">
          <FieldLabel label={partyLabel}>
            <TextInput value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Name" />
          </FieldLabel>

          <div className="sm:col-span-2">
            <FieldLabel label={productLabel} required>
              <TextArea rows={2} value={productDesc} onChange={(e) => setProductDesc(e.target.value)} placeholder="What is being sampled?" />
            </FieldLabel>
          </div>

          <SamplesGrid form={form} />

          {isInward && (
            <>
              <FieldLabel label="Lab testing required?" required>
                <Combobox
                  value={labTestingRequired}
                  onChange={(v) => setLabTestingRequired(v as typeof labTestingRequired)}
                  options={LAB_OPTIONS}
                  placeholder="Choose Yes or No"
                  autoAdvance
                />
              </FieldLabel>
              <FieldLabel label="Who will collect the sample" required>
                <Combobox
                  value={collectorId}
                  onChange={setCollectorId}
                  options={collectorOptions}
                  placeholder={collectorOptions.length ? "Select a collector" : "Add collectors in Masters first"}
                  searchable
                />
              </FieldLabel>
              {labNotRequired && (
                <FieldLabel label="Whom to hand over the sample to">
                  <Combobox
                    value={handoverRecipientId}
                    onChange={setHandoverRecipientId}
                    options={recipientOptions}
                    placeholder="Select a recipient"
                    searchable
                  />
                </FieldLabel>
              )}
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
