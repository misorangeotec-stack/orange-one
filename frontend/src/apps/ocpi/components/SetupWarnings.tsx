import type { ReactNode } from "react";
import { fyCode, ocNoFor } from "../lib/format";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { useOcpiStore } from "../store";
import { stepByKey, type StepKey } from "../lib/steps";
import { OCPI_MASTERS_QK, fetchOcpiMasters } from "../data/ocpiMasters";

/**
 * Three warnings that belong where the work happens, not in Settings.
 *
 * ⚠ BOTH OF THESE WERE ALREADY KNOWN AND ALREADY INVISIBLE. The quotation
 *   counter was seeded off one scanned submission with a SQL comment saying so;
 *   `loadLetterhead` computes a `usedDefault` flag with a comment saying it
 *   reports the fallback "loudly", and nothing anywhere read it. A caveat that
 *   only exists in a migration header is not a control — the person about to
 *   send a customer a numbered document is the person who has to see it.
 *
 * ⚠ NEITHER BLOCKS ANYTHING. Both describe a risk somebody outside this repo
 *   has to resolve — the real last paper quotation number, and which bank
 *   account a Colorix or Noida deal should print. Blocking on an answer nobody
 *   here can give would just mean the module cannot be used at all, which is
 *   strictly worse than using it with the risk in plain sight.
 */

/** Shared shell so both warnings read as the same kind of thing. */
function Warning({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="border-ryg-yellow/50 p-4">
      <p className="text-[13px] font-semibold text-navy">{title}</p>
      <div className="mt-1 text-[12.5px] leading-relaxed text-grey">{children}</div>
    </Card>
  );
}

/**
 * The quotation series has not been checked against the paper register.
 *
 * Shown wherever a number can be minted. Silent once an admin confirms it in
 * Settings → Quotation numbering.
 */
export function QuotationSeriesWarning() {
  const s = useOcpiStore();
  if (s.config.quotationSeries.confirmed) return null;

  return (
    <Warning title="The quotation series has not been confirmed">
      Numbers here continue the series that was running on paper. The starting point was read off a
      single scanned quotation (<b>QT-M0023</b>) and has never been checked against the register, so
      it may be behind the real last number &mdash; in which case the next quotations issued here
      repeat numbers customers already hold.{" "}
      {s.isAdmin ? (
        <>
          Set it in{" "}
          <Link to="/ocpi/settings" className="font-medium text-orange hover:underline">
            Settings &rarr; Quotation numbering
          </Link>
          .
        </>
      ) : (
        <>Ask an administrator to confirm it in Settings before sending a quotation out.</>
      )}
    </Warning>
  );
}

/**
 * The order-confirmation series has not been checked for the year now running.
 *
 * ⚠ IT SITS ON THE APPROVAL GATE, NOT THE EDITOR, because that is where the
 *   number is minted. The quotation warning belongs on the editor for the same
 *   reason. An approver is the last person who can stop a contract going out
 *   carrying a number some customer already has on file.
 *
 * ⚠ AND IT COMES BACK EVERY APRIL. The series restarts with the financial year,
 *   so confirmation is recorded per year and this reads the current one. A
 *   module confirmed once in 2026 and never again would quietly issue
 *   OTPL/OC/2728/0001 over the top of a paper series that had kept counting.
 */
export function OcSeriesWarning() {
  const s = useOcpiStore();
  const fy = fyCode();
  if (s.config.ocSeries[fy]?.confirmed) return null;

  return (
    <Warning title={`The order-confirmation series has not been confirmed for ${fy}`}>
      Approving mints <b>{ocNoFor(1, fy).replace(/\d+$/, "nnnn")}</b> from a counter nobody has
      checked against the paper register. If the real series is ahead of it, this contract goes out
      under a number a customer already holds &mdash; and unlike a quotation, that number is on
      something signed.{" "}
      {s.isAdmin ? (
        <>
          Set it in{" "}
          <Link to="/ocpi/settings" className="font-medium text-orange hover:underline">
            Settings &rarr; Order confirmation numbering
          </Link>
          .
        </>
      ) : (
        <>Ask an administrator to confirm it in Settings before approving.</>
      )}
    </Warning>
  );
}

