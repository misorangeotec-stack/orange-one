/**
 * Column sets shared by every list screen in the module, so the Accounts queue,
 * My Requests and All Requests cannot drift apart on what a column means.
 */
import { Link } from "react-router-dom";
import StatusBadge from "@hub/components/customerOnboarding/StatusBadge";
import type { RequestColumn } from "@hub/components/customerOnboarding/RequestTable";
import type { CustomerRequest } from "@hub/lib/customerOnboarding/types";
import { customerTypeLabel, dmy, inr, paymentTermsLabel, requestSubject } from "@hub/lib/customerOnboarding/format";
import { detailHref } from "@hub/lib/customerOnboarding/routes";
import { stepShort } from "@hub/lib/customerOnboarding/steps";
import { openStep } from "@hub/lib/customerOnboarding/queues";

/** Today, local — the yardstick for "overdue". Never `new Date().toISOString()`, which is UTC. */
function todayLocalIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const colRef: RequestColumn<CustomerRequest> = {
  key: "ref",
  header: "Request",
  value: (r) => r.reqNo ?? "Draft",
  cell: (r) => (
    <Link
      to={detailHref(r.id)}
      onClick={(e) => e.stopPropagation()}
      className="font-medium text-primary hover:underline whitespace-nowrap"
    >
      {r.reqNo ?? "Draft"}
    </Link>
  ),
};

export const colCustomer: RequestColumn<CustomerRequest> = {
  key: "customer",
  header: "Customer",
  value: (r) => requestSubject(r),
  cell: (r) => (
    <div className="min-w-[180px]">
      <div className="font-medium text-foreground">{requestSubject(r)}</div>
      {r.tradeName && r.legalName && r.tradeName !== r.legalName && (
        <div className="text-xs text-muted-foreground">{r.tradeName}</div>
      )}
    </div>
  ),
};

export const colPlace: RequestColumn<CustomerRequest> = {
  key: "place",
  header: "City / State",
  value: (r) => [r.city, r.stateName].filter(Boolean).join(", "),
  cell: (r) => (
    <span className="whitespace-nowrap">
      {[r.city, r.stateName].filter(Boolean).join(", ") || "—"}
    </span>
  ),
};

export const colType: RequestColumn<CustomerRequest> = {
  key: "type",
  header: "Type",
  value: (r) => customerTypeLabel(r.customerType),
  cell: (r) => customerTypeLabel(r.customerType),
};

export const colGst: RequestColumn<CustomerRequest> = {
  key: "gst",
  header: "GST Number",
  value: (r) => r.gstNumber,
  cell: (r) => <span className="font-mono text-xs">{r.gstNumber ?? "—"}</span>,
};

export const colTerms: RequestColumn<CustomerRequest> = {
  key: "terms",
  header: "Terms",
  value: (r) => paymentTermsLabel(r.paymentTerms),
  cell: (r) => paymentTermsLabel(r.paymentTerms),
};

/** What Sales asked for. The Accounts recommendation is a separate column. */
export const colRequestedLimit: RequestColumn<CustomerRequest> = {
  key: "requestedLimit",
  header: "Requested limit",
  align: "right",
  value: (r) => r.requestedCreditLimit,
  cell: (r) => inr(r.requestedCreditLimit),
};

export const colRecommendedLimit: RequestColumn<CustomerRequest> = {
  key: "recommendedLimit",
  header: "Recommended",
  align: "right",
  value: (r) => r.accRecommendedLimit,
  cell: (r) => inr(r.accRecommendedLimit),
};

export const colRaisedBy: RequestColumn<CustomerRequest> = {
  key: "raisedBy",
  header: "Raised by",
  value: (r) => r.raisedByName,
  cell: (r) => <span className="whitespace-nowrap">{r.raisedByName ?? "—"}</span>,
};

export const colRaisedOn: RequestColumn<CustomerRequest> = {
  key: "raisedOn",
  header: "Raised on",
  // Sort on the raw ISO string, not the dd-mm-yyyy label — otherwise the column
  // sorts by day-of-month and looks plausibly, silently wrong.
  value: (r) => r.submittedAt ?? r.createdAt,
  cell: (r) => <span className="whitespace-nowrap">{dmy(r.submittedAt ?? r.createdAt)}</span>,
};

export const colStatus: RequestColumn<CustomerRequest> = {
  key: "status",
  header: "Status",
  value: (r) => r.status,
  cell: (r) => <StatusBadge status={r.status} />,
};

export const colWaitingOn: RequestColumn<CustomerRequest> = {
  key: "waitingOn",
  header: "Waiting on",
  value: (r) => { const s = openStep(r); return s ? stepShort(s) : ""; },
  cell: (r) => {
    const s = openStep(r);
    return s ? <span className="whitespace-nowrap">{stepShort(s)}</span> : <span className="text-muted-foreground">—</span>;
  },
};

/** Due date with an overdue tint. `dueIso` comes from the store's SLA model. */
export function colDue(dueIsoFor: (r: CustomerRequest) => string | null): RequestColumn<CustomerRequest> {
  return {
    key: "due",
    header: "Due",
    value: (r) => dueIsoFor(r),
    cell: (r) => {
      const due = dueIsoFor(r);
      if (!due) return <span className="text-muted-foreground">—</span>;
      const overdue = due < todayLocalIso();
      return (
        <span className={overdue ? "text-destructive font-medium whitespace-nowrap" : "whitespace-nowrap"}>
          {dmy(due)}
        </span>
      );
    },
  };
}

export const colCustomerCode: RequestColumn<CustomerRequest> = {
  key: "customerCode",
  header: "Customer code",
  value: (r) => r.customerCode,
  cell: (r) => <span className="font-mono text-xs">{r.customerCode ?? "—"}</span>,
};

export const colSalesExec: RequestColumn<CustomerRequest> = {
  key: "salesExec",
  header: "Sales executive",
  value: (r) => r.assignedSalesExecName,
  cell: (r) => <span className="whitespace-nowrap">{r.assignedSalesExecName ?? "—"}</span>,
};
