import { supabase } from "@/core/platform/supabase";

/**
 * Per-module email on/off switch for Employee Exit (module id "hr-exit"), backed
 * by public.email_module_settings via the admin-checked set_email_module_enabled
 * RPC.
 *
 * Scope note: the server-side fms_exit_announce enqueue only fires for MASTER
 * REQUEST events (migration 20260814120100), so this switch governs master-data
 * governance mail and nothing else.
 */
export const EXIT_MODULE_ID = "hr-exit";

export async function fetchEmailModuleEnabled(moduleId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("email_module_settings")
    .select("enabled")
    .eq("module_id", moduleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.enabled ?? false;
}

export async function setEmailModuleEnabled(moduleId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_email_module_enabled", {
    p_module: moduleId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}
