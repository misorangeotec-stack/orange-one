/**
 * What somebody sees when their job has no sheet yet (HRREP-1).
 *
 * The alternative was to score them against the one sheet that does exist, and that is
 * the whole reason this component is here: a spare-parts employee marked on "CVs
 * uploaded per requisition" reads a number that looks exactly like an appraisal and
 * means nothing about their work. An honest empty state beats a confident wrong answer.
 *
 * It names the person, their job and the jobs that DO have one, so a reader can see in
 * a glance whether the answer is "nothing has been written for my job yet" or "my
 * department or designation is wrong in the directory" — two problems with two
 * completely different fixes, and the second is common enough to be worth naming.
 */
import Card from "@/shared/components/ui/Card";

export default function NoSheet({
  kind,
  personName,
  department,
  designation,
  jobsThatHaveOne,
}: {
  kind: "scorecard" | "weekly review";
  personName: string;
  department: string | null;
  designation: string | null;
  jobsThatHaveOne: string[];
}) {
  const jobKnown = !!department && !!designation;
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold text-navy">
        No {kind === "scorecard" ? "KPI sheet" : "weekly review form"} has been set up for this job yet
      </h2>

      <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-grey">
        {personName} is recorded as{" "}
        {jobKnown ? (
          <>
            <span className="font-medium text-navy">{department}</span> ·{" "}
            <span className="font-medium text-navy">{designation}</span>
          </>
        ) : (
          <span className="font-medium text-[#c0392b]">
            {department ? "no designation" : designation ? "no department" : "no department or designation"}
          </span>
        )}
        , and nothing has been written down for that job.{" "}
        {kind === "scorecard"
          ? "Rather than mark somebody against another job's targets, the page stops here."
          : "The weekly review form is written per job, so there is nothing to fill in."}
      </p>

      <div className="mt-4 rounded-md border border-line bg-page px-3.5 py-3 text-[12px] leading-relaxed text-grey">
        <span className="font-semibold text-navy">
          {jobsThatHaveOne.length === 1 ? "The one job that has one" : "The jobs that have one"}:
        </span>{" "}
        {jobsThatHaveOne.join(" · ")}
        <div className="mt-1.5">
          To add this job, HR hands over the sheet for it and we set it up against that department and designation —
          everybody doing that job then gets it, including anyone who joins later.
        </div>
      </div>

      {!jobKnown && (
        // Worth separating: this reader's problem is a blank field in the directory, not
        // a missing sheet, and nobody will guess that from the message above.
        <div className="mt-3 rounded-md border border-orange/40 bg-orange/[0.06] px-3.5 py-2.5 text-[12px] leading-relaxed text-navy">
          <span className="font-semibold">Their department or designation is blank in the hub.</span> Even once the sheet
          exists, it cannot be matched to them until an admin fills that in on the user&apos;s profile.
        </div>
      )}
    </Card>
  );
}
