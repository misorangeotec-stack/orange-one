import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

import type { CommentInput } from "../types";

/**
 * Post one comment on a trip.
 *
 * ⚠ A COMMENT IS AN ACTIVITY ROW, NOT A ROW IN A COMMENTS TABLE. The house
 *   pattern (`fms_hr_post_comment`), and the reason is that a trip's
 *   conversation and its history are one thing — read in order, or the reader
 *   has to interleave two lists to work out what happened.
 *
 * ⚠ ONLY A MENTION NOTIFIES. Commenting does not page the whole trip: a
 *   coordinator noting "customer moved the meeting" should not mail four people.
 *   `@`-mentioning somebody is the deliberate act that says "you, specifically",
 *   so the recipient list IS the mentions.
 *
 * ⚠ A MENTION OF SOMEBODY WHO CANNOT SEE THE TRIP IS DROPPED BY THE SERVER,
 *   silently. Raising would let an author probe who can see what by watching
 *   which names error; notifying anyway would mail them a link to a page that
 *   hands them Access Denied. So the count that comes back can be lower than
 *   what was sent, and that is correct.
 */
export async function postComment(tripId: string, input: CommentInput): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_post_comment", {
    p_trip: tripId,
    p_text: input.text,
    p_mentions: input.mentions,
    p_attachments: input.attachments,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
