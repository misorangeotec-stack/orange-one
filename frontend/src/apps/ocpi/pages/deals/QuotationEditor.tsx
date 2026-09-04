import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import QuotationForm from "../../components/QuotationForm";
import IssuedPapers from "../../components/IssuedPapers";
import LifecyclePanel from "../../components/LifecyclePanel";
import RevisionHistory from "../../components/RevisionHistory";
import {
  CompanyProfileWarning, OcSeriesWarning, QuotationSeriesWarning,
} from "../../components/SetupWarnings";
import { useOcpiStore } from "../../store";
import { submitQuotation } from "../../data/ocpiWrites";
import { useQuotationDraft, type GeneratedPapers } from "./useQuotationDraft";
import { dealFacts } from "../../lib/fieldSpec";
import {
  flashElement, focusField, missingForDetailSheet, type MissingField,
} from "../../lib/completeness";

/**
 * Write a quotation — the same screen whether it is new or a draft being
 * finished, because those are the same act.
 *
 * ⚠ SAVING A DRAFT IS DELIBERATELY CHEAP. It asks for a customer name and
 *   nothing else, so somebody handed half the details on a phone call can put
 *   them down and come back. A form that refuses to save until it is complete is
 *   a form people keep in a notebook instead.
 *
 * ⚠ GENERATE IS THE ACT THAT COSTS SOMETHING. It mints a number from a series
 *   customers already hold, and freezes a version that can never be edited. So
 *   it is a separate, clearly-labelled button, and the copy says what it will
 *   do — it is not a save with a different name.
 *
 * ── WHERE COMPLETENESS IS ENFORCED (OCPI-15) ───────────────────────────────
 *
 * It used to be enforced entirely at Generate: 26 answers, all or nothing, so a
 * salesperson mid-negotiation could not produce a paper at all. It is now two
 * gates of different strengths.
 *
 *   Save draft         · nothing, as before
 *   Generate           · `missingToGenerate` — the customer, the machine and the
 *                        PRICE. Without those the PDF is not a draft of anything.
 *   Send for approval  · `missing` — everything. An approver cannot sign off a
 *                        deal with holes in it.
 *
 * ⚠ THE PRICE IS AT GENERATE BECAUSE THE CLIENT PUT IT BACK THERE. OCPI-15 was
 *   specified to let a priceless quotation out, with a loud warning as the
 *   defence. Ritesh Bhai reversed it while it was being planned — "otherwise we
 *   already have the save draft option" — and he is right that a paper with no
 *   figure on it is what Save draft is for.
 */

/**
 * The answers whose absence shows on the CUSTOMER's own copy.
 *
 * ⚠ HEAD COUNT JOINED THEM IN OCPI-27, and only because that task made it
 *   required — this set filters `q.missing`, so a field that could never be
 *   missing could never appear here. `quotationPdf.ts` prints "No. of Print
 *   Heads Required" in the machine block on every summary sheet, as an empty
 *   string when the answer is null, which is exactly what this card is for.
 *
 * ⚠ MACHINE CATEGORY DID NOT JOIN THEM, and that is not an omission. It became
 *   required in the same task, but it prints on NO paper — it is a branch input
 *   that decides which questions the form asks. A card that warned about it
 *   would be telling the salesperson the customer will see a blank that does
 *   not exist.
 */
/*
 * ⚠ THE DELIVERY TERM JOINED THEM IN OCPI-35, and it is the strongest member of
 *   the set: it is the ONE answer here that shows on BOTH papers. Blank, it
 *   leaves the summary sheet's "Term of Delivery" row naming only the deal type
 *   and the cost bearer, and it rules an actual blank — "Transport Terms:
 *   ________" — in the SALE CONDITIONS clause of all 21 contract templates.
 *   Its three follow-ups are NOT here: they cannot be missing while the term
 *   itself is answered, because they compose into it.
 */
const CUSTOMER_FACING = new Set<string>([
  "transportTerms",
  "deliveryVia",
  "paymentTerms",
  "deliveryDate",
  "headCount",
]);

