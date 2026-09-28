import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { useSession } from "@/core/platform/session";
import { APPS } from "@/apps/appInfo";
import { CATEGORIES, UNCATEGORISED_LABEL } from "@/apps/categories";
import { isUniversalApp } from "@/apps/universal";
import {
  addDaysIso,
  audienceLabel,
  dmy,
  todayIst,
  usePublishAnnouncement,
  useRecipientCount,
} from "@/core/announcements/data";
import AnnouncementFields, { validateFields, type FieldValues } from "../components/AnnouncementFields";
import EmailPreview from "../components/EmailPreview";
import { B } from "../nav";

/**
 * Modules an announcement can be narrowed to.
 *
 * Read from `appInfo` (an import-free leaf), NOT the registry: the registry imports
 * this app's own manifest, so reading it from here would be a circular import.
 *
 * Left out on purpose:
 *   • customer-orders — its users are customers, and the database never lets a
 *     customer be in an audience, so picking it would reach only the admins.
 *   • announcements — "people who may post" is not an audience anyone means.
 *   • any universal app — everyone holds it, so it would mean "all staff" while
 *     reading like a narrower choice. (None exists today.)
 */
const EXCLUDED = new Set(["customer-orders", "announcements"]);

function moduleOptions(): MultiOption[] {
  return Object.entries(APPS)
    .filter(([id]) => !EXCLUDED.has(id) && !isUniversalApp(id))
    .map(([id, a]) => ({
      value: id,
      label: a.name,
      group: CATEGORIES.find((c) => c.key === a.category)?.label ?? UNCATEGORISED_LABEL,
    }))
    .sort((x, y) => (x.group ?? "").localeCompare(y.group ?? "") || x.label.localeCompare(y.label));
}

type Audience = "all" | "modules";

/**
 * PF-18 · Write an announcement.
 *
 * Everything that decides who is reached is shown BEFORE Publish, as the user asked:
 * the live head-count for the audience, and — only when "Also email" is ticked — the
 * number of people who will be mailed and a preview of the mail. Publish itself opens
 * a confirmation that says, in one line each, exactly what is about to happen.
 *
 * Email ships disarmed. While the announcements switch is off the tick-box is
 * disabled with the reason beside it, and the database refuses the request anyway.
 */
