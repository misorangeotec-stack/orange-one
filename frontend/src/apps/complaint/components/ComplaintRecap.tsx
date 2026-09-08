import { useState } from "react";
import { useComplaintStore } from "../store";
import {
  dmy,
  formatDateTime,
  invoiceDateLabelOf,
  invoiceLabelOf,
  lotLabelOf,
  partyLabelOf,
} from "../lib/format";
import { COMPLAINT_TYPE_LABEL, type ComplaintRequest } from "../types";

/**
 * Everything already known about a complaint, shown at the top of whichever
 * bucket is looking at it.
 *
 * ⚠ NOBODY DOWNSTREAM RAISED THE COMPLAINT. The plant, the service team and
 *   management each meet it cold, so this carries the whole record rather than a
 *   one-line summary. The alternative is a person opening a second tab to read
 *   the complaint they are being asked to act on.
 *
 * IT GROWS AS THE COMPLAINT MOVES: a step's panel appears once its timestamp is
 * stamped, and the attachments panel accumulates every file from every step.
 *
 * LAYOUT: a two-column cell grid, not a tall list of rows. Fifteen stacked rows
 * pushed the actual form off the screen and read as a receipt; in two columns
 * the whole complaint fits above the fold and scans like a record card.
 */

/** One labelled cell. Empty values are dropped rather than rendered as dashes. */
function Cell({
  label,
  value,
  wide,
}: {
  label: string;
  value: React.ReactNode;
  /** Span both columns — for free text that would otherwise wrap to five lines. */
  wide?: boolean;
}) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <div className="text-[11px] text-grey-2 leading-snug">{label}</div>
      {/* Wrapping is not optional here: ledger names run to 60 characters and
          remarks are free text. A truncated value hides the part that matters. */}
      <div className="text-[13px] font-medium text-navy whitespace-pre-wrap break-words leading-snug mt-0.5">
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border ${tone ?? "border-line bg-white"}`}>
      <div className="px-4 py-2 border-b border-line/70 text-[12px] font-bold text-navy">{title}</div>
      <div className="px-4 py-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

/** Every file on the complaint, whichever step attached it. */
function Attachments({ r }: { r: ComplaintRequest }) {
  const s = useComplaintStore();
  const [err, setErr] = useState("");
  const docs = s.docsFor(r.id);
  if (docs.length === 0) return null;

  // ⚠ SIGNED URLS ARE MINTED ON CLICK, never on render — they last ten minutes,
  //   and a link created when the modal opened is often dead by the time
  //   somebody uses it.
  const open = async (path: string) => {
    try {
      window.open(await s.docUrl(path), "_blank", "noopener");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="px-4 py-2 border-b border-line/70 text-[12px] font-bold text-navy">
        Attachments ({docs.length})
      </div>
      <div className="px-4 py-3 flex flex-wrap gap-2">
        {docs.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => void open(d.path)}
            title={`${d.name} — attached at ${d.stepKey}`}
            className="max-w-[240px] truncate rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-orange hover:bg-page transition"
          >
            {d.name}
          </button>
        ))}
      </div>
      {err && <p className="px-4 pb-2 text-[12px] text-red-600">{err}</p>}
    </div>
  );
}

export default function ComplaintRecap({ r }: { r: ComplaintRequest }) {
  const s = useComplaintStore();
  const t = r.complaintType;
  const qty = r.qtyAffected ? `${r.qtyAffected}${r.unitName ? ` ${r.unitName}` : ""}` : null;

  return (
    <div className="space-y-3">
      <Panel title={`${r.complaintNo} · ${COMPLAINT_TYPE_LABEL[t]}`}>
        <Cell label={partyLabelOf(t)} value={r.partyName} />
        <Cell label="Company" value={s.companyName(r.companyId)} />
        <Cell label={lotLabelOf(t)} value={r.lotNo} />
        <Cell label="LOT expiry" value={r.lotExpiryDate ? dmy(r.lotExpiryDate) : null} />
        <Cell label={invoiceLabelOf(t)} value={r.invoiceNo} />
        <Cell label={invoiceDateLabelOf(t)} value={r.invoiceDate ? dmy(r.invoiceDate) : null} />
        <Cell label="Item" value={r.itemName} wide />
        <Cell label="Category of ink" value={r.category} />
        <Cell label="Quantity affected" value={qty} />
        <Cell label="Nature of complaint" value={s.natureName(r.natureId)} />
        <Cell
          label="Issue identified"
          value={r.issueIdentifiedAt ? formatDateTime(r.issueIdentifiedAt) : null}
        />
        <Cell label="Problem in details" value={r.problemDetails} wide />
        <Cell label="Other remarks" value={r.otherRemarks} wide />
        <Cell label="Raised by" value={`${r.requesterName} · ${formatDateTime(r.submittedAt)}`} wide />
      </Panel>

      <Attachments r={r} />

      {r.plantAt && (
        <Panel title="Plant action">
          <Cell label="Corrective action" value={r.plantAction} wide />
          <Cell label="Plant remarks" value={r.plantRemarks} wide />
          <Cell label="Recorded" value={`${s.personName(r.plantBy)} · ${formatDateTime(r.plantAt)}`} wide />
        </Panel>
      )}

      {r.svcAt && (
        <Panel title="Service team">
          <Cell
            label="Commercial call"
            value={r.svcCommercialCall === null ? null : r.svcCommercialCall ? "Yes" : "No"}
          />
          <Cell label="Service remarks" value={r.svcRemarks} wide />
          <Cell label="Conclusion" value={r.svcConclusion} wide />
          <Cell label="Call remarks" value={r.svcCallRemarks} wide />
          <Cell label="Recorded" value={`${s.personName(r.svcBy)} · ${formatDateTime(r.svcAt)}`} wide />
        </Panel>
      )}

      {r.aprAt && (
        <Panel
          title={`Management ${r.aprDecision === "reject" ? "REFUSED the commercial call" : "approved the commercial call"}`}
          tone={r.aprDecision === "reject" ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}
        >
          <Cell label="Note" value={r.aprNote} wide />
          <Cell label="Decided" value={`${s.personName(r.aprBy)} · ${formatDateTime(r.aprAt)}`} wide />
        </Panel>
      )}

      {r.svcCloseAt && (
        <Panel title="Closed by the service team">
          <Cell label="Closing remarks" value={r.svcCloseRemarks} wide />
          <Cell label="Closed" value={`${s.personName(r.svcCloseBy)} · ${formatDateTime(r.svcCloseAt)}`} wide />
        </Panel>
      )}

      {r.mgmtAt && (
        <Panel title="Management review" tone="border-emerald-200 bg-emerald-50">
          <Cell label="Note" value={r.mgmtNote} wide />
          <Cell label="Reviewed" value={`${s.personName(r.mgmtBy)} · ${formatDateTime(r.mgmtAt)}`} wide />
        </Panel>
      )}
    </div>
  );
}
