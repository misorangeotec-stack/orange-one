import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import DueCell from "@/shared/components/ui/DueCell";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateTimeDMY } from "@/shared/lib/date";
import { useExitStore } from "../../store";
import { exitDocUrl, uploadHandoverDoc } from "../../data/exitWrites";
import type { ExitCase } from "../../types";

/** Open the private file in a new tab. Nothing in this bucket is ever public. */
async function openDoc(path: string) {
  const url = await exitDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

/**
 * ⭐ THE WORK HANDOVER & KNOWLEDGE TRANSFER — who is taking the work over, and then
 * **the two confirmations**.
 *
 * ⚠ A RECEIVER IS MANDATORY, and it is either a **portal user** or a **typed name**.
 *   The work very often goes to somebody with no login at all — a contractor, a new
 *   joiner whose account is not open yet, a client-side counterpart — so a user picker
 *   alone would force the manager to lie or to leave it blank. And "handed over to
 *   nobody" is not a handover: it is the work quietly evaporating on someone's last
 *   day, which is the single most common failure this step exists to catch. The RPC
 *   demands one of the two; so does the Save button.
 *
 * Then, exactly as the asset return:
 *
 *   1. **the reporting manager confirms** — they are the person who knows whether the
 *      work actually landed somewhere;
 *   2. **HR confirms** — which COMPLETES the step, stamps `handoverCompletedAt`, and
 *      ⭐ **auto-ticks the Reporting-Manager clearance row** ("Work handover & knowledge
 *      transfer"), so the manager never signs the same thing twice.
 *
 * Read-only unless `canActOn('handover', case)`; frozen once HR has confirmed.
 */
export default function HandoverPanel({ case: c }: { case: ExitCase }) {
  const s = useExitStore();
  const h = s.handoverFor(c.id);
  const skip = s.skipsFor(c.id).find((k) => k.stepKey === "handover");

  const [toUserId, setToUserId] = useState(h?.handoverToUserId ?? "");
  const [toName, setToName] = useState(h?.handoverToName ?? "");
  const [ktDone, setKtDone] = useState(h?.ktDone ?? false);
  const [ktRemarks, setKtRemarks] = useState(h?.ktRemarks ?? "");
  const [notes, setNotes] = useState(h?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState(false);

  const [mgrRemarks, setMgrRemarks] = useState("");
  const [hrRemarks, setHrRemarks] = useState("");
  const [busy, setBusy] = useState<"save" | "manager" | "hr" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const closed = !s.isOpenCase(c) && c.status !== "on_hold";
  const hrConfirmed = !!h?.hrConfirmedAt;
  const mgrConfirmed = !!h?.managerConfirmedAt;

  // Mirrors fms_exit_can_act('handover', …): the case's own reporting managers, the
  // configured step owners, the coordinators and admins. The RPC is the real gate.
  // `lwd` is in the list because the RPC refuses without one — the handover is dated
  // from the last working day, so there is nothing to act on before it exists.
  const mayAct = !closed && !skip && !!c.lwd && s.canActOn("handover", c);
  // Recording is over the moment HR confirms — the RPC refuses it, and so must this.
  const canRecord = mayAct && !hrConfirmed;

  const receiver = h?.handoverToUserId
    ? (s.profileById(h.handoverToUserId)?.name ?? "Unknown")
    : (h?.handoverToName ?? null);

  // Someone has to be named. Either half will do — the RPC accepts a user id OR a name.
  const noReceiver = !toUserId && !toName.trim();

  // The clearance row THIS step settles. Said out loud on both sides of the confirmation.
  const autoTicked = s.checksFor(c.id).filter((k) => k.satisfiedByStep === "handover");

  const person = (uid: string | null) => (uid ? (s.profileById(uid)?.name ?? "Unknown") : "—");

  const save = async () => {
    setBusy("save");
    setErr(null);
    try {
      // Upload FIRST, so a save can never succeed against a note that is not there. No
      // upload leaves the existing file alone (the RPC coalesces), so saving "the KT is
      // now done" cannot silently detach the handover document.
      const up = file ? await uploadHandoverDoc(c.id, file) : null;
      await s.recordHandover(c, {
        handoverToUserId: toUserId || null,
        handoverToName: toName.trim() || null,
        ktDone,
        ktRemarks: ktRemarks.trim() || null,
        notes: notes.trim() || null,
        filePath: up?.path ?? null,
        fileName: up?.name ?? null,
      });
      setFile(null);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const confirm = async (role: "manager" | "hr") => {
    setBusy(role);
    setErr(null);
    try {
      await s.confirmHandover(c, role, role === "manager" ? mgrRemarks.trim() : hrRemarks.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // The whole company, for the receiver picker. Nothing is filtered out: work is handed
  // sideways and upwards as often as it is handed down.
  const options = [...s.profiles]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.id, label: p.name, sublabel: p.email ?? undefined }));

  const showForm = canRecord && (editing || !h);

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-navy">Handover &amp; knowledge transfer</h2>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-grey-2">
            {c.lwd
              ? "Name the person taking the work over, then the reporting manager confirms and HR confirms. HR's confirmation completes the step — and ticks the manager's clearance row automatically."
              : "The handover opens when the last working day is confirmed — it is dated from it."}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {hrConfirmed ? (
            <span className="rounded-full bg-[#E9F7EF] px-2.5 py-1 text-[11.5px] font-semibold text-ryg-green">
              Handed over
            </span>
          ) : (
            c.lwd && (
              <span className="text-[12.5px] text-grey">
                Due <DueCell dueIso={s.dueIsoFor(c, "handover")} />
              </span>
            )
          )}
        </div>
      </div>

      {/* A waived step is complete-with-a-reason — an absconder has nobody to hand over
          to, and this is the one generic mechanism that covers it. */}
      {skip && (
        <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-navy">
          <span className="font-semibold">This step was waived</span> — {skip.reason}
        </p>
      )}

      {!c.lwd && !skip && (
        <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-grey-2">
          Nothing yet. Confirm the last working day first — the handover is dated from it.
        </p>
      )}

      {/* ---- What was recorded. ---- */}
      {h && !showForm && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Work handed over to" value={receiver} />
          <Field label="Knowledge transfer">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                h.ktDone ? "bg-[#E9F7EF] text-ryg-green" : "bg-[#FFF7E6] text-yellow"
              }`}
            >
              {h.ktDone ? "Done" : "Not done yet"}
            </span>
          </Field>
          <Field label="Handover note">
            {h.filePath ? (
              <button
                type="button"
                onClick={() => void openDoc(h.filePath!)}
                className="font-semibold text-orange hover:underline"
              >
                {h.fileName ?? "Open"} →
              </button>
            ) : null}
          </Field>
          {h.ktRemarks && <Field className="sm:col-span-3" label="KT remarks" value={h.ktRemarks} />}
          {h.notes && <Field className="sm:col-span-3" label="Notes" value={h.notes} />}
          {canRecord && (
            <div className="sm:col-span-3">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit the handover
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---- Record it. ---- */}
      {showForm && (
        <div className="space-y-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <FieldLabel label="Handed over to (a portal user)" hint="or type a name below">
              <Combobox
                value={toUserId}
                onChange={setToUserId}
                options={options}
                placeholder="Choose the person taking the work over"
              />
            </FieldLabel>
            {/* The receiver very often has NO LOGIN. A picker alone would force the
                manager to lie, or to leave the single most important field blank. */}
            <FieldLabel label="…or a name" hint="for someone with no portal login">
              <TextInput
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                placeholder="e.g. Ravi Menon (contractor)"
              />
            </FieldLabel>
          </div>

          <label className="flex items-center gap-2.5 text-[13px] text-navy">
            <input type="checkbox" checked={ktDone} onChange={(e) => setKtDone(e.target.checked)} />
            The knowledge transfer has happened
          </label>

          <FieldLabel label="KT remarks" hint="optional">
            <TextArea
              rows={2}
              value={ktRemarks}
              onChange={(e) => setKtRemarks(e.target.value)}
              placeholder="e.g. two sessions on the GST filing calendar; credentials moved to the shared vault"
            />
          </FieldLabel>

          <FieldLabel label="Notes" hint="optional">
            <TextArea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What is still open, and who is now carrying it."
            />
          </FieldLabel>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-navy">
              Handover note / KT document
            </span>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-[12px] text-grey file:mr-2 file:rounded-lg file:border-0 file:bg-page file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-navy hover:file:bg-line/60"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={busy !== null || noReceiver}>
              {busy === "save" ? "Saving…" : "Save the handover"}
            </Button>
            {h && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy !== null}>
                Cancel
              </Button>
            )}
            {noReceiver && (
              <span className="text-[12px] text-grey">
                Name the person taking the work over — a handover to nobody is not a handover.
              </span>
            )}
          </div>
        </div>
      )}

      {/* ---- ⭐ THE TWO CONFIRMATIONS. In order, and the second one completes the step. ---- */}
      {h && (
        <>
          <SectionHeading>Confirmation</SectionHeading>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* 1. The manager — the only person who knows whether the work landed. */}
            <div className="rounded-xl border border-line bg-white p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">
                Reporting manager
              </div>
              {mgrConfirmed ? (
                <>
                  <p className="mt-1.5 text-[13.5px] font-semibold text-ryg-green">
                    Confirmed · {person(h.managerConfirmedBy)}
                  </p>
                  <p className="mt-0.5 text-[12px] text-grey">{formatDateTimeDMY(h.managerConfirmedAt)}</p>
                  {h.managerRemarks && <p className="mt-1 text-[12.5px] text-navy">{h.managerRemarks}</p>}
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-[12.5px] leading-snug text-grey-2">
                    Confirms first. HR cannot confirm until this is done.
                  </p>
                  {mayAct && (
                    <div className="mt-2.5 space-y-2">
                      <TextInput
                        value={mgrRemarks}
                        onChange={(e) => setMgrRemarks(e.target.value)}
                        placeholder="Remarks (optional)"
                      />
                      <Button size="sm" onClick={() => void confirm("manager")} disabled={busy !== null}>
                        {busy === "manager" ? "Confirming…" : "Confirm as the manager"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 2. HR — completes the step and fires the auto-tick. */}
            <div className="rounded-xl border border-line bg-white p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">HR</div>
              {hrConfirmed ? (
                <>
                  <p className="mt-1.5 text-[13.5px] font-semibold text-ryg-green">
                    Confirmed · {person(h.hrConfirmedBy)}
                  </p>
                  <p className="mt-0.5 text-[12px] text-grey">{formatDateTimeDMY(h.hrConfirmedAt)}</p>
                  {h.hrRemarks && <p className="mt-1 text-[12.5px] text-navy">{h.hrRemarks}</p>}
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-[12.5px] leading-snug text-grey-2">
                    Completes the step. Blocked until the reporting manager has confirmed.
                  </p>
                  {mayAct && (
                    <div className="mt-2.5 space-y-2">
                      <TextInput
                        value={hrRemarks}
                        onChange={(e) => setHrRemarks(e.target.value)}
                        placeholder="Remarks (optional)"
                      />
                      <Button
                        size="sm"
                        onClick={() => void confirm("hr")}
                        disabled={busy !== null || !mgrConfirmed}
                      >
                        {busy === "hr" ? "Confirming…" : "Confirm as HR"}
                      </Button>
                      {!mgrConfirmed && (
                        <p className="text-[12px] text-grey">The reporting manager has to confirm first.</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ---- ⭐ THE AUTO-TICK, said out loud — on BOTH sides of the confirmation. ---- */}
          {autoTicked.length > 0 && (
            <p
              className={`rounded-xl border px-4 py-3 text-[12.5px] leading-relaxed ${
                hrConfirmed
                  ? "border-ryg-green/30 bg-[#E9F7EF]/40 text-navy"
                  : "border-line bg-page text-grey"
              }`}
            >
              {hrConfirmed ? (
                <>
                  <span className="font-semibold text-navy">Ticked automatically by this confirmation:</span>{" "}
                  {autoTicked.map((k) => `${k.name} (${k.departmentLabel})`).join(", ")}. The reporting manager
                  was not asked to sign the same thing twice.
                </>
              ) : (
                <>
                  <span className="font-semibold text-navy">HR's confirmation also ticks</span>{" "}
                  {autoTicked.map((k) => `${k.name} (${k.departmentLabel})`).join(", ")} on the clearance
                  checklist, with no file asked of anyone.
                </>
              )}
            </p>
          )}
        </>
      )}

      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
    </Card>
  );
}
