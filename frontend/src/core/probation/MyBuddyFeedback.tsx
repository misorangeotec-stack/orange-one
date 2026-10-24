import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { TextArea } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { supabase } from "@/core/platform/supabase";
import { useSession } from "@/core/platform/session";

/**
 * NR-9 / KPI 1B.5 — the new joiner rates their buddy programme.
 *
 * On THEIR page, not HR's, and written by them alone: the RPC refuses everyone
 * else, an admin included. A rating somebody else typed would be worth nothing,
 * and this is the one line on the sheet that is supposed to be the joiner's own
 * voice.
 *
 * Shown only once the programme has actually run a while — there is nothing to
 * rate on day two, and asking then would just train people to click 5.
 */
export default function MyBuddyFeedback() {
  const { user } = useSession();
  const qc = useQueryClient();
  const [rating, setRating] = useState<number | null>(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["myBuddyProgramme", user.id],
    queryFn: async () => {
      const { data: b, error } = await supabase
        .from("fms_hr_buddies")
        .select("id, buddy_user_id, joining_date, status, feedback_rating, feedback_remarks, feedback_at")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return b as {
        id: string;
        buddy_user_id: string;
        joining_date: string | null;
        status: string;
        feedback_rating: number | null;
        feedback_remarks: string | null;
        feedback_at: string | null;
      } | null;
    },
  });

  if (!data) return null;
  // The row could be somebody else's if this person is a BUDDY rather than a
  // joiner — the policy admits both. Only the joiner may rate, so a buddy
  // reading their own row must not be offered the form.
  if (data.buddy_user_id === user.id) return null;

  const already = data.feedback_rating != null;

  const send = async () => {
    if (rating == null) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("fms_hr_rate_buddy", {
      p_buddy: data.id,
      p_rating: rating,
      p_remarks: remarks.trim(),
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["myBuddyProgramme", user.id] });
  };

  return (
    <Card className="p-5 space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold text-navy">Your buddy</h2>
        <p className="mt-0.5 text-[12.5px] text-grey-2">
          {already
            ? "Thank you — this is what you said."
            : "How has having a buddy been? Your answer goes to HR, not to your buddy."}
        </p>
      </div>

      {already ? (
        <div className="rounded-xl border border-line px-3.5 py-2.5">
          <p className="text-[13px] font-medium text-navy">{data.feedback_rating} of 5</p>
          {data.feedback_remarks && (
            <p className="mt-0.5 text-[12.5px] text-grey leading-relaxed">{data.feedback_remarks}</p>
          )}
          {data.feedback_at && (
            <p className="mt-1 text-[11px] text-grey-2">Given {formatDateDMY(data.feedback_at)}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className={`h-10 w-10 rounded-xl border text-[14px] font-semibold transition ${
                  rating === n ? "border-orange bg-orange/5 text-navy" : "border-line text-grey"
                }`}
              >
                {n}
              </button>
            ))}
            <span className="self-center text-[11.5px] text-grey-2">1 = poor · 5 = excellent</span>
          </div>
          <TextArea
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Anything you want to add."
          />
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
          <Button size="sm" onClick={send} disabled={busy || rating == null}>
            {busy ? "Sending…" : "Send to HR"}
          </Button>
        </div>
      )}
    </Card>
  );
}
