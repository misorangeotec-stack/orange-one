import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell from "@/shared/components/ui/DueCell";
import Button from "@/shared/components/ui/Button";
import ReassignStepModal from "../../components/ReassignStepModal";
import { formatDateDMY } from "@/shared/lib/date";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../../store";
import { money } from "../../lib/format";
import { tripDueIso } from "../../lib/queues";
import { stepByKey } from "../../lib/steps";
import type { Trip } from "../../types";

/**
 * One approval gate's queue — the same screen for both, because a manager and a
 * Director are answering the identical question about the identical row.
 *
 * ⚠ THE QUEUE LISTS; THE TRIP DECIDES. There is deliberately no approve button
 *   on a row here. Every figure this decision turns on — the hotel cap for that
 *   band in that city's tier, the class of travel, whether §3.5 has already
 *   downgraded it — lives on the trip screen beside the request. An approve
 *   button in a list is an approval given without seeing any of it, which is
 *   precisely the habit this module exists to end.
 *
 * ⚠ MEMBERSHIP IS READ FROM `status`, NOT FROM `current_step`. `current_step` is
 *   a convenience column the RPCs also maintain; the status CHECK is what the
 *   database actually enforces, and reading the softer of the two is how a queue
 *   ends up holding a row the workflow has already moved on.
 */
