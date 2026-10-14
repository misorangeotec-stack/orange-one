import { callVideoFunction, PortalError } from "../data/client";
import { setMachineVideo } from "../data/mrWrites";
import type { VideoState } from "../types";

/**
 * States worth asking Bunny about again. `ready` and `failed` are final, and
 * `created` means nothing has arrived yet: only a new upload changes it.
 */
export const VIDEO_PENDING: VideoState[] = ["uploading", "processing"];

/**
 * Ask the video service where a machine's video has got to, and record it on the
 * machine when it changed (the website shows a video only once it reads `ready`).
 *
 * `uploading` is set by the form while the bytes are still going up; Bunny itself
 * calls that `created`. So `created` does not overwrite `uploading` while this tab
 * is the one uploading (`uploadingHere`). Anywhere else it means the upload was
 * abandoned, and the machine reads "Waiting for upload" until someone uploads again.
 *
 * Returns the new state and the row's new updated_at when it wrote, else null.
 * A 503 (video service keys not added) is returned as `notSetUp` and never thrown.
 */
export async function refreshVideoState(
  machineId: string,
  videoId: string,
  current: VideoState | null,
  uploadingHere = false,
): Promise<{ state: VideoState; updatedAt: string } | { notSetUp: true } | null> {
  try {
    const st = await callVideoFunction({ action: "status", videoId });
    const next: VideoState = st.status;
    if (next === "created" && current === "uploading" && uploadingHere) return null;
    if (next === current) return null;
    const updatedAt = await setMachineVideo(machineId, videoId, next);
    return { state: next, updatedAt };
  } catch (e) {
    if (e instanceof PortalError && e.kind === "not-set-up") return { notSetUp: true };
    throw e;
  }
}

/**
 * The 11-character id inside a YouTube link (watch, youtu.be, shorts, embed or live),
 * or null. Same rule as the portal's `mr_youtube_id()` and its column check, so a link
 * the form accepts is one the database accepts.
 */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!/^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)[A-Za-z0-9_-]{11}/.test(url)) return null;
  const m = url.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
