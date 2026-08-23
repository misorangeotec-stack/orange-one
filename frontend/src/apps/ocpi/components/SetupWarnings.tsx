import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { useOcpiStore } from "../store";
import { OCPI_MASTERS_QK, fetchOcpiMasters } from "../data/ocpiMasters";

/**
 * Two warnings that belong where the work happens, not in Settings.
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
 * This deal's selling entity has no profile of its own.
 *
 * ⚠ THE DOCUMENT STILL PRINTS — with the default entity's bank block, CIN and
 *   letterhead. That fallback is deliberate (a contract with a blank bank block
 *   is not more correct, just less usable), which is exactly why it has to be
 *   said out loud on the screen that produces the file.
 */
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
