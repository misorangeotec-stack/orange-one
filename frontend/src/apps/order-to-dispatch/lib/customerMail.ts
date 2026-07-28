/**
 * Client-side render of a customer mail template — the PREVIEW half of
 * `fms_dispatch_render_mail_template()`.
 *
 * The server is what actually renders and sends; this exists so the store keeper
 * can read the exact words before arming the send, rather than mailing a customer
 * blind. Keep the token list in step with the SQL function.
 */
import { dmy, DISPATCH_TYPE_LABEL } from "./format";
import type { DispatchOrder, MailTemplate } from "../types";

export interface MailPreview {
  subject: string;
  body: string;
  to: string | null;
  /** Why nothing will be sent, when that is the case. */
  skipReason: string | null;
}

export interface MailPreviewDeps {
  customerName: string;
  customerEmail: string | null;
  itemName: (id: string | null) => string;
  unitName: (id: string | null) => string;
}

const applyTokens = (text: string, tokens: Record<string, string>): string =>
  Object.entries(tokens).reduce(
    (acc, [k, v]) => acc.split(`{{${k}}}`).join(v),
    text,
  );

/** One line per order line: "Item · 250 KGS". */
export function itemsBlock(order: DispatchOrder, deps: MailPreviewDeps): string {
  if (!order.lines.length) return "—";
  return order.lines
    .map((l) => {
      const qty = l.finalQty ?? l.quantity;
      const unit = deps.unitName(l.finalUnitId ?? l.unitId);
      return `• ${deps.itemName(l.itemId)} — ${qty}${unit && unit !== "—" ? ` ${unit}` : ""}`;
    })
    .join("\n");
}

export function renderCustomerMail(
  template: MailTemplate | undefined,
  order: DispatchOrder,
  plannedDateIso: string,
  deps: MailPreviewDeps,
): MailPreview {
  const skipReason = !template
    ? "No customer mail template is configured."
    : !deps.customerEmail
      ? "This customer has no email address on file — the mail will be skipped and noted on the order."
      : null;

  const tokens: Record<string, string> = {
    customer: deps.customerName,
    order_no: order.orderNo,
    order_date: dmy(order.orderDate),
    planned_dispatch_date: plannedDateIso ? dmy(plannedDateIso) : dmy(order.promisedDate),
    items: itemsBlock(order, deps),
    type: DISPATCH_TYPE_LABEL[order.dispatchType],
  };

  return {
    subject: applyTokens(template?.subject ?? "", tokens),
    body: applyTokens(template?.body ?? "", tokens),
    to: deps.customerEmail,
    skipReason,
  };
}
