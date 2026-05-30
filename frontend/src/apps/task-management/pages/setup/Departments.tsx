import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import EmptyState from "@/shared/components/ui/EmptyState";
import { useTaskStore } from "../../mock/store";
import type { Department } from "../../types";

export default function Departments() {
  const { departments, profiles, addDepartment, updateDepartment, deleteDepartment } = useTaskStore();
  const [edit, setEdit] = useState<Department | "new" | null>(null);
  const [confirmDel, setConfirmDel] = useState<Department | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const open = (d: Department | "new") => {
    setEdit(d);
    setName(d === "new" ? "" : d.name);
    setDesc(d === "new" ? "" : d.description ?? "");
  };
  const save = () => {
    if (!name.trim()) return;
    if (edit === "new") addDepartment({ name: name.trim(), description: desc.trim() || undefined });
    else if (edit) updateDepartment(edit.id, { name: name.trim(), description: desc.trim() || undefined });
    setEdit(null);
  };
  const memberCount = (id: string) => profiles.filter((p) => p.departmentId === id).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-grey">{departments.length} department{departments.length !== 1 ? "s" : ""}</p>
        <Button size="sm" onClick={() => open("new")}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add Department
        </Button>
      </div>

      <Card className="overflow-hidden">
        {departments.length === 0 ? (
          <EmptyState title="No departments yet" message="Add your first department to organize teams." actionLabel="Add Department" onAction={() => open("new")} />
        ) : (
          <ul className="divide-y divide-line">
            {departments.map((d) => (
              <li key={d.id} className="flex items-center gap-4 px-5 py-4">
                <span className="w-9 h-9 rounded-card bg-orange-soft text-orange flex items-center justify-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3" /></svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-navy truncate">{d.name}</div>
                  <div className="text-[11.5px] text-grey-2 truncate">{d.description || "No description"}</div>
                </div>
                <span className="text-[12px] text-grey-2 whitespace-nowrap shrink-0">{memberCount(d.id)} member{memberCount(d.id) !== 1 ? "s" : ""}</span>
                <button onClick={() => open(d)} className="text-grey-2 hover:text-orange transition p-1 shrink-0" title="Edit">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                </button>
                <button onClick={() => setConfirmDel(d)} className="text-grey-2 hover:text-[#d4493f] transition p-1 shrink-0" title="Delete">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* add/edit modal */}
      <Modal
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit === "new" ? "Add department" : "Edit department"}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}
      >
        <div className="space-y-4">
          <FieldLabel label="Name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Operations" autoFocus /></FieldLabel>
          <FieldLabel label="Description" hint="optional"><TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What this department does…" /></FieldLabel>
        </div>
      </Modal>

      {/* delete confirm */}
      <Modal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title="Delete department?"
        subtitle={confirmDel?.name}
        size="sm"
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button>
          <Button className="!bg-[#d4493f] !shadow-none hover:!bg-[#bf3d34]" onClick={() => { if (confirmDel) deleteDepartment(confirmDel.id); setConfirmDel(null); }}>Delete</Button>
        </>}
      >
        <p className="text-[14px] text-grey leading-relaxed">
          {confirmDel && memberCount(confirmDel.id) > 0
            ? `${memberCount(confirmDel.id)} user(s) are in this department — they'll be left without one.`
            : "This department has no members."}
        </p>
      </Modal>
    </div>
  );
}
