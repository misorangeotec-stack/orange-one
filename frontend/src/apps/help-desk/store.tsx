import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople, type OrgPerson } from "@/core/platform/orgPeople";
import type { Department, Profile } from "@/core/platform/types";
import { fetchHelpData, helpQueryKey, HELP_QK, type HelpData } from "./data/helpFetch";
import { markNotificationsRead as markRead } from "./data/helpWrites";
import { openEntries, stepOwedBy, ticketDueIso, type HelpQueueEntry } from "./lib/queues";
import { QUEUE_STEPS, type StepKey } from "./lib/steps";
import type { HelpNotification, Ticket, TicketCategory } from "./types";

/**
 * The Help Desk store: one react-query snapshot of the module, plus the
 * capability flags every screen and the sidebar read.
 *
 * ⚠ THE MODULE IS UNIVERSAL, SO "CAN OPEN IT" IS NOT A PERMISSION HERE.
 *   Every signed-in employee loads this store — anyone may need to ask HR
 *   something. What each person may SEE and DO is decided by the flags below
 *   and, authoritatively, by RLS and `fms_help_can_act`. A plain employee gets
 *   their own tickets and the full category list, and that is correct, not a
 *   failure (see the ⚠ in data/helpFetch.ts).
 *
 * ⚠ AND `module_can_edit` IS NOT CONSULTED ANYWHERE, in this file or in SQL.
 *   A universal module has no `app_access` rows, so that check is false for
 *   every non-admin and would lock all 70 people out of a module the launcher is
 *   showing them. See the ⚠⚠ block in the HD-1 foundations migration.
 */

interface HelpStoreValue {
  loading: boolean;
  error: string | null;

  data: HelpData | null;
  tickets: Ticket[];
  categories: TicketCategory[];
  /** Active categories only, in display order — what the raise form offers. */
  raisableCategories: TicketCategory[];
  categoryById: (id: string | null) => TicketCategory | undefined;
  notifications: HelpNotification[];

  userId: string | null;
  isAdmin: boolean;

  profiles: Profile[];
  orgDepartments: Department[];
  orgPeople: OrgPerson[];
  /**
   * A person's NAME, for display.
   *
   * ⚠ USE THIS, NOT `profileById(id)?.name`. `profiles` is RLS-scoped — a reader
   *   sees themselves, their own downline and (for admins) everyone — so a
   *   colleague in another department resolves to nothing and the cell renders
   *   "—". L&D's request list showed exactly that for "Raised by" on every row
   *   until 22-09-2026. The org-wide name-only list is the backup.
   */
  personName: (id: string | null) => string;
  departmentName: (id: string | null) => string;

  /** Tickets this person raised, newest first. Everyone has this. */
  myTickets: Ticket[];
  /** Every open work-item the reader can see, one per ticket. */
  queueEntries: HelpQueueEntry[];
  /** The open work-items owed by the signed-in person. */
  myQueueEntries: HelpQueueEntry[];

  /** Due date for one step of one ticket — the module's single answer. */
  dueIsoFor: (t: Ticket, step: StepKey) => string | null;

  /** Is this person on the desk at all (owns a category, a step, or coordinates)? */
  isDeskStaff: boolean;
  canRaise: boolean;
  canSeeQueue: (step: StepKey) => boolean;
  /** `canSeeQueue` plus "there is something in it, or you own the step outright". */
  offersQueue: (step: StepKey) => boolean;
  canManageMasters: boolean;
  canSetup: boolean;

  /**
   * May this person act on this step of this ticket?
   *
   * ⚠ MIRRORS `fms_help_can_act` IN SQL, AND MUST BE KEPT IN STEP WITH IT.
   *   This decides whether a BUTTON is shown; the RPC decides whether the write
   *   happens. When they disagree the button is either missing (work nobody can
   *   do) or dead (a click that errors). The SQL is the authority.
   */
  canActOn: (step: StepKey, t: Ticket) => boolean;

  /**
   * May this person be HANDED a ticket? Mirrors `fms_help_can_receive`: the
   * configured reassign pool, OR anybody who already owns a category.
   *
   * ⚠ THE CATEGORY-OWNER ARM IS WHAT KEEPS REASSIGN USABLE. `reassign_pool`
   *   installs empty, so the pool alone would make the picker offer nobody —
   *   and the only other safe default would be "every profile", which is why
   *   the Import module's first Reassign was removed.
   */
  canReceive: (userId: string) => boolean;
  markNotificationsRead: (ids: string[]) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<HelpStoreValue | null>(null);

export function HelpStoreProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useSession();
  const dir = useDirectory();
  const qc = useQueryClient();
  const userId = user?.id ?? null;

  const q = useQuery({
    queryKey: helpQueryKey(userId),
    queryFn: fetchHelpData,
    enabled: !!userId,
  });

