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

/**
 * Step 5 — the process owner confirms they have the ticket.
 *
 * ⚠ NOT REQUIRED BEFORE RESOLVING. Half the tickets on this desk are answered in
 *   one go, and `resolveTicket` accepts a ticket that was never acknowledged,
 *   back-filling the stamp so the First Response Time report still counts it.
 *   This exists for the other half — the ones that will take a day, where
 *   "someone has picked this up" is the whole of what the employee needs to know
 *   right now.
 */
export async function acknowledgeTicket(ticketId: string, note?: string | null): Promise<void> {
  const { error } = await db.rpc("fms_help_acknowledge", {
    p_ticket: ticketId,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Step 7 — answer the ticket and hand it to the employee to confirm.
 *
 * ⚠ THE RESOLUTION TEXT IS MANDATORY, and the server refuses a blank one. It is
 *   the only record the employee gets of what was actually done, it is what they
 *   are being asked to accept, and it is the evidence the HR appraisal sheets
 *   call for. The form must not offer a way to skip it.
 */
export async function resolveTicket(
  ticketId: string,
  resolution: string,
  attachments: { path: string; name?: string }[] = [],
): Promise<void> {
  const { error } = await db.rpc("fms_help_resolve", {
    p_ticket: ticketId,
    p_resolution: resolution,
    p_attachments: attachments,
  });
  if (error) throw new Error(error.message);
}

/**
 * Resolve, with an attachment, in the order that survives a failure.
 *
 * ⚠ THE FILE GOES UP FIRST HERE — the opposite of raising a ticket. The ticket
 *   already exists, so the storage policy can resolve its path; and unlike a
 *   raise, a resolution whose evidence failed to attach is worth stopping for,
 *   because the owner can simply try again without anything having moved.
 */
export async function resolveTicketWithFile(
  ticketId: string,
  resolution: string,
  file: File | null,
): Promise<void> {
  const attachments: { path: string; name: string }[] = [];
  if (file) {
    attachments.push({ path: await uploadHelpDoc(ticketId, "resolution", file), name: file.name });
  }
  await resolveTicket(ticketId, resolution, attachments);
}

/**
 * One remark on the ticket.
 *
 * ⚠ ONLY A MENTION NOTIFIES, and the box must say so. Commenting should not page
 *   everybody on the ticket; naming somebody is the deliberate act.
 *
 * ⚠ GATED ON can_SEE, NOT can_ACT — the employee who raised it can chase it
 *   while it sits with HR, even though they own no step at that moment.
 */
export async function postComment(
  ticketId: string,
  text: string,
  mentions: string[] = [],
  attachments: { path: string; name?: string }[] = [],
): Promise<void> {
  const { error } = await db.rpc("fms_help_post_comment", {
    p_ticket: ticketId,
    p_text: text,
    p_mentions: mentions,
    p_attachments: attachments,
  });
  if (error) throw new Error(error.message);
}

/**
 * The desk asks a named person for something, and THE TICKET MOVES TO THEM.
 *
 * ⚠ THE MOVE IS THE POINT, not the message. While a ticket waits on somebody
 *   outside the desk it must not keep counting against the desk's turnaround —
 *   otherwise the SLA report measures how slowly employees answer their own
 *   questions.
 *
 * ⚠ ON A CONFIDENTIAL TICKET THIS GRANTS ACCESS. Asking anyone other than the
 *   raiser lets them read a grievance, POSH or disciplinary record. The server
 *   allows it — blocking it would stop an HR Head investigating — and writes an
 *   extra timeline entry naming who was let in. The caller MUST warn first.
 */
export async function requestInfo(
  ticketId: string,
  fromUserId: string,
  question: string,
  attachments: { path: string; name?: string }[] = [],
): Promise<void> {
  const { error } = await db.rpc("fms_help_request_info", {
    p_ticket: ticketId,
    p_from_user: fromUserId,
    p_question: question,
    p_attachments: attachments,
  });
  if (error) throw new Error(error.message);
}

/** The person who was asked answers, and the ticket returns to the desk. */
export async function answerInfo(
  ticketId: string,
  answer: string,
  attachments: { path: string; name?: string }[] = [],
): Promise<void> {
  const { error } = await db.rpc("fms_help_answer_info", {
    p_ticket: ticketId,
    p_answer: answer,
    p_attachments: attachments,
  });
  if (error) throw new Error(error.message);
}

/** Upload into the `comment` slot, for anything posted onto the thread. */
export async function uploadThreadFile(ticketId: string, file: File) {
  return { path: await uploadHelpDoc(ticketId, "comment", file), name: file.name };
}

/**
 * The employee accepts the answer, and the ticket closes.
 *
 * ⚠ THE RATING IS CAPTURED HERE AND NOWHERE ELSE. The PDF names CSAT as a KPI
 *   but gives it no step; one field on this action is the whole of it. An
 *   AUTO-CLOSED ticket therefore carries no rating at all, deliberately —
 *   inventing one would be inventing an opinion the employee never gave.
 */
export async function confirmTicket(
  ticketId: string,
  rating: number | null,
  note?: string | null,
): Promise<void> {
  const { error } = await db.rpc("fms_help_confirm", {
    p_ticket: ticketId,
    p_rating: rating,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * The employee is not satisfied. The ticket goes back to the same person AND
 * THE ESCALATION LADDER MOVES (decision D3):
 *
 *   reopen #1        → Escalation Level 1 is told, and joins the ticket
 *   reopen #2 and on → Escalation Level 2 as well
 *
 * ⚠ A REASON IS MANDATORY and the server refuses a blank one. A reopen is the
 *   one event that pulls other people in; it had better say why.
 */
export async function reopenTicket(ticketId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_help_reopen", {
    p_ticket: ticketId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/**
 * Hand a ticket to a different person. Right category, wrong person.
 *
 * ⚠ THE TAT AND THE ESCALATION LADDER DO NOT CHANGE — only who holds it. If
 *   the CATEGORY is wrong, `recategoriseTicket` is the other button, and it is a
 *   different repair.
 *
 * ⚠ THE TARGET MUST BE SET UP TO RECEIVE ONE: the configured reassign pool, or
 *   anybody who already owns a ticket category. Never "any profile" — the Import
 *   module's first Reassign was removed for exactly that.
 */
export async function reassignTicket(
  ticketId: string,
  toUserId: string,
  reason?: string | null,
): Promise<void> {
  const { error } = await db.rpc("fms_help_reassign", {
    p_ticket: ticketId,
    p_to_user: toUserId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Re-file a ticket under the right category.
 *
 * ⚠ THIS MOVES THE DEADLINE. The owner, the TAT and the escalation ladder all
 *   hang off the category, and nothing is stored — the due date is derived from
 *   the category's TAT at read time. So an attendance correction re-filed as a
 *   payroll query gains a day, and the reverse may be overdue the instant it is
 *   moved. The dialog shows the new date before the click.
 *
 * ⚠ REFUSED IN BOTH DIRECTIONS ON A CONFIDENTIAL CATEGORY. Into one, because
 *   the people who have already read it would stay able to; out of one, because
 *   it would hand a grievance's whole history to the HR pool in a single click.
 */
export async function recategoriseTicket(
  ticketId: string,
  categoryId: string,
  reason?: string | null,
): Promise<void> {
  const { error } = await db.rpc("fms_help_recategorise", {
    p_ticket: ticketId,
    p_category: categoryId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * D1: record that this ticket's work was started in the module that owns it.
 *
 * ⚠ THE REFERENCE IS VERIFIED BY THE SERVER, NOT TRUSTED. It is looked up in
 *   that module's own table and refused if it does not exist — a wrong one
 *   points the employee at something that is not there, and nobody ever checks.
 *   Case and surrounding spaces are forgiven, because people paste out of mail.
 */
export async function recordHandoff(
  ticketId: string,
  ref: string,
  note?: string | null,
): Promise<void> {
  const { error } = await db.rpc("fms_help_record_handoff", {
    p_ticket: ticketId,
    p_ref: ref,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Remove a reference recorded in error.
 *
 * ⚠ THIS EXISTS BECAUSE recordHandoff HAS NO OTHER WAY BACK. A stamp with no
 *   way to remove it is the FIX-4 trap — a control whose absence is invisible
 *   until somebody needs it. The timeline entry stays; only the pointer goes.
 */
export async function clearHandoff(ticketId: string, reason?: string | null): Promise<void> {
  const { error } = await db.rpc("fms_help_clear_handoff", {
    p_ticket: ticketId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Create or edit a ticket category.
 *
 * ⚠ A DIRECT TABLE WRITE, UNDER RLS — `fms_help_categories_write` limits it to
 *   `fms_help_is_master_manager`. That is the house pattern for a master: the
 *   workflow RPCs are definers because they enforce a SEQUENCE, and a master row
 *   has no sequence to enforce.
 *
 * ⚠ `code` AND `confidential` ARE NEVER SENT. The code is what every report
 *   matches on, so changing it would silently re-partition months of history;
 *   the confidential flag cannot be moved in either direction without either
 *   un-reading a ticket people have seen or exposing one they have not. Neither
 *   is offered by the form, and neither is written here even if it appeared in
 *   the bag.
 *
 * ⚠ AN EMPTY TAT IS `null`, NOT 0. Null means "governed by policy, no deadline";
 *   zero means "the same working day". Coalescing one to the other would give
 *   five categories a deadline nobody agreed to, POSH among them.
 */
export async function saveCategory(
  id: string | null,
  v: Record<string, string>,
  active = true,
): Promise<void> {
  const ids = (k: string) => (v[k] ? v[k].split(",").filter(Boolean) : []);
  const num = (k: string) => {
    const t = (v[k] ?? "").trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const row = {
    name: (v.name ?? "").trim(),
    owner_ids: ids("owner_ids"),
    tat_days: num("tat_days"),
    tat_text: (v.tat_text ?? "").trim() || null,
    escalation_l1_ids: ids("escalation_l1_ids"),
    escalation_l1_label: (v.escalation_l1_label ?? "").trim() || null,
    escalation_l2_ids: ids("escalation_l2_ids"),
    escalation_l2_label: (v.escalation_l2_label ?? "").trim() || null,
    handoff_app_id: (v.handoff_app_id ?? "").trim() || null,
    requires_note: v.requires_note === "yes",
    sort_order: num("sort_order") ?? 999,
    active,
  };

  if (id) {
    const { error } = await db.from("fms_help_categories").update(row).eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }

  // A new category needs a code, and it is derived rather than asked for: the
  // requester should not be inventing a key that reports match on. Slugged from
  // the name; the unique index refuses a collision, which is the right failure.
  const code = row.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!code) throw new Error("That name has no letters in it, and the report key is built from the name");

  const { error } = await db.from("fms_help_categories").insert({ ...row, code });
  if (error) throw new Error(error.message);
}

/**
 * Switch a category off, or back on.
 *
 * ⚠ OFF IS NOT DELETE, and it cannot be: `fms_help_tickets.category_id` is
 *   `on delete restrict`, so a category with tickets against it can never be
 *   removed — the MIS groups by it. Off means "stop offering it on the raise
 *   form"; every existing ticket keeps it.
 */
export async function setCategoryActive(id: string, active: boolean): Promise<void> {
  const { error } = await db.from("fms_help_categories").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Save one Setup key.
 *
 * ⚠ A DIRECT WRITE UNDER RLS — `fms_help_config_write` limits it to admins. The
 *   whole value is replaced, so the caller must pass the WHOLE object: a partial
 *   save would drop every key it did not mention, and `policy` holds five.
 */
export async function saveConfig(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from("fms_help_config")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/**
 * Save the additive step owners.
 *
 * ⚠ ONE ROW PER STEP, UPSERTED ON `step_key`, INCLUDING THE EMPTY ONES. Skipping
 *   a step whose list was cleared would leave its old owners in place while the
 *   screen showed none — and on `raise` that is the difference between "anyone
 *   may raise a ticket" and "only these three can", which is the module's whole
 *   premise.
 */
export async function saveStepOwners(byStep: Record<string, string[]>): Promise<void> {
  const rows = Object.entries(byStep).map(([step_key, employee_ids]) => ({
    step_key,
    employee_ids,
  }));
  const { error } = await db
    .from("fms_help_step_owners")
    .upsert(rows, { onConflict: "step_key" });
  if (error) throw new Error(error.message);
}

/**
 * Ask for a ticket category that does not exist.
 *
 * ⚠ THE PAYLOAD IS DELIBERATELY JUST A NAME AND A REASON. Every other module's
 *   master-request carries the whole row, and each key has to appear in that
 *   module's resolve RPC or it is SILENTLY DROPPED on approve. That trap is
 *   avoided here by not building the road: the owner, the turnaround, the
 *   escalation ladder and the confidentiality are decided by whoever APPROVES it,
 *   on the Masters screen, where they can see what is already in use.
 */
export async function requestCategory(name: string, reason: string | null): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { error } = await db.from("fms_help_master_requests").insert({
    requested_by: uid,
    proposed_name: name.trim(),
    reason: reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Decide a category request.
 *
 * ⚠ APPROVING DOES NOT CREATE THE CATEGORY. It records the decision and points
 *   the approver at the Masters screen to make it, because a category needs an
 *   owner, a turnaround and an escalation ladder — none of which the requester
 *   was asked for, and none of which should be guessed on their behalf. A row
 *   created blank here would route tickets to nobody.
 */
export async function decideCategoryRequest(
  id: string,
  status: "approved" | "rejected",
  note: string | null,
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await db
    .from("fms_help_master_requests")
    .update({
      status,
      decided_by: auth.user?.id ?? null,
      decided_at: new Date().toISOString(),
      decision_note: note?.trim() || null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
