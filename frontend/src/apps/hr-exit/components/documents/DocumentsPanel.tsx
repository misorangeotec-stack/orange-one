import { useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import DueCell from "@/shared/components/ui/DueCell";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useExitStore, skippedStepsOf } from "../../store";
import { archiveBlockersKey, fetchArchiveBlockers } from "../../data/exitFetch";
import { exitDocUrl, uploadShareDoc } from "../../data/exitWrites";
import { stepDone } from "../../lib/queues";
import type { StepKey } from "../../lib/steps";
import type { ExitCase, ExitDocument } from "../../types";

/**
 * ⭐⭐⭐ CLOSURE — the exit documents, the signed acknowledgement, and the archive.
 *
 * ── THE ONE THING THIS SCREEN EXISTS TO DO ──────────────────────────────────────
 *
 *   **REFUSE TO CLOSE A CASE THAT IS NOT ACTUALLY CLOSED — VISIBLY, BEFORE THE CLICK.**
 *
 *   `documents` and `archive` are two steps and not one, and the reason is right here:
 *   they have different evidence. `documents` is evidenced by the letter going OUT.
 *   `archive` is evidenced by THE SIGNED ACKNOWLEDGEMENT COMING BACK, and by the leaver's
 *   own copy of the F&F being somewhere they can actually open it.
 *
 *   Merge the two and you hide the commonest real failure of an exit: *the letters were
 *   issued and the acknowledgement never came back*. The case would read "closed", the
 *   employee would have no relieving letter on file, and nobody would find out until a
 *   background check eighteen months later.
 *
 * ── THE CHECKLIST IS THE DATABASE'S, NOT THIS COMPONENT'S ───────────────────────
 *
 *   ⚠ **THIS SCREEN CANNOT WORK OUT WHY IT IS BLOCKED, AND MUST NOT TRY.** One of the
 *     five archive conditions is "the leaver's own copy of the final F&F is attached" —
 *     and `finalFnfPath` lives on `fms_exit_settlements`, whose RLS is admin ∨ coordinator
 *     ∨ **finance staff** ∨ the-leaver-after-approval. The owner of the `documents` /
 *     `archive` steps is EXIT staff, and exit staff is not finance staff: they get ZERO
 *     ROWS from that table. A client-side checklist would tell them, with total
 *     confidence, that the final F&F copy was missing while it sat right there — and they
 *     would go and ask payroll to upload it again.
 *
 *   So the checklist below comes from `fms_exit_archive_blockers()` (SECURITY DEFINER,
 *   returns SENTENCES and not one figure), which is the **same function
 *   `fms_exit_archive_case` refuses on**. What the screen shows and what the database will
 *   do cannot drift apart, because they are one implementation.
 *
 * ── AND THE ABSCONDER STILL GETS OUT ────────────────────────────────────────────
 *
 *   Every guard is `stepDone` — **timestamp OR WAIVED**. An absconder has no handover, no
 *   relieving letter and no F&F to pay; those steps are skipped with a reason, and this
 *   case archives cleanly. A guard on the raw timestamps would wedge it open forever, and
 *   it is not a rare case.
 */

/** A block that cannot be worked yet, and the honest reason why. */
function Locked({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-grey-2">
      <span className="font-semibold text-grey">Locked</span> — {children}
    </p>
  );
}

const Done = ({ label }: { label: string }) => (
  <span className="rounded-full bg-[#E9F7EF] px-2.5 py-1 text-[11.5px] font-semibold text-ryg-green">
    {label}
  </span>
);

