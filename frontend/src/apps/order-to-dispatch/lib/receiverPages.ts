/**
 * Turning a receiver-copy page list into what the RPC wants: compress, upload,
 * and hand back `{path, name}` in the order the pages are shown.
 *
 * Shared by the two screens that collect these pages — StepModal when the
 * delivery is confirmed, AmendRoundModal when a coordinator replaces the
 * paperwork afterwards.
 */

import { compressImage } from "@/shared/lib/imageCompress";
import { uploadStepDocument } from "../data/dispatchWrites";
import type { ReceiverPage } from "../components/ReceiverCopyCapture";
import type { StepDoc } from "../types";

/**
 * Upload every not-yet-stored page and resolve the whole list to stored docs.
 *
 * ⚠ SEQUENTIAL, NOT PARALLEL. Two reasons, and neither is about throughput: the
 *   progress count has to mean something to someone watching a spinner at a
 *   customer's gate, and a phone on one bar gains nothing from four concurrent
 *   uploads except four ways to time out at once.
 *
 * ⚠ IT MEMOISES WHAT ALREADY LANDED, BY MUTATING THE PAGE OBJECTS. This app has
 *   no service worker and no offline queue, so a dropped signal mid-save throws
 *   and leaves the form on screen for the person to press Save again. Without
 *   the memo that retry re-uploads every page from the start and abandons the
 *   first attempt's objects in the bucket — on a bad connection, repeatedly.
 *
 *   The mutation is deliberate and safe: these objects live in the caller's
 *   state array, we never change the array's identity, and nothing renders
 *   `uploadedPath`. It exists only for the next attempt to read.
 *
 * @param roundNo ⚠ The round the pages BELONG TO, which for a correction is the
 *   archived round's number and NOT the order's current one. It lands in the
 *   storage path, and filing a correction under the live round's folder puts
 *   one round's proof inside another's.
 */
export async function uploadReceiverPages(
  orderId: string,
  folder: string,
  roundNo: number,
  pages: ReceiverPage[],
  onProgress?: (done: number, total: number) => void,
): Promise<StepDoc[]> {
  const pending = pages.filter((p) => p.kind === "pending" && !p.uploadedPath).length;
  let done = 0;
  const out: StepDoc[] = [];

  for (const page of pages) {
    if (page.kind === "stored") {
      out.push({ path: page.path, name: page.name });
      continue;
    }
    if (page.uploadedPath) {
      // Landed on an earlier attempt — reuse it rather than paying for it twice.
      out.push({ path: page.uploadedPath, name: page.uploadedName ?? page.file.name });
      continue;
    }

    onProgress?.(done + 1, pending);
    // A no-op for a PDF, and it never throws — a compressor failure returns the
    // original file rather than stopping a delivery being confirmed.
    const file = await compressImage(page.file);
    const up = await uploadStepDocument(orderId, folder, file, roundNo);
    page.uploadedPath = up.path;
    page.uploadedName = up.name;
    out.push(up);
    done += 1;
  }

  return out;
}
