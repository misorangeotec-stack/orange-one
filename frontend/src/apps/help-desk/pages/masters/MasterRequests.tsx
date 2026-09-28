import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useHelpStore } from "../../store";
import { decideCategoryRequest, requestCategory } from "../../data/helpWrites";
import { B } from "../../nav";

/**
 * "There should be a category for X."
 *
 * ⚠ ANYBODY MAY ASK, and the form asks for almost nothing: a name and why. The
 *   owner, the turnaround, the escalation ladder and the confidentiality are the
 *   approver's to set, on the Masters screen, where they can see what is already
 *   in use. Asking a requester to invent a turnaround for a list they cannot see
 *   is how a category ends up promising a day and owned by nobody.
 *
 * ⚠ APPROVING DOES NOT CREATE IT. It records the decision and sends the approver
 *   to Masters to build the row properly — a blank category routes tickets to
 *   nobody, which is worse than no category at all.
 */
export default function MasterRequests() {
  const s = useHelpStore();
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const rows = (s.data?.masterRequests ?? [])
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const ask = async () => {
    setBusy(true);
    setErr(null);
    try {
      await requestCategory(name, reason || null);
      setName("");
      setReason("");
      setSent(true);
      await s.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, status: "approved" | "rejected") => {
    setBusy(true);
    setErr(null);
    try {
      await decideCategoryRequest(id, status, null);
      await s.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[20px] font-bold text-navy">Ask for a ticket category</h1>
      <p className="mt-1 text-[13.5px] text-grey-2">
        If what you need to ask HR does not fit any of the categories, say so here. Meanwhile, raise
        it under <b>Others</b> and describe it — that reaches somebody today.
      </p>

      <Card className="mt-4 p-5">
        <FieldLabel label="What should it be called?" required>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Relocation Support"
          />
        </FieldLabel>
        <div className="mt-3">
          <FieldLabel label="Why is it needed?" hint="What kinds of question would go in it?">
            <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FieldLabel>
        </div>
        {err && (
          <p className="mt-3 rounded-lg border border-[#FDA29B] bg-[#FEF3F2] px-3 py-2 text-[13px] text-[#B42318]">
            {err}
          </p>
        )}
        {sent && !err && (
          <p className="mt-3 text-[13px] text-[#027A48]">
            Sent. HR will decide and you will see it below.
          </p>
        )}
        <div className="mt-4">
          <Button disabled={busy || name.trim().length === 0} onClick={() => void ask()}>
            {busy ? "Sending…" : "Ask for it"}
          </Button>
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Requests</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-[13px] text-grey-2">Nobody has asked for one yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <p className="text-[13.5px] font-semibold text-navy">{r.proposedName}</p>
                <p className="text-[12.5px] text-grey-2">
                  {s.personName(r.requestedBy)} · {formatDateDMY(r.createdAt)} · {r.status}
                </p>
                {r.reason && <p className="mt-1 text-[13px] text-grey">{r.reason}</p>}

                {s.canManageMasters && r.status === "pending" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" disabled={busy} onClick={() => void decide(r.id, "approved")}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void decide(r.id, "rejected")}
                    >
                      Not needed
                    </Button>
                    {/* ⚠ Approving RECORDS the decision; it does not build the row.
                        A category needs an owner, a turnaround and an escalation
                        ladder, none of which the requester was asked for. */}
                    <span className="text-[12px] text-grey-2">
                      Approving records the decision —{" "}
                      <Link to={`${B}/masters`} className="font-semibold text-orange hover:underline">
                        build the category on Masters
                      </Link>{" "}
                      with its owner and turnaround.
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
