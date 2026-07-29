import { supabase } from "@/core/platform/supabase";

/**
 * Per-module email on/off switch for Asset Maintenance, backed by
 * public.email_module_settings via the admin-checked set_email_module_enabled
 * RPC. The server-side fms_asset_announce enqueue only fires when this is on.
 *
 * ⚠ This module needs email more than the others do. Elsewhere an alert says
 *   "your turn" to somebody already working in the portal; here the reminder IS
 *   the product, and a bell nobody logs in to see is exactly the failure the
 *   module was built to end. It still ships OFF, because the FIRST generator run
 *   after a bulk import can open hundreds of already-overdue jobs at once.
 */
export const ASSET_MAINTENANCE_MODULE_ID = "asset-maintenance";

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
