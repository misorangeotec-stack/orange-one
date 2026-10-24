import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import { useTravelStore } from "../store";
import { exportTripAttachments } from "../lib/exportAttachments";
import type { Trip } from "../types";

/**
 * "Export all attachments" — one trip on the trip page, or every selected trip
 * from a list. Everything it zips the viewer could already open one by one.
 */
export default function ExportAttachmentsButton({
  trips,
  label = "Export all attachments",
  variant = "outline",
}: {
  trips: Trip[];
  label?: string;
  variant?: "outline" | "primary";
}) {
  const s = useTravelStore();
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setErr(null);
    setProgress("Preparing…");
    try {
      await exportTripAttachments(
        trips.map((trip) => ({
          trip,
          legs: s.legsOf(trip.id),
          cancellations: s.cancellationsOf(trip.id),
          claimLines: s.claimLinesOf(trip.id),
        })),
        (done, total) => setProgress(`${done} of ${total} files…`),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant={variant} onClick={run} disabled={progress !== null || trips.length === 0}>
        {progress ?? label}
      </Button>
      {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
    </span>
  );
}