/**
 * This deal's selling entity has no profile of its own.
 *
 * ⚠ THE DOCUMENT STILL PRINTS — with the default entity's bank block, CIN and
 *   letterhead. That fallback is deliberate (a contract with a blank bank block
 *   is not more correct, just less usable), which is exactly why it has to be
 *   said out loud on the screen that produces the file.
 */
/**
 * Nobody is named for this step.
 *
 * ⚠ THIS IS THE STATE OF THE MODULE TODAY, not a hypothetical. `fms_ocpi_step_owners`
 *   holds ZERO rows, so every approval, countersignature and Finance confirmation
 *   currently falls to whoever happens to be an admin or a process coordinator.
 *   That works, which is exactly why nobody would notice it — a queue that anybody
 *   senior can clear looks the same as one with the right person on it.
 *
 * ⚠ IT MATTERS MOST ON THE DIRECTORS' GATE. Approving a quotation is what mints
 *   the order-confirmation number and issues the contract, and the client asked
 *   for that to be the Directors' decision. Until somebody is named, it is not
 *   anybody's in particular.
 *
 * ⚠ IT BLOCKS NOTHING, like the other two. Naming owners is an administrator's
 *   job and nothing here can do it for them.
 */
export function StepOwnersWarning({ step }: { step: StepKey }) {
  const s = useOcpiStore();
  if (s.ownersOf(step).length > 0) return null;

  const title = stepByKey(step)?.title ?? step;
  const isDirectorsGate = step === "quotation_approval";

  return (
    <Warning
      title={
        isDirectorsGate
          ? "No Directors are named for this approval"
          : `Nobody is named for ${title}`
      }
    >
      {isDirectorsGate ? (
        <>
          Approving here mints the order-confirmation number and issues the contract, and the
          client asked for that to be the Directors&rsquo; decision. Nobody is named, so it falls
          to <b>whoever is an administrator or a process coordinator</b> &mdash; and a person who
          raised the deal still cannot approve it themselves.{" "}
        </>
      ) : (
        <>
          Nobody is named for this step, so only <b>administrators and process coordinators</b> can
          action it. That is not the same as the right person having it.{" "}
        </>
      )}
      {s.isAdmin ? (
        <>
          Name them in{" "}
          <Link to="/ocpi/settings" className="font-medium text-orange hover:underline">
            Settings &rarr; Who does what
          </Link>
          .
        </>
      ) : (
        <>Ask an administrator to name them in Settings.</>
      )}
    </Warning>
  );
}

export function CompanyProfileWarning({ companyId }: { companyId: string | null }) {
  const s = useOcpiStore();
  const status = s.profileStatusFor(companyId);
  const { data: masters } = useQuery({
    queryKey: OCPI_MASTERS_QK,
    queryFn: fetchOcpiMasters,
    staleTime: 30 * 60 * 1000,
  });

  if (!status.isFallback) return null;

  const company = masters?.companies.find((c) => c.id === companyId)?.name ?? "this company";
  const printing = status.profile?.legalName ?? "the default entity";

  return (
    <Warning title="This deal is booked under a company with no letterhead of its own">
      <b>{company}</b> has no company profile, so the document will print{" "}
      <b>{printing}</b>&rsquo;s bank account, CIN and registered address &mdash; which is the wrong
      entity for the customer to pay against.{" "}
      {s.isAdmin ? (
        <>
          Add it in{" "}
          <Link to="/ocpi/settings" className="font-medium text-orange hover:underline">
            Settings &rarr; Company profiles
          </Link>{" "}
          before this goes to the customer.
        </>
      ) : (
        <>Ask an administrator to set that company up before this goes to the customer.</>
      )}
    </Warning>
  );
}
