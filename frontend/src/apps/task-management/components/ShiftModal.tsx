import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { useTaskStore } from "../mock/store";
import { WEEK_START } from "../mock/data";
import type { Task } from "../types";

const nextWeekLabel = () => {
  const d = new Date(WEEK_START);
  d.setDate(d.getDate() + 7);
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const fmt = (x: Date) => x.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${fmt(d)} – ${fmt(end)}`;
};

/** Shift an unfinished task to next week. Creates a linked task; preserves history. */
export default function ShiftModal({
  task,
  open,
  onClose,
  onShifted,
}: {
  task: Task;
  open: boolean;
  onClose: () => void;
  onShifted?: (newId: string) => void;
}) {
  const { shiftTask } = useTaskStore();

  const submit = () => {
    const newId = shiftTask(task.id);
    onClose();
    if (newId) onShifted?.(newId);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Shift to next week"
      subtitle={task.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Confirm shift</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[14px] text-grey leading-relaxed">
          This creates a fresh linked task for next week and marks the current one as{" "}
          <b className="text-navy">Shifted</b>. The full history is preserved on both.
        </p>
        <div className="rounded-xl bg-orange-soft px-4 py-3 flex items-center gap-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF6A1F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
          <span className="text-[13px] text-navy font-medium">New task week: {nextWeekLabel()}</span>
        </div>
      </div>
    </Modal>
  );
}
