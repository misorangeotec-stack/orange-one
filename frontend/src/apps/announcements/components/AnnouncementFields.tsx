import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { addDaysIso, dmy, safeHref, todayIst } from "@/core/announcements/data";

export const TITLE_MAX = 120;
export const BODY_MAX = 4000;
export const MAX_DAYS_AHEAD = 365;

export interface FieldValues {
  title: string;
  body: string;
  link: string;
  endsOn: string;
}

export type FieldErrors = Partial<Record<keyof FieldValues, string>>;

/**
 * The same rules the database enforces (announcement_check_text / _check_end), said
 * before Publish so nobody meets them as an error after it. The database stays the
 * authority: this only saves a round trip.
 */
export function validateFields(v: FieldValues, opts: { checkEnd: boolean }): FieldErrors {
  const e: FieldErrors = {};
  const title = v.title.trim();
  if (!title) e.title = "Give it a title.";
  else if (title.length > TITLE_MAX) e.title = `Keep the title to ${TITLE_MAX} characters.`;
  if (v.body.trim().length > BODY_MAX) e.body = `Keep the message to ${BODY_MAX} characters.`;
  if (v.link.trim() && !safeHref(v.link.trim())) e.link = "A web address starting with http:// or https://, with no spaces.";
  if (opts.checkEnd) {
    const today = todayIst();
    if (!v.endsOn) e.endsOn = "Choose the last day it shows.";
    else if (v.endsOn < today) e.endsOn = "That date has passed.";
    else if (v.endsOn > addDaysIso(today, MAX_DAYS_AHEAD)) e.endsOn = "At most a year ahead.";
  }
  return e;
}

function Err({ text }: { text?: string }) {
  return text ? <p className="mt-1 text-[12px] text-ryg-red">{text}</p> : null;
}

/**
 * Title, message, link and end date — the part of an announcement that can still be
 * corrected after it is posted, so the composer and the Edit dialog share it.
 */
export default function AnnouncementFields({
  value,
  onChange,
  errors,
  endLocked,
}: {
  value: FieldValues;
  onChange: (next: FieldValues) => void;
  errors: FieldErrors;
  /** Ended early: the end date can no longer move (the database refuses it too). */
  endLocked?: boolean;
}) {
  const today = todayIst();
  const set = <K extends keyof FieldValues>(k: K, val: FieldValues[K]) => onChange({ ...value, [k]: val });

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel label="Title" required hint={`${value.title.trim().length} / ${TITLE_MAX}`}>
          <TextInput
            value={value.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={TITLE_MAX + 20}
            placeholder="e.g. Office closed on Monday for Dussehra"
            autoFocus
          />
        </FieldLabel>
        <Err text={errors.title} />
      </div>

      <div>
        <FieldLabel label="Message" hint="Optional. Shown under Read more, with your line breaks kept.">
          <TextArea
            value={value.body}
            onChange={(e) => set("body", e.target.value)}
            rows={6}
            maxLength={BODY_MAX + 200}
            placeholder="The details people need."
          />
        </FieldLabel>
        <Err text={errors.body} />
      </div>

      <div>
        <FieldLabel label="Link" hint="Optional. Must start with http:// or https://">
          <TextInput
            value={value.link}
            onChange={(e) => set("link", e.target.value)}
            inputMode="url"
            placeholder="https://"
          />
        </FieldLabel>
        <Err text={errors.link} />
      </div>

      <div>
        <FieldLabel
          label="Show until"
          required
          hint={endLocked ? "Ended early, so this can no longer change." : "It disappears for everyone at the end of this day (India time)."}
        >
          <TextInput
            type="date"
            value={value.endsOn}
            min={today}
            max={addDaysIso(today, MAX_DAYS_AHEAD)}
            disabled={endLocked}
            onChange={(e) => set("endsOn", e.target.value)}
            className="sm:max-w-[220px]"
          />
        </FieldLabel>
        {value.endsOn && !errors.endsOn && !endLocked && (
          <p className="mt-1 text-[12px] text-grey-2">Last day on screen: {dmy(value.endsOn)}.</p>
        )}
        <Err text={errors.endsOn} />
      </div>
    </div>
  );
}
