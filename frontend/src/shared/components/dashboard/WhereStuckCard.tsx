import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import StepPipeline, { type StepPipelineNode, type StepPipelineGroup } from "@/shared/components/ui/StepPipeline";

/**
 * "Where it's stuck" — the bottleneck step rail, fed by `queueRollup(...).nodes`.
 * INFORMATIONAL on a home dashboard: `selectedKeys` is fixed empty and `onChange`
 * is a no-op, so a click never toggles or navigates a regular user into the
 * gated Control Center. `groups` renders a multi-stage FMS's steps as labelled
 * stages (StepPipeline wraps them). The coordinator-only link opens the full board.
 */
export default function WhereStuckCard<K extends string>({
  nodes,
  groups,
  actionHref,
  showAction,
}: {
  nodes: StepPipelineNode<K>[];
  groups?: StepPipelineGroup<K>[];
  actionHref?: string;
  showAction?: boolean;
}) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={SECTION_HEADING_CLASS}>Where it's stuck</h2>
        {showAction && actionHref && (
          <Link to={actionHref} className="text-[12px] font-semibold text-orange hover:underline">
            Open Control Center →
          </Link>
        )}
      </div>
      <StepPipeline nodes={nodes} groups={groups} selectedKeys={[]} onChange={() => {}} />
    </Card>
  );
}
