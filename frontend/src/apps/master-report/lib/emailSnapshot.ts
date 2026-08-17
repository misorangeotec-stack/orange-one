/**
 * emailSnapshot.ts — mail today's snapshot now, with the PDF attached.
 *
 * THE ROUTE THE BYTES TAKE (identical to receivables-hub/lib/reportEmail.ts,
 * which this is modelled on):
 *   browser builds the PDF
 *     -> uploads it to storage `report-exports/<uid>/<batch>/`
 *     -> calls rpc queue_master_report_email(...) which inserts an email_outbox row
 *     -> an AFTER INSERT trigger pings the send-email Edge Function
 *     -> that function downloads the file with the service role and attaches it.
 *
 * WHY NOT POST THE FILE STRAIGHT TO THE FUNCTION
 *   `send-email` is deployed --no-verify-jwt and gated by a shared dispatch
 *   secret, so the browser must never call it — holding that secret client-side
 *   would let anyone send mail as the company. And `email_outbox` has RLS on with
 *   no policies, so a client cannot insert either. The SECURITY DEFINER RPC is
 *   the only door, and it re-checks module access, the email switch, and that
 *   every attachment path belongs to the caller.
 *
 * ⚠ THE NUMBERS ARE NOT SENT FROM HERE. The RPC takes its own snapshot
 *   server-side; this only chooses the recipient and supplies the rendered PDF.
 *   A client cannot mail a director fabricated counts.
 */

import { supabase } from "@/core/platform/supabase";

export const REPORT_EXPORTS_BUCKET = "report-exports";
/** Matches email_module_settings.module_id, which is the app's manifest id. */
export const MASTER_REPORT_EMAIL_MODULE = "master-report";

export interface SnapshotRecipient {
  email: string;
  name?: string;
}

const storageSafe = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_");

/**
 * Upload the PDF once and queue one mail per recipient.
 *
 * Returns the queued outbox ids. Throws with a readable message on the first
 * failure. Partial success is possible and is reported as such rather than
 * rolled back: a queued mail has already been handed to the sender.
 */
export async function emailSnapshot(input: {
  recipients: SnapshotRecipient[];
  subject?: string;
  body?: string;
  pdf?: { blob: Blob; filename: string };
}): Promise<string[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("You are not signed in.");
  if (!input.recipients.length) throw new Error("Add at least one recipient.");

  const attachments: { path: string; filename: string; mime: string }[] = [];

  if (input.pdf) {
    // One folder per send, so a retry never collides with the previous attempt
    // and the per-user prefix the storage policy enforces stays the first segment.
    const path = `${uid}/${crypto.randomUUID()}/${storageSafe(input.pdf.filename)}`;
    const { error } = await supabase.storage
      .from(REPORT_EXPORTS_BUCKET)
      .upload(path, input.pdf.blob, { contentType: "application/pdf", upsert: false });
    if (error) throw new Error(`Could not upload the PDF: ${error.message}`);
    attachments.push({ path, filename: input.pdf.filename, mime: "application/pdf" });
  }

  const ids: string[] = [];
  for (const r of input.recipients) {
    const { data, error } = await supabase.rpc("queue_master_report_email", {
      p_to_email: r.email,
      p_to_name: r.name ?? null,
      p_subject: input.subject ?? null,
      p_body: input.body ?? null,
      p_attachments: attachments,
    });
    // The RPC raises a plain sentence for the cases a user can act on (not
    // signed in, no access, module switched off), so pass it through unwrapped.
    if (error) throw new Error(error.message);
    if (typeof data === "string") ids.push(data);
  }
  return ids;
}

/** Read the module switch so the UI can explain an inert Email action up front. */
export async function fetchMasterReportEmailEnabled(): Promise<boolean> {
  const { data, error } = await supabase
    .from("email_module_settings")
    .select("enabled")
    .eq("module_id", MASTER_REPORT_EMAIL_MODULE)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.enabled ?? false;
}

/** Admin-only write, via the existing SECURITY DEFINER RPC (it re-checks is_admin). */
export async function setMasterReportEmailEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_email_module_enabled", {
    p_module: MASTER_REPORT_EMAIL_MODULE,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}