/**
 * The missing answers, as things you can press.
 *
 * ⚠ THIS IS THE WHOLE POINT OF OCPI-15's SECOND HALF. The list was a
 *   comma-separated sentence — "the total deal value, the type of payment" —
 *   which named fields without saying where they were, on a form long enough
 *   that finding one is a hunt. Each entry now carries its field key and jumps
 *   to the box.
 */
function MissingList({ items }: { items: MissingField[] }) {
  return (
    <ul className="mt-2.5 flex flex-wrap gap-1.5">
      {items.map((m) => (
        <li key={m.key}>
          <button
            type="button"
            onClick={() => focusField(m.key)}
            className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12.5px] text-navy transition hover:border-orange hover:text-orange focus:border-orange focus:outline-none"
          >
            {m.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function QuotationEditor({ dealId }: { dealId?: string }) {
  const nav = useNavigate();
  const s = useOcpiStore();
  const q = useQuotationDraft(dealId);
  const [papers, setPapers] = useState<GeneratedPapers | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /*
    ⚠ THE PANEL IS SCROLLED TO, NOT MERELY RENDERED. It sits above a form long
      enough that it can be well off screen when the button at the top is
      pressed — and a button that appears to do nothing is the bug OCPI-15 is
      fixing, moved down the page rather than removed.
  */
  const approvalPanel = useRef<HTMLDivElement | null>(null);

  const isNew = !dealId;
  const deal = q.savedId ? s.deals.find((d) => d.id === q.savedId) : undefined;
  const versions = useMemo(
    () => (q.savedId ? s.versions.filter((v) => v.dealId === q.savedId) : []),
    [s.versions, q.savedId],
  );

  const canGenerate = q.missingToGenerate.length === 0;
  const canSend = q.missing.length === 0;

  /**
   * What the CUSTOMER will see missing on the summary sheet they are sent.
   *
   * ⚠ A DIFFERENT STATEMENT FROM "YOU CANNOT SEND THIS YET", and it earns its
   *   own card for that reason. `quotationPdf.ts` prints Deal Type (:160),
   *   Tentative Machine Delivery Date (:236), Payment Terms (:240), Term of
   *   Delivery (:241) and No. of Print Heads Required (:345) from these four
   *   answers, and prints each of them as an empty string when the answer is
   *   null. Generating with them blank is allowed — it is how a specification
   *   goes out mid-negotiation — but it must not be a surprise discovered in the
   *   customer's reply.
   */
  const blankOnCustomerCopy = useMemo(
    () => q.missing.filter((m) => CUSTOMER_FACING.has(m.key)),
    [q.missing],
  );

  /** Which lines the DETAILED sheet will print blank. A warning, never a gate. */
  const blankOnDetailSheet = useMemo(
    () =>
      missingForDetailSheet(
        q.draft,
        // ⚠ WITHOUT THIS the card nags for a dryer name on a deal whose category
        //   says there is no dryer — a warning about a field the form no longer
        //   shows and the server nulls anyway (OCPI-8) — and, since OCPI-14, for
        //   a centering shipment answer on a category that never asks for one.
        dealFacts(s.dryerTypes, q.draft.dryerType, s.machineCategories, q.draft.machineCategoryId),
      ),
    [q.draft, s],
  );

  /*
    ⚠ 18 OF THE 28 MACHINES HAVE NO DETAILED TEMPLATE YET, and that is a state of
      the content, not a fault in the deal. Such a machine produces the summary
      sheet alone — the quotation still goes out, still gets a number, still goes
      for approval. What must not happen is a salesperson discovering afterwards
      that only one paper exists, so the machine is named here, before generating.
  */
  const chosenMachine = s.machineById(q.draft.machineId || null);
  const noDetailTemplate = !!chosenMachine && !chosenMachine.hasTemplate;

  async function onSave() {
    const id = await q.save();
    if (!id) return;
    if (isNew) nav(`/ocpi/deals/${id}/edit`, { replace: true });
  }

  async function onGenerate() {
    const built = await q.generate();
    if (!built) return;
    setPapers(built);
    if (isNew && q.savedId) nav(`/ocpi/deals/${q.savedId}/edit`, { replace: true });
  }

  /**
   * Send for approval — or say, in as many words, why not.
   *
   * ⚠ THE BUTTON STAYS LIVE WHEN THE DEAL IS INCOMPLETE, on purpose. A greyed
   *   button answers nothing: the reader is left to work out for themselves
   *   which of forty fields it is waiting on. Pressing it takes them to the list.
   *
   * 🔴 IT SAVES FIRST, AND THAT IS NOT A CONVENIENCE. `missing` is computed from
   *    the DRAFT — what is on screen — while the table CHECK
   *    `fms_ocpi_complete_when_submitted` reads the ROW. Somebody who fills in
   *    the payment terms and presses Send without saving would pass this
   *    function's check and be refused by the database, on a field the screen
   *    had just shown as answered. Saving makes the two look at the same thing.
   *
   *    A returned quotation is safe to save: `fms_ocpi_decide_quotation` puts a
   *    'rework' decision back to status 'draft', so `fms_ocpi_save_draft` takes
   *    it.
   */
  async function onSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const id = await q.save();
      if (!id) return; // q.error already says why

      if (q.missing.length > 0) {
        approvalPanel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        flashElement(approvalPanel.current);
        return;
      }

      await submitQuotation(id);
      await s.refresh();
      // It is out of the salesperson's hands now, so the editor is the wrong
      // place to be left standing.
      nav(`/ocpi/deals/${id}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const alreadyIssued = !!deal?.quotationNo;
  const nextVersionLabel = alreadyIssued ? "Generate revision" : "Generate quotation";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">
            {alreadyIssued ? deal!.quotationNo : isNew ? "New quotation" : "Draft quotation"}
          </h1>
          <p className="mt-0.5 text-[13.5px] text-grey-2">
            {alreadyIssued
              ? `${deal!.customerName ?? ""}${
                  deal!.quotationVersionNo > 1 ? ` · Rev ${deal!.quotationVersionNo - 1}` : ""
                }`
              : "No number is issued until the quotation is generated."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {q.savedAt && !q.busy && <span className="text-[12.5px] text-grey-2">Saved</span>}
          <Button variant="ghost" onClick={() => void onSave()} disabled={q.busy}>
            {q.busy ? "Working…" : "Save draft"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void onGenerate()}
            disabled={q.busy || !canGenerate}
            title={
              canGenerate
                ? undefined
                : `Still needed: ${q.missingToGenerate.map((m) => m.label).join(", ")}`
            }
          >
            {nextVersionLabel}
          </Button>
          {/*
            ⚠ SEPARATE FROM GENERATE, and only offered once a document exists.
              Sending for approval is the act that takes the quotation out of the
              salesperson's hands; an approver cannot sign off a set of answers
              nobody has rendered, so the database refuses it too.

            ⚠ DISABLED ONLY FOR "THERE IS NO DOCUMENT YET", which is a reason a
              tooltip can carry in six words. Incompleteness is NOT handled by
              disabling: it needs a list, so the button stays live and `onSubmit`
              takes the reader to one.
          */}
          <Button
            onClick={() => void onSubmit()}
            disabled={q.busy || !alreadyIssued || submitting}
            title={
              !alreadyIssued
                ? "Generate the quotation first"
                : canSend
                  ? undefined
                  : `${q.missing.length} ${q.missing.length === 1 ? "answer is" : "answers are"} still needed`
            }
          >
            {submitting ? "Sending…" : "Send for approval"}
          </Button>
        </div>
      </div>

      {(q.error || submitError) && (
        <Card className="border-ryg-red/40 p-4">
          <p className="text-[13px] text-ryg-red">{q.error ?? submitError}</p>
        </Card>
      )}

      {/*
        ⚠ ONLY WHILE NO NUMBER HAS BEEN ISSUED. Once this deal carries a
          quotation number the warning is history — regenerating keeps the same
          number, so nothing further can be minted from this screen and the
          notice would just be noise on every revision.
      */}
      {!alreadyIssued && <QuotationSeriesWarning />}
      {/*
        🔴 THE ORDER-CONFIRMATION SERIES IS NOW A GENERATE-TIME RISK (OCPI-36).
           This warning used to appear on the approval gate alone, because that
           was where `oc_no` was minted. The mint moved here, so by the time an
           approver sees the deal the serial has already been taken off a counter
           nobody checked — and unlike a quotation number, that one ends up on a
           signed contract.

           ⚠ SAME `alreadyIssued` GUARD AS THE QUOTATION WARNING, AND FOR THE SAME
             REASON. Both numbers are allocated once, on the first Generate, and
             regenerating keeps them — so on every revision after the first this
             would be a warning about something that can no longer happen.
      */}
      {!alreadyIssued && <OcSeriesWarning />}
      <CompanyProfileWarning companyId={q.draft.companyId || null} />

      {/*
        ── FOUR CARDS ON A SEVERITY LADDER ────────────────────────────────────

        ⚠ THEY MUST NOT READ AS FOUR VERSIONS OF THE SAME COMPLAINT. This screen
          has contradicted itself before — a card saying a sheet would print six
          blank lines sat directly under one saying the machine produced no such
          sheet. So each says a different thing, in its own register:

            neutral · you cannot generate yet
            red     · the CUSTOMER will see a blank
            orange  · you cannot SEND yet
            yellow  · the DETAILED sheet will rule blanks

          and the last three are gated on `canGenerate`, exactly as the yellow
          one already was, so the neutral card never stacks with them.
      */}
      {!canGenerate && (
        <Card className="p-4">
          <p className="text-[13px] font-medium text-navy">
            Still needed before a quotation can be generated
          </p>
          <p className="mt-1 text-[13px] text-grey">
            A quotation is a priced offer, so it cannot be produced without the customer, the machine
            and the money. Everything else can wait — you can save this as a draft in the meantime.
          </p>
          <MissingList items={q.missingToGenerate} />
        </Card>
      )}

      {canGenerate && blankOnCustomerCopy.length > 0 && (
        <Card className="border-ryg-red/40 bg-[#FFF7F6] p-4">
          <p className="text-[13px] font-semibold text-ryg-red">
            The customer’s copy will print{" "}
            {blankOnCustomerCopy.length === 1 ? "a blank line" : "blank lines"}
          </p>
          <p className="mt-1 text-[13px] text-grey">
            These print on the summary sheet the customer is sent, and they are still empty. You can
            generate anyway — that is how a specification goes out before the terms are settled — but
            send it knowing the paper has gaps.
          </p>
          <MissingList items={blankOnCustomerCopy} />
        </Card>
      )}

      {canGenerate && !canSend && (
        <div ref={approvalPanel}>
          <Card className="border-orange/40 bg-orange-soft p-4">
            <p className="text-[13px] font-semibold text-navy">
              {q.missing.length} {q.missing.length === 1 ? "answer is" : "answers are"} still needed
              before this can be sent for approval
            </p>
            <p className="mt-1 text-[13px] text-grey">
              Generate and revise as often as you need — nothing here blocks that. An approver only
              sees it once every one of these is filled in. Press a name to jump to it.
            </p>
            <MissingList items={q.missing} />
          </Card>
        </div>
      )}

      {/*
        ⚠ A WARNING, NEVER A BLOCK. The detail fields are optional on purpose —
          a quotation goes out mid-negotiation, often before the warranty and
          delivery terms are settled. What must not happen is a salesperson
          discovering the blanks in the customer's reply, so the lines that will
          print ruled-blank are named here, before anything is sent.

        ⚠ SUPPRESSED WHEN THERE IS NO DETAILED SHEET AT ALL. "The detailed sheet
          will print 6 blank lines" is a false statement about a machine that
          produces no detailed sheet, and it sat directly under the notice saying
          so — two cards contradicting each other on the same screen.

        ⚠ NOT CLICKABLE, unlike the three lists above, and that is deliberate.
          Four of these seven answers live in cells of the Shipment & invoice
          table rather than in a labelled field, so they carry no anchor to jump
          to — and a list where three entries move the page and four do nothing
          is worse than one that never offered.
      */}
      {canGenerate && !noDetailTemplate && blankOnDetailSheet.length > 0 && (
        <Card className="border-ryg-yellow/40 bg-[#FFFCF3] p-4">
          <p className="text-[13px] font-medium text-navy">
            The detailed sheet will print {blankOnDetailSheet.length === 1 ? "one blank line" : `${blankOnDetailSheet.length} blank lines`}
          </p>
          <p className="mt-1 text-[13px] text-grey">
            {blankOnDetailSheet.join(", ")}. You can generate anyway and fill these in later — the
            summary sheet is unaffected.
          </p>
        </Card>
      )}

      {alreadyIssued && (
        <Card className="p-4">
          <p className="text-[13px] text-grey">
            <span className="font-medium text-navy">{deal!.quotationNo}</span> has been issued. Editing
            below and generating again keeps that number and adds a revision — the version already
            with the customer is kept exactly as it was.
          </p>
        </Card>
      )}

      {/*
        ⚠ THE MACHINE WITH NO TEMPLATE IS NAMED, NOT REFUSED. The old order
          confirmation step refused such a machine by name and stopped there;
          under one form that would block 18 of 28 machines from being quoted at
          all. Summary-only is a legal outcome, so this says which machine and
          what the consequence is, and nothing is disabled.
      */}
      {noDetailTemplate && (
        <Card className="border-ryg-yellow/40 bg-[#FFFCF3] p-4">
          <p className="text-[13px] font-medium text-navy">
            {chosenMachine!.name} has no detailed sheet yet
          </p>
          <p className="mt-1 text-[13px] text-grey">
            Only the summary will be generated. The quotation still gets its number and still goes for
            approval — the detailed sheet appears once somebody builds this machine's template under
            Machines.
          </p>
        </Card>
      )}

      {/*
        ⚠ BOTH PAPERS, SHOWN AS A PAIR, AND SHOWN EVERY TIME. They are one issue
          of one document set, and a salesperson who sees only the summary will
          send only the summary.

        ⚠ NOT GATED ON `papers`, WHICH WAS THE BUG. This panel used to appear
          only when the Generate handler had just filled a piece of component
          state, so the documents disappeared on reload and the one chance to
          download a quotation was the moment it was made. `IssuedPapers` reads
          the stored files off the version row instead, and merely PREFERS the
          freshly rendered pair when it has one.
      */}
      {deal && versions.length > 0 && (
        <IssuedPapers
          deal={deal}
          versions={versions}
          fresh={papers ? { summary: papers.summary, detail: papers.detail, pi: papers.pi } : null}
        />
      )}

      {/*
        🔴 PARK IT OR WRITE IT OFF, FROM THE SCREEN THE DEAL IS ACTUALLY ON.
           `LifecyclePanel` renders Hold and Cancel, and OCPI-40 opened both to a
           GENERATED draft — the deal whose customer went quiet after being sent
           papers, which until then could only be DELETED, losing its contract
           serial and orphaning its stored PDFs.

           But the panel lives on `DealDetail`, and `DealsTable` routes every
           draft to THIS editor instead (`/deals/:id/edit`), so on its own that
           fix would have been unreachable — a control built and never routed to,
           the FIX-4 trap in reverse. Mounting it here is what makes it real.

        ⚠ IT RENDERS NOTHING UNTIL THERE IS A NUMBER. The panel's own guard is
          `!deal.quotationNo` → no buttons, and it returns null when the reader
          may not act. So an ungenerated draft shows exactly what it showed
          before, and is still deleted rather than cancelled.

        ⚠ BELOW THE FORM, DELIBERATELY. Writing a deal off is not what somebody
          came to this screen to do; it must be findable, not offered first.
      */}
      {deal && <LifecyclePanel deal={deal} />}

      <QuotationForm draft={q.draft} patch={q.patch} />

      {versions.length > 0 && <RevisionHistory versions={versions} />}
    </div>
  );
}
