import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import LearningDevelopmentApp from "./LearningDevelopmentApp";

/**
 * Manifest for the Learning & Development FMS — built on the same engine pattern
 * as Order to Dispatch and New Recruitment (step owners, planned-vs-actual due
 * dates, per-owner queues, notifications, master governance) with its own
 * `fms_ld_*` schema.
 *
 * The journey: somebody spots a skill gap → HR validates it → HR works out the
 * proposal, priority and budget → the HR Head approves and, when the configured
 * rule says so, Management approves too → a trainer is confirmed → a session goes
 * on the calendar → HODs nominate their people and HR approves the list →
 * invitations go out for RSVP → material is shared → the session runs →
 * attendance is marked → an assignment is issued and submitted → participants
 * give feedback → HR reviews the session → thirty days later each HOD records
 * whether it made a difference → follow-up, then closure.
 *
 * ⚠ UNIVERSAL (apps/universal.ts), and it is the only FMS here that is.
 *   Every employee is a potential participant: they have to be able to accept an
 *   invitation, read the material and upload their assignment. Granting it per
 *   user would mean 67 tick-boxes before the first invitation could go out, and a
 *   nominee without a grant would be emailed a link to a page they cannot open.
 *
 *   The consequence, worth saying to admins once: a universal app has NO
 *   `app_access` rows, so the Module Access matrix shows it as admins-only and
 *   there is nothing to tick. That is not a bug and the grants are not missing.
 *   The nav and RLS do the scoping instead — a plain employee sees the training
 *   calendar and their own requests; the queues, the pipeline and Setup belong to
 *   the people who own them.
 *
 * ⚠ NO ASSESSMENT. The client dropped test scoring entirely on 21-09-2026 —
 *   only whether each nominee submitted their assignment is tracked. §3 step 12
 *   of the source document asks for a post-test; it is deliberately absent.
 */
export const learningDevelopmentApp: AppManifest = {
  id: "learning-development",
  name: appName("learning-development"),
  description:
    "Training end to end: raise a need, validate it, budget and approve it, confirm a trainer, put the session on a calendar everyone can see, nominate and invite people, mark attendance, collect the assignment and feedback, and record thirty days later whether it made a difference.",
  basePath: appBasePath("learning-development"),
  status: "live",
  category: appCategory("learning-development"),
  subGroup: appSubGroup("learning-development"),
  order: 20,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4 2.5 8.5 12 13l9.5-4.5L12 4z" />
      <path d="M6.5 11v4.5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V11" stroke="#FF6A1F" />
      <path d="M21.5 8.5V14" />
    </svg>
  ),
  Component: LearningDevelopmentApp,
};