export default function Compose() {
  const navigate = useNavigate();
  const { user, canEditModule, isExternal } = useSession();
  const canPost = !isExternal && canEditModule("announcements");
  const options = useMemo(moduleOptions, []);

  const [fields, setFields] = useState<FieldValues>(() => ({
    title: "",
    body: "",
    link: "",
    endsOn: addDaysIso(todayIst(), 7),
  }));
  const [audience, setAudience] = useState<Audience>("all");
  const [modules, setModules] = useState<string[]>([]);
  const [email, setEmail] = useState(false);
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [serverError, setServerError] = useState("");

  const picked = audience === "all" ? [] : modules;
  const needsModules = audience === "modules" && modules.length === 0;
  const count = useRecipientCount(picked, canPost && !needsModules);
  const emailEnabled = count.data?.email_enabled ?? false;
  const publish = usePublishAnnouncement();

  const errors = validateFields(fields, { checkEnd: true });
  const valid = Object.keys(errors).length === 0 && !needsModules;

  if (!canPost) {
    return (
      <Card className="max-w-2xl p-6 text-[14px] text-grey">
        Posting announcements needs Full access to the Announcements module. You can still read every
        announcement meant for you on <Link to="/announcements" className="font-semibold text-orange hover:underline">the Announcements page</Link>.
      </Card>
    );
  }

  const shows = count.data?.shows_to;
  const emails = count.data?.emails_to;
  const audienceText = audience === "all" ? "All staff" : `People with ${audienceLabel(modules)}, and admins`;

  const onPublish = () => {
    setTouched(true);
    setServerError("");
    if (!valid || count.isLoading || !count.data) return;
    setConfirming(true);
  };

  const doPublish = () => {
    publish.mutate(
      {
        title: fields.title.trim(),
        body: fields.body,
        link: fields.link,
        endsOn: fields.endsOn,
        modules: picked,
        email: email && emailEnabled,
      },
      {
        onSuccess: (res) => {
          setConfirming(false);
          navigate(B, { state: { published: fields.title.trim(), emailed: res.emailed_count } });
        },
        onError: (e) => {
          setConfirming(false);
          setServerError((e as Error).message);
        },
      }
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">New announcement</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          It shows at the top of every screen in the hub for the people it is for, until its end date or until they close it.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Card className="space-y-6 p-5 sm:p-6">
          <AnnouncementFields value={fields} onChange={setFields} errors={touched ? errors : {}} />

          <div className="space-y-3 border-t border-line pt-5">
            {/* A heading, NOT FieldLabel: that renders a <label>, which hands any click on
                its text to its first control, so clicking the words "Who is it for?"
                would quietly switch the audience back to All staff. */}
            <div>
              <div className="mb-1.5 text-[13px] font-medium text-navy">
                Who is it for?<span className="text-orange"> *</span>
              </div>
              <ChoiceButtons
                options={[
                  { value: "all", label: "All staff" },
                  { value: "modules", label: "Pick modules" },
                ]}
                value={audience}
                onChange={(v) => setAudience(v as Audience)}
                autoAdvance
                ariaLabel="Who is it for?"
              />
            </div>
            {audience === "modules" && (
              <div>
                <MultiSelect
                  values={modules}
                  onChange={setModules}
                  options={options}
                  placeholder="Choose one or more modules"
                  searchable
                  chips
                />
                <p className="mt-1 text-[12px] text-grey-2">
                  Everyone granted any of these, plus every admin. Customers are never included.
                </p>
                {touched && needsModules && <p className="mt-1 text-[12px] text-ryg-red">Pick at least one module.</p>}
              </div>
            )}
            <p className="text-[13px] text-navy">
              {needsModules ? (
                <span className="text-grey-2">Pick a module to see who it reaches.</span>
              ) : count.isLoading ? (
                <span className="text-grey-2">Counting…</span>
              ) : count.error ? (
                <span className="text-ryg-red">{(count.error as Error).message}</span>
              ) : (
                <>
                  Shows to <b>{shows}</b> {shows === 1 ? "person" : "people"}.
                </>
              )}
            </p>
          </div>

          <div className="space-y-3 border-t border-line pt-5">
            <label className={`flex items-start gap-3 ${emailEnabled ? "cursor-pointer" : "cursor-not-allowed"}`}>
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-orange"
                checked={email && emailEnabled}
                disabled={!emailEnabled}
                onChange={(e) => setEmail(e.target.checked)}
              />
              <span>
                <span className={`block text-[14px] font-medium ${emailEnabled ? "text-navy" : "text-grey-2"}`}>
                  Also email everyone in the audience
                </span>
                <span className="block text-[12px] text-grey-2">
                  {emailEnabled
                    ? "Off unless you tick it. Email cannot be recalled once sent; editing later does not send it again."
                    : "Email for announcements is switched off for now, so this posts on screen only."}
                </span>
              </span>
            </label>
            {email && emailEnabled && !needsModules && (
              <p className="text-[13px] text-navy">
                Emails <b>{emails ?? "…"}</b> {emails === 1 ? "person" : "people"} as soon as you publish.
              </p>
            )}
          </div>

          {serverError && (
            <div className="rounded-xl border border-ryg-red/30 bg-[#FDECEC] px-4 py-3 text-[13px] text-ryg-red">{serverError}</div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-line pt-5">
            <Button variant="ghost" onClick={() => navigate(B)}>
              Cancel
            </Button>
            <Button onClick={onPublish} disabled={publish.isPending || (touched && !valid)}>
              Publish
            </Button>
          </div>
        </Card>

        <div className="space-y-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-grey-2">
            {email && emailEnabled ? "The email" : "On screen"}
          </h2>
          {email && emailEnabled ? (
            <EmailPreview title={fields.title} body={fields.body} link={fields.link} postedBy={user.name} />
          ) : (
            <StripPreview title={fields.title} hasMore={!!(fields.body.trim() || fields.link.trim())} />
          )}
        </div>
      </div>

      <Modal
        open={confirming}
        onClose={() => !publish.isPending && setConfirming(false)}
        title="Publish this announcement?"
        subtitle={fields.title.trim()}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={publish.isPending}>
              Back
            </Button>
            <Button onClick={doPublish} disabled={publish.isPending}>
              {publish.isPending ? "Publishing…" : email && emailEnabled ? `Publish and email ${emails}` : "Publish"}
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-[14px] text-ink">
          <li>
            Shows to <b>{shows}</b> {shows === 1 ? "person" : "people"} until <b>{dmy(fields.endsOn)}</b> (end of that day).
          </li>
          <li>For: {audienceText}.</li>
          {email && emailEnabled ? (
            <li>
              Emails <b>{emails}</b> {emails === 1 ? "person" : "people"} now. <span className="text-grey">This cannot be recalled.</span>
            </li>
          ) : (
            <li>No email is sent.</li>
          )}
        </ul>
      </Modal>
    </div>
  );
}

/** The strip as it will look, so a long title's truncation is seen before it is posted. */
function StripPreview({ title, hasMore }: { title: string; hasMore: boolean }) {
  return (
    <div className="overflow-hidden rounded-card border border-line">
      <div className="flex items-center gap-2 bg-navy px-4 py-2 text-white">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-orange" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
        <span className="min-w-0 truncate text-[13px] font-semibold">{title.trim() || "Your title"}</span>
        {hasMore && <span className="shrink-0 text-[12.5px] font-semibold text-orange-2">Read more</span>}
        <span className="ml-auto text-white/60">✕</span>
      </div>
      <div className="bg-white px-4 py-3 text-[12px] text-grey-2">
        Sits under the top bar of every screen. Each person can close it for themselves.
      </div>
    </div>
  );
}
