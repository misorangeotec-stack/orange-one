/**
 * HR Reports · Settings (HRREP-1) — who may open OTHER people's reports.
 *
 * Three things already widen a reader's reach without anybody deciding anything: an
 * admin sees everyone, a head sees their own reporting chain, and everybody sees
 * themselves. This screen manages the fourth — named people who may read EVERYBODY,
 * which is how "Management" is expressed in a platform whose only roles are admin,
 * hod, sub_hod and employee.
 *
 * ⚠ ROW AT A TIME, NEVER "SAVE THE LIST". A Setup screen that replaces a permission
 *   list wholesale can wipe it: the tab is opened before the fetch lands, somebody
 *   presses Save, and an empty array goes over the top of everyone's access. Each tick
 *   here is its own insert or delete, so no code path can send "nobody".
 */
import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import type { Profile } from "@/core/platform/types";
import { cn } from "@/shared/lib/cn";
import { formatDate } from "@/shared/lib/time";
import { useSetViewer, useViewers } from "../lib/viewers";

export default function Settings() {
  const { user } = useSession();
  const { profiles, departments } = useDirectory();
  const viewers = useViewers();
  const setViewer = useSetViewer();
  const [busy, setBusy] = useState<string | null>(null);

  const viewerIds = useMemo(() => new Set((viewers.data ?? []).map((v) => v.user_id)), [viewers.data]);
  const addedAt = useMemo(() => new Map((viewers.data ?? []).map((v) => [v.user_id, v.added_at])), [viewers.data]);
  const deptName = (id: string | null) => (id ? (departments.find((d) => d.id === id)?.name ?? "—") : "—");

  const people = useMemo(
    () => profiles.filter((p) => !p.isExternal).sort((a, b) => a.name.localeCompare(b.name)),
    [profiles],
  );

  const toggle = async (p: Profile, on: boolean) => {
    setBusy(p.id);
    try {
      await setViewer.mutateAsync({ userId: p.id, on, byUserId: user.id });
    } finally {
      setBusy(null);
    }
  };

  const columns: QueueColumn<Profile>[] = [
    {
      key: "name",
      header: "Person",
      alwaysVisible: true,
      cell: (p) => (
        <span className="block truncate font-medium text-navy" title={p.name}>
          {p.name}
        </span>
      ),
      resize: { width: 220, min: 140, max: 420 },
      sortValue: (p) => p.name,
      filter: { kind: "select", get: (p) => p.name },
    },
    {
      key: "designation",
      header: "Designation",
      cell: (p) => <span className="block truncate text-grey">{p.designation ?? "—"}</span>,
      resize: { width: 180, min: 100, max: 340 },
      sortValue: (p) => p.designation ?? "",
      filter: { kind: "select", get: (p) => p.designation ?? "Not set" },
    },
    {
      key: "dept",
      header: "Department",
      cell: (p) => <span className="block truncate text-grey">{deptName(p.departmentId)}</span>,
      resize: { width: 180, min: 100, max: 340 },
      sortValue: (p) => deptName(p.departmentId),
      filter: { kind: "select", get: (p) => deptName(p.departmentId) },
    },
    {
      key: "role",
      header: "Role in the hub",
      // Said plainly, because it is the reason most people need no tick at all: a head
      // already reaches their own team, and an admin already reaches everyone.
      cell: (p) => (
        <span className="whitespace-nowrap text-grey">
          {p.role === "admin"
            ? "Admin — sees everyone already"
            : p.role === "hod" || p.role === "sub_hod"
              ? "Head — sees their own team already"
              : "Employee — sees only themselves"}
        </span>
      ),
      resize: { width: 230, min: 140, max: 380 },
      sortValue: (p) => p.role,
      filter: { kind: "select", get: (p) => (p.role === "admin" ? "Admin" : p.role === "employee" ? "Employee" : "Head") },
    },
    {
      key: "viewer",
      header: "Can see everyone's reports",
      cell: (p) => {
        const on = viewerIds.has(p.id);
        const isAdminRow = p.role === "admin";
        return (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isAdminRow || busy === p.id || viewers.isLoading}
              onClick={() => void toggle(p, !on)}
              className={cn(
                "rounded border px-2 py-[2px] text-[11.5px] font-medium transition-colors",
                isAdminRow
                  ? "cursor-not-allowed border-line bg-page text-grey-2"
                  : on
                    ? "border-[#1f8a4d] bg-[#1f8a4d] text-white hover:opacity-90"
                    : "border-line text-grey hover:border-orange hover:text-orange",
              )}
              title={isAdminRow ? "Admins always see everyone — there is nothing to tick." : undefined}
            >
              {busy === p.id ? "saving…" : isAdminRow ? "Always" : on ? "Yes" : "No"}
            </button>
            {on && addedAt.get(p.id) && (
              <span className="whitespace-nowrap text-[11px] text-grey-2">since {formatDate(addedAt.get(p.id)!)}</span>
            )}
          </div>
        );
      },
      sortValue: (p) => (p.role === "admin" ? 2 : viewerIds.has(p.id) ? 1 : 0),
      filter: {
        kind: "select",
        get: (p) => (p.role === "admin" ? "Always (admin)" : viewerIds.has(p.id) ? "Yes" : "No"),
      },
      exportValue: (p) => (p.role === "admin" ? "always (admin)" : viewerIds.has(p.id) ? "yes" : "no"),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-white px-4 py-3 text-[12px] leading-relaxed text-navy">
        <span className="font-semibold">Who can open other people&apos;s reports.</span> Everybody opens their own with no
        setting at all. A <span className="font-medium">head</span> also opens the reports of everyone who reports to them, and an{" "}
        <span className="font-medium">admin</span> opens anybody&apos;s. Tick somebody here only when they need to read{" "}
        <span className="font-medium">everyone&apos;s</span> — a director or a management reader who heads no department and
        would otherwise see only themselves.
        <div className="mt-1.5 text-grey">
          Reaching the app is not the question: it is open to every employee, because everyone has their own report. This
          decides whose reports they may choose between.
        </div>
      </div>

      {viewers.isError && (
        <div className="rounded-lg border border-[#c0392b]/40 bg-[#c0392b]/[0.06] px-4 py-2.5 text-[12px] text-[#c0392b]">
          <span className="font-semibold">The viewer list would not load.</span> Nothing has been changed. {String(viewers.error)}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="px-2 pb-2 sm:px-3">
          <QueueTable
            rows={people}
            rowKey={(p) => p.id}
            columns={columns}
            rowsLabel="people"
            emptyTitle="Nobody in the directory"
            emptyMessage="No staff profile was returned for this login."
            initialSort={{ key: "name", dir: "asc" }}
            columnPicker={{ storageKey: "hr-reports.settings.viewers" }}
            resizeKey="hr-reports.settings.viewers"
            exportName="HR_Reports_Who_Can_See_Everyone"
            exportTitle="HR Reports · who can open other people's reports"
            exportNotes={[
              "Everybody opens their OWN report with no setting.",
              "Heads also open the reports of everyone who reports to them; admins open anybody's.",
              "The 'Yes' rows below are people ticked to read EVERYONE's, regardless of reporting line.",
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
