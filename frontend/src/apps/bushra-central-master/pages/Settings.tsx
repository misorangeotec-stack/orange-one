import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useDirectory } from "@/core/platform/store";
import { useSession } from "@/core/platform/session";
import { MODULE_LEVEL_LABEL, type ModuleLevel, type Profile } from "@/core/platform/types";
import { APP_ID } from "../lib/store";

/**
 * SETTINGS — who may see and who may edit Bushra Central Master.
 *
 * ⚠ THIS IS THE MODULE GRANT, NOT A SECOND LIST. The right to save here has
 *   always been the `bushra-central-master` row in app_access: RLS on
 *   bushra_central_master_overrides lets any grant read and only 'edit' write,
 *   and ItemMaster mirrors that with `canEditModule`. This screen edits exactly
 *   that one row per person, so it and Admin → Module Access can never disagree.
 *
 * Writes go through the directory's setUserModules with the person's WHOLE map,
 * this module changed and every other grant passed back untouched — that
 * function revokes whatever is missing from the map it is given.
 *
 * Admin-only: app_access is written under admin RLS, and admins always have
 * full access, so they are not listed.
 */
interface Row {
  id: string;
  name: string;
  designation: string;
  department: string;
  level: ModuleLevel;
}

export default function Settings() {
  const { isAdmin } = useSession();
  const { profiles, departmentById, setUserModules } = useDirectory();

  const [addIds, setAddIds] = useState<string[]>([]);
  const [addLevel, setAddLevel] = useState<ModuleLevel>("edit");
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Admins always edit; customer logins must never be offered a staff module.
  const staff = useMemo(() => profiles.filter((p) => p.role !== "admin" && !p.isExternal), [profiles]);

  const rows: Row[] = useMemo(
    () => staff
      .filter((p) => p.moduleLevels[APP_ID])
      .map((p) => ({
        id: p.id,
        name: p.name,
        designation: p.designation ?? "",
        department: departmentById(p.departmentId)?.name ?? "",
        level: p.moduleLevels[APP_ID],
      })),
    [staff, departmentById],
  );

  const addOptions: MultiOption[] = useMemo(
    () => staff
      .filter((p) => !p.moduleLevels[APP_ID])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [staff],
  );

  /** This person's full grant map with only this module changed (null = revoke). */
  const withLevel = (p: Profile, level: ModuleLevel | null): Record<string, ModuleLevel> => {
    const next = { ...p.moduleLevels };
    if (level) next[APP_ID] = level;
    else delete next[APP_ID];
    return next;
  };

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    setSaved(null);
    try {
      await work();
      setSaved(key);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const setLevel = (id: string, level: ModuleLevel | null) =>
    run(id, async () => {
      const p = profiles.find((x) => x.id === id);
      if (p) await setUserModules(id, withLevel(p, level));
    });

  const addPeople = () =>
    run("add", async () => {
      for (const id of addIds) {
        const p = profiles.find((x) => x.id === id);
        if (p) await setUserModules(id, withLevel(p, addLevel));
      }
      setAddIds([]);
    });

  const columns: QueueColumn<Row>[] = [
    { key: "name", header: "Person", cell: (r) => <span className="font-medium text-navy">{r.name}</span>,
      sortValue: (r) => r.name, filter: { kind: "select", get: (r) => r.name } },
    { key: "designation", header: "Designation", cell: (r) => r.designation || "—",
      sortValue: (r) => r.designation, filter: { kind: "select", get: (r) => r.designation || "—" } },
    { key: "department", header: "Department", cell: (r) => r.department || "—",
      sortValue: (r) => r.department, filter: { kind: "select", get: (r) => r.department || "—" } },
    {
      key: "level", header: "Access",
      cell: (r) => (
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          {(["view", "edit"] as ModuleLevel[]).map((lv) => (
            <button
              key={lv}
              type="button"
              disabled={busy !== null || r.level === lv}
              onClick={() => void setLevel(r.id, lv)}
              className={`px-3 py-1 text-[12px] font-medium transition ${
                r.level === lv ? "bg-orange text-white" : "bg-white text-navy hover:bg-orange/10"
              }`}
            >
              {lv === "edit" ? "Can edit" : "View only"}
            </button>
          ))}
        </div>
      ),
      sortValue: (r) => r.level,
      filter: { kind: "select", get: (r) => MODULE_LEVEL_LABEL[r.level] },
      exportValue: (r) => MODULE_LEVEL_LABEL[r.level],
    },
  ];

  if (!isAdmin) {
    return (
      <Card className="p-5 text-[13px] text-grey">
        Only an admin can change who has access to Bushra Central Master.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-[17px] font-semibold text-navy">Settings · Who can edit</h1>
        <p className="mt-1 max-w-3xl text-[13px] text-grey">
          <strong>Can edit</strong> lets a person type into the Item master and Save for everyone.{" "}
          <strong>View only</strong> lets them open it and read the saved values, but not change them.
          Admins can always edit. This is the same grant as Admin → Module Access, so a change here shows there too.
        </p>
      </Card>

      {err && <Card className="text-[13px] text-ryg-red">Could not save: {err}</Card>}

      <Card className="space-y-3 p-5">
        <h3 className="text-[15px] font-bold text-navy">Give access</h3>
        <MultiSelect
          values={addIds}
          onChange={(v) => { setAddIds(v); setSaved(null); }}
          options={addOptions}
          placeholder="Select people"
          searchable
          chips
          disabled={busy !== null}
        />
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            {(["edit", "view"] as ModuleLevel[]).map((lv) => (
              <button
                key={lv}
                type="button"
                onClick={() => setAddLevel(lv)}
                className={`px-3 py-1.5 text-[12.5px] font-medium transition ${
                  addLevel === lv ? "bg-navy text-white" : "bg-white text-navy hover:bg-navy/5"
                }`}
              >
                {lv === "edit" ? "Can edit" : "View only"}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => void addPeople()} disabled={busy !== null || addIds.length === 0}>
            {busy === "add" ? "Saving…" : "Give access"}
          </Button>
          {saved === "add" && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="text-[15px] font-bold text-navy">People with access</h3>
        <QueueTable<Row>
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          rowsLabel="people"
          initialSort={{ key: "name", dir: "asc" }}
          emptyTitle="Admins only"
          emptyMessage="Nobody else has access yet. Use Give access above."
          actions={(r) => (
            <Button
              size="sm"
              variant="ghost"
              className="!px-3 !py-1.5 text-[12.5px]"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm(`Remove ${r.name}'s access to Bushra Central Master?`)) void setLevel(r.id, null);
              }}
            >
              {busy === r.id ? "Saving…" : "Remove"}
            </Button>
          )}
          exportName="Bushra Central Master access"
        />
      </Card>
    </div>
  );
}
