/**
 * The single data hook for the Leads Dashboard. Reads all captured leads from the
 * identity project's `app_leads` (cross-user read is enabled server-side by the
 * `app_leads_select_dashboard` RLS policy for admins + `leads-dashboard` grantees),
 * plus the global masters and a salesperson id→name map. Normalizes each row into
 * a flat `Lead` the pages/charts consume. Read-only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/core/platform/supabase";
import { useDirectory } from "@/core/platform/store";
import type { Lead, LeadPayload, MasterItem, Masters, PersonInfo } from "./types";

const EMPTY_MASTERS: Masters = { source: [], categories: [], interestLevels: [], askedAbout: [], followUpActions: [] };

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];

function parseMasters(raw: unknown): Masters {
  if (!raw || typeof raw !== "object") return EMPTY_MASTERS;
  const obj = raw as Record<string, unknown>;
  const pick = (k: string): MasterItem[] =>
    Array.isArray(obj[k])
      ? (obj[k] as unknown[])
          .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
          .map((i) => ({ id: String(i.id ?? ""), label: String(i.label ?? ""), color: typeof i.color === "string" ? i.color : undefined, order: typeof i.order === "number" ? i.order : undefined }))
          .filter((i) => i.id)
      : [];
  return {
    source: pick("source"),
    categories: pick("categories"),
    interestLevels: pick("interestLevels"),
    askedAbout: pick("askedAbout"),
    followUpActions: pick("followUpActions"),
  };
}

const allMobiles = (p: LeadPayload): string[] => {
  const people: PersonInfo[] = [p.person, ...(p.additionalPeople ?? [])].filter(Boolean) as PersonInfo[];
  return Array.from(new Set([...people.flatMap((x) => strArr(x.mobiles)), ...strArr(p.company?.mobiles)]));
};
const allEmails = (p: LeadPayload): string[] => {
  const people: PersonInfo[] = [p.person, ...(p.additionalPeople ?? [])].filter(Boolean) as PersonInfo[];
  return Array.from(new Set([...people.flatMap((x) => strArr(x.emails)), ...strArr(p.company?.emails)]));
};

export interface LeadsData {
  leads: Lead[];
  masters: Masters;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useLeadsData(): LeadsData {
  const { profileById } = useDirectory();
  const [leadsRaw, setLeadsRaw] = useState<{ id: string; user_id: string; person_name: string | null; company_name: string | null; interest_level_id: string | null; follow_up_action_id: string | null; captured_on: string | null; updated_at: string; payload: LeadPayload }[]>([]);
  const [masters, setMasters] = useState<Masters>(EMPTY_MASTERS);
  const [salesById, setSalesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [leadsRes, mastersRes, salesRes] = await Promise.all([
          supabase
            .from("app_leads")
            .select("id,user_id,person_name,company_name,interest_level_id,follow_up_action_id,captured_on,updated_at,payload")
            .eq("deleted", false)
            .order("captured_on", { ascending: false }),
          supabase.from("app_lead_masters_global").select("masters").eq("id", "global").maybeSingle(),
          supabase.rpc("leads_dashboard_salespeople"),
        ]);
        if (!active) return;
        if (leadsRes.error) throw leadsRes.error;

        setLeadsRaw(
          (leadsRes.data ?? []).map((r) => ({ ...r, payload: (r.payload ?? {}) as LeadPayload }))
        );
        setMasters(parseMasters(mastersRes.data?.masters));
        const map: Record<string, string> = {};
        for (const s of salesRes.data ?? []) if (s.id) map[s.id] = s.name || s.email || "";
        setSalesById(map);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load leads.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tick]);

  const leads = useMemo<Lead[]>(() => {
    const nameFor = (uid: string) => salesById[uid] || profileById(uid)?.name || profileById(uid)?.email || `User ${uid.slice(0, 6)}`;
    return leadsRaw.map((r) => {
      const p = r.payload ?? {};
      const people = [p.person, ...(p.additionalPeople ?? [])].filter(Boolean) as PersonInfo[];
      const names = people.map((x) => (x.name || "").trim()).filter(Boolean);
      const primaryName = r.person_name || p.person?.name || "";

      const isPath = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";
      const cardImages = [p.cardImages?.front, p.cardImages?.back].filter(isPath);
      const photos = people
        .map((x, i) => ({ label: (x.name || "").trim() || `Person ${i + 1}`, uri: x.photoUri }))
        .filter((x): x is { label: string; uri: string } => isPath(x.uri));
      const voiceNotes = (Array.isArray(p.voiceNotes) ? p.voiceNotes : [])
        .filter((v) => v && isPath(v.uri))
        .map((v) => ({ uri: v.uri as string, transcript: v.transcript ?? null, summary: v.summary ?? null, status: v.status ?? null }));

      return {
        id: r.id,
        userId: r.user_id,
        salesperson: nameFor(r.user_id),
        personName: primaryName,
        jobTitle: (p.person?.jobTitles ?? []).find(Boolean) ?? "",
        people: names.length ? names : primaryName ? [primaryName] : [],
        companyName: r.company_name || p.company?.name || "",
        sourceId: p.sourceId ?? null,
        interestLevelId: r.interest_level_id ?? p.interestLevelId ?? null,
        followUpActionId: r.follow_up_action_id ?? p.followUpActionId ?? null,
        categoryIds: strArr(p.categoryIds),
        askedAboutIds: strArr(p.askedAboutIds),
        mobiles: allMobiles(p),
        emails: allEmails(p),
        peopleCount: 1 + (Array.isArray(p.additionalPeople) ? p.additionalPeople.length : 0),
        hasVoice: voiceNotes.length > 0,
        location: typeof p.capturedAt?.address === "string" ? p.capturedAt.address : "",
        capturedOn: r.captured_on ?? p.capturedOn ?? null,
        updatedAt: r.updated_at,
        cardImages,
        photos,
        voiceNotes,
        hasPhotos: cardImages.length > 0 || photos.length > 0,
      };
    });
  }, [leadsRaw, salesById, profileById]);

  return { leads, masters, loading, error, reload };
}
