/**
 * The Deno stand-in for `@/core/platform/supabase`.
 *
 * WHY THIS FILE EXISTS
 *   Every FMS read layer (`apps/*​/data/*Fetch.ts`) opens with
 *   `import { supabase } from "@/core/platform/supabase"` and is otherwise pure
 *   PostgREST — paging, `.eq()`, `.in()`, `.gte()`. That single line is the only
 *   thing stopping those files running on a server: the real module reads
 *   `import.meta.env.VITE_*` and pokes `window`.
 *
 *   So the bundle build (build.mjs) aliases that specifier to THIS file. The
 *   fetchers are then compiled unchanged and run server-side, which is the whole
 *   point — the daily snapshot mail must count work the same way the screen does,
 *   and the only way to guarantee that is to run the same code, not a copy of it.
 *
 * ⚠ SERVICE ROLE, SO ROW-LEVEL SECURITY DOES NOT APPLY HERE.
 *   In the browser RLS narrows the data first and the provider's ownership filter
 *   narrows it again. Here only the ownership filter runs. That is safe for the
 *   counts because ownership is a subset of visibility — you can see what you own
 *   — and it is what makes one pass over the data serve every user instead of one
 *   fetch per person. It is NOT safe to hand this raw data to anyone: the caller
 *   (functions/work-snapshot) must only ever emit a user their own filtered rows.
 *
 * ⚠ TIMEZONE. Due dates are derived with `getFullYear/getMonth/getDate` on the
 *   host clock (shared/lib/workingDays.ts). Deno runs UTC unless told otherwise,
 *   and India is UTC+5:30, so without TZ=Asia/Kolkata everything due today reads
 *   as overdue between 00:00 and 05:30 IST. work-snapshot asserts it at boot.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!url || !serviceKey) {
  throw new Error("work-snapshot: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
}

export const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Some frontend modules import the client as a default. Cover both shapes. */
export default supabase;
