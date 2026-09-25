import { useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { todayIso } from "@/shared/lib/time";
import EvidenceCapture from "./EvidenceCapture";
import ComplaintRecap from "./ComplaintRecap";
import { useComplaintStore } from "../store";
import { servicePass } from "../lib/queues";
import { stepByKey, type StepKey } from "../lib/steps";
import type { ComplaintRequest } from "../types";

/**
 * Every step's form, one arm each.
 *
 * ⚠ THE SERVICE STEP HAS TWO ARMS, chosen by `servicePass`. Its first pass takes
 *   the remarks, conclusion and commercial call; its second, after management has
 *   ruled, takes only the closing remarks. Same bucket, same queue, different
 *   question — so the modal asks which pass it is rather than the caller.
 *
 * ⚠ MANAGEMENT'S TWO JOBS ARE TWO STEPS, NOT TWO ARMS. `rm_management` is where
 *   an imported-material complaint is read and either answered or handed on;
 *   `management_review` is the one-click sign-off every chain ends on. They were
 *   briefly one key with two passes — see lib/steps.ts for why that was undone.
 */
export default function StepModal({
  step,
  request,
  onClose,
}: {
  step: StepKey;
  request: ComplaintRequest;
  onClose: () => void;
}) {
  const s = useComplaintStore();
  const [f, setF] = useState<Record<string, string>>({ date: todayIso() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const g = (k: string) => f[k] ?? "";

  const pass = servicePass(request);
  const call = g("commercial_call");
  /** Close it here, or hand it on. Management's first pass only. */
  const mgmtAction = g("mgmt_action") || "close";

  /**
   * Everyone the complaint could be handed to.
   *
   * ⚠ THE DIRECTORY, NOT THE STEP OWNERS. The whole point of the reassign right
   *   is that management may pick somebody who owns no step in this module — the
   *   person who actually knows the imported material. The RPC re-resolves the
   *   id in `profiles` and refuses one it cannot find, so an id from here is the
   *   only kind that can be saved.
   */
  const peopleOpts = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({
          value: p.id,
          label: p.name,
          sublabel: p.designation ?? undefined,
        })),
    [s.profiles],
  );

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const date = g("date") || todayIso();
      if (step === "plant") {
        await s.recordPlant(request.id, {
          action: g("action"),
          remarks: g("remarks"),
          date,
        });
      } else if (step === "service" && pass === "first") {
        await s.recordService(request.id, {
          remarks: g("remarks") || null,
          conclusion: g("conclusion"),
          commercialCall: call === "yes",
          callRemarks: g("call_remarks") || null,
          // ⚠ THE CONCLUSION IS THE CLOSING REMARK when no commercial call was
          //   taken. Asking for both meant typing the same sentence twice: the
          //   service team's conclusion IS why they are closing it.
          closeRemarks: call === "no" ? g("conclusion") : null,
          date,
        });
      } else if (step === "service") {
        await s.recordServiceClose(request.id, { closeRemarks: g("close_remarks"), date });
      } else if (step === "approval") {
        await s.recordApproval(request.id, {
          decision: (g("decision") || "approve") as "approve" | "reject",
          note: g("note") || null,
          date,
        });
      } else if (step === "purchase") {
        await s.recordPurchase(request.id, { remarks: g("remarks"), date });
      } else if (step === "assignee") {
        await s.recordAssignee(request.id, { remarks: g("remarks"), date });
      } else if (step === "rm_management") {
        await s.recordRmManagement(request.id, {
          action: mgmtAction as "close" | "assign",
          assigneeId: mgmtAction === "assign" ? g("assignee_id") || null : null,
          note: g("note") || null,
          date,
        });
      } else if (step === "management_review") {
        await s.recordManagementReview(request.id, { note: g("note") || null, date });
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const title =
    step === "service" && pass === "close"
      ? `Close — ${request.complaintNo}`
      : `${stepByKey(step)?.title ?? step} — ${request.complaintNo}`;

  /** What the primary button promises to do. A sign-off and a hand-off are not "Save". */
  const submitLabel =
    step === "rm_management"
      ? mgmtAction === "assign"
        ? "Assign"
        : "Close complaint"
      : step === "management_review"
        ? "Review done"
        : "Save";

  return (
    <Modal
      open
      size="3xl"
      onClose={onClose}
      title={title}
      subtitle={`${request.partyName ?? "—"} · ${request.itemName ?? "—"}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* THE WHOLE RECORD, not a summary — see ComplaintRecap. Nobody
            downstream raised the complaint, and it grows as the chain moves so
            each bucket also sees what the previous ones recorded. */}
        <ComplaintRecap r={request} />

        {step === "plant" && (
          <>
            <FieldLabel strong label="Corrective action taken" required>
              <TextArea rows={3} value={g("action")} onChange={(e) => set("action", e.target.value)} />
            </FieldLabel>
            <FieldLabel strong label="Plant remarks" required>
              <TextArea rows={3} value={g("remarks")} onChange={(e) => set("remarks", e.target.value)} />
            </FieldLabel>
            <EvidenceCapture complaintId={request.id} stepKey={step} slot="evidence" label="Attachment" />
          </>
        )}

        {step === "service" && pass === "first" && (
          <>
            <FieldLabel strong label="Service remarks">
              <TextArea rows={3} value={g("remarks")} onChange={(e) => set("remarks", e.target.value)} />
            </FieldLabel>
            <FieldLabel strong label="Conclusion" required>
              <TextArea rows={3} value={g("conclusion")} onChange={(e) => set("conclusion", e.target.value)} />
            </FieldLabel>

            {/* THE GATE. Yes routes to management; No closes it here. */}
            <FieldLabel strong label="Commercial call taken?" required>
              <ChoiceButtons
                ariaLabel="Commercial call taken"
                options={[
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                ]}
                value={call}
                onChange={(v) => set("commercial_call", v)}
              />
            </FieldLabel>

            {call === "yes" && (
              <FieldLabel strong label="Commercial call remarks to management" required>
                <TextArea
                  rows={3}
                  value={g("call_remarks")}
                  onChange={(e) => set("call_remarks", e.target.value)}
                />
              </FieldLabel>
            )}
            <EvidenceCapture complaintId={request.id} stepKey={step} slot="other" label="Attachment" />
          </>
        )}

        {step === "service" && pass === "close" && (
          <>
            <FieldLabel strong label="Closing remarks" required>
              <TextArea
                rows={4}
                value={g("close_remarks")}
                onChange={(e) => set("close_remarks", e.target.value)}
              />
            </FieldLabel>
            <EvidenceCapture complaintId={request.id} stepKey={step} slot="resolution_doc" label="Attachment" />
          </>
        )}

        {step === "approval" && (
          <>
            <FieldLabel strong label="Decision" required>
              <ChoiceButtons
                ariaLabel="Decision"
                options={[
                  { value: "approve", label: "Approve" },
                  { value: "reject", label: "Refuse" },
                ]}
                value={g("decision") || "approve"}
                onChange={(v) => set("decision", v)}
              />
            </FieldLabel>
            <FieldLabel
              strong
              label={g("decision") === "reject" ? "Why, and what should be done instead" : "Note"}
              required={g("decision") === "reject"}
            >
              <TextArea rows={3} value={g("note")} onChange={(e) => set("note", e.target.value)} />
            </FieldLabel>
          </>
        )}

        {step === "purchase" && (
          <>
            <FieldLabel strong label="Purchase remarks" required>
              <TextArea
                rows={4}
                value={g("remarks")}
                onChange={(e) => set("remarks", e.target.value)}
                placeholder="What the supplier said, and what has been agreed."
              />
            </FieldLabel>
            <EvidenceCapture complaintId={request.id} stepKey={step} slot="other" label="Attachment" />
          </>
        )}

        {step === "assignee" && (
          <>
            {/* The brief management wrote when they handed it over. Shown here
                rather than only in the recap, because it is the ONE thing this
                person was asked to answer. */}
            {request.rmAssignNote && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                <div className="text-[11px] text-violet-700">Management asked</div>
                <div className="text-[13px] font-medium text-navy whitespace-pre-wrap break-words mt-0.5">
                  {request.rmAssignNote}
                </div>
              </div>
            )}
            <FieldLabel strong label="Your remarks" required>
              <TextArea
                rows={4}
                value={g("remarks")}
                onChange={(e) => set("remarks", e.target.value)}
                placeholder="What you found, and what has been done about it."
              />
            </FieldLabel>
            <EvidenceCapture complaintId={request.id} stepKey={step} slot="other" label="Attachment" />
          </>
        )}

        {step === "rm_management" && (
          <>
            {/* THE FORK. Close it here, or put it on somebody else's desk. */}
            <FieldLabel strong label="What would you like to do?" required>
              <ChoiceButtons
                ariaLabel="Management action"
                options={[
                  { value: "close", label: "Answer and close" },
                  { value: "assign", label: "Assign to someone" },
                ]}
                value={mgmtAction}
                onChange={(v) => set("mgmt_action", v)}
              />
            </FieldLabel>

            {mgmtAction === "assign" && (
              <FieldLabel
                strong
                label="Assign to"
                required
                hint="it moves to their queue"
              >
                <Combobox
                  value={g("assignee_id")}
                  onChange={(v) => set("assignee_id", v)}
                  options={peopleOpts}
                  placeholder="Search people"
                  searchable
                  wrapLabel
                  clearable
                />
              </FieldLabel>
            )}

            <FieldLabel
              strong
              label={mgmtAction === "assign" ? "What should they do?" : "Management remarks"}
              required={mgmtAction === "close"}
              hint={mgmtAction === "assign" ? "optional" : undefined}
            >
              <TextArea rows={3} value={g("note")} onChange={(e) => set("note", e.target.value)} />
            </FieldLabel>

            {mgmtAction === "close" && (
              <EvidenceCapture complaintId={request.id} stepKey={step} slot="other" label="Attachment" />
            )}
          </>
        )}

        {step === "management_review" && (
          <>
            {/* One click was the ask, so the note is optional — everything the
                reviewer needs is already in the recap above. */}
            <FieldLabel strong label="Review note" hint="optional">
              <TextArea rows={2} value={g("note")} onChange={(e) => set("note", e.target.value)} />
            </FieldLabel>
          </>
        )}

        <FieldLabel strong label="Date">
          <TextInput type="date" value={g("date")} onChange={(e) => set("date", e.target.value)} />
        </FieldLabel>

        {err && <p className="text-[12.5px] text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}
