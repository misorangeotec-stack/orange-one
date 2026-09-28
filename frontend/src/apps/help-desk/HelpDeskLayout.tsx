import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildHelpNav, B } from "./nav";
import { useHelpStore } from "./store";
import { QUEUE_STEPS, type StepKey } from "./lib/steps";
import type { HelpNotification } from "./types";

const linkFor = (n: HelpNotification): string =>
  n.entityType === "ticket" ? `${B}/tickets/${n.entityId}` : B;

/**
 * Wires the portal session and the Help Desk store into the shared AppShell.
 *
 * The bell renders `n.text` RAW, so every notification the RPCs write is a whole
 * sentence — "HD-2627-0004 · Payslip for August" rather than a code the reader
 * has to decode.
 */
export default function HelpDeskLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useHelpStore();
  const orgPersonById = useOrgPersonById();

  const countByStep = useMemo(() => {
    const out: Partial<Record<StepKey, number>> = {};
    for (const e of s.myQueueEntries) {
      out[e.stepKey] = (out[e.stepKey] ?? 0) + 1;
    }
    return out;
  }, [s.myQueueEntries]);

  const queues = useMemo(() => {
    const out: Partial<Record<StepKey, boolean>> = {};
    for (const key of QUEUE_STEPS) out[key] = s.offersQueue(key);
    return out;
  }, [s]);

  const nav = useMemo(
    () =>
      buildHelpNav({
        isAdmin,
        canRaise: s.canRaise,
        isDeskStaff: s.isDeskStaff,
        queues,
        countByStep,
        canManageMasters: s.canManageMasters,
        canSetup: s.canSetup,
      }),
    [isAdmin, s.canRaise, s.isDeskStaff, s.canManageMasters, s.canSetup, queues, countByStep],
  );

  const notifications = useMemo<NotificationItem[]>(
    () =>
      s.notifications
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 40)
        .map((n) => {
          const actor = orgPersonById(n.actorId);
          return {
            id: n.id,
            actorName: n.actorId ? (actor?.name ?? "Someone") : "System",
            actorColor: actor?.avatarColor ?? undefined,
            message: n.text ?? "",
            createdAt: n.createdAt,
            unread: !n.readAt,
            to: linkFor(n),
          };
        }),
    [s.notifications, orgPersonById],
  );

  return (
    <AppShell
      nav={nav}
      role={role ?? ""}
      user={{
        name: user?.name ?? "",
        designation: user?.designation ?? null,
        color: user?.avatarColor ?? "navy",
        roleLabel: roleLabel(role ?? ""),
      }}
      notifications={notifications}
      onMarkRead={(ids) => {
        void s.markNotificationsRead(ids);
      }}
      /*
       * ⚠ A LOAD FAILURE IS SHOWN, NOT SWALLOWED. The module reads its tables
       *   in one Promise.all, so a single failing query empties every screen at
       *   once — no tickets, no categories, and step owners that never arrive, so
       *   even the person who owns the desk is told she has no queue. That is
       *   indistinguishable from "nobody has raised anything yet" unless the page
       *   says so. It happened to L&D on 22-09-2026: one query ordered by a column
       *   its table did not have.
       *
       *   A BANNER, not a replacement screen — the nav still works, so the reader
       *   can go somewhere else instead of being stranded.
       */
      banner={
        s.error ? (
          <div className="rounded-xl border border-[#FDA29B] bg-[#FEF3F2] px-4 py-3">
            <p className="text-[13.5px] font-semibold text-[#B42318]">
              Help Desk could not load its data
            </p>
            <p className="mt-0.5 text-[12.5px] text-[#B42318]">{s.error}</p>
            <p className="mt-0.5 text-[12px] text-grey-2">
              Nothing below is missing. The page could not read it. Tell IT what this says.
            </p>
          </div>
        ) : undefined
      }
    />
  );
}
