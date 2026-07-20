import { supabase } from "@/core/platform/supabase";
import type { AiPayload } from "./exposureAnalytics";

/**
 * Client half of the `analyze-receivables` Edge Function — the AI Insights panel on the
 * Top-Exposure report's Analysis tab.
 *
 * Goes through the identity Supabase client so the caller's JWT rides along (the function
 * runs with verify_jwt = true). Never throws: a failed / not-yet-deployed function must
 * still leave the charts usable — the panel just shows the returned message.
 *
 * Mirrors the shape of hr-recruitment/data/parseResume.ts.
 */

export interface AiCallItem {
  customer: string;
  reason: string;
}

export interface ExposureInsights {
  summary: string;
  callList: AiCallItem[];
  patterns: string[];
  nextSteps: string[];
  model: string;
}

export type AnalyzeResult =
  | { ok: true; data: ExposureInsights }
  | { ok: false; reason: "unavailable" | "error"; message: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];

export async function analyzeExposure(payload: AiPayload): Promise<AnalyzeResult> {
  try {
    const { data, error } = await supabase.functions.invoke("analyze-receivables", {
      body: { payload },
    });

    if (error) {
      // functions.invoke turns any non-2xx into an error; the raw status lives on error.context.
      const status = (error as { context?: Response }).context?.status;
      // 404 = function not deployed yet; 500 = server missing the key — both "not available".
      if (status === 404 || status === 500) {
        return {
          ok: false,
          reason: "unavailable",
          message: "AI analysis isn't available yet — the analysis service hasn't been deployed. The charts above still work.",
        };
      }
      return { ok: false, reason: "error", message: "Couldn't generate the analysis. Please try again." };
    }

    const b = (data ?? {}) as Record<string, unknown>;
    const callList: AiCallItem[] = Array.isArray(b.callList)
      ? (b.callList as unknown[])
          .map((x) => {
            const o = (x ?? {}) as Record<string, unknown>;
            return { customer: str(o.customer), reason: str(o.reason) };
          })
          .filter((c) => c.customer || c.reason)
      : [];

    return {
      ok: true,
      data: {
        summary: str(b.summary),
        callList,
        patterns: strArr(b.patterns),
        nextSteps: strArr(b.nextSteps),
        model: str(b.model),
      },
    };
  } catch {
    return { ok: false, reason: "error", message: "Couldn't reach the analysis service. Please try again." };
  }
}
