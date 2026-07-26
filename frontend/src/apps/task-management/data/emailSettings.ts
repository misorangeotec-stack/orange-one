import { supabase } from "@/core/platform/supabase";

/**
 * Per-module email on/off switch (see migration 20260721150000). The server-side
 * enqueue in notify_task_assignee / add_task_remark only fires when the module's
 * row is enabled, so this toggle is the business gate above the delivery infra.
 * The same table keys every future FMS module by its manifest id.
 */
export const TASK_MODULE_ID = "task-management";

/** Read whether email is enabled for a module (defaults false if no row). */
export async function fetchEmailModuleEnabled(moduleId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("email_module_settings")
    .select("enabled")
    .eq("module_id", moduleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.enabled ?? false;
}

/** Admin-only write via the SECURITY DEFINER RPC (re-checks is_admin server-side). */
export async function setEmailModuleEnabled(moduleId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_email_module_enabled", {
    p_module: moduleId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}
