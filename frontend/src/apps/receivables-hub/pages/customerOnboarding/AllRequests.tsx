/**
 * Every onboarding request the viewer is allowed to see, filtered and exportable.
 *
 * RLS already decides what "allowed to see" means (raiser, assigned executive,
 * back-office step owners, coordinators, admins), so this page applies no scope
 * of its own — a second, hand-written filter here would be a second place for
 * the rule to be wrong.
 *
 * Doubles as the module's REPORT: with the Dispatch push deliberately absent,
 * the Excel export is how downstream teams get this data.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileSpreadsheet, Users, UserPlus } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import RequestTable from "@hub/components/customerOnboarding/RequestTable";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { newHref, detailHref } from "@hub/lib/customerOnboarding/routes";
import { STATUS_LABEL } from "@hub/lib/customerOnboarding/format";
import { exportCompletedCustomers } from "@hub/lib/customerOnboarding/exportCustomers";
import type { CustomerStatus } from "@hub/lib/customerOnboarding/types";
import {
  colCompany, colCustomer, colCustomerCode, colDue, colGst, colPlace, colRaisedBy, colRaisedOn,
  colRecommendedLimit, colRef, colRequestedLimit, colSalesExec, colStatus, colTerms,
  colType, colWaitingOn,
} from "./columns";

type Filter = "all" | "open" | "completed" | CustomerStatus;

export default function AllRequests() {
  const s = useCustomerStore();
  const [filter, setFilter] = useState<Filter>("open");

  const rows = useMemo(() => {
    const all = s.requests;
    if (filter === "all") return all;
    if (filter === "open") {
      return all.filter((r) => s.openStepOf(r) !== null || r.status === "on_hold");
    }
    if (filter === "completed") return all.filter((r) => r.status === "completed");
    return all.filter((r) => r.status === filter);
  }, [s, filter]);

  // Completed requests are read as a customer master, so they show the code and
  // the assigned executive instead of due dates and who is holding things up.
  const showAsMaster = filter === "completed";

  const filterLabel =
    filter === "open" ? "In progress"
    : filter === "completed" ? "Completed"
    : filter === "all" ? "Everything"
    : STATUS_LABEL[filter];

  const columns = showAsMaster
    ? [colRef, colCustomer, colCompany(s.companyName), colCustomerCode, colGst, colPlace, colType,
       colTerms, colRecommendedLimit, colSalesExec, colRaisedOn, colStatus]
    : [colRef, colCustomer, colCompany(s.companyName), colPlace, colType, colTerms,
       colRequestedLimit, colWaitingOn, colDue(s.dueIsoFor), colRaisedBy, colRaisedOn, colStatus];

  if (s.loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (s.error) {
    return (
      <div className="p-6">
        <Card><CardContent className="p-6 text-sm text-destructive">{s.error}</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" /> All customer requests
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {showAsMaster
              ? "Customers that reached Tally. Export this to hand the list to another team."
              : "Everything currently moving through onboarding."}
          </p>
        </div>
        {s.canRaise && (
          <Button asChild className="gap-2">
            <Link to={newHref()}><UserPlus className="h-4 w-4" /> New customer</Link>
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-5">
          <RequestTable
            rows={rows}
            columns={columns}
            rowHref={(r) => detailHref(r.id)}
            searchPlaceholder="Search by name, GST, city, request number…"
            exportName={showAsMaster ? "Customers-created" : "Customer-onboarding"}
            empty={
              filter === "open"
                ? "No requests are in progress. Anything completed or rejected is under the other filters."
                : "Nothing here yet."
            }
            toolbar={
              <>
                <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">In progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="all">Everything</SelectItem>
                    {(Object.keys(STATUS_LABEL) as CustomerStatus[]).map((k) => (
                      <SelectItem key={k} value={k}>{STATUS_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* The table's own Excel button exports the eleven columns on
                    screen — right for a table view, wrong for a hand-off. This
                    one carries every field of every step, which is how any
                    downstream team gets this data (nothing is pushed to them). */}
                {rows.length > 0 && (
                  <Button
                    variant="outline" size="sm" className="gap-2"
                    onClick={() =>
                      exportCompletedCustomers(rows, s.personName, s.companyName, `Filter: ${filterLabel}`)
                    }
                  >
                    <FileSpreadsheet className="h-4 w-4" /> Full export
                  </Button>
                )}
              </>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