  const orgQ = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60 * 1000,
  });

  const value = useMemo<HelpStoreValue>(() => {
    const data = q.data ?? null;
    const tickets = data?.tickets ?? [];
    const categories = data?.categories ?? [];

    const catMap = new Map(categories.map((c) => [c.id, c]));
    const categoryById = (id: string | null) => (id ? catMap.get(id) : undefined);

    const orgPeople = orgQ.data ?? [];
    const orgNameById = new Map(orgPeople.map((p) => [p.id, p.name]));
    const profiles = dir.profiles ?? [];
    const profileNameById = new Map(profiles.map((p) => [p.id, p.name]));
    const personName = (id: string | null): string =>
      (id && (profileNameById.get(id) ?? orgNameById.get(id))) || "—";
    const departmentName = (id: string | null): string =>
      (id && (dir.departments ?? []).find((d) => d.id === id)?.name) || "—";

    const ownsStep = (step: StepKey): boolean =>
      !!userId && !!data?.stepOwners.find((o) => o.stepKey === step)?.employeeIds.includes(userId);

    const isCoordinator = isAdmin || (!!userId && (data?.coordinatorIds ?? []).includes(userId));
    const ownsAnyCategory = !!userId && categories.some((c) => c.ownerIds.includes(userId));
    const ownsAnyStep = QUEUE_STEPS.some(ownsStep);
    const isDeskStaff = isAdmin || isCoordinator || ownsAnyCategory || ownsAnyStep;

    // ⚠ No owners on `raise` => ANYBODY may raise, which is what decision D2
    //   asks for. Owners set => only them, plus admins and coordinators. The
    //   RPC enforces the same rule; this only decides whether the button shows.
    const raiseOwners = data?.stepOwners.find((o) => o.stepKey === "raise")?.employeeIds ?? [];
    const canRaise =
      !userId ? false
      : raiseOwners.length === 0 ? true
      : raiseOwners.includes(userId) || isCoordinator;

    const queueEntries = openEntries(
      tickets,
      catMap,
      data?.config?.step_sla ?? null,
    );

    const myQueueEntries = userId
      ? queueEntries.filter((e) => e.ownerIds.includes(userId))
      : [];

    const myTickets = userId
      ? tickets
          .filter((t) => t.raisedBy === userId)
          .slice()
          .sort((a, b) => b.raisedAt.localeCompare(a.raisedAt))
      : [];

    const slaMap = data?.stepSla;
    const dueIsoFor = (t: Ticket, step: StepKey): string | null =>
      slaMap ? ticketDueIso(t, catMap.get(t.categoryId), slaMap, step) : null;

    const canSeeQueue = (step: StepKey): boolean => {
      if (!userId) return false;
      if (isAdmin || isCoordinator) return true;
      if (ownsStep(step)) return true;
      // The row-owned steps: you see the queue if any ticket currently owes it
      // to you. `confirm` and `awaiting_info` are how an ordinary employee gets
      // a queue at all — they are the two steps the DESK does not own.
      return queueEntries.some((e) => e.stepKey === step && e.ownerIds.includes(userId));
    };

    const offersQueue = (step: StepKey): boolean => {
      if (!canSeeQueue(step)) return false;
      // Somebody who owns the step in Setup keeps the link even when it is empty
      // — an empty queue they are responsible for is information. Somebody who
      // only has it because a ticket landed on them loses the link when it
      // clears, rather than keeping a permanently empty menu item.
      if (isAdmin || isCoordinator || ownsStep(step)) return true;
      return queueEntries.some((e) => e.stepKey === step && e.ownerIds.includes(userId!));
    };

    const canActOn = (step: StepKey, t: Ticket): boolean => {
      if (!userId) return false;
      if (t.status === "closed" || t.status === "cancelled") return false;
      if (isAdmin || isCoordinator) return true;
      if (ownsStep(step)) return true;
      // ⚠ `confirm` is the RAISER's alone — never the desk's. The desk says
      //   "resolved", the employee says "satisfied"; letting one person supply
      //   both is how a CSAT score stops meaning anything. Mirrored in SQL.
      return stepOwedBy(t, catMap.get(t.categoryId), step).includes(userId);
    };

    return {
      loading: q.isLoading,
      error: q.error ? (q.error as Error).message : null,
      data,
      tickets,
      categories,
      raisableCategories: categories.filter((c) => c.active),
      categoryById,
      notifications: data?.notifications ?? [],
      userId,
      isAdmin,
      profiles,
      orgDepartments: dir.departments ?? [],
      orgPeople,
      personName,
      departmentName,
      myTickets,
      queueEntries,
      myQueueEntries,
      dueIsoFor,
      isDeskStaff,
      canRaise,
      canSeeQueue,
      offersQueue,
      canManageMasters:
        isCoordinator || (!!userId && (data?.masterOwnerIds ?? []).includes(userId)),
      canSetup: isAdmin,
      canActOn,
      canReceive: (id: string) =>
        (data?.reassignPoolIds ?? []).includes(id) ||
        categories.some((c) => c.ownerIds.includes(id)),
      markNotificationsRead: async (ids: string[]) => {
        if (!ids.length) return;
        await markRead(ids);
        await qc.invalidateQueries({ queryKey: HELP_QK });
      },
      refresh: async () => {
        await qc.invalidateQueries({ queryKey: HELP_QK });
      },
    };
  }, [q.data, q.isLoading, q.error, orgQ.data, dir, userId, isAdmin, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHelpStore(): HelpStoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHelpStore must be used inside HelpStoreProvider");
  return v;
}
