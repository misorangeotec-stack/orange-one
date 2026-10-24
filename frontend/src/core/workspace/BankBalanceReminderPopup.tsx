import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { useSession } from "@/core/platform/session";
import { TASK_NOTIF_KEY } from "@/apps/task-management/lib/useMyNotifications";
import { fetchMyNotifications } from "@/apps/task-management/data/fetchTaskData";

/**
 * Daily Report bank balances not entered — a pop-up on opening the hub (user, 24-Oct-2026).
 *
 * From 10:30 AM, ff_bank_chase (migration 20270219120000_fund_flow.sql, every 15 minutes) drops a
 * 'fund_flow' bell row linking to Daily Report → Bank balances for the Daily Report team, the CFO
 * and Dimple, and after three unanswered reminders the Directors too. The bell is easy to miss,
 * so the open reminder also comes up here each time the hub is opened. Once every balance is
 * entered the chase marks its rows read, and this stops by itself.
 *
 * "Each time the hub is opened" = once per browser tab session, as the task reminder pop-up.
 */
const SEEN_KEY = "ff:bank-reminder-popup-seen";
const LINK = "/daily-report/bank-balances";

function seenThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export default function BankBalanceReminderPopup() {
  const { user } = useSession();
  const navigate = useNavigate();
  // Same query key as the bell, so this shares its cache, fetch and realtime refresh.
  const { data: notifications = [] } = useQuery({
    queryKey: [TASK_NOTIF_KEY, user?.id ?? null],
    queryFn: () => fetchMyNotifications(user!.id),
    enabled: !!user,
  });
  const [dismissed, setDismissed] = useState(seenThisSession);

  // The latest open reminder (each one restates what is still missing).
  const latest = useMemo(
    () => notifications.find((n) => n.type === "fund_flow" && n.link === LINK && !n.readAt) ?? null,
    [notifications],
  );

  const close = () => {
    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode: it just shows again next time */
    }
    setDismissed(true);
  };

  if (dismissed || !latest) return null;
  return (
    <Modal
      open
      onClose={close}
      title="Bank balances not entered"
      subtitle="The Fund Flow's balance as on today comes from these. This shows each time you open the hub until they are entered."
      footer={
        <>
          <Button variant="ghost" onClick={close}>Later</Button>
          <Button onClick={() => { close(); navigate(LINK); }}>Enter bank balances</Button>
        </>
      }
    >
      <div className="flex items-start gap-3 py-2">
        <span className="text-[18px] leading-none">🏦</span>
        <div className="text-[13.5px] font-medium text-navy">{latest.message}</div>
      </div>
    </Modal>
  );
}
