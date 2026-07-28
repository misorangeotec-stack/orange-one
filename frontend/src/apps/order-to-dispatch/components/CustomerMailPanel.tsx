import { useMemo, useState } from "react";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { useDispatchStore } from "../store";
import { renderCustomerMail } from "../lib/customerMail";
import { dmyTime } from "../lib/format";
import type { DispatchOrder } from "../types";

/**
 * The material-status step's customer auto-mail.
 *
 * This is the ONLY place in the portal that emails outside the company, so it is
 * deliberately explicit: the exact recipient, subject and body are shown before
 * anything is armed, and the send is off unless BOTH the module-level switch
 * (Setup → Customer Mail) is on AND the customer has an address on file.
 */
export default function CustomerMailPanel({
  order,
  plannedDate,
  notify,
  onNotifyChange,
  readOnly,
}: {
  order: DispatchOrder;
  plannedDate: string;
  notify: boolean;
  onNotifyChange: (v: boolean) => void;
  readOnly?: boolean;
}) {
  const s = useDispatchStore();
  const [showBody, setShowBody] = useState(false);

  const customer = s.customers.find((c) => c.id === order.customerId);
  const template = s.mailTemplates.find((t) => t.code === s.customerMail.templateCode && t.active);

  const preview = useMemo(
    () =>
      renderCustomerMail(template, order, plannedDate, {
        customerName: customer?.name ?? "Customer",
        customerEmail: customer?.email ?? null,
        itemName: s.itemName,
        unitName: s.unitName,
      }),
    [template, order, plannedDate, customer, s],
  );

  const armed = s.customerMail.enabled;
  const canSend = armed && !preview.skipReason;

  // Already sent on a previous save — show what went out rather than offering it again.
  if (order.msMailQueuedAt) {
    return (
      <section className="space-y-2">
        <SectionHeading>Customer mail</SectionHeading>
        <p className="text-[13px] text-grey">
          Sent {dmyTime(order.msMailQueuedAt)} to <span className="font-semibold text-navy">{order.msMailTo}</span>
          {order.msMailSubject ? <> — “{order.msMailSubject}”</> : null}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2 rounded-xl border border-line bg-[#FBFCFE] p-3.5">
      <SectionHeading>Customer mail</SectionHeading>

      {!armed && (
        <p className="text-[12.5px] text-grey-2">
          Customer mail is switched off for this module. An admin can arm it in Setup → Customer Mail.
        </p>
      )}

      {armed && preview.skipReason && (
        <p className="text-[12.5px] text-yellow">{preview.skipReason}</p>
      )}

      {canSend && (
        <>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={notify}
              disabled={readOnly}
              onChange={(e) => onNotifyChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#FF6A1F]"
            />
            <span className="text-[13px] text-navy">
              Email <span className="font-semibold">{preview.to}</span> the planned dispatch date
            </span>
          </label>

          <div className="text-[12.5px] text-grey-2">
            Subject: <span className="text-navy">{preview.subject || "—"}</span>
            <button
              type="button"
              onClick={() => setShowBody((v) => !v)}
              className="ml-2 font-semibold text-orange hover:underline"
            >
              {showBody ? "hide" : "preview"}
            </button>
          </div>

          {showBody && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-white border border-line p-3 text-[12.5px] text-grey">
              {preview.body}
            </pre>
          )}
        </>
      )}
    </section>
  );
}
