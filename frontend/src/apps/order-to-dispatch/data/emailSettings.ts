import { supabase } from "@/core/platform/supabase";

/**
 * Per-module email on/off switch for Order to Dispatch (module id
 * "order-to-dispatch"), backed by public.email_module_settings via the
 * admin-checked set_email_module_enabled RPC. The server-side
 * fms_dispatch_announce enqueue only fires when this is on.
 *
 * NOTE this gates INTERNAL step alerts only. The customer auto-mail has a SECOND
 * switch (`fms_dispatch_config.customer_mail`, edited in Setup → Customer Mail),
 * because it sends outside the company and must be arm-able independently.
 */
export const ORDER_TO_DISPATCH_MODULE_ID = "order-to-dispatch";

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
