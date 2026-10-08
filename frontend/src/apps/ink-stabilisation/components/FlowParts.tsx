import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { cn } from "@/shared/lib/cn";
import { fmtDate } from "../lib/schedule";
import {
  docUrl, FlowNotInstalled, RESULT_LABEL, RESULT_TONE, STATUS_LABEL, STATUS_TONE,
  type FlowStatus, type LabResult, type FlowTest, type TestActivity, type TestDoc,
} from "../lib/flow";

export function StatusPill({ status }: { status: FlowStatus }) {
  return (
    <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", STATUS_TONE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ResultPill({ result }: { result: LabResult | null | undefined }) {
  if (!result) return <span className="text-grey-2">—</span>;
  return (
    <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", RESULT_TONE[result])}>
      {RESULT_LABEL[result]}
    </span>
  );
}

/** Shown in place of the queues until the migration is applied. Main data still works. */
export function FlowUnavailable({ error }: { error: unknown }) {
  const notInstalled = error instanceof FlowNotInstalled;
  return (
    <Card className="border-yellow/60 bg-yellow/10 p-4 text-[13px] text-ink">
      {notInstalled ? (
        <>
          <b>The retest flow is not switched on yet.</b> Its database tables (migration
          <code className="mx-1">20261217120000_ink_stabilisation_retest_flow.sql</code>) have not been applied.
          Step 1 · Main data works without them.
        </>
      ) : (
        <>Could not load the retest flow: {(error as Error)?.message}</>
      )}
    </Card>
  );
}

const fmtStamp = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export { fmtStamp };

/** The facts about the lot and test that both steps need in front of them. */
export function TestFacts({ t }: { t: FlowTest }) {
  const f = (label: string, value: string) => (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">{label}</div>
      <div className="text-[13px] text-ink">{value}</div>
    </div>
  );
  // A Closing stock lot carries its company; its qty is stock today and its date may be a purchase.
  const stock = !!t.lot.company;
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg bg-page p-3 sm:grid-cols-4">
      {f("Stock item", t.lot.item)}
      {f("Lot no.", t.lot.lot)}
      {f("Test", `Test ${t.no} (+${t.no * 3} months)`)}
      {f("Due date", fmtDate(t.due))}
      {f(stock ? "Prod. / purchase date" : "Production date", fmtDate(t.lot.prod))}
      {f("Expiry (Tally)", t.lot.expiry ? fmtDate(t.lot.expiry) : "not in Tally")}
      {f(stock ? "Qty in stock" : "Qty produced", `${t.lot.qty.toLocaleString("en-IN")} ${t.lot.uom ?? ""}`)}
      {stock ? f("Company", t.lot.company!) : f("Ink family", t.lot.family)}
    </div>
  );
}

export function DocList({ docs, onDelete }: { docs: TestDoc[]; onDelete?: (d: TestDoc) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (docs.length === 0) return <div className="text-[12.5px] text-grey">No attachments.</div>;

  const open = async (d: TestDoc) => {
    setErr(null);
    try { window.open(await docUrl(d.path), "_blank", "noopener"); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="space-y-1.5">
      {docs.map((d) => (
        <div key={d.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-grey" />
          <button onClick={() => open(d)} className="truncate text-left text-[13px] font-medium text-blue hover:underline">
            {d.name}
          </button>
          <span className="ml-auto shrink-0 text-[11px] text-grey">
            {d.sizeBytes ? `${Math.max(1, Math.round(d.sizeBytes / 1024))} KB` : ""}
          </span>
          {onDelete && (
            <button
              title="Remove"
              disabled={busy === d.id}
              onClick={async () => {
                if (!window.confirm(`Remove ${d.name}?`)) return;
                setBusy(d.id); setErr(null);
                try { await onDelete(d); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
              }}
              className="shrink-0 text-grey hover:text-ryg-red disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      {err && <div className="text-[12px] text-ryg-red">{err}</div>}
    </div>
  );
}

const ACTION_LABEL: Record<TestActivity["action"], string> = {
  submitted: "Submitted by Plant",
  returned: "Sent back by Management",
  closed: "Closed by Management",
  reassigned: "Reassigned",
};

export function Trail({ items }: { items: TestActivity[] }) {
  const person = useOrgPersonById();
  if (items.length === 0) return null;
  return (
    <ol className="space-y-2 border-l-2 border-line pl-4">
      {items.map((a) => (
        <li key={a.id} className="relative">
          <span className={cn("absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full",
            a.action === "closed" ? "bg-ryg-green" : a.action === "returned" ? "bg-ryg-red" : a.action === "reassigned" ? "bg-orange" : "bg-blue")} />
          <div className="text-[12.5px] font-semibold text-ink">
            {a.action === "closed" && !a.actor ? "Closed automatically (lab approved)"
              : a.action === "reassigned" ? `Reassigned to ${a.toUser ? person(a.toUser)?.name ?? "someone" : "Management (handed back)"}`
              : ACTION_LABEL[a.action]}{" "}
            <span className="font-normal text-grey">· {a.actor ? person(a.actor)?.name ?? "Someone" : "System"} · {fmtStamp(a.createdAt)}</span>
          </div>
          {a.remarks && <div className="whitespace-pre-wrap text-[12.5px] text-ink">{a.remarks}</div>}
        </li>
      ))}
    </ol>
  );
}
