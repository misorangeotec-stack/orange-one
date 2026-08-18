import { useMemo, useState } from "react";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { cn } from "@/shared/lib/cn";
import { groupByCategory } from "@/apps/categories";
import { useAccessMatrix, lastSeenLabel } from "../lib/accessMatrix";
import type { AccessRow } from "../lib/accessMatrix";
import type { ModuleLevel } from "@/core/platform/types";
import { exportAccessMatrixToXlsx } from "../lib/exportAccessXlsx";

/**
 * Section 2 of the Master Report — who can open what.
 *
 * A READ-ONLY twin of core/admin/ModuleAccess.tsx: same category bands, same
 * sticky first column, same 25/page pagination, same category filter chips
 * (sixteen columns genuinely need them). The difference is that this screen
 * never writes — granting stays in Admin, where it belongs — and that it adds
 * the two things a director asks next: who has never signed in, and how many
 * people hold each module.
 */

const ROLE_LABEL: Record<AccessRow["role"], string> = {
  admin: "Admin",
  hod: "HOD",
  sub_hod: "Sub-HOD",
  employee: "Employee",
};

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[12px] font-medium rounded-pill px-3 py-1.5 border transition",
        active ? "bg-orange text-white border-orange" : "bg-white text-grey border-line hover:border-orange/40"
      )}
    >
      {label}
    </button>
  );
}

/** The access mark. Filled tick = full access; outlined eye = view only; hollow =
 *  no access. Never a bare glyph on its own, so it reads the same here as it does
 *  in the PDF. Matches Admin → Module Access exactly, so the report and the screen
 *  an admin acts on cannot say different things. */
function Mark({ level, title }: { level: ModuleLevel | "none"; title: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-[6px] border",
        level === "edit"
          ? "border-orange bg-orange text-white"
          : level === "view"
            ? "border-orange bg-white text-orange"
            : "border-line bg-white"
      )}
    >
      {level === "edit" && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
      {level === "view" && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      )}
    </span>
  );
}

/** What a cell's mark means, spelled out in its tooltip. */
const LEVEL_PHRASE: Record<ModuleLevel | "none", string> = {
  edit: "full access",
  view: "view only — can open and read it, but change nothing",
  none: "no access",
};

