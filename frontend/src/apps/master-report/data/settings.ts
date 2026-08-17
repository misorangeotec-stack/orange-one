/**
 * Master Report settings — read directly under RLS, written only through the
 * SECURITY DEFINER RPCs, which re-check is_admin server-side.
 *
 * Same shape as apps/task-management/data/emailSettings.ts: the read is a plain
 * select any signed-in user may do (the page needs the labels), and every write
 * is an RPC so the admin gate is an access control rather than a hidden button.
 */

import { supabase } from "@/core/platform/supabase";

export interface MasterReportSettings {
  enabled: boolean;
  sendHourIst: number;
  dormantAfterDays: number;
  /** null = every enabled module. */
  includeModules: string[] | null;
}

export interface MasterReportRecipient {
  id: string;
  email: string;
  name: string | null;
  enabled: boolean;
  /**
   * The portal user this recipient is, when they are one. Set it and the daily
   * send reads their LIVE address from `profiles`, so an address changed in
   * Admin → Users follows through here instead of leaving this list quietly
   * mailing the old one. Null = an external address that is not a user.
   */
  userId: string | null;
}

export interface MasterReportModuleRow {
  appId: string;
  label: string;
  enabled: boolean;
  sortOrder: number;
}

export async function fetchMasterReportSettings(): Promise<MasterReportSettings> {
  const { data, error } = await supabase
    .from("master_report_settings")
    .select("enabled, send_hour_ist, dormant_after_days, include_modules")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    enabled: data?.enabled ?? false,
    sendHourIst: data?.send_hour_ist ?? 8,
    dormantAfterDays: data?.dormant_after_days ?? 7,
    includeModules: data?.include_modules ?? null,
  };
}

/**
 * What is ACTUALLY installed as the cron job, as opposed to what is stored in
 * settings.
 *
 * WHY THIS READ EXISTS AT ALL
 *   `send_hour_ist` used to be written by the admin screen, read back by the
 *   admin screen, and printed to the admin — while the cron job stayed pinned
 *   to a hard-coded 02:30 UTC. The screen only ever echoed its own input, so a
 *   setting that moved nothing looked exactly like one that worked. Showing the
 *   live job is what makes that class of drift visible instead of silent.
 */
export interface MasterReportSchedule {
  scheduled: boolean;
  /** Raw UTC cron expression, e.g. "30 2 * * *". */
  cron: string | null;
  active: boolean;
  /** Decoded back to IST. Null if the expression is not a plain daily one. */
  hourIst: number | null;
}

export async function fetchMasterReportSchedule(): Promise<MasterReportSchedule> {
  const { data, error } = await supabase.rpc("master_report_schedule_info");
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    scheduled: d.scheduled === true,
    cron: typeof d.cron === "string" ? d.cron : null,
    active: d.active === true,
    hourIst: typeof d.hour_ist === "number" ? d.hour_ist : null,
  };
}

export async function fetchMasterReportRecipients(): Promise<MasterReportRecipient[]> {
  const { data, error } = await supabase
    .from("master_report_recipients")
    .select("id, email, name, enabled, user_id")
    .order("email");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id, email: r.email, name: r.name, enabled: r.enabled, userId: r.user_id,
  }));
}

export async function fetchMasterReportModules(): Promise<MasterReportModuleRow[]> {
  const { data, error } = await supabase
    .from("master_report_modules")
    .select("app_id, label, enabled, sort_order")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({
    appId: m.app_id,
    label: m.label,
    enabled: m.enabled,
    sortOrder: m.sort_order,
  }));
}

export async function saveMasterReportSettings(patch: {
  enabled?: boolean;
  sendHourIst?: number;
  dormantAfterDays?: number;
  /** Pass null to go back to "every module"; that needs its own flag server-side. */
  includeModules?: string[] | null;
}): Promise<void> {
  const clearInclude = patch.includeModules === null;
  const { error } = await supabase.rpc("set_master_report_settings", {
    p_enabled: patch.enabled ?? null,
    p_send_hour_ist: patch.sendHourIst ?? null,
    p_dormant_after_days: patch.dormantAfterDays ?? null,
    p_include_modules: clearInclude ? null : (patch.includeModules ?? null),
    p_clear_include: clearInclude,
  });
  if (error) throw new Error(error.message);
}

/** Whole-list replace — the screen edits a list, not a diff. */
export async function saveMasterReportRecipients(
  recipients: { email: string; name?: string | null; enabled?: boolean; userId?: string | null }[]
): Promise<void> {
  const { error } = await supabase.rpc("set_master_report_recipients", {
    // When user_id is set the server IGNORES the email and name posted here and
    // reads them from profiles — a client must not be able to point a named
    // person's row at a different mailbox.
    p_recipients: recipients.map((r) => ({
      email: r.email,
      name: r.name ?? null,
      enabled: r.enabled ?? true,
      user_id: r.userId ?? null,
    })),
  });
  if (error) throw new Error(error.message);
}
