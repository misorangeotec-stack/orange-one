/**
 * Personal daily snapshot — settings, live schedule, preview and test send.
 *
 * Same shape as apps/master-report/data/settings.ts: reads are plain selects any
 * signed-in user may do, every write is a SECURITY DEFINER RPC that re-checks
 * `is_admin` server-side, so the admin gate is access control rather than a
 * hidden button.
 *
 * ⚠ THE FIGURES DO NOT COME FROM SQL. My Work Today derives every FMS due date
 *   in TypeScript from working-day SLAs and stores none of them, so a cron job
 *   cannot reproduce the screen. `previewUserSnapshot` calls the `work-snapshot`
 *   edge function, which runs the app's real queue code server-side against the
 *   same rules — see supabase/worksnapshot/. That is why this file talks to a
 *   function instead of a view.
 */

import { supabase } from "@/core/platform/supabase";

export interface UserSnapshotSettings {
  enabled: boolean;
  sendHourIst: number;
  /** Don't mail someone whose plate is empty. On by default. */
  skipWhenEmpty: boolean;
  /** null = everyone with a login. Otherwise only these users. */
  includeUsers: string[] | null;
}

/** What cron actually holds, as opposed to what the settings table wishes. */
export interface UserSnapshotSchedule {
  jobName: string | null;
  /** Raw cron expression, in UTC. */
  schedule: string | null;
  active: boolean;
  hourIst: number | null;
}

/** One module's line, exactly as the mail and My Work Today both show it. */
export interface SnapshotSource {
  key: string;
  appId: string;
  module: string;
  items: number;
  overdue: number;
  dueToday: number;
  next2: number;
  noDate: number;
}

export interface UserSnapshotPreview {
  forDate: string;
  userName: string;
  totalItems: number;
  tiles: { overdue: number; dueToday: number; next2: number; noDate: number };
  sources: SnapshotSource[];
  /** Modules they hold that the server cannot count yet. Shown, never hidden. */
  uncounted: { appId: string; label: string }[];
  /**
   * SQL's own Task Management count, computed independently of the queue code.
   * If it ever disagrees with the "Task Management" source row, one of the two
   * filters has drifted and the report is lying — so it is surfaced, not hidden.
   */
  tasksSql: { open: number; overdue: number } | null;
}

export async function fetchUserSnapshotSettings(): Promise<UserSnapshotSettings> {
  const { data, error } = await supabase
    .from("user_snapshot_settings")
    .select("enabled, send_hour_ist, skip_when_empty, include_users")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    enabled: data?.enabled ?? false,
    sendHourIst: data?.send_hour_ist ?? 9,
    skipWhenEmpty: data?.skip_when_empty ?? true,
    includeUsers: data?.include_users ?? null,
  };
}

/**
 * Read the installed cron job back rather than echoing the input.
 *
 * The Master Report shipped an hour picker that wrote to the database and moved
 * nothing — the job was hard-coded — and it went unnoticed for weeks because
 * saving looked like it worked. Reading the job is what makes that impossible
 * to repeat quietly.
 */
export async function fetchUserSnapshotSchedule(): Promise<UserSnapshotSchedule> {
  const { data, error } = await supabase.rpc("user_snapshot_schedule_info");
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    jobName: (row.jobname as string) ?? null,
    schedule: (row.schedule as string) ?? null,
    active: row.active === true,
    hourIst: typeof row.hour_ist === "number" ? row.hour_ist : null,
  };
}

export async function saveUserSnapshotSettings(s: {
  enabled: boolean;
  sendHourIst: number;
  skipWhenEmpty: boolean;
  includeUsers: string[] | null;
}): Promise<void> {
  const { error } = await supabase.rpc("set_user_snapshot_settings", {
    p_enabled: s.enabled,
    p_send_hour_ist: s.sendHourIst,
    p_skip_when_empty: s.skipWhenEmpty,
    p_include_users: s.includeUsers,
    // Null means "everyone", and `coalesce(p_include_users, include_users)`
    // cannot express that — passing null just keeps the old list. Hence an
    // explicit flag rather than a magic value.
    p_clear_include: s.includeUsers === null,
  });
  if (error) throw new Error(error.message);
}

/** The per-module gate every app in this portal has. Ships OFF. */
export async function fetchUserSnapshotEmailEnabled(): Promise<boolean> {
  const { data, error } = await supabase
    .from("email_module_settings")
    .select("enabled")
    .eq("module_id", "user-snapshot")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.enabled ?? false;
}

export async function setUserSnapshotEmailEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_email_module_enabled", {
    p_module: "user-snapshot",
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}

/**
 * What one person's snapshot says right now — and optionally mail a copy of it
 * to `sendTo`.
 *
 * Goes to the edge function with the caller's own JWT; it enforces admin-or-self
 * itself. `sendTo` only changes the envelope: the CONTENT is still that person's
 * work, which is why the same check gates both.
 */
export async function previewUserSnapshot(
  userId: string,
  sendTo?: string | null,
): Promise<UserSnapshotPreview> {
  const { data, error } = await supabase.functions.invoke("work-snapshot", {
    body: { userId, ...(sendTo ? { sendTo } : {}) },
  });
  if (error) throw new Error(error.message);

  const snap = ((data ?? {}) as Record<string, unknown>).snapshot as Record<string, unknown>;
  if (!snap) throw new Error("work-snapshot returned nothing");

  const tiles = (snap.tiles ?? {}) as Record<string, number>;
  const tasksSql = (snap.tasks_sql ?? null) as Record<string, number> | null;
  return {
    forDate: String(snap.for_date ?? ""),
    userName: String(((snap.user ?? {}) as Record<string, unknown>).name ?? ""),
    totalItems: Number(snap.total_items ?? 0),
    tiles: {
      overdue: Number(tiles.overdue ?? 0),
      dueToday: Number(tiles.dueToday ?? 0),
      next2: Number(tiles.next2 ?? 0),
      noDate: Number(tiles.noDate ?? 0),
    },
    sources: (Array.isArray(snap.sources) ? snap.sources : []) as SnapshotSource[],
    uncounted: (Array.isArray(snap.uncounted) ? snap.uncounted : []) as {
      appId: string;
      label: string;
    }[],
    tasksSql: tasksSql
      ? { open: Number(tasksSql.open ?? 0), overdue: Number(tasksSql.overdue ?? 0) }
      : null,
  };
}
