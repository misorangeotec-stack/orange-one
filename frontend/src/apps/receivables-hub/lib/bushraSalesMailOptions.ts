/**
 * What a scheduled Sales-Dashboard mail carries, and who gets it.
 *
 * The hub already stores WHEN (report_email_schedule), WHETHER (report_email_settings) and WHO by
 * address (report_email_recipients). This adds the two a dashboard needs: which BLOCKS go in, and
 * recipients chosen as PEOPLE — the sender reads their profile email at send time, so an address
 * change needs no edit and a closed account stops receiving.
 *
 * ⚠ THE TABLES MAY NOT EXIST YET. The migration (20261125120000) ships with the branch and is
 *   applied by hand. Rather than throw a Postgres error at an admin, every read here reports
 *   `installed: false` and the screen says what is missing.
 */
import { supabase } from "@/core/platform/supabase";

const db = supabase as any;

export type MailBlock = "summary" | "company" | "performance" | "pivot";
export type MailPeriod = "month" | "quarter" | "ytd";

export const MAIL_BLOCKS: { id: MailBlock; label: string; note: string }[] = [
  { id: "summary", label: "Summary", note: "Sales, discount, net, returns, quantity, free issues" },
  { id: "company", label: "Company & location", note: "Quantity and revenue per company and per location" },
  { id: "performance", label: "Product performance", note: "This month and year to date, against last year" },
  { id: "pivot", label: "Quarter & month table", note: "Every product by quarter and month, with last year" },
];

export const MAIL_PERIODS: { id: MailPeriod; label: string }[] = [
  { id: "month", label: "This month" },
  { id: "quarter", label: "This quarter" },
  { id: "ytd", label: "Year to date" },
];

export interface MailOptions {
  blocks: MailBlock[];
  period: MailPeriod;
  attachPdf: boolean;
}

/** No row means everything, this month, with the PDF — the least surprising default. */
export const DEFAULT_MAIL_OPTIONS: MailOptions = {
  blocks: MAIL_BLOCKS.map((b) => b.id),
  period: "month",
  attachPdf: true,
};

export interface MailSetup {
  installed: boolean;
  options: MailOptions;
  userIds: string[];
}

/** A name to pick from when choosing recipients. */
export interface MailUser {
  id: string;
  name: string;
  email: string;
  /** False when this person cannot open the dashboard the mail is about. */
  mayOpen: boolean;
}

const isMissing = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "42P01" || error.code === "PGRST202" ||
    /does not exist|schema cache/i.test(error.message ?? ""));

export async function fetchMailSetup(reportKey: string): Promise<MailSetup> {
  const [optRes, userRes] = await Promise.all([
    db.from("report_email_options").select("blocks,period,attach_pdf").eq("report_key", reportKey).maybeSingle(),
    db.from("report_email_user_recipients").select("user_id").eq("report_key", reportKey),
  ]);
  if (isMissing(optRes.error) || isMissing(userRes.error)) {
    return { installed: false, options: DEFAULT_MAIL_OPTIONS, userIds: [] };
  }
  if (optRes.error) throw new Error(optRes.error.message);
  if (userRes.error) throw new Error(userRes.error.message);

  const row = optRes.data as { blocks: string[]; period: MailPeriod; attach_pdf: boolean } | null;
  const blocks = (row?.blocks ?? []).filter((b): b is MailBlock => MAIL_BLOCKS.some((x) => x.id === b));
  return {
    installed: true,
    options: {
      // An empty list in the database means "everything", so a block added later is carried by
      // existing schedules rather than silently dropped from them.
      blocks: blocks.length ? blocks : DEFAULT_MAIL_OPTIONS.blocks,
      period: row?.period ?? "month",
      attachPdf: row?.attach_pdf ?? true,
    },
    userIds: ((userRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id),
  };
}

export async function saveMailOptions(reportKey: string, options: MailOptions): Promise<void> {
  const { error } = await db.rpc("set_bushra_sales_mail_options", {
    p_report_key: reportKey,
    p_options: { blocks: options.blocks, period: options.period, attach_pdf: options.attachPdf },
  });
  if (error) throw new Error(error.message);
}

export async function saveMailUserRecipients(reportKey: string, userIds: string[]): Promise<void> {
  const { error } = await db.rpc("set_report_email_user_recipients", {
    p_report_key: reportKey,
    p_user_ids: userIds,
  });
  if (error) throw new Error(error.message);
}

/**
 * Who can be picked, and whether each may actually OPEN the dashboard being mailed.
 *
 * Someone who cannot open it can still be chosen — an owner may want a figure without giving access
 * to the screen — but the screen says so beside their name rather than letting it pass unnoticed.
 */
export async function fetchMailUsers(reportKey: string): Promise<MailUser[]> {
  // ⚠ THE COLUMN IS `name`, AND THE ROLE IS NOT ON THIS TABLE. profiles carries `name`/`email`;
  //   who is an admin lives in `user_roles` (see core/platform/liveDirectory.ts, which reads the
  //   same pair). Asking profiles for `full_name, role` returns an error and an empty picker —
  //   which is exactly what the first version did.
  const [profileRes, roleRes] = await Promise.all([
    db.from("profiles").select("id,name,email,receivables_allowed_reports").order("name"),
    db.from("user_roles").select("user_id,role"),
  ]);
  if (profileRes.error) throw new Error(profileRes.error.message);
  const admins = new Set(
    ((roleRes.data ?? []) as { user_id: string; role: string }[])
      .filter((r) => r.role === "admin")
      .map((r) => r.user_id),
  );
  return ((profileRes.data ?? []) as {
    id: string; name: string | null; email: string | null; receivables_allowed_reports: string[] | null;
  }[])
    .filter((p) => !!p.email)
    .map((p) => ({
      id: p.id,
      name: p.name || p.email || "(no name)",
      email: p.email ?? "",
      mayOpen: admins.has(p.id) || (p.receivables_allowed_reports ?? []).includes(reportKey),
    }));
}