export default function ApprovalQueue({
  step,
}: {
  step: "manager_approval" | "director_approval";
}) {
  const s = useTravelStore();
  const { departmentById } = useDirectory();

  const wantStatus =
    step === "director_approval" ? "awaiting_director_approval" : "awaiting_manager_approval";

  const rows = useMemo(
    () =>
      s.trips.filter(
        (t) =>
          t.status === wantStatus &&
          // A trip that skipped this gate can never legitimately sit at its
          // status, but reading the flag as well costs nothing and is the
          // cheapest possible guard against defect (E) reaching a screen.
          !(step === "director_approval" ? t.directorApprovalSkipped : t.managerApprovalSkipped),
      ),
    [s.trips, wantStatus, step],
  );

  const mine = useMemo(() => rows.filter((t) => s.canActOn(step, t)), [rows, s, step]);
  const [reassigning, setReassigning] = useState<Trip | null>(null);

  const columns = useMemo<QueueColumn<Trip>[]>(() => {
    const cityName = (id: string | null) => s.cityById(id)?.name ?? "—";
    const dueOf = (t: Trip) => tripDueIso(t, step, s.stepSla);

    return [
      {
        key: "ref",
        header: "Trip",
        alwaysVisible: true,
        cell: (t) => (
          <Link
            to={`/travel-desk/trips/${t.id}`}
            className="font-semibold text-navy hover:text-orange hover:underline"
          >
            {t.tripNo ?? t.travellerName}
          </Link>
        ),
        sortValue: (t) => t.tripNo ?? "",
        filter: { kind: "text", get: (t) => t.tripNo ?? t.travellerName },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "traveller",
        header: "Traveller",
        cell: (t) => t.travellerName,
        sortValue: (t) => t.travellerName,
        filter: { kind: "select", get: (t) => t.travellerName },
      },
      {
        key: "band",
        header: "Band",
        cell: (t) =>
          t.snapTravelCategory
            ? `${t.snapBandNo ?? "—"} · ${t.snapTravelCategory}`
            : String(t.snapBandNo ?? "—"),
        // ⚠ The BAND NUMBER, not the rendered text: "3 · TC-C" sorts before
        //   "10 · TC-A" as a string, which is the wrong order for a ladder.
        sortValue: (t) => t.snapBandNo ?? 0,
        filter: { kind: "select", get: (t) => t.snapTravelCategory ?? "—" },
      },
      {
        key: "department",
        header: "Department",
        cell: (t) => departmentById(t.snapDepartmentId)?.name ?? "—",
        sortValue: (t) => departmentById(t.snapDepartmentId)?.name ?? "",
        filter: { kind: "select", get: (t) => departmentById(t.snapDepartmentId)?.name ?? "—" },
        defaultHidden: true,
      },
      {
        key: "destination",
        header: "Destination",
        cell: (t) => cityName(t.destinationCityId),
        sortValue: (t) => cityName(t.destinationCityId),
        filter: { kind: "select", get: (t) => cityName(t.destinationCityId) },
      },
      {
        key: "departure",
        header: "Departure",
        cell: (t) => (t.plannedDepartureDate ? formatDateDMY(t.plannedDepartureDate) : "—"),
        sortValue: (t) => t.plannedDepartureDate ?? "",
        filter: { kind: "date", get: (t) => t.plannedDepartureDate ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "estimate",
        header: "Estimate",
        align: "right",
        cell: (t) => money(t.estimatedCost),
        sortValue: (t) => t.estimatedCost ?? 0,
        filter: { kind: "number", get: (t) => t.estimatedCost ?? 0 },
        exportValue: (t) => t.estimatedCost ?? 0,
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "advance",
        header: "Advance",
        align: "right",
        cell: (t) => (t.advanceRequested ? money(t.advanceRequestedAmount) : "—"),
        sortValue: (t) => (t.advanceRequested ? t.advanceRequestedAmount ?? 0 : -1),
        filter: { kind: "select", get: (t) => (t.advanceRequested ? "Requested" : "None") },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "flags",
        header: "Flags",
        cell: (t) => (
          <span className="flex flex-wrap gap-1">
            {t.isEmergency && (
              <span className="rounded-pill bg-[#FFF7E6] px-2 py-0.5 text-[11px] font-semibold text-yellow">
                Emergency
              </span>
            )}
            {t.tcDowngradedFrom && (
              <span className="rounded-pill bg-[#FDECEC] px-2 py-0.5 text-[11px] font-semibold text-ryg-red">
                §3.5 → TC-D
              </span>
            )}
            {t.returnedAt === null && t.returnedStage && (
              <span className="rounded-pill bg-page px-2 py-0.5 text-[11px] font-semibold text-grey">
                Resubmitted
              </span>
            )}
            {!t.isEmergency && !t.tcDowngradedFrom && !t.returnedStage && (
              <span className="text-grey-2">—</span>
            )}
          </span>
        ),
        sortValue: (t) => (t.tcDowngradedFrom ? 2 : t.isEmergency ? 1 : 0),
        filter: {
          kind: "select",
          get: (t) => (t.tcDowngradedFrom ? "§3.5 → TC-D" : t.isEmergency ? "Emergency" : "—"),
        },
      },
      {
        key: "due",
        header: "Due",
        cell: (t) => <DueCell dueIso={dueOf(t)} />,
        sortValue: (t) => dueOf(t) ?? "9999",
        filter: { kind: "date", get: (t) => dueOf(t) ?? "" },
        tdClassName: "whitespace-nowrap",
        exportValue: (t) => dueOf(t) ?? "",
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cities, s.stepSla, step]);

  const title = stepByKey(step)?.title ?? "Approvals";
  const notMine = rows.length - mine.length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">{title}</h1>
        <p className="text-[13px] text-grey">
          {step === "director_approval"
            ? `Trips from bands ${s.config.approvalMatrix.directorFromBand} and above, which §3.2 sends to a Director as well as to the reporting manager.`
            : "Trips waiting on their reporting manager. Open one to see the entitlement it is measured against, then decide."}
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        actions={(t) => (
          <>
            <Link to={`/travel-desk/trips/${t.id}`}>
              <Button variant={s.canActOn(step, t) ? "primary" : "outline"} className="h-7 px-2.5 text-[12px]">
                {s.canActOn(step, t) ? "Open & decide" : "Open"}
              </Button>
            </Link>
            {/* Hand this gate on, or pull it back. The trip's snapshot approver
                stays recorded on the trip either way — see ReassignStepModal. */}
            {s.canReassignStep(step, t) && (
              <Button
                variant="ghost"
                className="ml-2 h-7 px-2.5 text-[12px]"
                onClick={() => setReassigning(t)}
              >
                Reassign
              </Button>
            )}
          </>
        )}
        rowsLabel="trips"
        emptyTitle="Nothing to decide"
        emptyMessage={
          step === "director_approval"
            ? "No trip is waiting on a Director. Bands below the threshold never reach this step."
            : "No trip is waiting on a reporting manager."
        }
        loading={s.isLoading}
        initialSort={{ key: "due", dir: "asc" }}
        exportName={step === "director_approval" ? "Travel_Director_Approvals" : "Travel_Manager_Approvals"}
        columnPicker={{ storageKey: `travel-queue-${step}` }}
      />

      {/*
        ⚠ SAID RATHER THAN HIDDEN. The queue shows every trip at this step, not
          only the ones this reader may decide — a coordinator chasing an
          approval needs to see what is stuck even where they cannot act, and
          silently filtering the list would make it look shorter than it is. The
          Open button says which is which; this says how many.
      */}
      {notMine > 0 && (
        <p className="text-[12.5px] text-grey-2">
          {notMine} of these {rows.length} route to somebody else — they are shown so the queue is a
          true picture of what is outstanding, not only of what you can act on.
        </p>
      )}
      <ReassignStepModal
        trip={reassigning}
        step={step}
        open={reassigning !== null}
        onClose={() => setReassigning(null)}
      />
    </div>
  );
}
