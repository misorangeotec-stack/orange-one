/**
 * "Gate pass" — prints the slip that leaves with the consignment.
 *
 * One component behind three placements (the Gate Outward queue row, the Gate
 * Outward modal, and the order page) so the rule about WHEN a pass exists is
 * stated once. Reprinting is free and always yields the same number: the number
 * was allocated server-side with the invoice, and this only reads it.
 */
import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import { useDispatchStore } from "../store";
import { downloadGatePass, gatePassFromRound } from "../lib/gatePass";
import type { RoundView } from "../lib/rounds";
import type { DispatchOrder } from "../types";

export default function GatePassButton({
  order,
  view,
  size = "sm",
  variant = "ghost",
}: {
  order: DispatchOrder;
  view: RoundView | null;
  size?: "sm" | "md";
  variant?: "ghost" | "outline";
}) {
  const s = useDispatchStore();
  const [busy, setBusy] = useState(false);

  // No invoice, no pass. The number is issued with the sales bill, so a round
  // that has not been billed has nothing to print — say that rather than
  // producing a slip with a blank serial, which is the one field the security
  // desk actually files by.
  const gpNo = view?.gpNo ?? null;

  const print = async () => {
    if (!view || !gpNo) return;
    setBusy(true);
    try {
      // ⚠ THE EM DASH TEST IS LOAD-BEARING. `masterName` answers "—" for a null
      //   or unknown id, and a masthead reading the company name over a bare "—"
      //   is worse than one with no second line at all. Mapping it to null is
      //   what lets the slip close the gap instead of printing the dash.
      const branch = s.masterName("company_location", order.locationId);
      await downloadGatePass(
        gatePassFromRound(view, {
          orderNo: order.orderNo,
          companyName: s.masterName("company", order.companyId),
          companyLocation: branch === "—" ? null : branch,
          customerName: s.customerName(order.customerId),
          customerLocation: order.customerLocation,
          itemName: s.itemName,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size={size}
      variant={variant}
      onClick={print}
      disabled={busy || !gpNo}
      title={gpNo ? `Gate pass ${gpNo}` : "Available once the sales bill is recorded"}
    >
      {busy ? "Preparing…" : "Gate pass"}
    </Button>
  );
}
