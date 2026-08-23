import { supabase } from "@/core/platform/supabase";

/**
 * The per-module email on/off switch for OCPI, backed by
 * `public.email_module_settings` via the admin-checked `set_email_module_enabled`
 * RPC.
 *
 * ⚠ THE SERVER IS THE GATE, NOT THIS FILE. `fms_ocpi_announce` reads
 *   `email_module_enabled('ocpi')` before it enqueues anything, so nothing here
 *   can cause a send and nothing here can prevent one. This is the switch's
 *   remote control; the switch is in the database.
 */
export const OCPI_MODULE_ID = "ocpi";

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