async function openDoc(path: string) {
  const url = await exitDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

/* -------------------------------------------------------------------------- */
/*  One document row                                                          */
/* -------------------------------------------------------------------------- */

function DocumentRow({ case: c, doc, canWork }: { case: ExitCase; doc: ExitDocument; canWork: boolean }) {
  const s = useExitStore();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The issue.
  const [issuing, setIssuing] = useState(false);
  const [issuedOn, setIssuedOn] = useState(doc.issuedOn ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [remarks, setRemarks] = useState(doc.remarks ?? "");

  // The acknowledgement coming BACK.
  const [acking, setAcking] = useState(false);
  const [handedOn, setHandedOn] = useState(doc.handedOverOn ?? "");
  const [ackFile, setAckFile] = useState<File | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const issued = !!doc.issuedOn;
  const acked = !!doc.ackSignedPath;

  return (
    <li className="space-y-3 rounded-xl border border-line bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-navy">{doc.name}</span>
            {doc.requiresFile && (
              <span className="rounded-full bg-page px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">
                File required
              </span>
            )}
          </div>
          {issued && (
            <p className="mt-0.5 text-[12px] text-grey-2">Issued {formatDateDMY(doc.issuedOn)}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {issued ? <Done label="Issued" /> : (
            <span className="rounded-full bg-page px-2.5 py-1 text-[11.5px] font-semibold text-grey-2">
              Not issued
            </span>
          )}
          {/* ⭐ THE SECOND CHIP IS THE WHOLE PHASE. "Issued" is not "acknowledged". */}
          {acked ? <Done label="Acknowledged" /> : (
            <span
              className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                issued ? "bg-[#FFF7E6] text-yellow" : "bg-page text-grey-2"
              }`}
              title={issued ? "The signed copy has not come back. The case cannot be archived." : undefined}
            >
              {issued ? "Awaiting signature" : "—"}
            </span>
          )}
        </div>
      </div>

      {/* ---------------------------- 1. ISSUE ---------------------------- */}
      {issuing && canWork ? (
        <div className="space-y-3">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <FieldLabel label="Issued on">
              {/* A business date, straight out of a date input. NEVER toISOString(). */}
              <TextInput type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
            </FieldLabel>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-navy">
                The letter{doc.requiresFile ? "" : " (optional)"}
              </span>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-[12px] text-grey file:mr-2 file:rounded-lg file:border-0 file:bg-page file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-navy hover:file:bg-line/60"
              />
              <span className="mt-1 block text-[11.5px] text-grey-2">
                Stored under <code>cases/…/share/</code> — the one prefix the leaver can open. A relieving
                letter they cannot open is not a relieving letter.
              </span>
            </label>
          </div>
          <FieldLabel label="Remarks" hint="optional">
            <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </FieldLabel>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  // Upload FIRST, so a document can never be "issued" against a letter
                  // that is not there. The RPC validates the share/ prefix — and counts
                  // whatever arrives in THIS call as the evidence (20260712190000), which
                  // is what lets the file and the date land together.
                  const up = file ? await uploadShareDoc(c.id, file) : null;
                  await s.issueDocuments(c, [
                    {
                      id: doc.id,
                      issuedOn: issuedOn || null,
                      filePath: up?.path ?? null,
                      fileName: up?.name ?? null,
                      remarks: remarks.trim() || null,
                    },
                  ]);
                  setFile(null);
                  setIssuing(false);
                })
              }
            >
              {busy ? "Saving…" : issued ? "Save the correction" : "Mark it issued"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setIssuing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Issued on" value={formatDateDMY(doc.issuedOn)} />
          <Field label="The document">
            {doc.filePath ? (
              <button
                type="button"
                onClick={() => void openDoc(doc.filePath!)}
                className="font-semibold text-orange hover:underline"
              >
                {doc.fileName ?? "Open"} →
              </button>
            ) : (
              <span className="text-grey-2">—</span>
            )}
          </Field>
          <Field label="Handed over on" value={formatDateDMY(doc.handedOverOn)} />
          {doc.remarks && <Field className="sm:col-span-3" label="Remarks" value={doc.remarks} />}
        </div>
      )}

      {/* ------------------- 2. ⭐ THE ACKNOWLEDGEMENT, COMING BACK ------------------- */}
      {acked ? (
        <div className="rounded-xl border border-[#E9F7EF] bg-[#E9F7EF]/40 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12.5px] text-navy">
              <span className="font-semibold">Signed acknowledgement received</span>
              {doc.handedOverOn && ` — ${formatDateDMY(doc.handedOverOn)}`}
            </span>
            {doc.ackSignedPath && (
              <button
                type="button"
                onClick={() => void openDoc(doc.ackSignedPath!)}
                className="text-[12.5px] font-semibold text-orange hover:underline"
              >
                {doc.ackSignedName ?? "Open the signed copy"} →
              </button>
            )}
          </div>
        </div>
      ) : issued && acking && canWork ? (
        <div className="space-y-3 rounded-xl border border-line bg-page px-3.5 py-3">
          <SectionHeading>The signed acknowledgement</SectionHeading>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <FieldLabel label="Handed over on">
              <TextInput type="date" value={handedOn} onChange={(e) => setHandedOn(e.target.value)} />
            </FieldLabel>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-navy">
                The copy they signed and returned
              </span>
              <input
                type="file"
                onChange={(e) => setAckFile(e.target.files?.[0] ?? null)}
                className="w-full text-[12px] text-grey file:mr-2 file:rounded-lg file:border-0 file:bg-page file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-navy hover:file:bg-line/60"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const up = ackFile ? await uploadShareDoc(c.id, ackFile) : null;
                  await s.recordAck(c, doc.id, {
                    handedOverOn: handedOn || null,
                    ackPath: up?.path ?? null,
                    ackName: up?.name ?? null,
                  });
                  setAckFile(null);
                  setAcking(false);
                })
              }
            >
              {busy ? "Saving…" : "Record the acknowledgement"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAcking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : issued ? (
        <p className="text-[12.5px] text-grey-2">
          <span className="font-semibold text-yellow">The signed copy has not come back.</span> The case
          cannot be archived until it does.
        </p>
      ) : null}

      {/* The two actions. Deliberately separate buttons: issuing and acknowledging are
          separated by days and a human being with a pen. */}
      {canWork && !issuing && !acking && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={issued ? "ghost" : undefined} onClick={() => setIssuing(true)}>
            {issued ? "Correct the issue" : "Issue this document"}
          </Button>
          {issued && (
            <Button size="sm" variant={acked ? "ghost" : undefined} onClick={() => setAcking(true)}>
              {acked ? "Replace the signed copy" : "Record the signed acknowledgement"}
            </Button>
          )}
        </div>
      )}

      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*  The panel                                                                 */
/* -------------------------------------------------------------------------- */

export default function DocumentsPanel({ case: c }: { case: ExitCase }) {
  const s = useExitStore();
  const docs = s.documentsFor(c.id);
  const skipped = skippedStepsOf(s.skips, c.id);
  const skipOf = (k: StepKey) => s.skipsFor(c.id).find((x) => x.stepKey === k);
  const done = (k: StepKey) => stepDone(c, k, skipped);

  const closed = !s.isOpenCase(c) && c.status !== "on_hold";
  const may = (k: StepKey) => !closed && !skipOf(k) && !!c.lwd && s.canActOn(k, c);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [archiveRemarks, setArchiveRemarks] = useState("");

  /**
   * ⭐ THE LIVE CHECKLIST — asked of the database, for the reasons in the file header.
   *
   * The key nests under `EXIT_QK`, so every write in the store (which invalidates on the
   * QK PREFIX) re-asks it. Issue a letter, and "Waiting on…" corrects itself.
   *
   * Not fetched for an archived case: there is nothing left to block.
   */
  const { data: blockers = [], isLoading: blockersLoading } = useQuery({
    queryKey: archiveBlockersKey(c.id),
    queryFn: () => fetchArchiveBlockers(c.id),
    enabled: !!c.approvedAt && c.status !== "archived",
  });

  const canArchive = may("archive") && blockers.length === 0;

  return (
    <Card className="space-y-5 p-5">
      {/* ---------------------------- header ---------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-navy">Documents &amp; closure</h2>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-grey-2">
            The experience and relieving letters go out — and then{" "}
            <span className="font-semibold text-navy">the signed acknowledgement has to come back</span>.
            Those are two different facts, and the case is not closed until both are true.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {c.documentsIssuedAt && <Done label="Issued" />}
          {c.archivedAt && <Done label="Archived" />}
        </div>
      </div>

      {/* ======================== 15 · ISSUE THE DOCUMENTS ======================= */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading>15 · Issue the exit documents</SectionHeading>
          {c.documentsIssuedAt ? (
            <Done label={`Issued ${formatDateDMY(c.documentsIssuedAt)}`} />
          ) : (
            done("fnf_approve") && (
              <span className="text-[12.5px] text-grey">
                Due <DueCell dueIso={s.dueIsoFor(c, "documents")} />
              </span>
            )
          )}
        </div>

        {skipOf("documents") ? (
          <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-navy">
            <span className="font-semibold">Waived</span> — {skipOf("documents")!.reason}
            <span className="mt-1 block text-[11.5px] text-grey-2">
              A terminated employee gets no relieving letter, and an absconder gets nothing at all. The
              archive still demands the signed acknowledgement for any document that <em>was</em> issued.
            </span>
          </p>
        ) : !c.lwd ? (
          <Locked>the last working day has not been confirmed. The letters are dated from it.</Locked>
        ) : !done("fnf_approve") ? (
          /* Letters issue once the settlement is SETTLED, not once the bank has moved —
             transfers lag, and the leaver needs their relieving letter to start elsewhere. */
          <Locked>
            the full &amp; final has not been approved yet. The letters go out once the settlement is
            agreed — not once the bank has moved. (The step can be waived, with a reason.)
          </Locked>
        ) : docs.length === 0 ? (
          <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-grey-2">
            No document types were active when this exit's last working day was confirmed, so there is
            nothing to issue. Add them in Masters and waive this step with a reason.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {docs.map((d) => (
              <DocumentRow key={d.id} case={c} doc={d} canWork={may("documents")} />
            ))}
          </ul>
        )}
      </div>

      {/* ============================ 16 · ARCHIVE ============================= */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading>16 · Acknowledge &amp; archive</SectionHeading>
          {c.archivedAt ? (
            <Done label={`Archived ${formatDateDMY(c.archivedAt)}`} />
          ) : (
            done("documents") && (
              <span className="text-[12.5px] text-grey">
                Due <DueCell dueIso={s.dueIsoFor(c, "archive")} />
              </span>
            )
          )}
        </div>

        {c.archivedAt ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Archived on" value={formatDateDMY(c.archivedAt)} />
            <Field label="Status changed in the system" value={c.systemStatusChanged ? "Yes" : "Not ticked"} />
            <Field label="Clearance remarks" value={c.clearanceRemarks} />
            <p className="sm:col-span-3 text-[11.5px] text-grey-2">
              The case is closed. It has left every queue and every count — it is in nobody's work list,
              and it is in no overdue total.
            </p>
          </div>
        ) : (
          <>
            {/* ⭐⭐ THE REFUSAL, SHOWN BEFORE THE BUTTON IS PRESSED. This list is the
                   DATABASE's — the same check fms_exit_archive_case runs. See the header. */}
            {blockersLoading ? (
              <p className="text-[13px] text-grey-2">Checking what is still outstanding…</p>
            ) : blockers.length > 0 ? (
              <div className="rounded-xl border border-yellow/30 bg-[#FFF7E6]/60 px-4 py-3">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-yellow">
                  Waiting on
                </div>
                <ul className="mt-1.5 space-y-1">
                  {blockers.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-[13px] text-navy">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-yellow" />
                      <span className="first-letter:uppercase">{b}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11.5px] leading-snug text-grey-2">
                  This is the database's own check, not this screen's guess — it is exactly what Archive
                  will refuse on. Every one of these can also be <span className="font-semibold">waived
                  with a reason</span> if it genuinely does not apply.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-[#E9F7EF] bg-[#E9F7EF]/40 px-4 py-3 text-[13px] text-navy">
                <span className="font-semibold">Everything is in.</span> Clearance, the settlement, the
                letters, the signed acknowledgements and the employee's own copy of the final F&amp;F.
              </div>
            )}

            {may("archive") && (
              <div className="space-y-3">
                <FieldLabel label="Closing remarks" hint="optional — kept on the case">
                  <TextArea
                    rows={2}
                    value={archiveRemarks}
                    onChange={(e) => setArchiveRemarks(e.target.value)}
                    placeholder="Anything worth saying about how this exit went."
                  />
                </FieldLabel>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busy || !canArchive}
                    onClick={() =>
                      void (async () => {
                        setBusy(true);
                        setErr(null);
                        try {
                          await s.archiveCase(c, archiveRemarks.trim() || null);
                        } catch (e) {
                          setErr((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      })()
                    }
                  >
                    {busy ? "Archiving…" : "Archive this exit"}
                  </Button>
                  <span className="text-[11.5px] text-grey-2">
                    This is the terminal step. It marks the employee separated, ticks “status changed in
                    the system”, and takes the case out of every queue.
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
    </Card>
  );
}
