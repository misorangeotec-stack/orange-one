import { formatDate } from "@/shared/lib/time";
import { appName } from "@/apps/appInfo";
import type { PersonItem, PersonWork } from "../data/peopleWork";

/**
 * The little bits of text the Call List hands the coordinator — a dialable number,
 * a WhatsApp link, and a reminder she can paste rather than type out per person.
 */

/** Whole days from `dueIso` to `todayIso`; positive = that many days late. */
export function daysLate(dueIso: string | null, todayIso: string): number | null {
  if (!dueIso) return null;
  return Math.round((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${dueIso}T00:00:00Z`)) / 86_400_000);
}

/**
 * Digits only, Indian numbers given their 91 prefix — the form wa.me accepts.
 * Null when there is nothing dialable left.
 */
export function waNumber(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 ? d : null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function line(it: PersonItem, todayIso: string): string {
  const late = daysLate(it.dueIso, todayIso);
  const when =
    it.bucket === "overdue" && late != null
      ? `due ${formatDate(it.dueIso)} (${late}d late)`
      : it.bucket === "today"
        ? "due today"
        : it.dueIso
          ? `due ${formatDate(it.dueIso)}`
          : "no due date";
  return `• ${appName(it.appId)} · ${it.ref}${it.stage ? ` · ${it.stage}` : ""} · ${when}`;
}

/**
 * The reminder: overdue + due today first, because that is what the call is
 * about. If they have neither, it lists the rest so the message is never empty.
 * Capped so a WhatsApp message stays readable; the count says what was left out.
 */
export function reminderText(row: PersonWork, todayIso: string, max = 15): string {
  const urgent = row.items.filter((i) => i.bucket === "overdue" || i.bucket === "today");
  const pick = urgent.length ? urgent : row.items.filter((i) => i.bucket !== "hold");
  const shown = pick.slice(0, max);
  const head =
    urgent.length > 0
      ? `Hi ${firstName(row.person.name)}, a reminder from the Process Coordinator — these FMS steps are waiting on you:`
      : `Hi ${firstName(row.person.name)}, a reminder from the Process Coordinator — these FMS steps are coming up for you:`;
  const more = pick.length > shown.length ? `\n…and ${pick.length - shown.length} more on your My Control Center.` : "";
  return `${head}\n\n${shown.map((i) => line(i, todayIso)).join("\n")}${more}\n\nPlease close them in Orange Hub today. Thank you!`;
}
