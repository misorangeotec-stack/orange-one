import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useLdStore } from "../store";
import { B } from "../nav";
import { stepByKey, type StepKey } from "../lib/steps";
import { inr } from "../lib/format";
import DocField from "./DocField";
import type { TrainingRequest } from "../types";

/**
 * What the reader can DO about the step this request is sitting at.
 *
 * One panel rather than one component per step: the six request-scoped actions
 * share a shape (some fields, a note, a decision) and splitting them would mean
 * six copies of the busy/error/refresh plumbing.
 *
 * ⚠ IT RENDERS NOTHING WHEN THE READER CANNOT ACT, rather than a disabled form.
 *   A greyed-out Approve button on somebody else's approval invites them to ask
 *   why it doesn't work; the honest answer is that this step isn't theirs, and a
 *   line of text says that better than a dead control.
 *
 * ⚠ THE SERVER IS THE GATE. `canActOn` mirrors `fms_ld_can_act()` so a screen
 *   never offers a button that then fails — but every RPC re-checks, and the
 *   error surfaces here if the two ever disagree.
 */
export default function StepActionPanel({
  request: r,
  step,
  onError,
}: {
  request: TrainingRequest;
  step: StepKey;
  onError: (msg: string | null) => void;
}) {
  const s = useLdStore();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  // Validation
  const [competencyId, setCompetencyId] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState(r.expectedOutcome ?? "");
  // Proposal
  const [priority, setPriority] = useState(r.priority ?? "");
  const [typeIds, setTypeIds] = useState<string[]>(r.sessionTypeIds);
  const [mode, setMode] = useState(r.deliveryMode ?? "");
  const [cost, setCost] = useState(r.proposedCost != null ? String(r.proposedCost) : "");
  // Approval
  const [budget, setBudget] = useState(r.approvedBudget != null ? String(r.approvedBudget) : "");
  // Trainer
  const [trainerId, setTrainerId] = useState(r.trainerId ?? "");
  const [terms, setTerms] = useState(r.trainerTerms ?? "");
  const [proposalFile, setProposalFile] = useState<File | null>(null);
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const proposalRef = useRef<HTMLInputElement>(null);
  const quoteRef = useRef<HTMLInputElement>(null);
  // Scheduling
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [capacity, setCapacity] = useState("");
  const [venueId, setVenueId] = useState("");
  const [link, setLink] = useState("");

  const def = stepByKey(step);
  const mayAct = s.canActOn(step, r.id);

  const run = async (fn: () => Promise<unknown>) => {
    onError(null);
    setBusy(true);
    try {
      await fn();
      await s.refresh();
      setNote("");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!mayAct) {
    const owners = s.stepOwnerIds(step).map((id) => s.personName(id)).filter((n) => n !== "—");
    return (
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-navy">Waiting on {def?.title ?? step}</h2>
        <p className="mt-1 text-[13.5px] text-grey-2">
          {owners.length > 0
            ? `This step belongs to ${owners.join(", ")}. You'll be told when it moves.`
            : "Nobody is configured to own this step yet — an admin sets that in Setup → Step Owners."}
        </p>
      </Card>
    );
  }

  const types = (s.data?.sessionTypes ?? []).filter((t) => t.active);
  const trainers = (s.data?.trainers ?? []).filter((t) => t.active);
  const competencies = (s.data?.competencies ?? []).filter((c) => c.active);
  const venues = (s.data?.venues ?? []).filter((v) => v.active);
  const venue = venues.find((v) => v.id === venueId);

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold text-navy">{def?.title ?? step}</h2>
        <p className="text-[12.5px] text-grey-2 mt-0.5">This step is yours.</p>
      </div>

      {step === "need_validation" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="Competency this maps to">
              <Combobox
                value={competencyId}
                onChange={setCompetencyId}
                clearable
                options={competencies.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Select a competency"
              />
            </FieldLabel>
            <FieldLabel label="Expected outcome">
              <TextInput value={expectedOutcome} onChange={(e) => setExpectedOutcome(e.target.value)} />
            </FieldLabel>
          </div>
          <FieldLabel label="Remarks" hint="Required if you send it back.">
            <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  s.writes.validateRequest(
                    r.id,
                    true,
                    { competencyId: competencyId || null, expectedOutcome, duplicateChecked: true },
                    note || null,
                  ),
                )
              }
            >
              Validate
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !note.trim()}
              onClick={() => void run(() => s.writes.validateRequest(r.id, false, {}, note))}
            >
              Send back
            </Button>
          </div>
          {!note.trim() && (
            <p className="text-[12px] text-grey-2">Sending back needs a reason — the raiser only sees what you write.</p>
          )}
        </>
      )}

      {step === "proposal" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="Priority" required>
              <Combobox
                value={priority}
                onChange={setPriority}
                options={[
                  { value: "high", label: "High" },
                  { value: "medium", label: "Medium" },
                  { value: "low", label: "Low" },
                ]}
                placeholder="Set a priority"
              />
            </FieldLabel>
            <FieldLabel label="Delivery mode">
              <Combobox
                value={mode}
                onChange={setMode}
                clearable
                options={[
                  { value: "classroom", label: "Classroom" },
                  { value: "online", label: "Online" },
                  { value: "hybrid", label: "Hybrid" },
                  { value: "on_the_job", label: "On the job" },
                ]}
                placeholder="Select a mode"
              />
            </FieldLabel>
          </div>
          <FieldLabel
            label="Type of training"
            hint="Pick every one that applies — an external agency running a technical session is both."
          >
            <MultiSelect
              values={typeIds}
              chips
              onChange={setTypeIds}
              options={types.map((t) => ({ value: t.id, label: t.name }))}
              placeholder="Select types"
            />
          </FieldLabel>
          <FieldLabel label="Estimated cost" hint={mgmtHint(s.approvalRule, cost)}>
            <TextInput
              type="number"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0"
            />
          </FieldLabel>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => proposalRef.current?.click()}>
              {proposalFile ? proposalFile.name.slice(0, 26) : "Attach the proposal (optional)"}
            </Button>
            <input
              ref={proposalRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => setProposalFile(e.target.files?.[0] ?? null)}
            />
            {r.proposalPath && !proposalFile && (
              <DocField path={r.proposalPath} disabled onUpload={async () => {}} />
            )}
          </div>
          <Button
            disabled={busy || !priority}
            onClick={() =>
              void run(async () => {
                const proposalPath = proposalFile
                  ? await s.writes.uploadProposal(r.id, proposalFile)
                  : r.proposalPath;
                await s.writes.submitProposal(r.id, {
                  priority,
                  sessionTypeIds: typeIds,
                  deliveryMode: mode || null,
                  proposedCost: cost === "" ? null : Number(cost),
                  proposalPath,
                });
              })
            }
          >
            Send for approval
          </Button>
        </>
      )}

      {(step === "hr_head_approval" || step === "mgmt_approval") && (
        <>
          <div className="rounded-lg bg-[#F8FAFD] px-3 py-2 text-[13px] text-navy">
            Proposed cost <strong>{inr(r.proposedCost)}</strong>
            {step === "hr_head_approval" && (
              <span className="text-grey-2">
                {" "}· {r.mgmtRequired ? "Management approval will be needed after yours." : "Your approval is the last one."}
              </span>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="Approved budget">
              <TextInput
                type="number"
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder={r.proposedCost != null ? String(r.proposedCost) : "0"}
              />
            </FieldLabel>
            <FieldLabel label="Remarks" hint="Required to reject or return.">
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldLabel>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  s.writes.decideApproval(
                    r.id,
                    step === "hr_head_approval" ? "hr_head" : "management",
                    "approve",
                    budget === "" ? null : Number(budget),
                    note || null,
                  ),
                )
              }
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !note.trim()}
              onClick={() =>
                void run(() =>
                  s.writes.decideApproval(
                    r.id,
                    step === "hr_head_approval" ? "hr_head" : "management",
                    "return",
                    null,
                    note,
                  ),
                )
              }
            >
              Return for revision
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !note.trim()}
              onClick={() =>
                void run(() =>
                  s.writes.decideApproval(
                    r.id,
                    step === "hr_head_approval" ? "hr_head" : "management",
                    "reject",
                    null,
                    note,
                  ),
                )
              }
            >
              Reject
            </Button>
          </div>
        </>
      )}

      {step === "trainer_finalization" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="Trainer" required>
              <Combobox
                value={trainerId}
                onChange={setTrainerId}
                options={trainers.map((t) => ({
                  value: t.id,
                  label: t.trainerType === "external" ? `${t.name} (agency)` : t.name,
                }))}
                placeholder="Select a trainer"
              />
            </FieldLabel>
            <FieldLabel label="Terms agreed">
              <TextInput value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. 2 days on site" />
            </FieldLabel>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => quoteRef.current?.click()}>
              {quoteFile ? quoteFile.name.slice(0, 26) : "Attach their quotation (optional)"}
            </Button>
            <input
              ref={quoteRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => setQuoteFile(e.target.files?.[0] ?? null)}
            />
            {r.quotationPath && !quoteFile && (
              <DocField path={r.quotationPath} disabled onUpload={async () => {}} />
            )}
          </div>
          <p className="text-[12px] text-grey-2">
            An external trainer has no Orange Hub login — you upload their material and mark the session on
            their behalf.
          </p>
          <Button
            disabled={busy || !trainerId}
            onClick={() =>
              void run(async () => {
                const quotationPath = quoteFile
                  ? await s.writes.uploadQuotation(r.id, quoteFile)
                  : r.quotationPath;
                await s.writes.finaliseTrainer(r.id, {
                  trainerId,
                  trainerTerms: terms || null,
                  quotationPath,
                });
              })
            }
          >
            Confirm trainer
          </Button>
        </>
      )}

      {step === "session_scheduling" && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <FieldLabel label="Date" required>
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FieldLabel>
            <FieldLabel label="Starts">
              <TextInput type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </FieldLabel>
            <FieldLabel label="Ends">
              <TextInput type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </FieldLabel>
            <FieldLabel label="Capacity">
              <TextInput
                type="number"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="—"
              />
            </FieldLabel>
          </div>
          {/*
            ⚠ WITHOUT THIS THE VENUES MASTER HAS NO READER. `createSession`,
              `fms_ld_create_session` and Session Detail's "Where" have carried
              venue_id and meeting_link since LD-1; nothing ever SET them, so
              every session in the module said "Where: —" and the venue list was
              decorative. Found while building LD-13 — the FIX-4 shape in
              reverse: the plumbing was whole and only the control was missing.
          */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="Where">
              <Combobox
                value={venueId}
                onChange={setVenueId}
                options={venues.map((v) => ({
                  value: v.id,
                  label: v.isOnline ? `${v.name} (online)` : v.name,
                }))}
                placeholder={venues.length ? "Pick a venue" : "No venues on the list yet"}
                clearable
                autoAdvance
              />
            </FieldLabel>
            {/* Asked for whenever the venue is an online one — that link is what
                the invitation carries, and a session nobody can join is not
                scheduled. */}
            {venue?.isOnline && (
              <FieldLabel label="Joining link" required>
                <TextInput
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…"
                />
              </FieldLabel>
            )}
          </div>
          {venue?.capacity != null && capacity !== "" && Number(capacity) > venue.capacity && (
            <p className="text-[12.5px] text-[#B54708]">
              {venue.name} seats {venue.capacity}. You have set capacity to {capacity} — either the
              room is wrong or the number is.
            </p>
          )}
          <Button
            disabled={busy || !date || (venue?.isOnline === true && !link.trim())}
            onClick={() =>
              void run(async () => {
                await s.writes.createSession({
                  requestId: r.id,
                  title: r.title,
                  sessionTypeIds: r.sessionTypeIds,
                  deliveryMode: r.deliveryMode,
                  trainerId: r.trainerId,
                  sessionDate: date,
                  startTime: start || null,
                  endTime: end || null,
                  capacity: capacity === "" ? null : Number(capacity),
                  venueId: venueId || null,
                  meetingLink: link.trim() || null,
                });
                nav(`${B}/calendar`);
              })
            }
          >
            Create the session
          </Button>
          <p className="text-[12px] text-grey-2">
            Nominations open once the session exists. Who comes is decided next, by the HODs or by HR.
          </p>
        </>
      )}

      {step === "need_resubmit" && (
        <p className="text-[13.5px] text-grey-2">
          HR sent this back. Editing a returned request lands with LD-2; for now, raise it again with the
          correction, or ask HR to reopen it.
        </p>
      )}
    </Card>
  );
}

/**
 * Tell the proposer, while they are typing the cost, whether this will need a
 * second approval — so the gate is never a surprise after the fact.
 */
function mgmtHint(rule: { mgmt: string; aboveAmount: number }, cost: string): string {
  if (rule.mgmt === "always") return "Management approval is required on every request.";
  if (rule.mgmt === "never") return "HR Head's approval is the only one needed.";
  const n = cost === "" ? 0 : Number(cost);
  return n > rule.aboveAmount
    ? `Above ${inr(rule.aboveAmount)} — this will also need Management approval.`
    : `At or below ${inr(rule.aboveAmount)} — HR Head's approval is the only one needed.`;
}
