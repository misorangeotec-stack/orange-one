import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useDirectory } from "@/core/platform/store";
import { formatDate, dateLabel } from "@/shared/lib/time";
import { useFmsStore, activeStage, entryStatus } from "../mock/store";
import { STAGE_COUNT, stageByKey } from "../config/stages";
import { ownerLabel } from "../lib/owner";
import { nextOwnerNotice } from "../lib/notify";
import type { OwnerNotice } from "../lib/notify";
import { makeSandboxEntry, advanceEntryLocal } from "../lib/testSandbox";
import PipelineStepper from "../components/PipelineStepper";
import StageTimeline from "../components/StageTimeline";
import TaskModal from "../components/TaskModal";

/** What the last completed stage handed off to (drives the notification preview). */
type Handoff = { kind: "handoff"; notice: OwnerNotice } | { kind: "complete" } | null;

// A userId that owns nothing — keeps the pipeline overview read-only (every active
// stage shows the "Awaiting <owner>" state an onlooker sees).
const NOBODY = "__test-mode-bystander__";

/**
 * Admin-only Test Mode: walk a throwaway sandbox entry through all 9 stages on a
 * single screen — purely in-browser (no Supabase writes, no real notifications).
 *
 * It exercises BOTH live experiences against the same in-memory entry:
 *  • the INDIVIDUAL-USER flow — click "Do this task" to open the real `TaskModal`
 *    pop-up exactly as the stage's owner sees it, complete it, and the sandbox
 *    advances to the next owner's task;
 *  • the ADMIN view — the full pipeline stepper + timeline as a read-only overview.
 * Each completion previews who the real notification bell would surface it to next.
 */
export default function TestMode() {
  const { profileById } = useDirectory();
  const { ownerForStep } = useFmsStore();

  const [entry, setEntry] = useState(makeSandboxEntry);
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [handoff, setHandoff] = useState<Handoff>(null);

  const focusStage = (key: string) => {
    setSelectedKey(key);
    requestAnimationFrame(() => {
      document.getElementById(`fms-stage-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Local completion (mirrors the RPC; no DB) — used as the TaskModal override.
  const handleComplete = (values: Record<string, string | number | null>) => {
    const updated = advanceEntryLocal(entry, values);
    setEntry(updated);
    setSelectedKey(undefined);
    const notice = nextOwnerNotice(updated, ownerForStep, profileById);
    setHandoff(notice ? { kind: "handoff", notice } : { kind: "complete" });
  };

  const reset = () => {
    setEntry(makeSandboxEntry());
    setSelectedKey(undefined);
    setModalOpen(false);
    setHandoff(null);
  };

  const status = entryStatus(entry);
  const active = activeStage(entry);
  const activeDef = active ? stageByKey(active.key) : undefined;
  const activeOwner = active ? ownerLabel(ownerForStep(active.key), profileById) : "—";
  const started = entry.currentIndex > 0; // origin completed → header populated

  return (
    <div className="space-y-5">
      <Link to="/purchase-fms" className="inline-flex items-center gap-1.5 text-[13px] text-grey hover:text-orange transition">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Dashboard
      </Link>

      {/* Sandbox banner */}
      <div className="rounded-card border border-orange/40 bg-[#FFF7ED] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] text-navy">
            <b className="font-semibold">Test Mode</b> — sandbox only. Nothing is saved and no real notifications are sent; reloading resets it. Click <b>Do this task</b> to complete each stage through the real pop-up your users see.
          </div>
          <Button size="sm" variant="ghost" onClick={reset}>Reset sandbox</Button>
        </div>
      </div>

      {/* Current task — the INDIVIDUAL-USER action (opens the real TaskModal) */}
      {status !== "completed" ? (
        <Card className="p-4 border-orange/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11.5px] uppercase tracking-wide text-grey-2 font-semibold">Current task · what the user sees</div>
              <div className="mt-1 text-[15px] font-semibold text-navy">{activeDef?.title}</div>
              <div className="text-[12.5px] text-grey mt-0.5">
                Whose turn: <b className="text-navy font-medium">{activeOwner}</b>
                {activeDef?.defaultOwner && <span className="text-grey-2"> ({activeDef.defaultOwner})</span>}
                {active?.plannedDate && <> · Due {formatDate(active.plannedDate)}</>}
              </div>
            </div>
            <Button size="sm" onClick={() => setModalOpen(true)}>Do this task →</Button>
          </div>
        </Card>
      ) : (
        <div className="rounded-card border border-[#bfe6cf] bg-[#E8F8EF] px-4 py-3 text-[13px] text-[#1f9d57] font-medium">
          All {STAGE_COUNT} stages are done — this sandbox purchase is fully processed. Use <b>Reset sandbox</b> to start over.
        </div>
      )}

      {/* Notification preview (the next-owner handoff) */}
      {handoff && (
        <div className="rounded-card border border-[#bfe6cf] bg-[#E8F8EF] px-4 py-3">
          {handoff.kind === "handoff" ? (
            <div className="flex items-start gap-2.5 text-[13px]">
              <span aria-hidden>🔔</span>
              <div>
                <div className="text-navy">
                  <b className="font-semibold">{handoff.notice.ownerLabel}</b> would be notified — “
                  <b className="font-semibold">{entry.code}</b> is now awaiting{" "}
                  <b className="font-semibold">{handoff.notice.stageTitle}</b>”
                  {handoff.notice.plannedDate && <> · Planned {dateLabel(handoff.notice.plannedDate)}</>}
                </div>
                <div className="text-[11.5px] text-grey-2 mt-0.5">Simulated — no real notification is sent in Test Mode.</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 text-[13px] text-[#1f9d57] font-medium">
              <span aria-hidden>✅</span>
              All {STAGE_COUNT} stages complete — no further notification.
            </div>
          )}
        </div>
      )}

      {/* Admin pipeline overview (read-only) */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11.5px] uppercase tracking-wide text-grey-2 font-semibold mb-1.5">Pipeline overview · what an admin sees</div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[20px] font-bold text-navy">{entry.code}</h2>
              {entry.category && <span className="rounded-pill bg-page px-2.5 py-1 text-[11.5px] font-semibold text-grey">{entry.category}</span>}
            </div>
            <p className="text-grey text-[13px] mt-1">
              {started ? (
                <><span className="text-navy font-medium">{entry.itemName}</span> · {entry.quantity.toLocaleString("en-IN")} {entry.unit}</>
              ) : (
                <span className="text-grey-2">Complete the first task to start the sandbox.</span>
              )}
            </p>
          </div>
          <div className="text-right text-[12.5px] text-grey-2">
            {status === "completed" ? (
              <div className="text-[#1f9d57] font-semibold">Pipeline complete</div>
            ) : (
              <div>Current: <span className="text-navy font-medium">{activeDef?.title}</span></div>
            )}
          </div>
        </div>

        <div className="mt-5">
          <PipelineStepper stages={entry.stages} selectedKey={selectedKey} onSelect={focusStage} />
        </div>
      </Card>

      <StageTimeline
        entry={entry}
        ownerForStep={ownerForStep}
        profileById={profileById}
        userId={NOBODY}
        isAdmin={false}
        selectedKey={selectedKey}
        onComplete={() => { /* overview is read-only — completion happens via the pop-up */ }}
      />

      {/* The real individual-user pop-up, driven locally (no DB writes). */}
      {modalOpen && status !== "completed" && (
        <TaskModal
          entry={entry}
          onClose={() => setModalOpen(false)}
          onComplete={async (_id, values) => handleComplete(values)}
          onUploadFile={async (file) => URL.createObjectURL(file)}
        />
      )}
    </div>
  );
}
