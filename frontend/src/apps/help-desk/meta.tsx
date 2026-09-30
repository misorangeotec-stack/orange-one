import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import HelpDeskApp from "./HelpDeskApp";

/**
 * Manifest for the HR Help Desk — the fifteenth FMS module, built on the same
 * engine as the others (step owners, per-step due dates, per-owner queues,
 * notifications) with its own `fms_help_*` schema.
 *
 * What it is for: HR answers the same questions all day, by WhatsApp, by walking
 * over, by mail. Nothing records who asked, when, who answered, or whether the
 * answer ever came — so the TATs the appraisal sheets promise ("1 working day"
 * for an attendance correction, "2 working days" for a payroll query) have no
 * clock anywhere and are decorative.
 *
 * ⚠ THE CATEGORY IS THE ROUTER, and it is the one idea to understand before
 *   reading anything else here. `fms_help_categories` decides who owns a ticket,
 *   how long they have, who a reopen escalates to, whether it is confidential,
 *   and whether the work actually belongs to another module. The employee picks
 *   one thing; everything else follows.
 *
 * ⚠ THE RESOLVE SLA IS PER CATEGORY, NOT PER STEP — the only module here that
 *   works that way, and five categories are deliberately UNTIMED ("As per POSH
 *   Policy", "As per Exit Policy"…). See lib/sla.ts before touching a due date.
 *
 * ⚠ UNIVERSAL (apps/universal.ts). Anyone may need to ask HR something, so
 *   granting it per user would mean 70 tick-boxes before the first question
 *   could be asked. The consequence, worth saying to admins once: a universal
 *   app has NO `app_access` rows, so the Module Access matrix shows it as
 *   admins-only and there is nothing to tick. That is not a bug and the grants
 *   are not missing. RLS does the scoping instead — a plain employee sees their
 *   own tickets and the category list, and nothing else.
 *
 *   The same fact has a sharper edge in SQL: `module_can_edit()` is FALSE for
 *   every non-admin on a universal module, so no `fms_help_*` function may gate
 *   on it. A migration assertion proves none does.
 *
 * ⚠ ELEVEN CATEGORIES HAND OFF to Travel Desk, New Recruitment, General
 *   Purchase, Learning & Development and Employee Exit. Help Desk is the one
 *   front door; the WORK still happens in the module that owns it. Resolving a
 *   travel booking inside Help Desk is how the same trip gets counted twice in
 *   two people's KPIs.
 */
export const helpDeskApp: AppManifest = {
  id: "help-desk",
  name: appName("help-desk"),
  description:
    "One place to ask HR anything: attendance, payroll, leave, travel, admin. See where your question has got to. The category you pick decides who answers it and by when.",
  basePath: appBasePath("help-desk"),
  status: "live",
  category: appCategory("help-desk"),
  subGroup: appSubGroup("help-desk"),
  // HR runs New Recruitment (10) → Learning & Development (20) → Employee Exit →
  // Travel Desk (30) → Help Desk (40). Last because it is the one everybody
  // uses and the one that points at all the others.
  order: 40,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M9.2 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.6 2.3-2.6 3.8" stroke="#FF6A1F" />
      <path d="M12 16.5h.01" stroke="#FF6A1F" />
    </svg>
  ),
  Component: HelpDeskApp,
};
