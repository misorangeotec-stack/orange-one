import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import Combobox from "@/shared/components/ui/Combobox";
import Avatar from "@/shared/components/ui/Avatar";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import LocationPicker from "../components/LocationPicker";
import MentionTextArea from "../components/MentionTextArea";
import { useReportsToSuffix } from "../components/ReportsToTag";

/** Create a one-time task. Assignee options depend on the current user's role. */
export default function CreateTask() {
  const navigate = useNavigate();
  const { user, role } = useSession();
  const { createTask, assignableUsers, peerAssignableUsers, departmentById, canCreateTask } = useTaskStore();
  const canAssign = assignableUsers(role, user.id);
  const reportsToSuffix = useReportsToSuffix();

  // TM-1: a HOD may also hand a one-off task sideways, to another HOD.
  //
  // ⚠ HODs ONLY — an ADMIN never gets this group. That is not an oversight: the
  //   client settled (07-09-2026) that an admin assigning to a HOD is ordinary
  //   downward work and must keep being scored the normal way. Because the flag
  //   is stamped only from this list, an admin assignment cannot become peer
  //   work by construction — and the 183 such tasks already in the database are
  //   untouched.
  //
  // ⚠ Anyone already in the downline is filtered OUT. Nobody is mapped that way
  //   today (the three HODs with a boss report to admins), but user_hods is
  //   editable, and the moment a HOD is mapped under another HOD that is a
  //   reporting line, not a peer one. "My team" wins.
  const peers = useMemo(() => {
    if (role !== "hod") return [];
    const team = new Set(canAssign.map((p) => p.id));
    return peerAssignableUsers(user.id).filter((p) => !team.has(p.id));
  }, [role, user.id, canAssign.map((p) => p.id).join(","), peerAssignableUsers]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Department is derived from the assignee — never selected manually.
  //
  // 🔴 RESOLVED AGAINST BOTH LISTS, NOT `profileById`. `profiles_select` cannot
  //   see another department's HOD at all, so profileById(peer) is undefined and
  //   the task would be born with NO department — filed under "Unassigned" in
  //   Master Analysis forever. The peer list comes from list_org_people(), which
  //   is SECURITY DEFINER and carries department_id. (Proved at the SQL level
  //   before this was written: the same insert run as the assigning HOD resolved
  //   the department to null.) The department NAME is fine either way —
  //   `departments_select` is is_staff, so every department is readable.
  const picked = canAssign.find((p) => p.id === assignedTo) ?? peers.find((p) => p.id === assignedTo);
  const departmentId = picked?.departmentId ?? null;
  const departmentName = departmentById(departmentId)?.name;
  /** Stamped only when the pick came from the peer group — never inferred later. */
  const isPeerAssignment = !!assignedTo && peers.some((p) => p.id === assignedTo);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Please enter a task title.");
      return;
    }
    if (!assignedTo) {
      setError("Please choose who to assign this task to.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const id = await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        assignedTo,
        departmentId,
        dueDate: dueDate || null,
        locationIds,
        isPeerAssignment,
      });
      navigate(`/task-management/tasks/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the task.");
      setBusy(false);
    }
  };

  const BackLink = (
    <button onClick={() => navigate(-1)} className="text-[13px] text-grey hover:text-orange font-medium inline-flex items-center gap-1">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      Back
    </button>
  );

  // You assign tasks down your team — with no team members, there's no one to assign to.
  // Peers count: four HODs have no downline at all, and before TM-1 this screen
  // turned them away outright. They can still hand work to another HOD.
  if (canAssign.length === 0 && peers.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          {BackLink}
          <h2 className="text-[22px] font-bold text-navy mt-2">Create Task</h2>
        </div>
        <Card className="p-6">
          <p className="text-[14px] text-grey">You don't have anyone to assign tasks to.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        {BackLink}
        <h2 className="text-[22px] font-bold text-navy mt-2">Create Task</h2>
        <p className="text-grey text-[13px] mt-1">
          {peers.length > 0 ? "Assign a task to a member of your team, or to another HOD." : "Assign a task to a member of your team."}
        </p>
      </div>

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <FieldLabel label="Task title" required>
            <TextInput value={title} onChange={(e) => { setTitle(e.target.value); setError(""); }} placeholder="e.g. Submit daily sales report" autoFocus />
          </FieldLabel>

          <FieldLabel label="Description" hint="optional">
            <MentionTextArea
              value={description}
              onChange={setDescription}
              rows={4}
              placeholder="Add any details, context, or links…  use @ to tag a teammate"
            />
          </FieldLabel>

          <div className="grid sm:grid-cols-2 gap-4">
            <FieldLabel label="Assign to" hint={departmentName ? `Dept: ${departmentName}` : undefined}>
              <Combobox
                value={assignedTo}
                onChange={setAssignedTo}
                options={[
                  // Team first, then peers. Combobox draws a heading wherever
                  // `group` changes between consecutive options, so the order IS
                  // the grouping. Groups are only set when there is something to
                  // separate — a HOD with no peers keeps the plain flat list.
                  ...canAssign.map((p) => {
                    const dept = departmentById(p.departmentId)?.name;
                    const sub = [p.designation, dept, reportsToSuffix(p, user.id)].filter(Boolean).join(" · ");
                    return {
                      value: p.id,
                      label: p.name,
                      sublabel: sub || undefined,
                      icon: <Avatar name={p.name} color={p.avatarColor} size={22} />,
                      group: peers.length > 0 ? "My team" : undefined,
                    };
                  }),
                  // No reportsToSuffix here — a peer does not report to you, which
                  // is the whole point of the group.
                  ...peers.map((p) => {
                    const dept = departmentById(p.departmentId)?.name;
                    const sub = [p.designation, dept].filter(Boolean).join(" · ");
                    return {
                      value: p.id,
                      label: p.name,
                      sublabel: sub || undefined,
                      icon: <Avatar name={p.name} color={p.avatarColor} size={22} />,
                      group: "Other HODs",
                    };
                  }),
                ]}
              />
            </FieldLabel>

            <FieldLabel label="Due date" hint="optional">
              <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </FieldLabel>
          </div>

          <LocationPicker value={locationIds} onChange={setLocationIds} />

          {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            {!canCreateTask && <span className="mr-auto text-[12.5px] text-grey-2">Read-only preview — saving is being wired next.</span>}
            <Button variant="ghost" onClick={() => navigate(-1)} disabled={busy}>{canCreateTask ? "Cancel" : "Back"}</Button>
            <Button type="submit" disabled={!canCreateTask || busy}>{busy ? "Creating…" : "Create Task"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
