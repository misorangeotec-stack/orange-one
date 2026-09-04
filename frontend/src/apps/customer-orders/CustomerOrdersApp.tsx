import { createContext, useContext, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import OrderDeskShell from "./components/OrderDeskShell";
import { fetchCustomerProfile, PROFILE_QK, type CustomerProfile } from "./data/orderDesk";
import PlaceOrder from "./pages/PlaceOrder";
import MyOrders from "./pages/MyOrders";
import OrderDetail from "./pages/OrderDetail";
import ChangePassword from "./pages/ChangePassword";
import { callUs } from "./lib/customerLabels";

/**
 * Orange Order Desk — the customer's own screen, and the only app in the portal
 * whose reader does not work here.
 *
 * Four screens: place an order, the orders they have placed, one of them, and
 * their password. Nothing else, on purpose — this is not a small version of the
 * staff module, it is a different product that happens to write into the same
 * order table.
 */

const ProfileCtx = createContext<CustomerProfile | null>(null);

/** The signed-in customer. Only ever called under a resolved profile. */
export const useCustomer = (): CustomerProfile => {
  const p = useContext(ProfileCtx);
  if (!p) throw new Error("useCustomer outside the Order Desk");
  return p;
};

/**
 * Every state before there is a customer to serve, in one place.
 *
 * ⚠ "NOT A CUSTOMER" IS NOT AN ERROR. Admins bypass module checks and see every
 *   app in their launcher, so an admin clicking this card is the ordinary way to
 *   arrive here with no customer behind the login. A red failure box would be a
 *   lie, and worse, would send them looking for a bug. They get the sentence that
 *   is actually true and where to go instead.
 */
function NotACustomer({ isStaff }: { isStaff: boolean }) {
  return (
    <OrderDeskShell title="Orange Order Desk">
      <div className="rounded-2xl border border-line bg-white p-8 max-w-2xl">
        {isStaff ? (
          <>
            <p className="text-[15px] font-semibold">This screen belongs to a customer.</p>
            <p className="text-[14px] text-grey mt-2 leading-relaxed">
              You are signed in with a staff account, so there is no customer behind it
              and nothing to show. Customers and their logins are set up in{" "}
              <span className="font-semibold text-ink">Order to Dispatch → Setup → Customer logins</span>.
            </p>
          </>
        ) : (
          <>
            <p className="text-[15px] font-semibold">Your account is not finished being set up.</p>
            <p className="text-[14px] text-grey mt-2 leading-relaxed">
              {callUs("Please call us")} and we will finish it. Nothing is wrong with your
              sign-in — there is just no ordering set up against it yet.
            </p>
          </>
        )}
      </div>
    </OrderDeskShell>
  );
}

function Loading() {
  return (
    <OrderDeskShell title="Orange Order Desk">
      <div className="rounded-2xl border border-line bg-white p-8 max-w-2xl text-[14px] text-grey">
        Loading…
      </div>
    </OrderDeskShell>
  );
}

/**
 * The browser TAB, which is the one piece of chrome an app cannot restyle away.
 *
 * ⚠ NOTHING ELSE IN THE PORTAL SETS `document.title` — every screen inherits the
 *   one in `index.html`, "Orange One — One Platform. Every Workflow.". That is our
 *   internal name and our marketing line, and on a customer's machine it is the
 *   label on the tab, in their history, and on the bookmark they make. The Order
 *   Desk goes to some length to keep our vocabulary off the page and would then
 *   have put it in the tab.
 *
 * Set once for the whole app rather than per page: each screen renders its own
 * shell, so a per-page effect would restore and re-set the title on every click
 * and flicker the tab.
 *
 * Restored on unmount, because an admin can open this app and navigate back out
 * to the staff portal in the same session — leaving their tab reading "Orange
 * Order Desk" over the Control Center.
 */
function useOrderDeskTitle() {
  useEffect(() => {
    const was = document.title;
    document.title = appName("customer-orders");
    return () => { document.title = was; };
  }, []);
}

export default function CustomerOrdersApp() {
  const { isAdmin, isExternal } = useSession();
  useOrderDeskTitle();

  const { data: profile, isLoading, error } = useQuery({
    queryKey: PROFILE_QK,
    queryFn: fetchCustomerProfile,
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <Loading />;

  if (error) {
    return (
      <OrderDeskShell title="Orange Order Desk">
        <div className="rounded-2xl border border-[#f6d2d3] bg-[#FDECEC] p-6 max-w-2xl text-[14px] text-[#B3282C]">
          We could not load your account just now. Please refresh the page, and{" "}
          {callUs("call us")} if it keeps happening.
        </div>
      </OrderDeskShell>
    );
  }

  if (!profile) return <NotACustomer isStaff={!isExternal || isAdmin} />;

  return (
    <ProfileCtx.Provider value={profile}>
      <Routes>
        <Route index element={<PlaceOrder />} />
        <Route path="orders" element={<MyOrders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="password" element={<ChangePassword />} />
        {/* Anything else under the base lands on the one screen they came for. */}
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </ProfileCtx.Provider>
  );
}
