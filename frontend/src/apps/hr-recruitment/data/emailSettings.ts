import { supabase } from "@/core/platform/supabase";

/**
 * Per-module email on/off switch for New Recruitment (module id "hr-recruitment"),
 * backed by public.email_module_settings via the admin-checked
 * set_email_module_enabled RPC.
 *
 * Scope note: unlike the purchase-family apps, the server-side fms_hr_announce
 * enqueue only fires for MASTER REQUEST events (migration 20260814120000), so
 * this switch governs master-data governance mail and nothing else.
 */
export const HR_MODULE_ID = "hr-recruitment";

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
