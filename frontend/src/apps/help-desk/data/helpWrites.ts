import { supabase } from "@/core/platform/supabase";
import type { RaiseInput } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

/**
 * Help Desk write layer. Every workflow write is a SECURITY DEFINER RPC — there
 * is no direct table write for anybody but an admin, so the workflow rules
 * cannot be walked around with a PATCH.
 */

/**
 * Raise one ticket.
 *
 * ⚠ ATTACHMENTS ARE UPLOADED FIRST, THEN PASSED AS PATHS. The storage policy
 *   (`fms help docs insert`) is what actually authorises the file — this RPC
 *   only records it. Upload before calling, so a refused file fails before a
 *   ticket number is burned.
 *
 * ⚠ A MENTION OF SOMEBODY WHO CANNOT SEE THE TICKET IS DROPPED BY THE SERVER,
 *   SILENTLY. Raising would let an author probe who can see what by watching
 *   which names error; notifying anyway would mail them a link to a page that
 *   hands them Access Denied. So fewer people can be notified than were named,
 *   and that is correct — do not "fix" it by reporting a count back to the form.
 */
export async function raiseTicket(input: RaiseInput): Promise<string> {
  const { data, error } = await db.rpc("fms_help_raise", {
    p_category: input.categoryId,
    p_subject: input.subject,
    p_body: input.body ?? null,
    p_other_note: input.otherNote ?? null,
    p_attachments: input.attachments ?? [],
    p_mentions: input.mentions ?? [],
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Upload one attachment and return its storage path.
 *
 * ⚠ THE PATH SHAPE IS LOAD-BEARING: `<ticket-id>/<slot>/<epoch>-<filename>`.
 *   The storage policy reads the ticket id out of the FIRST SEGMENT and the slot
 *   out of the second (`public.fms_help_doc_ticket` / `_doc_slot`), so a file
 *   can always name its own ticket and the rule is `fms_help_can_see` reused
 *   rather than restated. A path in any other shape resolves to NULL and is
 *   refused outright.
 *
 * ⚠ SLOTS ARE A CLOSED SET: raise | resolution | comment. Adding one here
 *   without adding it to `fms_help_doc_slot` means every upload to it is
 *   refused, and the error a user sees is a storage 403, not an explanation.
 */
export type DocSlot = "raise" | "resolution" | "comment";

export async function uploadHelpDoc(
  ticketId: string,
  slot: DocSlot,
  file: File,
): Promise<string> {
  // The filename is sanitised because it lands in a URL path. Spaces and
  // non-ASCII survive a signed URL badly and are impossible to debug later.
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
  const path = `${ticketId}/${slot}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage
    .from("fms-help-docs")
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}

/** A short-lived signed URL for one attachment. The bucket is private. */
export async function helpDocUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("fms-help-docs")
    .createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/**
 * Raising a ticket WITH attachments, in the order that survives a failure.
 *
 * ⚠ THE TICKET HAS TO EXIST BEFORE ITS FILES CAN, because the storage policy
 *   reads the owning ticket out of the path — so there is no way to upload
 *   first. The ticket is therefore created, then the files go up, then the paths
 *   are recorded on the timeline.
 *
 * ⚠ A FAILED UPLOAD DOES NOT DISCARD THE TICKET. The question has been asked and
 *   somebody owes an answer; throwing it away because a photo did not upload
 *   would lose the one thing that mattered. The caller is told which files
 *   failed so the employee can attach them again from the thread.
 */
export async function raiseTicketWithFiles(
  input: Omit<RaiseInput, "attachments">,
  files: File[],
): Promise<{ ticketId: string; failedFiles: string[] }> {
  const ticketId = await raiseTicket({ ...input, attachments: [] });
  if (!files.length) return { ticketId, failedFiles: [] };

  const attachments: { path: string; name: string }[] = [];
  const failedFiles: string[] = [];
  for (const f of files) {
    try {
      attachments.push({ path: await uploadHelpDoc(ticketId, "raise", f), name: f.name });
    } catch {
      failedFiles.push(f.name);
    }
  }

  if (attachments.length) {
    // Recorded on the timeline rather than on the ticket row: attachments arrive
    // at several points in a ticket's life and the timeline is the one place
    // that shows them in the order they were added.
    const { error } = await db.rpc("fms_help_announce", {
      p_entity_type: "ticket",
      p_entity_id: ticketId,
      p_type: "help_ticket_attachment",
      p_text: attachments.length === 1 ? "Attached a file" : `Attached ${attachments.length} files`,
      // Empty recipient list: the raise notification has already gone out, and
      // paging everybody a second time for the same event is noise.
      p_user_ids: [],
      p_meta: { attachments },
    });
    if (error) throw new Error(error.message);
  }

  return { ticketId, failedFiles };
}

/**
 * Mark notifications read.
 *
 * ⚠ A PLAIN TABLE UPDATE, NOT AN RPC, AND THAT IS DELIBERATE. It is the one
 *   write in this module that changes nothing about a ticket, and
 *   `fms_help_notifications_update_own` already limits it to the reader's own
 *   rows. Routing it through a definer function would need a second gate saying
 *   the same thing.
 *
 * ⚠ THE `user_id` FILTER IS NOT REDUNDANT. PostgREST refuses an unqualified
 *   write outright, and an update that matched somebody else's row would fail
 *   the policy silently — as zero rows changed, which reads like "already read".
 */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  const { error } = await supabase
    .from("fms_help_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .eq("user_id", uid)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}
