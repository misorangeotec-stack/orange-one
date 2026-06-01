import { useCallback, useEffect, useRef, useState } from "react";

export type RefreshStatus = "idle" | "starting" | "running" | "done" | "error";

interface ProgressEvent {
  stage?: string;
  percent?: number;
  status?: "done" | "error";
  message?: string;
}

interface UseRefreshJobResult {
  status: RefreshStatus;
  progress: number;
  stageLabel: string;
  elapsed: number;
  error: string | null;
  start: () => void;
  reset: () => void;
}

const REFRESH_API_URL      = (import.meta.env.VITE_REFRESH_API_URL ?? "").trim();
const REFRESH_API_PASSWORD = (import.meta.env.VITE_REFRESH_API_PASSWORD ?? "").trim();

export function useRefreshJob(): UseRefreshJobResult {
  const [status, setStatus]         = useState<RefreshStatus>("idle");
  const [progress, setProgress]     = useState(0);
  const [stageLabel, setStageLabel] = useState("");
  const [elapsed, setElapsed]       = useState(0);
  const [error, setError]           = useState<string | null>(null);

  const startTime  = useRef<number | null>(null);
  const tickRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const sourceRef  = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (tickRef.current)   { clearInterval(tickRef.current); tickRef.current = null; }
    if (sourceRef.current) { sourceRef.current.close();      sourceRef.current = null; }
  }, []);

  const reset = useCallback(() => {
    cleanup();
    startTime.current = null;
    setStatus("idle");
    setProgress(0);
    setStageLabel("");
    setElapsed(0);
    setError(null);
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    if (status === "starting" || status === "running") return;
    if (!REFRESH_API_URL) {
      setStatus("error");
      setError("Refresh service is not configured. Set VITE_REFRESH_API_URL.");
      return;
    }

    setStatus("starting");
    setProgress(0);
    setStageLabel("Starting refresh…");
    setElapsed(0);
    setError(null);
    startTime.current = Date.now();

    tickRef.current = setInterval(() => {
      if (startTime.current) {
        setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
      }
    }, 1000);

    try {
      const resp = await fetch(`${REFRESH_API_URL}/api/refresh`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password: REFRESH_API_PASSWORD }),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(body || `Refresh failed (${resp.status})`);
      }

      const { jobId } = (await resp.json()) as { jobId: string };
      if (!jobId) throw new Error("Refresh service did not return a job ID.");

      setStatus("running");

      const es = new EventSource(`${REFRESH_API_URL}/api/refresh/${encodeURIComponent(jobId)}/stream`);
      sourceRef.current = es;

      es.onmessage = (ev) => {
        let data: ProgressEvent;
        try { data = JSON.parse(ev.data); } catch { return; }

        if (typeof data.stage   === "string") setStageLabel(data.stage);
        if (typeof data.percent === "number") setProgress(Math.max(0, Math.min(100, data.percent)));

        if (data.status === "done") {
          cleanup();
          setStatus("done");
          setProgress(100);
        } else if (data.status === "error") {
          cleanup();
          setStatus("error");
          setError(data.message || "Refresh failed.");
        }
      };

      es.onerror = () => {
        // EventSource fires onerror on close too. Only treat as error if we're not done.
        if (sourceRef.current === es) {
          cleanup();
          setStatus("error");
          setError("Lost connection to refresh service.");
        }
      };
    } catch (e) {
      cleanup();
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not reach refresh service.");
    }
  }, [status, cleanup]);

  return { status, progress, stageLabel, elapsed, error, start, reset };
}
