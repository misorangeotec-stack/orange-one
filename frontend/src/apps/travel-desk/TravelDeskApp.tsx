import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { TravelStoreProvider, useTravelStore } from "./store";
import { STEPS } from "./lib/steps";
import type { QueueStep } from "./lib/queues";
import { QUEUE_PATH } from "./nav";
import TravelDeskLayout from "./TravelDeskLayout";
import Loaded from "./components/Loaded";
import Dashboard from "./pages/Dashboard";
import NewTrip from "./pages/trips/NewTrip";
import EditDraft from "./pages/trips/EditDraft";
import Drafts from "./pages/trips/Drafts";
import MyTrips from "./pages/trips/MyTrips";
import TripsList from "./pages/trips/TripsList";
import TripDetail from "./pages/trips/TripDetail";
import ApprovalQueue from "./pages/queues/ApprovalQueue";
import AdvanceQueue from "./pages/queues/AdvanceQueue";
import BookingQueue from "./pages/queues/BookingQueue";
import ClaimQueue from "./pages/queues/ClaimQueue";
import ClaimReviewQueue from "./pages/queues/ClaimReviewQueue";
import FinanceReviewQueue from "./pages/queues/FinanceReviewQueue";
import SettlementQueue from "./pages/queues/SettlementQueue";
import OutstandingAdvances from "./pages/reports/OutstandingAdvances";
import UpcomingTravel from "./pages/reports/UpcomingTravel";
import CancelledTravel from "./pages/reports/CancelledTravel";
import PolicyExceptions from "./pages/reports/PolicyExceptions";
import GstItcRegister from "./pages/reports/GstItcRegister";
import TripRegister from "./pages/reports/TripRegister";
import SpendSummary from "./pages/reports/SpendSummary";
import DeskPerformance from "./pages/reports/DeskPerformance";
import ControlCenter from "./pages/monitoring/ControlCenter";
import Masters from "./pages/masters/Masters";
import RateCards from "./pages/rate-cards/RateCards";
import MasterRequests from "./pages/MasterRequests";
import Setup from "./pages/settings/Setup";
import AccessDenied from "./pages/system/AccessDenied";
import NotFound from "./pages/system/NotFound";
import ComingSoon from "./pages/system/ComingSoon";
import type { TravelMasterType } from "./types";

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (!isAdmin) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Editing a list needs ownership OF THAT LIST — or of any of them, for the hub.
 *
 * Mirrors `fms_travel_is_master_manager` plus the admin bypass every master
 * table policy carries. Deliberately NOT the admin check it replaces: the whole
 * point of naming an owner is that they can curate a list without being made an
 * administrator of the portal.
 */
