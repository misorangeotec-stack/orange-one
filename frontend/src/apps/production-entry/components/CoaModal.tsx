import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import FileCapture from "@/shared/components/ui/FileCapture";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useProductionStore } from "../store";
import { uploadStepDocument, type CoaLineInput } from "../data/productionWrites";
import CoaExports from "./CoaExports";
import StepDocLink from "./StepDocLink";
import { dmy } from "../lib/format";
import type { CoaAudience, CoaParameter, ProductionRequest } from "../types";

/**
 * COA ENTRY — the one form behind both generated copies.
 *
 * Opens on ONE TEST ROUND of a job card. Product name and lot number are read off
 * the card and shown read-only; the only things typed here are the issue date,
 * the observed values, an optional per-lot override of each standard, and the
 * conclusion.
 *
 * ⚠ ONE CERTIFICATE PER ROUND, and the caller says which. A rejected lot comes
 *   back as Test 2 and gets its own; Test 1 keeps what it issued, because a
 *   certificate that may already be in a customer's hands must not be silently
 *   overwritten. The round itself is stamped by the server — see lib/coaRound.ts.
 *
 * ⚠ A REJECTED ROUND IS CERTIFIED TOO, and so is one whose verdict has not been
 *   entered yet: this form is the TEST-RESULTS RECORD, not only the certificate,
 *   and the observed values on a failed lot are the evidence for the rejection.
 *   Both print with the verdict on the paper and a watermark across it.
 *
 * ⚠ EVERY ACTIVE PARAMETER IS ENTERED, whichever copy it prints on. "Prints on"
 *   decides what the CUSTOMER document shows, not what QC measures — hiding the
 *   internal-only rows here would mean running the test with nowhere to record it.
 *
 * ⚠ THE STANDARD IS EDITABLE AND WHAT IS TYPED IS WHAT IS STORED. The master
 *   supplies the default; the saved COA keeps its own copy. That is the whole
 *   reason a standard corrected next month cannot rewrite a certificate that has
 *   already gone to a customer.
 */

/** One row of the form. `frozen` marks a row that came from the SAVED COA rather
 *  than from the master — see `seedRows`. */
interface Row {
  parameterId: string | null;
  name: string;
  standard: string;
  observed: string;
  equipmentId: string | null;
  equipmentName: string | null;
  appearsOn: CoaAudience | "both";
  sortOrder: number;
  frozen: boolean;
}

const AUDIENCE_LABEL: Record<string, string> = {
  both: "Both",
  customer: "Customer",
  internal: "Internal",
};

