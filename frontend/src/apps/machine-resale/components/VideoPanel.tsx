import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { callVideoFunction, deleteBunnyVideo, PortalError, VIDEO_NOT_SET_UP } from "../data/client";
import { setMachineVideo } from "../data/mrWrites";
import { VIDEO_PENDING } from "../lib/video";
import { VideoPill } from "./Pills";
import type { VideoState } from "../types";

const POLL_MS = 10_000;

/**
 * One machine's video, uploaded straight from the browser to Bunny Stream.
 *
 *   1. `mr-video-upload` (action create) makes the video on Bunny and returns a
 *      one-hour signed upload ticket. The portal holds the Bunny key; the browser
 *      never sees it.
 *   2. The machine is marked `uploading`, and tus sends the file in resumable
 *      chunks with a progress bar.
 *   3. The machine is marked `processing`; while this panel is open it asks
 *      (action status) every 10 seconds until Bunny says ready or failed, and
 *      records each change. The website plays a video only once it is ready.
 *
 * Needs a saved machine (the video is recorded on its row). Every write here moves
 * the row's updated_at, so `onRowChanged` hands the new value to the form, which
 * would otherwise mistake its own video for someone else's edit.
 *
 * Replacing or removing a video deletes the old one from the Bunny library once the
 * machine no longer points at it (the function refuses while any machine still does).
 * Deleting the whole machine does the same, in MachineForm.
 */
export default function VideoPanel({
  machineId,
  title,
  videoId,
  state,
  canEdit,
  onRowChanged,
}: {
  machineId: string | null;
  title: string;
  videoId: string | null;
  state: VideoState | null;
  canEdit: boolean;
  onRowChanged: (updatedAt: string, videoId: string | null, state: VideoState | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<tus.Upload | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [encode, setEncode] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);
  const uploadingHere = progress !== null;

  // Poll while the video is on its way. Editors only: the video service refuses a
  // view-only pass, and a viewer has nothing to record anyway.
  useEffect(() => {
    if (!canEdit || !machineId || !videoId || !state || !VIDEO_PENDING.includes(state) || uploadingHere) return;
    let stop = false;
    const tick = async () => {
      try {
        const st = await callVideoFunction({ action: "status", videoId });
        if (stop) return;
        setEncode(st.encodeProgress);
        if (st.status === state) return;
        const at = await setMachineVideo(machineId, videoId, st.status);
        if (!stop) onRowChanged(at, videoId, st.status);
      } catch (e) {
        if (e instanceof PortalError && e.kind === "not-set-up") setNotSetUp(true);
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [canEdit, machineId, videoId, state, uploadingHere, onRowChanged]);

  // Leaving the page mid-upload stops it; the machine then reads "Waiting for
  // upload" (Bunny's `created`) the next time anyone checks.
  useEffect(() => () => void uploadRef.current?.abort(), []);

  const start = async (file: File) => {
    if (!machineId) return;
    if (!file.type.startsWith("video/")) {
      setErr(`"${file.name}" is not a video file.`);
      return;
    }
    if (videoId && !window.confirm("This machine already has a video. Upload this one in its place?")) return;
    setErr(null);
    setWarn(null);
    setProgress(0);
    const oldId = videoId;
    try {
      const t = await callVideoFunction({ action: "create", title: title.trim() || "Machine video" });
      const at1 = await setMachineVideo(machineId, t.videoId, "uploading");
      onRowChanged(at1, t.videoId, "uploading");
      // The machine now points at the new video, so the old one is unused from here on.
      if (oldId && oldId !== t.videoId) void deleteBunnyVideo(oldId).then(setWarn);
      await new Promise<void>((resolve, reject) => {
        const up = new tus.Upload(file, {
          endpoint: t.tusEndpoint,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          chunkSize: 50 * 1024 * 1024,
          headers: {
            AuthorizationSignature: t.signature,
            AuthorizationExpire: String(t.expires),
            VideoId: t.videoId,
            LibraryId: t.libraryId,
          },
          metadata: { filetype: file.type, title: title.trim() || "Machine video" },
          onProgress: (sent, total) => setProgress(total ? Math.round((sent / total) * 100) : 0),
          onError: (e) => reject(e),
          onSuccess: () => resolve(),
        });
        uploadRef.current = up;
        up.start();
      });
      uploadRef.current = null;
      const at2 = await setMachineVideo(machineId, t.videoId, "processing");
      onRowChanged(at2, t.videoId, "processing");
    } catch (e) {
      if (e instanceof PortalError && e.kind === "not-set-up") setNotSetUp(true);
      else setErr(e instanceof Error ? `The video did not upload: ${e.message}` : "The video did not upload.");
    } finally {
      setProgress(null);
    }
  };

  const remove = async () => {
    if (!machineId || !window.confirm("Remove the video from this machine? The website stops showing it.")) return;
    const oldId = videoId;
    setWarn(null);
    try {
      const at = await setMachineVideo(machineId, null, null);
      onRowChanged(at, null, null);
      if (oldId) setWarn(await deleteBunnyVideo(oldId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (!machineId) {
    return <p className="text-[13px] text-grey-2">Save the machine first, then add its video here.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="text-grey">Video:</span>
        <VideoPill state={state} />
        {state === "processing" && encode !== null && <span className="text-grey-2">{encode}% encoded</span>}
        {state === "created" && !uploadingHere && <span className="text-grey-2">The upload did not finish. Upload it again.</span>}
        {state === "failed" && <span className="text-grey-2">Bunny could not process this file. Try another copy.</span>}
      </div>

      {progress !== null && (
        <div>
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-[#EEF1F6]">
            <div className="h-full bg-orange transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-[12.5px] text-grey-2">Uploading {progress}%. Keep this page open until it finishes.</p>
        </div>
      )}

      {notSetUp ? (
        <p className="rounded-lg bg-[#FFF6E5] px-3 py-2 text-[13px] text-[#8A5A00]">{VIDEO_NOT_SET_UP}</p>
      ) : (
        canEdit &&
        progress === null && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-navy hover:border-orange"
            >
              {videoId ? "Replace video" : "Upload video"}
            </button>
            {videoId && (
              <button type="button" onClick={() => void remove()} className="text-[13px] font-medium text-ryg-red hover:underline">
                Remove video
              </button>
            )}
            <span className="text-[12.5px] text-grey-2">MP4 or MOV. It goes straight to the video service.</span>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void start(f);
              }}
            />
          </div>
        )
      )}
      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      {warn && <p className="text-[12.5px] text-[#8A5A00]">{warn}</p>}
    </div>
  );
}
