import { supabase } from "@/core/platform/supabase";

/**
 * Global lead masters (admin-managed). The four configurable lists the mobile
 * Leads app uses in its dropdowns, stored as a single jsonb row
 * (`app_lead_masters_global`, id = 'global') in the identity project. The mobile
 * app reads these read-only; only admins write them (RLS: is_admin). Shapes match
 * the mobile app's MasterItem / Masters (mobile/src/lib/leads/types.ts).
 */

export type MasterType = "source" | "categories" | "interestLevels" | "askedAbout" | "followUpActions";

export interface MasterItem {
  id: string;
  label: string;
  /** Optional accent color (used by interest levels). */
  color?: string;
  /** Sort order within its list. */
  order: number;
}

export type Masters = Record<MasterType, MasterItem[]>;

export const MASTER_META: { type: MasterType; label: string; hasColor: boolean; hint: string }[] = [
  { type: "source", label: "Source", hasColor: false, hint: "Where the lead came from — e.g. the exhibition name" },
  { type: "categories", label: "Categories", hasColor: false, hint: "Business type tags on a lead" },
  { type: "interestLevels", label: "Interest levels", hasColor: true, hint: "How warm the lead is (shown as a colored dot)" },
  { type: "askedAbout", label: "What they asked about", hasColor: false, hint: "What the lead enquired about" },
  { type: "followUpActions", label: "Follow-up actions", hasColor: false, hint: "The next step for this lead" },
];

const EMPTY: Masters = { source: [], categories: [], interestLevels: [], askedAbout: [], followUpActions: [] };

/** Coerce a raw jsonb blob into a well-formed Masters (missing lists → empty). */
function normalize(raw: unknown): Masters {
  const m = (raw ?? {}) as Partial<Record<MasterType, unknown>>;
  const list = (v: unknown): MasterItem[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is MasterItem => !!x && typeof (x as MasterItem).id === "string")
          .map((x, i) => ({ id: x.id, label: String(x.label ?? ""), color: x.color, order: typeof x.order === "number" ? x.order : i + 1 }))
      : [];
  return {
    source: list(m.source),
    categories: list(m.categories),
    interestLevels: list(m.interestLevels),
    askedAbout: list(m.askedAbout),
    followUpActions: list(m.followUpActions),
  };
}

/** Load the org-wide master set (the seeded 'global' row). */
export async function fetchGlobalMasters(): Promise<Masters> {
  const { data, error } = await supabase
    .from("app_lead_masters_global")
    .select("masters")
    .eq("id", "global")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalize(data.masters) : EMPTY;
}

/** Save the whole master set (admin-only under RLS). Upserts the single row. */
export async function saveGlobalMasters(masters: Masters): Promise<void> {
  const { error } = await supabase
    .from("app_lead_masters_global")
    .upsert(
      { id: "global", masters: masters as unknown as never, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) throw new Error(error.message);
}

/** Fresh master id (mirrors the mobile store's `newId`). */
export function newMasterId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
