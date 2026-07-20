import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import SamplingApp from "./SamplingApp";

/**
 * Manifest for the Sampling FMS — the sixth FMS module (ink / raw-material
 * sampling), built on the same engine pattern as the other FMS apps (step owners,
 * planned-vs-actual due dates, per-owner queues, notifications, master governance)
 * with its own `fms_sampling_*` schema.
 *
 * A lab-sampling tracker: raise a request → the sample is received (inward) or
 * sent + confirmed (outward) → it is tested → a result is recorded → it closes.
 * NO approval, NO PO, NO quotations.
 *
 * It is a PER-USER-GRANTED app (not universal) — like Import, an admin switches it
 * on for the sampling team. The nav and RLS scope what each person sees.
 */
export const samplingApp: AppManifest = {
  id: "sampling",
  name: appName("sampling"),
  description:
    "Ink / raw-material sampling end to end: raise a request, receive or send-and-confirm the sample, record testing and the result, and close.",
  basePath: appBasePath("sampling"),
  status: "live",
  category: appCategory("sampling"),
  subGroup: appSubGroup("sampling"),
  order: 40,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6" />
      <path d="M10 3v6.5L5.2 17.4A2 2 0 0 0 7 20.5h10a2 2 0 0 0 1.8-3.1L14 9.5V3" />
      <path d="M7.5 14h9" stroke="#FF6A1F" />
    </svg>
  ),
  Component: SamplingApp,
};
