import { useCallback, useState } from "react";
import type { CandidateStage } from "../../types";
import { STAGE_RANK, canDropOn } from "../../lib/board";

/**
 * Native HTML5 drag-and-drop state for the candidate board. No library, on purpose.
 *
 * A card move can never be a silent write — dropping into an interview round must
 * capture who is interviewing and when; dropping into Disqualified must capture a
 * reason. So **every drop opens a modal**, which means drag is only a *trigger*,
 * never the commit. That collapses the whole requirement to about sixty lines.
 *
 * `canDrop` here is courtesy only: it stops the cursor showing a drop target where
 * one is illegal. `fms_hr_move_candidate` re-validates the transition AND the
 * caller's authorization server-side — that is the real gate.
 */
export function useBoardDnd(onDrop: (candidateId: string, toStage: CandidateStage) => void) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingFrom, setDraggingFrom] = useState<CandidateStage | null>(null);
  const [hoverStage, setHoverStage] = useState<CandidateStage | null>(null);

  const onDragStart = useCallback((e: React.DragEvent, id: string, from: CandidateStage) => {
    setDraggingId(id);
    setDraggingFrom(from);
    // Needed for Firefox to start a drag at all, and it gives us a drag image.
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
    setDraggingFrom(null);
    setHoverStage(null);
  }, []);

  const allows = useCallback(
    (to: CandidateStage): boolean => (draggingFrom ? canDropOn(draggingFrom, to) : false),
    [draggingFrom],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent, to: CandidateStage) => {
      if (!allows(to)) return; // no preventDefault => the browser shows "no drop"
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setHoverStage(to);
    },
    [allows],
  );

  const onDragLeave = useCallback((to: CandidateStage) => {
    setHoverStage((cur) => (cur === to ? null : cur));
  }, []);

  const onDropOn = useCallback(
    (e: React.DragEvent, to: CandidateStage) => {
      e.preventDefault();
      const id = draggingId ?? e.dataTransfer.getData("text/plain");
      setHoverStage(null);
      setDraggingId(null);
      setDraggingFrom(null);
      if (id && allows(to)) onDrop(id, to);
    },
    [draggingId, allows, onDrop],
  );

  return { draggingId, draggingFrom, hoverStage, allows, onDragStart, onDragEnd, onDragOver, onDragLeave, onDropOn, STAGE_RANK };
}
