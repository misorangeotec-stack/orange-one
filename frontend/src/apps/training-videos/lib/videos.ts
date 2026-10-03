/**
 * Training video links — read and written straight against `public.training_videos`.
 * RLS is the gate (20270104120000): staff read the videos of the modules they hold, admins
 * read everything and are the only ones who write.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/core/platform/supabase";
import { APPS } from "../../appInfo";

/**
 * The module grant a video's module is opened under, when that is not its own id. Reports
 * rides the Outstanding Dashboard grant (reports/meta.tsx `accessAppId`), so a Reports video
 * belongs to whoever holds that. The SQL policy carries the same mapping.
 */
const ACCESS_ALIAS: Record<string, string> = { reports: "outstanding-dashboard" };
export const accessAppIdFor = (appId: string) => ACCESS_ALIAS[appId] ?? appId;

/** The module's display name, the same one the left menu shows. */
export const moduleName = (appId: string) => APPS[appId]?.name ?? appId;

/** Old local-test rows stored the module's NAME; map it back to the id on read. */
const idForName = (name: string) => Object.entries(APPS).find(([, a]) => a.name === name)?.[0] ?? name;

/**
 * The generated `Database` type knows nothing about `training_videos` until types are
 * regenerated from the live schema. One untyped handle keeps the escape hatch in one place.
 */
const db = supabase as unknown as SupabaseClient;

/**
 * LOCAL TEST MODE — on localhost (`npm run dev`) the videos are kept in this browser, not in
 * the database. The local app talks to the LIVE database, and test videos must not land
 * there. Every deployed build has `DEV` false and reads/writes `training_videos` as normal.
 */
export const LOCAL_TEST = import.meta.env.DEV;
const LOCAL_KEY = "training-videos:local-test:v1";

const readLocal = (): Row[] => {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    return (v as (Row & { module?: string })[]).map((r) =>
      r.app_id ? r : { ...r, app_id: idForName(r.module ?? "") },
    );
  } catch {
    return [];
  }
};
const writeLocal = (rows: Row[]) => localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));

export interface TrainingVideo {
  id: string;
  /** The portal module (app id) this video teaches — decides who sees it. */
  appId: string;
  title: string;
  url: string;
  description: string | null;
  sortOrder: number;
  updatedAt: string;
}

export interface VideoDraft {
  appId: string;
  title: string;
  url: string;
  description: string;
  sortOrder: number;
}

interface Row {
  id: string;
  app_id: string;
  title: string;
  url: string;
  description: string | null;
  sort_order: number;
  updated_at: string;
}

const fromRow = (r: Row): TrainingVideo => ({
  id: r.id,
  appId: r.app_id,
  title: r.title,
  url: r.url,
  description: r.description,
  sortOrder: r.sort_order,
  updatedAt: r.updated_at,
});

export async function fetchVideos(): Promise<TrainingVideo[]> {
  if (LOCAL_TEST) return readLocal().map(fromRow);
  const { data, error } = await db
    .from("training_videos")
    .select("id,app_id,title,url,description,sort_order,updated_at")
    .order("app_id")
    .order("sort_order")
    .order("title");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(fromRow);
}

/**
 * Why a link is refused, or null when it is fine.
 *
 * The company is on Microsoft 365 and Google is blocked on its network (02-10-2026), so the
 * recordings live on OneDrive / SharePoint. A YouTube or Google Drive link would not open for
 * staff, so both are refused at the door. Any other real http(s) link is accepted.
 */
export function linkProblem(raw: string): string | null {
  const url = raw.trim();
  if (!url) return "Paste the OneDrive / SharePoint link.";
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "The link must start with https://";
    host = u.hostname.toLowerCase();
  } catch {
    return "That is not a valid link. In OneDrive, use Share → Copy link.";
  }
  if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) {
    return "YouTube links are not used here — upload the video to OneDrive and paste its link.";
  }
  if (host === "drive.google.com" || host === "docs.google.com" || host.endsWith(".googleusercontent.com")) {
    return "Google is blocked on the company network — upload the video to OneDrive and paste its link.";
  }
  return null;
}

/** A OneDrive / SharePoint / Stream link — the company's own Microsoft 365 storage. */
export const isMicrosoftLink = (url: string) => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h.endsWith(".sharepoint.com") || h === "onedrive.live.com" || h === "1drv.ms" ||
      h.endsWith(".microsoftstream.com") || h === "stream.microsoft.com"
    );
  } catch {
    return false;
  }
};

const toRow = (d: VideoDraft) => ({
  app_id: d.appId,
  title: d.title.trim(),
  url: d.url.trim(),
  description: d.description.trim() || null,
  sort_order: Number.isFinite(d.sortOrder) ? Math.round(d.sortOrder) : 100,
});

export async function saveVideo(id: string | null, d: VideoDraft, userId: string): Promise<void> {
  if (LOCAL_TEST) {
    const rows = readLocal();
    const now = new Date().toISOString();
    if (id) writeLocal(rows.map((r) => (r.id === id ? { ...r, ...toRow(d), updated_at: now } : r)));
    else writeLocal([...rows, { id: crypto.randomUUID(), ...toRow(d), updated_at: now }]);
    return;
  }
  const row = { ...toRow(d), updated_by: userId };
  const { error } = id
    ? await db.from("training_videos").update(row).eq("id", id)
    : await db.from("training_videos").insert({ ...row, created_by: userId });
  if (error) throw new Error(error.message);
}

export async function deleteVideo(id: string): Promise<void> {
  if (LOCAL_TEST) return writeLocal(readLocal().filter((r) => r.id !== id));
  const { error } = await db.from("training_videos").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
