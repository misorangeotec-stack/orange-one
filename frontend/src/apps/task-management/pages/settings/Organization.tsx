import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import { useTaskStore } from "../../mock/store";

/** Admin: workspace-level settings. */
export default function Organization() {
  const { workspace, updateWorkspace, profiles, departments } = useTaskStore();
  const [name, setName] = useState(workspace.workspaceName);
  const [weekStart, setWeekStart] = useState(workspace.weekStart);
  const [maxRev, setMaxRev] = useState(workspace.maxRevisionsPerWeek);
  const [saved, setSaved] = useState(false);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    updateWorkspace({ workspaceName: name.trim() || "Workspace", weekStart, maxRevisionsPerWeek: Math.max(1, maxRev) });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card className="px-4 py-3"><div className="text-[22px] font-bold text-navy leading-none">{profiles.length}</div><div className="text-[11.5px] text-grey mt-1.5">Users</div></Card>
        <Card className="px-4 py-3"><div className="text-[22px] font-bold text-navy leading-none">{departments.length}</div><div className="text-[11.5px] text-grey mt-1.5">Departments</div></Card>
        <Card className="px-4 py-3"><div className="text-[22px] font-bold text-navy leading-none">{workspace.maxRevisionsPerWeek}</div><div className="text-[11.5px] text-grey mt-1.5">Max revisions/wk</div></Card>
      </div>

      <Card className="p-6">
        <form onSubmit={save} className="space-y-4">
          <FieldLabel label="Workspace name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></FieldLabel>

          <FieldLabel label="Week starts on">
            <div className="inline-flex rounded-xl border border-line p-1 bg-page">
              {(["mon", "sun"] as const).map((d) => (
                <button key={d} type="button" onClick={() => setWeekStart(d)} className={cn("px-5 py-2 rounded-lg text-[13px] font-semibold transition", weekStart === d ? "bg-white text-orange shadow-soft" : "text-grey hover:text-navy")}>
                  {d === "mon" ? "Monday" : "Sunday"}
                </button>
              ))}
            </div>
          </FieldLabel>

          <FieldLabel label="Max revisions per week" hint="the core accountability rule">
            <div className="flex items-center gap-3">
              <input type="range" min={1} max={5} value={maxRev} onChange={(e) => setMaxRev(Number(e.target.value))} className="accent-orange w-48" />
              <span className="text-[15px] font-bold text-navy w-6 text-center">{maxRev}</span>
            </div>
          </FieldLabel>

          <div className="flex items-center justify-end gap-3 pt-1">
            {saved && <span className="text-[12.5px] text-[#27AE60] font-medium">✓ Saved</span>}
            <Button type="submit">Save settings</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
