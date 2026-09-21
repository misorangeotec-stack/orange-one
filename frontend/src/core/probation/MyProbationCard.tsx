import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import { formatDateDMY } from "@/shared/lib/date";
import { todayIso } from "@/shared/lib/time";
import { supabase } from "@/core/platform/supabase";

/**
 * NR-10 · The nudge on the home screen when a new joiner owes a check-in.
 *
 * Renders NOTHING for everybody else — which is almost everybody. That is the
 * point: the sidebar cannot know who is on probation, so a permanent menu item
 * would lead 67 of 68 people to an empty page. This asks the database, and only
 * the person it concerns ever sees anything.
 *
 * The same RPC the page uses, so there is one definition of "my check-ins" and
 * the card can never disagree with the page it links to. It returns no rows for
 * anyone who is not a linked new joiner, so the cost for everyone else is one
 * small query that answers "not you".
 */
export default function MyProbationCard() {
  const { data } = useQuery({
    queryKey: ["myProbation"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fms_hr_my_probation");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const rows = data ?? [];
  if (rows.length === 0) return null;

  const today = todayIso();
  // Owed = open, and its day has arrived. A future check-in is not a nag.
  const owed = rows
    .filter((r) => !r.joiner_at && r.due_on <= today && !r.final_status)
    .sort((a, b) => a.day_no - b.day_no);
  if (owed.length === 0) return null;

  const next = owed[0];
  const overdue = next.due_on < today;

  return (
    <Card className="p-4 border-orange/30 bg-orange-soft/25">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-navy">
            Your Day-{next.day_no} check-in {overdue ? "is overdue" : "is due"}
          </p>
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            {overdue
              ? `It was due ${formatDateDMY(next.due_on)}.`
              : `Due ${formatDateDMY(next.due_on)}.`}{" "}
            A couple of minutes — how the first {next.day_no} days have gone.
            {/* `owed` is sorted ASCENDING and `next` is the first of them, so the
                rest are always LATER days — calling them "earlier" was simply
                wrong on a card whose whole job is to say what is outstanding. */}
            {owed.length > 1 &&
              ` ${owed.length - 1} other${owed.length > 2 ? "s are" : " is"} open too.`}
          </p>
        </div>
        <Link
          to="/my-probation"
          className="rounded-pill bg-orange px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90"
        >
          Answer it
        </Link>
      </div>
    </Card>
  );
}
