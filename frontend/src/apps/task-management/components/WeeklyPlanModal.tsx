import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import Avatar from "@/shared/components/ui/Avatar";
import { FieldLabel } from "@/shared/components/ui/Form";
import { addWeeks, weekEndOf, formatDate } from "@/shared/lib/time";
import { WEEK_START } from "../mock/data";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import RygBar from "./RygBar";

/** HOD/admin sets the Red/Yellow/Green completion target for a doer's upcoming week. */
export default function WeeklyPlanModal({ open, onClose, defaultDoerId }: { open: boolean; onClose: () => void; defaultDoerId?: string }) {
  const { user, role } = useSession();
  const { assignableUsers, weeklyPlanFor, setWeeklyPlan, canWeeklyPlan } = useTaskStore();
  const pool = useMemo(() => assignableUsers(role, user.id), [role, user.id, assignableUsers]);

  // week options: next week (default), week after next, this week
  const weekOptions = useMemo(
    () =>
      [1, 2, 0].map((n) => {
        const ws = addWeeks(WEEK_START, n);
        const tag = n === 1 ? "Next week" : n === 2 ? "Week after next" : "This week";
        return { value: ws, label: `${tag} · ${formatDate(ws)} – ${formatDate(weekEndOf(ws))}` };
      }),
    []
  );

  const [doerId, setDoerId] = useState(defaultDoerId ?? pool[0]?.id ?? "");
  const [weekStart, setWeekStart] = useState(weekOptions[0].value);
  const [green, setGreen] = useState(70);
  const [yellow, setYellow] = useState(20);
  const [red, setRed] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // prefill from an existing plan whenever doer or week changes (and on open)
  useEffect(() => {
    if (!open) return;
    const existing = weeklyPlanFor(doerId, weekStart);
    if (existing) {
      setGreen(existing.greenPct);
      setYellow(existing.yellowPct);
      setRed(existing.redPct);
    } else {
      setGreen(70);
      setYellow(20);
      setRed(10);
    }
  }, [open, doerId, weekStart, weeklyPlanFor]);

  const sum = green + yellow + red;
  const valid = sum === 100 && green >= 0 && yellow >= 0 && red >= 0;
  const editing = !!weeklyPlanFor(doerId, weekStart);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await setWeeklyPlan({ doerId, weekStart, redPct: red, yellowPct: yellow, greenPct: green });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Set weekly plan"
      subtitle="Red / Yellow / Green completion target for the week"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{canWeeklyPlan ? "Cancel" : "Close"}</Button>
          <Button onClick={submit} disabled={!valid || !canWeeklyPlan || busy}>{busy ? "Saving…" : editing ? "Update plan" : "Save plan"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <FieldLabel label="Employee">
            <Combobox
              value={doerId}
              onChange={setDoerId}
              disabled={pool.length <= 1}
              options={pool.map((p) => ({
                value: p.id,
                label: p.name,
                sublabel: p.designation ?? undefined,
                icon: <Avatar name={p.name} color={p.avatarColor} size={22} />,
              }))}
            />
          </FieldLabel>
          <FieldLabel label="Week">
            <Combobox value={weekStart} onChange={setWeekStart} options={weekOptions} />
          </FieldLabel>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <PctInput label="Green" tone="text-ryg-green" value={green} onChange={setGreen} />
          <PctInput label="Yellow" tone="text-[#B7820E]" value={yellow} onChange={setYellow} />
          <PctInput label="Red" tone="text-ryg-red" value={red} onChange={setRed} />
        </div>

        <div>
          <RygBar red={red} yellow={yellow} green={green} />
        </div>

        <div className={"text-[12.5px] font-medium " + (sum === 100 ? "text-grey-2" : "text-[#d4493f]")}>
          {sum === 100 ? "Totals 100% ✓" : `Must total 100% — currently ${sum}%`}
        </div>

        {error && <p className="text-[12.5px] text-[#d4493f]">{error}</p>}
      </div>
    </Modal>
  );
}

function PctInput({ label, tone, value, onChange }: { label: string; tone: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <span className={`text-[12px] font-semibold ${tone}`}>{label}</span>
      <div className="mt-1.5 relative">
        <input
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          className="w-full rounded-xl border border-line bg-white pl-3 pr-7 py-2.5 text-[14px] text-ink outline-none transition focus:border-orange focus:ring-4 focus:ring-orange/10"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-grey-2 text-[13px]">%</span>
      </div>
    </label>
  );
}