export default function UserAccess() {
  const { data, isLoading, error } = useAccessMatrix();
  const [activeGroup, setActiveGroup] = useState<string>("all");

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const pg = usePagination(rows);

  const groups = useMemo(() => {
    if (!data) return [];
    // Re-group the SAME module list the builder ordered, so the chips and the
    // columns cannot fall out of step.
    const byId = new Map(data.modules.map((m) => [m.id, m]));
    return groupByCategory(data.modules).map((g) => ({
      ...g,
      rows: g.rows.filter((m) => byId.has(m.id)),
    }));
  }, [data]);

  const shownGroups = activeGroup === "all" ? groups : groups.filter((g) => g.key === activeGroup);
  const shownModules = shownGroups.flatMap((g) => g.rows);

  if (isLoading) return <Card className="p-6 text-[14px] text-grey">Loading user access…</Card>;
  if (error) {
    return (
      <Card className="border-ryg-red/30 bg-[#FDECEC] p-4 text-[13.5px] text-[#B3322F]">
        Could not load user access: {(error as Error).message}
      </Card>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-[13px] text-grey">
          Every user, alphabetically, with the modules they can open. Admins see every module
          regardless of what is granted to them, so their row is marked as such. Granting is done in{" "}
          <span className="font-semibold text-navy">Admin → Module Access</span>; this page is read-only.
        </p>
        <Button variant="ghost" size="sm" onClick={() => exportAccessMatrixToXlsx(data)}>
          Export to Excel
        </Button>
      </div>

      {data.grantedButNeverSignedIn > 0 && (
        <Card className="border-[#f0dcb4] bg-[#FDF3E2] p-3.5 text-[13px] text-[#9A6512]">
          <b>
            {data.grantedButNeverSignedIn}{" "}
            {data.grantedButNeverSignedIn === 1 ? "person holds" : "people hold"} module access but
            have never signed in.
          </b>{" "}
          {data.neverSignedIn} of {rows.length} users have never signed in at all — worth checking
          before granting anything further.
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip label="All" active={activeGroup === "all"} onClick={() => setActiveGroup("all")} />
        {groups.map((g) => (
          <FilterChip
            key={g.key}
            label={`${g.label} (${g.rows.length})`}
            active={activeGroup === g.key}
            onClick={() => setActiveGroup(g.key)}
          />
        ))}
      </div>

      <Card>
        {/*
          A max-height is what MAKES the header sticky: `position: sticky`
          resolves against the nearest SCROLLING ancestor, and without a height
          cap this container only ever scrolls sideways — the header would have
          nothing to stick to and would simply scroll away with the page.
        */}
        <ScrollableTable maxHeight="max-h-[72vh]">
          <table className="w-full border-collapse">
            {/*
              Sticky cells and `border-collapse` do not mix: a collapsed border
              belongs to the table grid, not to the cell, so it stays behind
              while the cell travels. Every rule on a sticky row is therefore an
              inset box-shadow, which rides along with it.

              Layering: header corner 40 > header 30 > body/footer first column
              20 > everything else. Get this wrong and the name column paints
              over the header names on a sideways scroll.
            */}
            <thead>
              {/* Category band above the module names — without it a wide sideways
                  scroll loses all sense of which family a column belongs to. */}
              <tr>
                <th className="sticky left-0 top-0 z-40 h-8 bg-white shadow-[inset_0_-1px_0_#E9EEF6]" />
                <th className="sticky top-0 z-30 h-8 bg-white shadow-[inset_0_-1px_0_#E9EEF6]" />
                {shownGroups.map((g) => (
                  <th
                    key={g.key}
                    colSpan={g.rows.length}
                    className="sticky top-0 z-30 h-8 border-l border-line/60 bg-white px-4 pb-1 pt-3 text-center text-[10.5px] font-semibold uppercase tracking-wider text-grey-2 shadow-[inset_0_-1px_0_#E9EEF6]"
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              {/* top-8 = the 32px band above it. The two must stay in step; if the
                  band's h-8 changes, this offset changes with it. */}
              <tr>
                <th className="sticky left-0 top-8 z-40 bg-white px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide text-grey-2 shadow-[inset_0_-1px_0_#E9EEF6]">
                  User
                </th>
                <th className="sticky top-8 z-30 whitespace-nowrap bg-white px-3 py-3 text-right text-[12px] font-semibold uppercase tracking-wide text-grey-2 shadow-[inset_0_-1px_0_#E9EEF6]">
                  Last sign-in
                </th>
                {shownModules.map((m) => (
                  <th
                    key={m.id}
                    className="sticky top-8 z-30 whitespace-nowrap bg-white px-4 py-3 text-center text-[12px] font-semibold text-navy shadow-[inset_0_-1px_0_#E9EEF6]"
                  >
                    {m.name}
                    {m.status !== "live" && <span className="block text-[10px] font-normal text-grey-2">coming soon</span>}
                    {m.universal && <span className="block text-[10px] font-normal text-grey-2">everyone</span>}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {pg.pageItems.map((u) => (
                <tr key={u.userId} className="border-b border-line last:border-0">
                  <td className="sticky left-0 z-20 bg-white px-4 py-3">
                    <div className="min-w-[200px]">
                      <div className="truncate text-[13px] font-medium text-navy">
                        {u.name}
                        <span className="ml-1.5 text-[11px] font-normal text-grey-2">{ROLE_LABEL[u.role]}</span>
                      </div>
                      <div className="truncate text-[11px] text-grey-2">
                        {u.department || "No department"} ·{" "}
                        {u.isAdmin ? "all modules" : `${u.explicitCount} granted`}
                      </div>
                    </div>
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-3 text-right text-[12.5px]",
                      u.lastActiveAt ? "text-grey" : "font-semibold text-ryg-red"
                    )}
                  >
                    {lastSeenLabel(u.lastActiveAt)}
                  </td>

                  {u.isAdmin ? (
                    // One banded span, not sixteen ticks: an admin's access does not
                    // come from app_access at all, and drawing it as sixteen granted
                    // cells would imply grants that are not there.
                    <td
                      colSpan={shownModules.length}
                      className="bg-orange-soft/60 px-4 py-3 text-center text-[12px] font-semibold text-orange"
                    >
                      Admin — every module
                    </td>
                  ) : (
                    shownModules.map((m) => {
                      const lvl = u.level[m.id] ?? "none";
                      return (
                        <td key={m.id} className="px-4 py-3 text-center">
                          <Mark level={lvl} title={`${u.name} — ${m.name}: ${LEVEL_PHRASE[lvl]}`} />
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>

            {/* Pinned to the bottom of the scroll box for the same reason the
                header is pinned to the top: capping the height would otherwise
                have buried the totals row, which is the line the reader is
                comparing every column against. */}
            <tfoot>
              <tr className="bg-page">
                <td className="sticky bottom-0 left-0 z-40 bg-page px-4 py-3 text-[12px] font-semibold text-navy shadow-[inset_0_2px_0_#E9EEF6]">
                  Users with access
                </td>
                <td className="sticky bottom-0 z-30 bg-page shadow-[inset_0_2px_0_#E9EEF6]" />
                {shownModules.map((m) => {
                  const n = data.totals[m.id] ?? 0;
                  const explicit = data.explicitTotals[m.id] ?? 0;
                  // Every admin can open every module, so `n` can never fall
                  // below the admin count — it is `explicit` that says whether a
                  // module was ever actually rolled out to anyone.
                  const adminsOnly = explicit === 0;
                  return (
                    <td
                      key={m.id}
                      className={cn(
                        "sticky bottom-0 z-30 bg-page px-4 py-3 text-center text-[13px] font-semibold shadow-[inset_0_2px_0_#E9EEF6]",
                        adminsOnly ? "text-ryg-red" : "text-navy"
                      )}
                      title={
                        adminsOnly
                          ? `${m.name}: granted to nobody — only admins can open it`
                          : `${m.name}: ${explicit} granted, ${n} can open it including admins`
                      }
                    >
                      {n}
                      {adminsOnly && <span className="block text-[10px] font-normal">admins only</span>}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </ScrollableTable>
        {rows.length > 0 && <Pagination state={pg} rowsLabel="users" />}
      </Card>
    </div>
  );
}
