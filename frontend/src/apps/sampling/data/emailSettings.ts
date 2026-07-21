import { supabase } from "@/core/platform/supabase";

/**
 * Per-module email on/off switch for Sampling (module id "sampling"), backed by
 * public.email_module_settings via the admin-checked set_email_module_enabled
 * RPC. The server-side fms_sampling_announce enqueue only fires when this is on.
 */
export const SAMPLING_MODULE_ID = "sampling";

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
