/**
 * "Which salesperson owns this customer?" — the vocabulary, the picker, and the
 * default.
 *
 * ⚠ ONE SALESPERSON PER REQUEST, asked at the gate rather than at step 9.
 *   This writes the SAME column the Tally step's "Salesperson in Tally" reads
 *   (`assigned_sales_exec_name`) — deliberately, so there is one answer and not
 *   two that can disagree. The Tally step still owns the final say: it opens
 *   with this value already filled and can correct it before the ledger is made.
 *
 * ⚠ THE LIST IS NOT COMPANY-SCOPED, and cannot be. `ext_ledger_tags` is keyed by
 *   (ledger_id, salesperson) with no company column, so there is no per-company
 *   slice of this vocabulary to offer. Choosing O-tec rather than Colorix does
 *   not change who is on this list.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { Input } from "@hub/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";

/** The sentinel for "not on the list" — never a real salesperson name. */
const OTHER = "__other__";

/**
 * The Tally salesperson vocabulary, read straight from the live ConnectWave mirror
 * (ext_ledger_tags.salesperson) — the same column the hub scopes customers on, so a
 * name offered here always matches something.
 *
 * ⚠ IMPORTED DYNAMICALLY. connectwaveFetcher is a code-split chunk — useAppData
 *   import()s it so the hub's receivables machinery is not in the entry bundle.
 *   A static import here would drag the whole fetcher (and its second Supabase
 *   client) back into the main chunk for the sake of one string list. Same
 *   reasoning as lookupGstin's dynamic import of the platform client.
 */
export function useSalespersonNames(): string[] {
  const { data } = useQuery({
    queryKey: ["hub", "salespersonNames"],
    queryFn: async () => {
      const { fetchSalespersonNames } = await import("@hub/lib/connectwaveFetcher");
      return fetchSalespersonNames();
    },
    staleTime: 10 * 60 * 1000,
  });
  return data ?? [];
}

/**
 * The name to offer when a salesperson is the one raising the request.
 *
 * ⚠ THE PROFILE TAG IS THE AUTHORITY, not the user's display name.
 *   `profiles.receivables_salespersons` is the mapping an admin sets explicitly
 *   and the receivables dashboard already scopes on, so it is the one place that
 *   genuinely knows "this portal user IS that salesperson". A display-name match
 *   is only the fallback for someone untagged, and it has to be exact — guessing
 *   from a partial match would silently attribute a customer to the wrong rep.
 *
 * Returns null when the person is not a salesperson, or is tagged with SEVERAL
 * (there is no basis to choose between them, and a wrong default that looks
 * deliberate is worse than a blank the rep must answer).
 */
export function useDefaultSalesperson(): string | null {
  const { user } = useSession();
  const names = useSalespersonNames();
  const tagged = user.receivablesSalespersons;

  return useMemo(() => {
    const tags = (tagged ?? []).map((t) => t.trim()).filter(Boolean);
    if (tags.length === 1) {
      // Prefer the master's exact casing so the value matches the dropdown.
      return names.find((n) => n.toLowerCase() === tags[0].toLowerCase()) ?? tags[0];
    }
    if (tags.length > 1) return null;

    const own = (user.name ?? "").trim();
    if (!own) return null;
    return names.find((n) => n.toLowerCase() === own.toLowerCase()) ?? null;
  }, [tagged, user.name, names]);
}

/**
 * A dropdown of known salespeople plus "Other" — which reveals a text box.
 *
 * ⚠ "OTHER" IS STICKY while the box is empty. Deriving the mode purely from
 *   `value` would snap the control back to the dropdown the moment the user
 *   cleared the box to retype, which is exactly when they are mid-thought.
 *
 * ⚠ AND IT WAITS FOR THE LIST. `names` is empty on first render while the mirror
 *   is queried; treating "not in an empty list" as "must be Other" would flip a
 *   perfectly ordinary stored name into the free-text box on every page load.
 */
export default function SalespersonPicker({
  id, value, onChange, disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const names = useSalespersonNames();
  const [otherMode, setOtherMode] = useState(false);

  const loaded = names.length > 0;
  const known = loaded && names.includes(value);
  const isOther = otherMode || (value !== "" && loaded && !known);
  /**
   * A stored value while the mirror is still answering.
   *
   * ⚠ IT MUST STILL RENDER. Without an option to match, the trigger falls back
   *   to its placeholder, so a required field that is actually filled reads as
   *   empty for as long as the query takes — and this list comes from a SECOND
   *   Supabase project, so that is not always instant. The form value is intact
   *   underneath either way; this is about not telling the user otherwise.
   */
  const pending = value !== "" && !loaded;

  return (
    <div className="space-y-2">
      <Select
        value={isOther ? OTHER : known || pending ? value : ""}
        disabled={disabled}
        onValueChange={(v) => {
          if (v === OTHER) {
            setOtherMode(true);
            onChange("");           // they must type it; required-ness still applies
          } else {
            setOtherMode(false);
            onChange(v);
          }
        }}
      >
        <SelectTrigger id={id} aria-label="Salesperson">
          <SelectValue placeholder={loaded ? "Choose a salesperson" : "Loading salespeople…"} />
        </SelectTrigger>
        <SelectContent>
          {pending && <SelectItem value={value}>{value}</SelectItem>}
          {names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
          <SelectItem value={OTHER}>Other — type a name</SelectItem>
        </SelectContent>
      </Select>

      {isOther && (
        <Input
          value={value}
          disabled={disabled}
          placeholder="Salesperson's name"
          aria-label="Salesperson name"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
