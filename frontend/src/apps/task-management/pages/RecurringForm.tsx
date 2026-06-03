import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Avatar from "@/shared/components/ui/Avatar";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import LocationPicker from "../components/LocationPicker";
import { MONTH_LAST_DAY, type RecurrenceType } from "../types";

// display order Mon→Sun, stored as 0=Sun..6=Sat
const WEEKDAYS = [
  { v: 1, l: "Mon" }, { v: 2, l: "Tue" }, { v: 3, l: "Wed" }, { v: 4, l: "Thu" },
  { v: 5, l: "Fri" }, { v: 6, l: "Sat" }, { v: 0, l: "Sun" },
];

// 1..31 for the monthly day-of-month grid (MONTH_LAST_DAY is a separate toggle).
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export default function RecurringForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, role } = useSession();
  const { getRecurring, createRecurring, updateRecurring, assignableUsers, profileById, departmentById, canRecurring } = useTaskStore();
  const editing = getRecurring(id ?? "");
  const canAssign = assignableUsers(role, user.id);

  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [assignedTo, setAssignedTo] = useState(editing?.assignedTo ?? "");
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(editing?.recurrenceType ?? "daily");
  const [weeklyDays, setWeeklyDays] = useState<number[]>(editing?.weeklyDays ?? [1]);
  const [monthlyDays, setMonthlyDays] = useState<number[]>(editing?.monthlyDays ?? [1]);
  const [active, setActive] = useState(editing?.active ?? true);
  const [locationIds, setLocationIds] = useState<string[]>(editing?.locationIds ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Department is derived from the assignee — never selected manually.
  const departmentName = departmentById(profileById(assignedTo)?.departmentId ?? null)?.name;

  const toggleDay = (v: number) =>
    setWeeklyDays((prev) => (prev.includes(v) ? prev.filter((d) => d !== v) : [...prev, v].sort((a, b) => a - b)));
  const toggleMonthDay = (v: number) =>
    setMonthlyDays((prev) => (prev.includes(v) ? prev.filter((d) => d !== v) : [...prev, v].sort((a, b) => a - b)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError("Please enter a title.");
    if (!assignedTo) return setError("Please choose who to assign this task to.");
    if (recurrenceType === "weekly" && weeklyDays.length === 0) return setError("Pick at least one weekday.");
    if (recurrenceType === "monthly" && monthlyDays.length === 0) return setError("Pick at least one day of the month.");
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      recurrenceType,
      weeklyDays: recurrenceType === "weekly" ? weeklyDays : [],
      monthlyDays: recurrenceType === "monthly" ? monthlyDays : [],
      assignedTo,
      createdBy: user.id,
      departmentId: profileById(assignedTo)?.departmentId ?? null,
      active,
      locationIds,
    };
    setBusy(true);
    setError("");
    try {
      if (editing) await updateRecurring(editing.id, payload);
      else await createRecurring(payload);
      navigate("/task-management/recurring");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <button onClick={() => navigate("/task-management/recurring")} className="text-[13px] text-grey hover:text-orange font-medium inline-flex items-center gap-1">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
        <h2 className="text-[22px] font-bold text-navy mt-2">{editing ? "Edit Recurring Task" : "New Recurring Task"}</h2>
        <p className="text-grey text-[13px] mt-1">Tasks generate automatically on the schedule you set.</p>
      </div>

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <FieldLabel label="Task title" required>
            <TextInput value={title} onChange={(e) => { setTitle(e.target.value); setError(""); }} placeholder="e.g. Submit daily sales report" autoFocus />
          </FieldLabel>

          <FieldLabel label="Description" hint="optional">
            <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details for each generated task…" />
          </FieldLabel>

          <FieldLabel label="Assign to" hint={departmentName ? `Dept: ${departmentName}` : undefined}>
            <Combobox
              value={assignedTo}
              onChange={setAssignedTo}
              options={canAssign.map((p) => {
                const dept = departmentById(p.departmentId)?.name;
                const sub = [p.designation, dept].filter(Boolean).join(" · ");
                return {
                  value: p.id,
                  label: p.name,
                  sublabel: sub || undefined,
                  icon: <Avatar name={p.name} color={p.avatarColor} size={22} />,
                };
              })}
            />
          </FieldLabel>

          {/* frequency segmented */}
          <FieldLabel label="Frequency">
            <div className="inline-flex rounded-xl border border-line p-1 bg-page">
              {(["daily", "weekly", "monthly"] as RecurrenceType[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setRecurrenceType(f)}
                  className={cn(
                    "px-5 py-2 rounded-lg text-[13px] font-semibold capitalize transition",
                    recurrenceType === f ? "bg-white text-orange shadow-soft" : "text-grey hover:text-navy"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </FieldLabel>

          {recurrenceType === "weekly" && (
            <FieldLabel label="Repeat on">
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => {
                  const on = weeklyDays.includes(d.v);
                  return (
                    <button
                      key={d.v}
                      type="button"
                      onClick={() => toggleDay(d.v)}
                      className={cn(
                        "flex-1 min-w-[2.5rem] sm:flex-none sm:w-12 py-2 rounded-lg text-[12.5px] font-semibold border transition",
                        on ? "bg-orange text-white border-orange shadow-cta" : "bg-white text-grey border-line hover:border-orange/40"
                      )}
                    >
                      {d.l}
                    </button>
                  );
                })}
              </div>
            </FieldLabel>
          )}

          {recurrenceType === "monthly" && (
            <FieldLabel label="Day(s) of the month" hint="task generates on these dates each month">
              <div className="grid grid-cols-7 gap-1.5">
                {MONTH_DAYS.map((d) => {
                  const on = monthlyDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleMonthDay(d)}
                      className={cn(
                        "py-1.5 rounded-lg text-[12.5px] font-semibold border transition",
                        on ? "bg-orange text-white border-orange shadow-cta" : "bg-white text-grey border-line hover:border-orange/40"
                      )}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => toggleMonthDay(MONTH_LAST_DAY)}
                className={cn(
                  "mt-2 w-full sm:w-auto px-4 py-2 rounded-lg text-[12.5px] font-semibold border transition",
                  monthlyDays.includes(MONTH_LAST_DAY) ? "bg-orange text-white border-orange shadow-cta" : "bg-white text-grey border-line hover:border-orange/40"
                )}
              >
                Last day of month
              </button>
              <p className="text-[11.5px] text-grey-2 mt-1.5">
                Days 29–31 only fire in months that have them — use “Last day of month” for a reliable month-end task.
              </p>
            </FieldLabel>
          )}

          <LocationPicker value={locationIds} onChange={setLocationIds} />

          <label className="flex items-center gap-3 pt-1 cursor-pointer select-none">
            <button
              type="button"
              onClick={() => setActive((a) => !a)}
              className={cn("relative w-10 h-[22px] rounded-full transition shrink-0", active ? "bg-[#27AE60]" : "bg-line")}
            >
              <span className={cn("absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all", active ? "left-[20px]" : "left-0.5")} />
            </button>
            <span className="text-[13px] text-navy font-medium">{active ? "Active" : "Paused"}</span>
          </label>

          {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            {!canRecurring && <span className="mr-auto text-[12.5px] text-grey-2">Read-only preview — saving is being wired next.</span>}
            <Button variant="ghost" onClick={() => navigate("/task-management/recurring")} disabled={busy}>{canRecurring ? "Cancel" : "Back"}</Button>
            <Button type="submit" disabled={!canRecurring || busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
