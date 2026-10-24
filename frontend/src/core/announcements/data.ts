/**
 * PF-18 · Announcements — the one data module the strip, the history page and the
 * posting app all read through.
 *
 * Every rule lives in the database (20261130120000_pf18_announcements.sql): who is in
 * the audience, that a customer never is, who may post, and that email is refused
 * while its switch is off. Nothing here re-decides any of that; it only calls the
 * functions and gives their jsonb a shape.
 *
 * Query keys all start with ANNOUNCEMENTS_QK and carry the viewer's id, so a second
 * person signing in on the same tab can never be shown the first one's strip.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";

/** The history page, open to every member of staff with no grant. */
export { ANNOUNCEMENTS_PATH } from "@/shared/components/layout/types";

export const ANNOUNCEMENTS_QK = ["announcements"] as const;

export type AnnouncementStatus = "running" | "ended" | "expired";

export const STATUS_LABEL: Record<AnnouncementStatus, string> = {
  running: "Running",
  ended: "Ended early",
  expired: "Expired",
};

/** Running first, then the ones cut short, then the ones that ran their course. */
export const STATUS_ORDER: Record<AnnouncementStatus, number> = { running: 0, ended: 1, expired: 2 };

/** What the strip needs. */
export interface ActiveAnnouncement {
  id: string;
  title: string;
  body: string | null;
  link_url: string | null;
  starts_at: string;
  ends_at: string;
  /** The last day it shows (India), yyyy-mm-dd. */
  ends_on: string;
  created_at: string;
}

/** A row of the history page. The poster-only fields are null for everyone else. */
export interface HistoryAnnouncement extends ActiveAnnouncement {
  audience_modules: string[];
  ended_at: string | null;
  status: AnnouncementStatus;
  dismissed: boolean;
  posted_by: string | null;
  email_requested: boolean | null;
  emailed_at: string | null;
  emailed_count: number | null;
}

/** A row of the posting app's grid: every announcement, whoever it was for. */
export interface ManagedAnnouncement extends ActiveAnnouncement {
  audience_modules: string[];
  ended_at: string | null;
  ended_by: string | null;
  created_by: string | null;
  posted_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  status: AnnouncementStatus;
  email_requested: boolean;
  emailed_at: string | null;
  emailed_count: number | null;
  dismissed_count: number;
  /** The poster, or an admin. */
  can_edit: boolean;
}

export interface RecipientCount {
  shows_to: number;
  emails_to: number;
  email_enabled: boolean;
}

/**
 * Only http(s) links are ever rendered as links. The database refuses anything else
 * already; this is the second lock, so a row that somehow held `javascript:` could
 * still never become a clickable one.
 */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\/[^\s<>"']+$/i.test(url) ? url : null;
}

/** "All staff", or the modules it was narrowed to, by their display names. */
export function audienceLabel(modules: string[] | null | undefined): string {
  if (!modules || modules.length === 0) return "All staff";
  return modules.map(appName).sort((a, b) => a.localeCompare(b)).join(", ");
}

/** Today's date in India, yyyy-mm-dd — the day an end date is measured from. */
export function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** yyyy-mm-dd plus n days, without the local timezone ever touching it. */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** yyyy-mm-dd → dd-mm-yyyy, the portal's one date format. */
export function dmy(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
}

async function rpcJson<T>(fn: "announcements_active" | "announcements_history" | "announcements_manage"): Promise<T> {
  const { data, error } = await supabase.rpc(fn);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as T;
}

// ── The strip ────────────────────────────────────────────────────────────────

/**
 * What is running for the signed-in person right now, newest first.
 *
 * One small RPC. Fresh for five minutes, re-read when the window regains focus and
 * every fifteen minutes while the tab is in front — a new announcement reaches an
 * open screen without the strip polling hard. A customer is never asked: the
 * database would answer [] anyway, but there is no reason to spend the call.
 */
export function useActiveAnnouncements() {
  const { user, isExternal } = useSession();
  const uid = user?.id ?? null;
  return useQuery({
    queryKey: [...ANNOUNCEMENTS_QK, "active", uid],
    queryFn: () => rpcJson<ActiveAnnouncement[]>("announcements_active"),
    enabled: !!uid && !isExternal,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 15 * 60_000,
    // A strip that failed to load simply does not show; it must never cost a page.
    retry: 1,
  });
}

/**
 * ✕ — close it for me. Optimistic: it leaves the strip at once, and comes back only
 * if the database refuses.
 */
export function useDismissAnnouncement() {
  const qc = useQueryClient();
  const { user } = useSession();
  const key = [...ANNOUNCEMENTS_QK, "active", user?.id ?? null];
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("announcement_dismiss", { p_id: id });
      if (error) throw new Error(error.message);
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<ActiveAnnouncement[]>(key);
      qc.setQueryData<ActiveAnnouncement[]>(key, (rows) => (rows ?? []).filter((r) => r.id !== id));
      return { before };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ANNOUNCEMENTS_QK }),
  });
}

// ── The history page ─────────────────────────────────────────────────────────

export function useAnnouncementHistory() {
  const { user } = useSession();
  return useQuery({
    queryKey: [...ANNOUNCEMENTS_QK, "history", user?.id ?? null],
    queryFn: () => rpcJson<HistoryAnnouncement[]>("announcements_history"),
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}

// ── The posting app ──────────────────────────────────────────────────────────

export function useManagedAnnouncements(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: [...ANNOUNCEMENTS_QK, "manage", user?.id ?? null],
    queryFn: () => rpcJson<ManagedAnnouncement[]>("announcements_manage"),
    enabled: enabled && !!user?.id,
    staleTime: 30_000,
  });
}

/** The composer's live numbers. An empty module list means all staff. */
export function useRecipientCount(modules: string[], enabled: boolean) {
  const { user } = useSession();
  const sorted = [...modules].sort();
  return useQuery({
    queryKey: [...ANNOUNCEMENTS_QK, "count", user?.id ?? null, sorted.join(",")],
    queryFn: async (): Promise<RecipientCount> => {
      const { data, error } = await supabase.rpc("announcement_recipient_count", { p_modules: sorted });
      if (error) throw new Error(error.message);
      return data as unknown as RecipientCount;
    },
    enabled: enabled && !!user?.id,
    staleTime: 30_000,
  });
}

export interface PublishInput {
  title: string;
  body: string;
  link: string;
  endsOn: string;
  modules: string[];
  email: boolean;
}

export function usePublishAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: PublishInput): Promise<{ id: string; emailed_count: number }> => {
      const { data, error } = await supabase.rpc("announcement_publish", {
        p_title: v.title,
        p_body: v.body.trim() || null,
        p_link: v.link.trim() || null,
        p_ends_on: v.endsOn,
        p_modules: v.modules,
        p_email: v.email,
      });
      if (error) throw new Error(error.message);
      return data as unknown as { id: string; emailed_count: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ANNOUNCEMENTS_QK }),
  });
}

export interface UpdateInput {
  id: string;
  title: string;
  body: string;
  link: string;
  endsOn: string | null;
}

export function useUpdateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: UpdateInput) => {
      const { error } = await supabase.rpc("announcement_update", {
        p_id: v.id,
        p_title: v.title,
        p_body: v.body.trim() || null,
        p_link: v.link.trim() || null,
        p_ends_on: v.endsOn,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ANNOUNCEMENTS_QK }),
  });
}

export function useEndAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("announcement_end", { p_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ANNOUNCEMENTS_QK }),
  });
}