export default function CoaModal({
  open,
  onClose,
  request,
  round,
  readOnly = false,
  stacked = false,
}: {
  open: boolean;
  onClose: () => void;
  request: ProductionRequest | null;
  /**
   * WHICH TEST this certificate is for. Required, and never guessed here — the
   * caller knows whether it is opening the round underway (currentCoaRound) or a
   * particular certificate from a list.
   */
  round: number;
  readOnly?: boolean;
  /** Opening on top of another dialog (the quality step form). */
  stacked?: boolean;
}) {
  const s = useProductionStore();
  const existing = request ? s.coaForRound(request.id, round) : undefined;
  /** The verdict of THIS round, if it has been recorded. Read from the round's
   *  own entry, never from `qcStatus` — that mirrors the latest test. */
  const thisRound = request?.qcRounds[round - 1];
  /** The certificate of the PREVIOUS round, which a re-test seeds from. */
  const previous = request && round > 1 ? s.coaForRound(request.id, round - 1) : undefined;
  const fgItem = request ? s.fgItemById(request.fgItemId) : undefined;
  const productName = fgItem?.name ?? "—";

  const [issueDate, setIssueDate] = useState("");
  const [conclusion, setConclusion] = useState("");
  /** ⚠ The CERTIFICATE's remark, internal copy only — NOT the test's `qcRemarks`,
   *  which lives on the quality step form one screen away. */
  const [remarks, setRemarks] = useState("");
  /** A signed/scanned copy picked but not yet uploaded. Null = nothing new. */
  const [signedFile, setSignedFile] = useState<File | null>(null);
  /** C: push every standard that differs from the master back to the master. */
  const [pushStandards, setPushStandards] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { activeCoaParameters, testEquipmentById } = s;
  /**
   * What the form starts from — a MERGE, not a straight read of either side.
   *
   * A saved COA keeps its own lines and their frozen figures, because they are
   * the certificate. Any ACTIVE master parameter the COA does not already carry
   * is then appended, so a parameter added since it was issued can still be
   * filled in on an edit. And a saved line whose parameter has since been
   * DEACTIVATED is kept rather than dropped: it was measured, it printed, and
   * silently losing it would rewrite history to make the master look right.
   *
   * ⚠ A RE-TEST STARTS FROM THE PREVIOUS ROUND'S CERTIFICATE — its parameters,
   *   standards and equipment — with OBSERVED DELIBERATELY BLANK, because that is
   *   the one thing the new test measures. Without this a Test 2 form opens
   *   completely empty (the nine master standards are all null today), so the QC
   *   team would retype every standard they typed an hour earlier. It copies from
   *   a frozen snapshot and writes a new row, so it cannot reach back and alter
   *   what Test 1 issued.
   */
  const seedRows = useMemo((): Row[] => {
    const fromMaster = (p: CoaParameter): Row => ({
      parameterId: p.id,
      name: p.name,
      standard: p.standard ?? "",
      observed: "",
      equipmentId: p.testEquipmentId,
      equipmentName: testEquipmentById(p.testEquipmentId)?.name ?? null,
      appearsOn: p.appearsOn,
      sortOrder: p.sortOrder,
      frozen: false,
    });
    const source = existing ?? previous;
    if (!source) return activeCoaParameters.map(fromMaster);

    const carried: Row[] = source.lines.map((l) => ({
      parameterId: l.parameterId,
      name: l.name,
      standard: l.standard ?? "",
      // Only an EDIT of this round's own certificate brings the readings back.
      observed: existing ? l.observed ?? "" : "",
      equipmentId: l.equipmentId,
      equipmentName: l.equipmentName,
      appearsOn: l.appearsOn,
      sortOrder: l.sortOrder,
      frozen: !!existing,
    }));
    const have = new Set(carried.map((r) => r.parameterId).filter(Boolean));
    const added = activeCoaParameters.filter((p) => !have.has(p.id)).map(fromMaster);
    return [...carried, ...added].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [existing, previous, activeCoaParameters, testEquipmentById]);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setIssueDate(existing?.issueDate ?? todayLocalIso());
    // A round already known to have FAILED must not default to "Pass" — the one
    // free-text line on the certificate would then contradict its own verdict.
    setConclusion(
      existing?.conclusion ??
        (thisRound?.result === "rejected" ? "Fail / Not Qualified" : "Pass / Qualified"),
    );
    setRemarks(existing?.remarks ?? "");
    setSignedFile(null);
    // ⚠ Never remembered between openings: pushing a master value is a decision
    //   taken per save, not a preference.
    setPushStandards(false);
    setRows(seedRows);
  }, [open, existing, thisRound, seedRows]);

  const patch = (i: number, next: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...next } : r)));

  const observedCount = rows.filter((r) => r.observed.trim() !== "").length;

  /**
   * C — the standards on this form that differ from what the master holds.
   *
   * ⚠ Compared against the MASTER, not against what the certificate was seeded
   *   with. A re-test seeds its standards from the previous round's frozen
   *   snapshot, so a value can match the certificate it came from and still be
   *   news to the master — which is the case that most needs pushing.
   *
   * Rows with no `parameterId` (a free-text or since-deleted parameter) have no
   * master row to push to and are skipped.
   */
  const differing = useMemo(() => {
    const byId = new Map(s.coaParameters.map((p) => [p.id, p]));
    const out: { parameterId: string; name: string; from: string; to: string }[] = [];
    for (const r of rows) {
      if (!r.parameterId) continue;
      const master = byId.get(r.parameterId);
      if (!master) continue;
      const to = r.standard.trim();
      const from = (master.standard ?? "").trim();
      if (to === from) continue;
      out.push({ parameterId: r.parameterId, name: r.name, from, to });
    }
    return out;
  }, [rows, s.coaParameters]);

  const save = async () => {
    if (!request) return;
    // Mirrors the server guard rather than replacing it: the input's `max` stops
    // the picker, this stops a typed date, and the RPC stops everything else.
    if (issueDate && issueDate > todayLocalIso()) {
      setErr("The issue date cannot be in the future.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const lines: CoaLineInput[] = rows.map((r) => ({
        parameter_id: r.parameterId,
        name: r.name,
        standard: r.standard.trim() || null,
        observed: r.observed.trim() || null,
        equipment_id: r.equipmentId,
        equipment_name: r.equipmentName,
        appears_on: r.appearsOn,
        sort_order: r.sortOrder,
      }));
      // F: the signed copy goes to storage first, and its keys are sent ONLY
      // when there is a new file — omitted, the RPC keeps whatever is stored.
      const uploaded = signedFile
        ? await uploadStepDocument(request.id, "coa", signedFile)
        : null;
      // ⚠ The round is NOT sent — the server stamps it. An existing certificate
      // is named by its id, so correcting Test 1 while Test 2 is open updates
      // Test 1 instead of minting a second certificate for the current round.
      await s.saveCoa({
        requestId: request.id,
        coaId: existing?.id ?? null,
        issueDate,
        conclusion: conclusion.trim(),
        remarks: remarks.trim(),
        ...(uploaded ? { attachmentPath: uploaded.path, attachmentName: uploaded.name } : {}),
        // C: only what the tick asked for. The server re-checks each value
        // against the master and writes an activity row per real change.
        pushStandards: pushStandards
          ? differing.map((d) => ({ parameter_id: d.parameterId, standard: d.to || null }))
          : [],
        lines,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
  const cell = "w-full px-2.5 py-1.5 text-[13px]";

  /**
   * E + F — the finished papers, and the signed copy someone attached.
   *
   * ⚠ RENDERED IN EXACTLY ONE OF TWO PLACES, never both. `Modal`'s read-only
   *   branch emits `readOnlyHeader` AND its children (the latter inside a
   *   `<fieldset disabled>`), so mounting this in the body unguarded would give a
   *   viewer two copies — one live above, one dead below. And the body copy alone
   *   would be the dead one, which is exactly the person this is for: someone who
   *   opened a certificate to print it.
   */
  const papers = existing ? (
    <div className="rounded-xl border border-line px-3.5 py-3 space-y-2.5">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-grey-2">
        Download or print — Test {existing.round}
      </div>
      <CoaExports coa={existing} />
      {existing.attachmentPath && (
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[12px] text-grey-2">Signed copy:</span>
          <StepDocLink path={existing.attachmentPath} name={existing.attachmentName} />
        </div>
      )}
    </div>
  ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      stacked={stacked}
      readOnlyHeader={papers}
      size="3xl"
      title={`Certificate of Analysis — ${request?.jobcardNo ?? ""} · Test ${round}`}
      subtitle={
        existing
          ? `Issued for Test ${round}. Saving corrects that certificate; the other tests on this lot are untouched.`
          : previous
            ? `A new certificate for Test ${round}. Test ${round - 1} keeps the one it issued — the standards are carried over, the observed values are not.`
            : "Issued for this test, and editable afterwards."
      }
      footer={
        readOnly ? (
          <Button variant="ghost" onClick={onClose}>Close</Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : existing ? "Save changes" : "Issue COA"}
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl bg-page px-3.5 py-3">
          <div>
            <div className={cap}>Product Name</div>
            <div className="text-[14px] font-semibold text-navy leading-tight">{productName}</div>
          </div>
          <div>
            <div className={cap}>Lot No</div>
            <div className="text-[14px] font-semibold text-navy leading-tight">{request?.jobcardNo || "—"}</div>
          </div>
          <div>
            {/* ⚠ THIS ROUND'S verdict and THIS ROUND'S date, not the card's
                `qcStatus`/`qcActualDate` — those mirror the LATEST test, so on a
                re-tested lot they would label Test 1's certificate with Test 2's
                answer. It reads "not recorded yet" while the certificate is being
                entered ahead of Approve/Reject, which is now allowed. */}
            <div className={cap}>Quality Check · Test {round}</div>
            <div
              className={`text-[14px] font-semibold leading-tight ${
                thisRound?.result === "approved"
                  ? "text-ryg-green"
                  : thisRound?.result === "rejected"
                    ? "text-ryg-red"
                    : "text-grey-2"
              }`}
            >
              {thisRound?.result === "approved"
                ? "Approved"
                : thisRound?.result === "rejected"
                  ? "Rejected"
                  : "Not recorded yet"}
              {thisRound?.testDate ? ` · ${dmy(thisRound.testDate)}` : ""}
            </div>
          </div>
        </div>


        {/* The body copy — guarded, because in read-only mode the identical
            block is already rendered above the fieldset (see `papers`). */}
        {!readOnly && papers}
        {/* Say on the FORM what the paper will say, so nobody is surprised by a
            stamp they did not know they were creating. */}
        {thisRound?.result === "rejected" ? (
          <div className="rounded-xl border border-ryg-red/40 bg-[#FDECEC] px-3.5 py-2.5 text-[12.5px] text-ryg-red">
            <span className="font-semibold">Test {round} was rejected.</span> The certificate still
            saves and still prints — these observed values are the evidence for the rejection — with
            <span className="font-semibold"> REJECTED</span> across the page and the result stated
            beside the conclusion, on both copies.
          </div>
        ) : !thisRound ? (
          <div className="rounded-xl bg-orange-soft px-3.5 py-2.5 text-[12.5px] text-orange font-medium">
            Test {round} has not been saved as Approved or Rejected yet, so this certificate prints
            NOT VERIFIED across the page until it is. The verdict is stamped on automatically the
            moment you record the test.
          </div>
        ) : null}

        <FieldLabel label="Issue Date" hint="defaults to today · may be back-dated, never post-dated">
          <TextInput
            type="date"
            max={todayLocalIso()}
            disabled={readOnly}
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </FieldLabel>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="block text-[13px] font-medium text-navy">Test results</span>
            <span className="text-[11.5px] text-grey-2 tabular-nums">
              {observedCount} of {rows.length} observed
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-line px-3.5 py-3 text-[12.5px] text-grey-2">
              No active COA parameters. Add them under Masters → COA Parameters before issuing a certificate.
            </div>
          ) : (
            <div className="rounded-xl border border-line overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                    <th className="font-medium px-3 py-2 min-w-[220px]">Parameter</th>
                    <th className="font-medium px-2 py-2 w-36">Standard</th>
                    <th className="font-medium px-2 py-2 w-36">Observed</th>
                    <th className="font-medium px-2 py-2 w-36">Test Equipment</th>
                    <th className="font-medium px-2 py-2 w-24">Prints on</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.parameterId ?? "row"}-${i}`} className="border-b border-line/70 last:border-0">
                      <td className="px-3 py-2 text-navy align-middle">{r.name}</td>
                      <td className="px-2 py-2">
                        {readOnly ? (
                          <span className="text-grey">{r.standard || "—"}</span>
                        ) : (
                          <TextInput
                            className={cell}
                            value={r.standard}
                            onChange={(e) => patch(i, { standard: e.target.value })}
                            placeholder="—"
                          />
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {readOnly ? (
                          <span className="text-grey">{r.observed || "—"}</span>
                        ) : (
                          <TextInput
                            className={cell}
                            value={r.observed}
                            onChange={(e) => patch(i, { observed: e.target.value })}
                            placeholder="—"
                          />
                        )}
                      </td>
                      {/* Read-only: the instrument comes from the parameter master
                          mapping, so it is corrected there, not per certificate. */}
                      <td className="px-2 py-2 text-grey">{r.equipmentName || "—"}</td>
                      <td className="px-2 py-2 text-grey-2">{AUDIENCE_LABEL[r.appearsOn] ?? "Both"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/*
            C — one line at the foot, not a tick per row.

            ⚠ ONE CONTROL BECAUSE OF WHAT THE DATA LOOKS LIKE TODAY: every master
              standard is still null (PE-5 item B), so the ordinary case for
              months is somebody typing all nine and wanting all nine kept. Nine
              separate ticks would be worst at exactly the job this does most.

            Unticked — the default, never remembered — is precisely today's
            behaviour: the value lives on this certificate and nowhere else.
          */}
          {!readOnly && differing.length > 0 && (
            <label className="flex items-start gap-2.5 rounded-xl border border-line bg-page/60 px-3.5 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-orange"
                checked={pushStandards}
                onChange={(e) => setPushStandards(e.target.checked)}
              />
              <span className="text-[12.5px] text-navy">
                <span className="font-semibold">
                  {differing.length} standard{differing.length === 1 ? "" : "s"} differ
                  {differing.length === 1 ? "s" : ""} from the master
                </span>{" "}
                — update the master as well?
                <span className="block text-grey-2 mt-0.5">
                  {differing.map((d) => d.name).join(", ")}
                </span>
                <span className="block text-grey-2 mt-0.5">
                  Certificates already issued are never changed by this.
                </span>
              </span>
            </label>
          )}
        </div>

        <FieldLabel label="Conclusion">
          <TextInput
            disabled={readOnly}
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            placeholder="e.g. Pass / Qualified"
          />
        </FieldLabel>

        {/* D — the CERTIFICATE's remark. ⚠ Not the test's: `qcRemarks` on the
            quality step form is a different field about a different thing, and
            nothing is wired between them. */}
        <FieldLabel
          label="Remarks"
          hint="prints on the INTERNAL copy only — never on the customer copy"
        >
          <TextArea
            rows={2}
            disabled={readOnly}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Anything worth recording about this batch, for internal readers"
          />
        </FieldLabel>

        {/* F — a signed or scanned copy of this certificate. */}
        <FieldLabel
          label="Signed COA"
          hint={
            existing?.attachmentPath
              ? "optional · choosing a file replaces the attached copy"
              : "optional · a signed or scanned copy"
          }
        >
          <FileCapture value={signedFile} onChange={setSignedFile} disabled={readOnly} />
          {existing?.attachmentPath && !signedFile && (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-[12px] text-grey-2">Attached:</span>
              <StepDocLink path={existing.attachmentPath} name={existing.attachmentName} />
            </div>
          )}
        </FieldLabel>

        {err && <div className="text-[12.5px] text-ryg-red font-medium">{err}</div>}
      </div>
    </Modal>
  );
}
