import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { cn } from "@/shared/lib/cn";
import { useTaskStore } from "../../mock/store";

/** Admin onboarding checklist — progress derived from current workspace state. */
export default function Onboarding() {
  const { departments, profiles, tasks } = useTaskStore();

  const hasHod = profiles.some((p) => p.role === "hod" || p.role === "sub_hod");
  const hasEmployee = profiles.some((p) => p.role === "employee");
  const hasMapping = profiles.some((p) => p.hodIds.length > 0);

  const steps = [
    { label: "Create departments", done: departments.length > 0, hint: `${departments.length} created`, to: "/task-management/setup/departments", cta: "Manage departments" },
    { label: "Add HODs / managers", done: hasHod, hint: hasHod ? "Added" : "None yet", to: "/task-management/setup/users/new", cta: "Add a HOD" },
    { label: "Add employees", done: hasEmployee, hint: hasEmployee ? "Added" : "None yet", to: "/task-management/setup/users/new", cta: "Add an employee" },
    { label: "Map reporting structure", done: hasMapping, hint: hasMapping ? "Mapped" : "Not mapped", to: "/task-management/setup/hierarchy", cta: "Review hierarchy" },
    { label: "Create first tasks", done: tasks.length > 0, hint: `${tasks.length} tasks`, to: "/task-management/tasks/new", cta: "Create a task" },
  ];

  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[14px] font-semibold text-navy">Setup progress</h3>
          <span className="text-[13px] font-semibold text-orange">{done}/{steps.length} complete</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-line overflow-hidden">
          <div className="h-full bg-orange-grad transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Card>

      <Card className="divide-y divide-line">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <span className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0", s.done ? "bg-[#E8F8EF] text-[#27AE60]" : "bg-page text-grey-2 border border-line")}>
              {s.done ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              ) : (
                <span className="text-[12px] font-semibold">{i + 1}</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-[14px] font-medium", s.done ? "text-grey line-through" : "text-navy")}>{s.label}</div>
              <div className="text-[11.5px] text-grey-2">{s.hint}</div>
            </div>
            <Link to={s.to} className="text-[12.5px] font-semibold text-orange hover:underline whitespace-nowrap shrink-0">
              {s.cta} →
            </Link>
          </div>
        ))}
      </Card>
    </div>
  );
}
