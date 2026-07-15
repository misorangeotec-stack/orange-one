import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { timeAgo } from "@/shared/lib/time";
import { useImportStore } from "../store";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import type { ImportNotification } from "../types";

const B = "/import";

interface QueueCard {
  label: string;
  count: number;
  to: string;
}

/**
 * Per-persona home shown in demo mode. Reads the same capability flags + queue
 * selectors the real screens use, so it mirrors exactly what the acting persona
 * can do: their open queues (with live counts), their recent notifications, and
 * a nudge toward the first queue that needs action.
 */
export default function SandboxDashboard() {
  const s = useImportStore();
  const { user } = useEffectiveIdentity();

  const openPos = s.pos.filter((p) => p.currentStage !== "closed" && p.currentStage !== "cancelled");
  const stageCount = (stage: string) => openPos.filter((p) => p.currentStage === stage).length;

  const cards: QueueCard[] = [];
  if (s.canSource) cards.push({ label: "Sourcing Queue", count: s.sourcingQueue.length, to: `${B}/queues/sourcing` });
  if (s.isApprover) cards.push({ label: "Approvals", count: s.approvalQueue.length, to: `${B}/queues/approvals` });
  if (s.canGeneratePo) cards.push({ label: "PO Workbench", count: s.poPool.length, to: `${B}/po/workbench` });
  if (s.canSharePo) cards.push({ label: "Share PO", count: stageCount("share_po"), to: `${B}/queues/share` });
  if (s.canCollectPi) cards.push({ label: "Collect PI", count: stageCount("collect_pi"), to: `${B}/queues/collect-pi` });
  if (s.canAdvancePayment) cards.push({ label: "Advance", count: stageCount("advance_payment"), to: `${B}/queues/advance` });
  if (s.canFollowup) cards.push({ label: "Follow-up", count: stageCount("follow_up"), to: `${B}/queues/follow-up` });
  if (s.canInward) cards.push({ label: "Inward", count: stageCount("inward"), to: `${B}/queues/inward` });
  if (s.canTally) cards.push({ label: "Tally", count: stageCount("tally"), to: `${B}/queues/tally` });
  if (s.isProcessCoordinator) cards.push({ label: "Purchase FMS Control Center", count: openPos.length + s.sourcingQueue.length + s.approvalQueue.length + s.poPool.length, to: `${B}/monitoring` });

  const notifs = s.myNotifications.slice(0, 6);
  const firstAction = cards.find((c) => c.count > 0);

  const linkFor = (n: ImportNotification): string | undefined => {
    switch (n.entityType) {
      case "request":
        return `${B}/requests/${n.entityId}`;
      case "line": {
        const line = s.lineById(n.entityId);
        return line ? `${B}/requests/${line.requestId}` : undefined;
      }
      case "po":
        return `${B}/pos/${n.entityId}`;
      case "pi": {
        const pi = s.pis.find((p) => p.id === n.entityId);
        return pi ? `${B}/pos/${pi.poId}` : undefined;
      }
      default:
        return undefined;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Welcome, {user.name.split(" ")[0]}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {cards.length > 0 ? (
            <>Here's what's on your plate. {firstAction ? <>Start with <span className="font-semibold text-navy">{firstAction.label}</span>.</> : "Nothing needs your action right now."}</>
          ) : (
            <>You raise purchase requirements. Use <span className="font-semibold text-navy">New Request</span> to start one.</>
          )}
        </p>
      </div>

      {cards.length > 0 && (
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-navy mb-2">Your queues</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {cards.map((c) => (
              <Link key={c.to} to={c.to}>
                <Card className="px-4 py-3 hover:border-orange/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="text-[13px] font-medium text-navy">{c.label}</div>
                    <span className={`inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full text-[12px] font-bold ${c.count > 0 ? "bg-orange/10 text-orange" : "bg-page text-grey-2"}`}>
                      {c.count}
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-navy">Your notifications</div>
            <Link to={`${B}`} className="text-[12px] text-grey-2">·</Link>
          </div>
          {notifs.length === 0 ? (
            <p className="text-[13px] text-grey-2">No notifications yet.</p>
          ) : (
            <div className="divide-y divide-line/70">
              {notifs.map((n) => {
                const actor = n.actorId ? s.profileById(n.actorId)?.name ?? "Someone" : "System";
                const to = linkFor(n);
                const body = (
                  <div className="flex items-start gap-2 py-2">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${n.readAt ? "bg-transparent" : "bg-orange"}`} />
                    <div className="min-w-0">
                      <div className="text-[13px] text-navy"><b className="font-semibold">{actor}</b> {n.text}</div>
                      <div className="text-[11px] text-grey-2">{timeAgo(n.createdAt)}</div>
                    </div>
                  </div>
                );
                return to ? <Link key={n.id} to={to} className="block hover:bg-page/60 -mx-2 px-2 rounded-lg">{body}</Link> : <div key={n.id}>{body}</div>;
              })}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-navy mb-2.5">Quick actions</div>
          <div className="flex flex-wrap gap-2">
            <Link to={`${B}/requests/new`} className="inline-flex items-center rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-navy hover:border-orange hover:text-orange transition-colors">+ New Request</Link>
            <Link to={`${B}/requests`} className="inline-flex items-center rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-navy hover:border-orange hover:text-orange transition-colors">Purchase Requests</Link>
            <Link to={`${B}/pos`} className="inline-flex items-center rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-navy hover:border-orange hover:text-orange transition-colors">Purchase Orders</Link>
            {firstAction && (
              <Link to={firstAction.to} className="inline-flex items-center rounded-lg bg-orange px-3 py-2 text-[13px] font-semibold text-white hover:bg-orange/90 transition-colors">Go to {firstAction.label} →</Link>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
