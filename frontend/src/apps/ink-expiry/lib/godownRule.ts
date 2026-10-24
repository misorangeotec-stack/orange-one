import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { DEFAULT_GODOWN_RULE, type GodownRule } from "./expiry";

/**
 * Which godowns COUNT, per company — the one row of public.ink_expiry_settings
 * (migration 20270211120000), shared by everyone; admins change it from the dashboard.
 * Until the migration is on a database, or if the row can't be read, the page keeps the
 * standing rule (Enterprises Surat: FINISHED GOODS-SACHIN and HOJIWALA, as Ink IMS) rather
 * than counting everything.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const GODOWN_RULE_KEY = ["ink-expiry", "godown-rule"];

export function useGodownRule() {
  return useQuery({
    queryKey: GODOWN_RULE_KEY,
    queryFn: async (): Promise<GodownRule> => {
      const { data, error } = await db.from("ink_expiry_settings").select("counted_godowns").eq("id", 1).maybeSingle();
      if (error || !data) return DEFAULT_GODOWN_RULE;
      return (data.counted_godowns ?? DEFAULT_GODOWN_RULE) as GodownRule;
    },
    staleTime: 5 * 60_000,
  });
}

export async function saveGodownRule(rule: GodownRule, userId: string): Promise<void> {
  const { error } = await db.from("ink_expiry_settings")
    .update({ counted_godowns: rule, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(error.message);
}