function RequireMasterOwner({ type, children }: { type?: TravelMasterType; children: ReactNode }) {
  const s = useTravelStore();
  const ok = type ? s.canManageMaster(type) : s.canManageAnyMaster;
  if (!ok) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * One step's queue, for its owners, the coordinators, any module viewer, and —
 * for the two manager steps — anyone named as an approver on an open trip.
 *
 * Same predicate the nav uses, so the sidebar can never offer a screen that then
 * refuses you, and no screen is reachable that the sidebar deliberately hid.
 *
 * ⚠ Must sit INSIDE <Loaded> — `canSeeQueue` is derived from the module's first
 *   fetch, so gating before it resolves would bounce a legitimate approver to
 *   Access Denied on a slow load.
 */
function RequireQueue({ step, children }: { step: QueueStep; children: ReactNode }) {
  const { canSeeQueue } = useTravelStore();
  if (!canSeeQueue(step)) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Raising a trip needs an edit grant, and ownership of the origin step if anyone
 * owns it. Mirrors fms_travel_can_act — a view-only user reads every list here
 * but cannot open the form, which would otherwise hand them something whose Save
 * the database refuses.
 */
function RequireRaise({ children }: { children: ReactNode }) {
  const { canRaise } = useTravelStore();
  if (!canRaise) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Travel Desk — the twelfth FMS module, on the same engine as the others (step
 * owners, per-owner queues, notifications, module-level view/edit grants) with
 * its own `fms_travel_*` schema.
 *
 * ⚠ THE ROUTES BELOW ARE THE WHOLE MODULE, DECLARED IN PHASE 1.
 *   Screens that later phases build render <ComingSoon> naming the phase that
 *   fills them, rather than being added to the router one at a time. Two
 *   reasons: the sidebar is built once against the real shape of the module
 *   instead of growing a link per phase, and a reader (or a reviewer) can see
 *   the finished surface from the first commit. Each placeholder says what will
 *   be there and when, so it reads as scheduled rather than broken.
 */
function TravelDeskRoutes() {
  return (
    <Routes>
      <Route element={<TravelDeskLayout />}>
        <Route index element={<Loaded><Dashboard /></Loaded>} />

        {/* ---- trips ---------------------------------------------------- */}
        <Route path="trips" element={<Loaded><TripsList /></Loaded>} />
        <Route path="mine" element={<Loaded><MyTrips /></Loaded>} />
        <Route path="drafts" element={<Loaded><Drafts /></Loaded>} />
        <Route path="new" element={<Loaded><RequireRaise><NewTrip /></RequireRaise></Loaded>} />
        {/*
          Editing a draft is a RAISE, not a read: it writes through the same
          fms_travel_save_draft the new form does, so it carries the same gate.
          The page then checks the draft is this person's and is still a draft -
          both mirrored in the RPC, which is the real boundary.
        */}
        <Route
          path="drafts/:id"
          element={<Loaded><RequireRaise><EditDraft /></RequireRaise></Loaded>}
        />
        {/*
          ⚠ DECLARED AFTER "trips", so the literal segment wins. React Router
            ranks static over dynamic regardless of order, but the two reading in
            this order is what keeps the file honest for the next reader.
        */}
        <Route path="trips/:id" element={<Loaded><TripDetail /></Loaded>} />

        {/* ---- the eight step queues ------------------------------------ */}
        {STEPS.filter((st) => !st.noQueue).map((st) => {
          const step = st.key as QueueStep;
          // The two approval gates are the same screen — a manager and a
          // Director answer the identical question about the identical row.
          const built =
            step === "manager_approval" || step === "director_approval" ? (
              <ApprovalQueue step={step} />
            ) : step === "advance" ? (
              <AdvanceQueue />
            ) : step === "booking" ? (
              <BookingQueue mode="book" />
            ) : step === "claim" ? (
              <ClaimQueue />
            ) : step === "claim_review" ? (
              <ClaimReviewQueue />
            ) : step === "finance_review" ? (
              <FinanceReviewQueue />
            ) : step === "settlement" ? (
              <SettlementQueue />
            ) : null;
          return (
            <Route
              key={step}
              path={`queues/${QUEUE_PATH[step]}`}
              element={
                <Loaded>
                  <RequireQueue step={step}>
                    {built ?? (
                      <ComingSoon
                        title={st.title}
                        detail={`The ${st.title.toLowerCase()} queue — every trip waiting on this step, with its due date. Built in the phase that owns this step; the queue membership and due dates behind it are already live and already counted on the Control Center.`}
                      />
                    )}
                  </RequireQueue>
                </Loaded>
              }
            />
          );
        })}

        {/* ---- monitoring & reports ------------------------------------- */}
        <Route path="monitoring" element={<Loaded><ControlCenter /></Loaded>} />
        <Route path="reports" element={<Loaded><TripRegister /></Loaded>} />
        {/*
          ⚠ NOT GATED ON THE ADVANCE STEP, deliberately. This is the report §11.2
            is unenforceable without, and the people who need it are not only the
            people who disburse: an approver about to wave through a request with
            an advance on it needs to know the traveller already owes. The trips
            policy still limits WHAT each reader sees to their own rows, so an
            ordinary employee opens their own balance and nobody else's.
        */}
        <Route path="reports/outstanding-advances" element={<Loaded><OutstandingAdvances /></Loaded>} />
        <Route path="reports/upcoming" element={<Loaded><UpcomingTravel /></Loaded>} />
        <Route path="reports/cancelled" element={<Loaded><CancelledTravel /></Loaded>} />
        <Route path="reports/exceptions" element={<Loaded><PolicyExceptions /></Loaded>} />
        <Route path="reports/gst-itc" element={<Loaded><GstItcRegister /></Loaded>} />
        <Route path="reports/spend" element={<Loaded><SpendSummary /></Loaded>} />
        <Route path="reports/performance" element={<Loaded><DeskPerformance /></Loaded>} />
        {/*
          ⚠ GATED ON THE **BOOKING** STEP, because that is whose work it is.
            Cancelling a booking is the opposite job from making one and it is
            the urgent one — an airline refund window closes — so it gets its own
            screen rather than sharing the booking queue, while sharing its
            ownership.
        */}
        <Route
          path="queues/cancellations"
          element={
            <Loaded>
              <RequireQueue step="booking">
                <BookingQueue mode="cancel" />
              </RequireQueue>
            </Loaded>
          }
        />

        {/* Not gated: anyone who raises a request wants to see its outcome.
            Deciding one still needs ownership of that list, checked in the page. */}
        <Route path="master-requests" element={<Loaded><MasterRequests /></Loaded>} />

        {/* ---- administration ------------------------------------------- */}
        <Route
          path="masters"
          element={<Loaded><RequireMasterOwner><Masters /></RequireMasterOwner></Loaded>}
        />
        <Route
          path="rate-cards"
          element={
            <Loaded>
              <RequireMasterOwner type="rate_card"><RateCards /></RequireMasterOwner>
            </Loaded>
          }
        />
        <Route
          path="settings"
          element={<Loaded><RequireAdmin><Setup /></RequireAdmin></Loaded>}
        />

        {/* Legacy/typo'd deep links land on the dashboard rather than a 404. */}
        <Route path="dashboard" element={<Navigate to="/travel-desk" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function TravelDeskApp() {
  return (
    <TravelStoreProvider>
      <TravelDeskRoutes />
    </TravelStoreProvider>
  );
}
