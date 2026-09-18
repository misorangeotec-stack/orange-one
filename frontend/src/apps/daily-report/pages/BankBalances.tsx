import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import Modal from "@/shared/components/ui/Modal";
import { useSession } from "@/core/platform/session";

import { useBankAccounts } from "../data/bankAccounts";
import {
  balanceKey, saveEvening, useBalanceStatus, useBankBalances, usePreviousBalances,
  type BalanceMap, type BalanceWrite,
} from "../data/bankBalances";
import {
  ccLimitKey, facilityKey, useCarriedLimits, useCcLimits,
  type CarriedLimits, type CcLimitMap, type CcLimitWrite,
} from "../data/ccLimits";
import { entityTotal, facilityFor, FACILITY_BALANCE_NOTE } from "../lib/aggregate";
import { entityLabel, entityRank, BLANK_NOTE, FACILITY_BANKS } from "../lib/labels";
import { addDays, dmy, fmtLacs, isSunday, longDate, todayIso } from "../lib/format";
import type { BankAccount, BankBalance, CcLimit, FacilityFigures } from "../types";

/**
 * Daily Report → Bank balances. The part of this report that is typed.
 *
 * Read off the bank portal at about 7pm. Deliberately NOT Tally's book balance,
 * which excludes uncleared cheques and bank-only entries like interest and
 * charges, and so is a different number rather than a stale one.
 *
 * Each company's card is its accounts, then its TOTAL, then its CREDIT FACILITY
 * (DR-1) — in that order because the total feeds the facility's available
 * balance. Both are worked out by `lib/aggregate.ts` from the boxes as they are
 * typed, with the same functions the report and its exports use on saved data,
 * so the preview here cannot disagree with the page it becomes.
 *
 * ⚠ AN EMPTY BOX IS NEVER WRITTEN, AND A MISSING DAY IS NEVER A ZERO.
 *   Three states have to stay distinguishable all the way down: a Sunday nobody
 *   was asked about, a working day nobody typed, and an account that genuinely
 *   stood at zero. The form enforces this by writing nothing for an untouched or
 *   emptied box unless the user explicitly clears a stored figure — and that
 *   asks first, because un-recording a number should feel deliberate.
 */

/** Parse a typed box. `null` = blank. Throws on anything that is not a number. */
function parseMoney(raw: string, label: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new Error(`${label}: “${raw}” is not a number.`);
  return n;
}

/** The same, for a live preview: a half-typed or mistyped box is simply unknown. */
function softMoney(raw: string): number | null {
  try {
    return parseMoney(raw, "");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------ credit facility -- */

/** The four typed boxes of one company's credit facility, as raw text. */
interface CcDraft {
  ccLimit: string;
  lcBcLimit: string;
  utilised: string;
  hold: string;
}

const BLANK_CC: CcDraft = { ccLimit: "", lcBcLimit: "", utilised: "", hold: "" };

const str = (n: number | null): string => (n == null ? "" : String(n));

const trimDraft = (d: CcDraft): CcDraft => ({
  ccLimit: d.ccLimit.trim(), lcBcLimit: d.lcBcLimit.trim(), utilised: d.utilised.trim(), hold: d.hold.trim(),
});

const sameDraft = (a: CcDraft, b: CcDraft): boolean =>
  a.ccLimit === b.ccLimit && a.lcBcLimit === b.lcBcLimit && a.utilised === b.utilised && a.hold === b.hold;

const blankDraft = (d: CcDraft): boolean => sameDraft(trimDraft(d), BLANK_CC);

/** What a stored block reads as in the boxes — all blank when nothing is stored. */
function storedDraft(row: CcLimit | undefined): CcDraft {
  return row
    ? {
        ccLimit: str(row.ccLimitLacs), lcBcLimit: str(row.lcBcLimitLacs),
        utilised: str(row.lcBcUtilisedLacs), hold: str(row.holdByBankLacs),
      }
    : BLANK_CC;
}

/**
 * What the boxes OPEN with: the stored block, or — on a day with none — the two
 * sanctioned limits carried forward, and utilised and held left empty.
 *
 * ⚠ A PRE-FILL, NOT AN ENTRY. `pendingCc` below does not count carried limits on
 *   their own as a change, so saving an evening whose facility nobody touched
 *   writes no block for it, and the day stays "not recorded".
 */
function seedDraft(row: CcLimit | undefined, carried: CarriedLimits | undefined): CcDraft {
  if (row) return storedDraft(row);
  return {
    ...BLANK_CC,
    ccLimit: carried?.ccLimit ? String(carried.ccLimit.lacs) : "",
    lcBcLimit: carried?.lcBcLimit ? String(carried.lcBcLimit.lacs) : "",
  };
}

function parseDraft(d: CcDraft, who: string): FacilityFigures {
  return {
    ccLimitLacs: parseMoney(d.ccLimit, `${who} CC limit`),
    lcBcLimitLacs: parseMoney(d.lcBcLimit, `${who} LC / BC limit`),
    lcBcUtilisedLacs: parseMoney(d.utilised, `${who} utilised`),
    holdByBankLacs: parseMoney(d.hold, `${who} held by bank`),
  };
}

const softDraft = (d: CcDraft): FacilityFigures => ({
  ccLimitLacs: softMoney(d.ccLimit),
  lcBcLimitLacs: softMoney(d.lcBcLimit),
  lcBcUtilisedLacs: softMoney(d.utilised),
  holdByBankLacs: softMoney(d.hold),
});

interface Facility {
  alias: string;
  bank: string;
  /** `facilityKey(alias, bank)` — the draft and carry-forward key. */
  key: string;
}

/* ---------------------------------------------------------------- seeding -- */

function closingSeed(active: BankAccount[], stored: BalanceMap, date: string): Record<string, string> {
  const c: Record<string, string> = {};
  for (const a of active) {
    const row = stored.get(balanceKey(a.id, date));
    c[a.id] = row ? String(row.closingLacs) : "";
  }
  return c;
}

function ccSeed(
  facilities: Facility[],
  stored: CcLimitMap,
  carried: Map<string, CarriedLimits>,
  date: string,
): Record<string, CcDraft> {
  const out: Record<string, CcDraft> = {};
  for (const f of facilities) {
    out[f.key] = seedDraft(stored.get(ccLimitKey(f.alias, f.bank, date)), carried.get(f.key));
  }
  return out;
}

/* ------------------------------------------------------------ the cells -- */

const cellLabel = "block text-[10.5px] font-semibold uppercase tracking-wide text-grey";
const cellNote = "mt-0.5 block min-h-[14px] text-[10.5px] text-grey-2";

/** A typed facility figure. */
function FacilityBox({
  label, note, value, onChange, disabled,
}: {
  label: string;
  note?: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="block">
      <span className={cellLabel}>{label}</span>
      <TextInput
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 text-right tabular-nums"
        placeholder="—"
      />
      <span className={cellNote}>{note}</span>
    </label>
  );
}

/**
 * A WORKED-OUT facility figure. Styled unlike an input on purpose — dashed, no
 * white fill — so nobody hunts for how to type into it.
 */
function FacilityFigure({
  label, note, value, title,
}: {
  label: string;
  note: string;
  value: number | null;
  title?: string;
}) {
  return (
    <div>
      <span className={cellLabel}>{label}</span>
      <div
        className="mt-1 rounded-xl border border-dashed border-line bg-page px-3.5 py-2.5 text-right text-[14px] font-semibold tabular-nums text-navy"
        title={title}
      >
        {value == null ? <span className="font-normal text-grey-2">—</span> : fmtLacs(value)}
      </div>
      <span className={cellNote}>{note}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ page -- */

export default function BankBalances() {
  const { canEditModule } = useSession();
  const qc = useQueryClient();
  const mayEdit = canEditModule("daily-report");

  const today = todayIso();
  const [params, setParams] = useSearchParams();
  const dateParam = params.get("d") ?? "";
  // A hand-edited future date would mint a phantom column on every later report,
  // and the routine refuses it anyway — clamp before it can be asked for.
  const date = dateParam && dateParam <= today ? dateParam : today;

  const accounts = useBankAccounts();
  const stored = useBankBalances(date, date);
  const previous = usePreviousBalances(date);
  const status = useBalanceStatus(date);
  const storedCc = useCcLimits(date, date);
  const carried = useCarriedLimits(date);

  /** accountId → the text in its box. Seeded from what is stored. */
  const [closing, setClosing] = useState<Record<string, string>>({});
  /** facilityKey → the text in its four boxes. Seeded from stored, or carried. */
  const [cc, setCc] = useState<Record<string, CcDraft>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const active = useMemo(
    () =>
      (accounts.data ?? [])
        .filter((a) => a.active)
        .sort((a, b) =>
          entityRank(a.entityAlias) - entityRank(b.entityAlias) ||
          a.sortOrder - b.sortOrder ||
          a.name.localeCompare(b.name)),
    [accounts.data],
  );

  // ⚠ BY ENTITY ALIAS, NEVER company_id: Orange O Tec's Surat and Noida books
  //   are one company on this form, one total and one credit facility.
  const byEntity = useMemo(() => {
    const groups = new Map<string, BankAccount[]>();
    for (const a of active) {
      const list = groups.get(a.entityAlias) ?? [];
      list.push(a);
      groups.set(a.entityAlias, list);
    }
    return [...groups.entries()].sort((x, y) => entityRank(x[0]) - entityRank(y[0]));
  }, [active]);

  const facilities = useMemo(
    (): Facility[] =>
      byEntity.flatMap(([alias]) =>
        FACILITY_BANKS.map((bank) => ({ alias, bank, key: facilityKey(alias, bank) }))),
    [byEntity],
  );

  // Re-seed whenever the day or the stored figures change. Keyed on the query
  // data itself, so a save that refetches lands back in the boxes rather than
  // leaving them showing what was typed before the round trip.
  useEffect(() => {
    if (!stored.data) return;
    setClosing(closingSeed(active, stored.data, date));
  }, [stored.data, active, date]);

  // Only a new DAY clears the "Saved at" line. It used to be cleared in the
  // re-seed above, which runs on the very refetch a save triggers, so the
  // confirmation was wiped the instant it was set and never once showed.
  useEffect(() => setSavedAt(null), [date]);

  // Waits for BOTH reads: seeding from the stored block alone and then again
  // when the carried limits land would wipe whatever was typed in between.
  const ccReady = Boolean(storedCc.data && carried.data);
  useEffect(() => {
    if (!storedCc.data || !carried.data) return;
    setCc(ccSeed(facilities, storedCc.data, carried.data, date));
  }, [storedCc.data, carried.data, facilities, date]);

  const setDate = (next: string) => {
    const p = new URLSearchParams(params);
    p.set("d", next);
    setParams(p, { replace: true });
  };

  /** The boxes as they stand, read as balances — what the live totals are summed from. */
  const draftBalances = useMemo(() => {
    const m: BalanceMap = new Map();
    for (const a of active) {
      const n = softMoney(closing[a.id] ?? "");
      if (n == null) continue;
      const row: BankBalance = { bankAccountId: a.id, date, closingLacs: n, updatedAt: "" };
      m.set(balanceKey(a.id, date), row);
    }
    return m;
  }, [active, closing, date]);

  /** What would be written, and whether anything differs from what is stored. */
  const pending = useMemo((): BalanceWrite[] => {
    const out: BalanceWrite[] = [];
    for (const a of active) {
      const row = stored.data?.get(balanceKey(a.id, date));
      const typedC = (closing[a.id] ?? "").trim();
      const storedC = row ? String(row.closingLacs) : "";
      if (typedC === storedC) continue;

      // An empty box on a day that has nothing stored is not a change — it is
      // simply a day nobody recorded, and writing it would be writing a zero.
      if (typedC === "" && !row) continue;

      let c: number | null;
      try {
        c = parseMoney(typedC, a.name);
      } catch {
        // Surfaced on save with the real message; skipped from the count here so
        // a typo does not silently inflate "3 unsaved changes".
        continue;
      }
      out.push({ bankAccountId: a.id, date, closingLacs: c });
    }
    return out;
  }, [active, closing, stored.data, date]);

  /** The credit-facility blocks that would be written. */
  const pendingCc = useMemo((): CcLimitWrite[] => {
    const out: CcLimitWrite[] = [];
    if (!ccReady) return out;
    for (const f of facilities) {
      const row = storedCc.data?.get(ccLimitKey(f.alias, f.bank, date));
      const typed = trimDraft(cc[f.key] ?? BLANK_CC);
      if (sameDraft(typed, storedDraft(row))) continue;

      if (!row) {
        // Nothing stored for this company today. Blank boxes are a day nobody
        // recorded, and the carried limits on their own are a PRE-FILL: writing
        // them would copy yesterday's block forward under today's date. Only a
        // figure typed for today, or a limit actually changed, makes this an entry.
        if (blankDraft(typed)) continue;
        const seed = seedDraft(undefined, carried.data?.get(f.key));
        const typedToday = typed.utilised !== "" || typed.hold !== "";
        const limitChanged = typed.ccLimit !== seed.ccLimit || typed.lcBcLimit !== seed.lcBcLimit;
        if (!typedToday && !limitChanged) continue;
      }

      let figures: FacilityFigures;
      try {
        figures = parseDraft(typed, entityLabel(f.alias));
      } catch {
        continue; // surfaced on save, as above
      }
      out.push({ entityAlias: f.alias, bank: f.bank, date, ...figures });
    }
    return out;
  }, [ccReady, facilities, cc, storedCc.data, carried.data, date]);

  const changes = pending.length + pendingCc.length;

  /** Every stored figure this save would UN-record. Asked about first. */
  const clearing = useMemo(
    () => [
      ...pending
        .filter((p) => p.closingLacs == null)
        .map((p) => active.find((a) => a.id === p.bankAccountId)?.name ?? "an account"),
      ...pendingCc
        .filter((p) =>
          p.ccLimitLacs == null && p.lcBcLimitLacs == null &&
          p.lcBcUtilisedLacs == null && p.holdByBankLacs == null)
        .map((p) => `${entityLabel(p.entityAlias)} — ${p.bank} credit facility`),
    ],
    [pending, pendingCc, active],
  );

  async function commit() {
    setBusy(true);
    setErr(null);
    try {
      // Re-parse here so a typo raises with its real message rather than being
      // quietly dropped as it is in the pending counts above.
      for (const a of active) parseMoney(closing[a.id] ?? "", a.name);
      for (const f of facilities) parseDraft(cc[f.key] ?? BLANK_CC, entityLabel(f.alias));
      const n = await saveEvening(pending, pendingCc);
      await qc.invalidateQueries({ queryKey: ["daily-report"] });
      setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
      if (n === 0) setErr("Nothing to save.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirmClear(false);
    }
  }

  const onSave = () => {
    if (clearing.length > 0) {
      setConfirmClear(true);
      return;
    }
    void commit();
  };

  const discard = () => {
    if (stored.data) setClosing(closingSeed(active, stored.data, date));
    if (storedCc.data && carried.data) setCc(ccSeed(facilities, storedCc.data, carried.data, date));
    setErr(null);
  };

  const setCcField = (key: string, field: keyof CcDraft, value: string) =>
    setCc((s) => ({ ...s, [key]: { ...(s[key] ?? BLANK_CC), [field]: value } }));

  const st = status.data;
  const complete = st ? st.expected > 0 && st.entered >= st.expected : false;
  const sunday = isSunday(date);

  return (
    <div className="space-y-4 pb-24">
      {/* ---------------------------------------------------------- header -- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold text-navy">Bank balances</h1>
          <p className="mt-1 text-[12.5px] text-grey">{longDate(date)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</Button>
          <TextInput
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDate(addDays(date, 1))}
            disabled={date >= today}
            aria-label="Next day"
          >
            ›
          </Button>
          {date !== today && <Button variant="ghost" size="sm" onClick={() => setDate(today)}>Today</Button>}
        </div>
      </div>

      {/* Completeness reads only from SAVED data, so it can never claim a number
          that is still sitting unsaved in a box. */}
      {st && (
        <div
          className={
            complete
              ? "rounded-lg border border-line bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800"
              : "rounded-lg border border-line bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"
          }
        >
          <span className="font-semibold">{st.entered} of {st.expected} entered</span>
          {!complete && st.missing.length > 0 && (
            <span> — still missing {st.missing.map((m) => m.shortLabel).join(", ")}</span>
          )}
        </div>
      )}

      {sunday && (
        <div className="rounded-lg border border-line bg-page px-3 py-2 text-[12.5px] text-grey">
          <span className="font-semibold text-navy">{dmy(date)} is a Sunday.</span>{" "}
          The books are closed and balances are not normally recorded. Anything left blank stays
          blank on the report rather than reading as a missing entry.
        </div>
      )}

      {(storedCc.isError || carried.isError) && (
        <Card className="border-orange/40 p-3 text-[12.5px] text-orange">
          Could not read the credit limits: {String(storedCc.error ?? carried.error)}
        </Card>
      )}

      <div className="max-w-3xl space-y-1.5 text-[12px] text-grey">
        <p>
          Closing balance in ₹ lakhs, as the bank portal shows it.{" "}
          <span className="font-semibold text-navy">Leave a box empty for a day an account was not recorded</span>{" "}
          — an empty box is not a zero, and the report prints it as “not entered”. Type 0.00 when the
          account genuinely stood at zero.
        </p>
        <p>
          Under each company’s total is its <span className="font-semibold text-navy">credit facility</span>,
          also in ₹ lakhs. The CC limit and LC / BC limit carry forward from the last day they were
          recorded — change them only when the bank does. Utilised and held by bank are typed each
          evening. The other three figures are worked out, and a company’s facility is saved only once
          something is typed into it.
        </p>
      </div>

      {/* ------------------------------------------------------ the entity -- */}
      {byEntity.map(([alias, rows]) => {
        const total = entityTotal(rows, draftBalances, date);
        return (
          <Card key={alias} className="p-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-navy">
                {entityLabel(alias)}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-grey">
                    <th className="px-4 py-2 font-semibold">Account</th>
                    <th className="px-2 py-2 font-semibold">Location</th>
                    <th className="px-2 py-2 text-right font-semibold">Previous</th>
                    <th className="px-2 py-2 text-right font-semibold">Closing balance (₹ L)</th>
                    <th className="px-2 py-2 text-right font-semibold">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const prev = previous.data?.get(a.id);
                    const typed = (closing[a.id] ?? "").trim();
                    const parsed = typed === "" ? null : Number(typed.replace(/,/g, ""));
                    const delta =
                      parsed != null && Number.isFinite(parsed) && prev
                        ? parsed - prev.closingLacs
                        : null;
                    return (
                      <tr key={a.id} className="border-b border-line/60">
                        <td className="px-4 py-2">
                          <span className="font-semibold text-navy">{a.name}</span>
                          {a.accountNo && (
                            <span className="ml-2 tabular-nums text-[11.5px] text-grey-2">
                              •••• {a.accountNo.slice(-4)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-grey">{a.location}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-grey">
                          {prev ? (
                            <>
                              {fmtLacs(prev.closingLacs)}
                              {/* The DATE matters: with Sundays blank, "previous" is
                                  rarely yesterday, and a comparison against an
                                  unnamed day is not a comparison. */}
                              <span className="ml-1 text-[11px] text-grey-2">({dmy(prev.date).slice(0, 5)})</span>
                            </>
                          ) : (
                            <span className="text-grey-2">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <TextInput
                            inputMode="decimal"
                            value={closing[a.id] ?? ""}
                            disabled={!mayEdit}
                            onChange={(e) => setClosing((s) => ({ ...s, [a.id]: e.target.value }))}
                            className="w-28 text-right tabular-nums"
                            placeholder="—"
                            aria-label={`Closing balance for ${a.name}`}
                          />
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {/* A delta against nothing is a fabricated number, so an
                              empty box reads "not entered", never "− 6.91". */}
                          {typed === "" ? (
                            <span className="text-[11.5px] text-grey-2">not entered</span>
                          ) : delta == null ? (
                            <span className="text-grey-2">—</span>
                          ) : (
                            <span className={delta < 0 ? "text-orange" : "text-emerald-700"}>
                              {delta >= 0 ? "+" : "−"} {fmtLacs(Math.abs(delta))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* The company total, from the boxes as typed. `entityTotal`
                    refuses a partial sum, so this is blank until EVERY account is
                    in — and says so, or an empty total reads as a broken screen. */}
                <tfoot>
                  <tr className="bg-page/60">
                    <td colSpan={3} className="px-4 py-2 font-semibold text-navy">Company total</td>
                    {/* pr-[23px]: the cell's own 8px plus the input's border and
                        inner padding, so the total lines up under the typed figures. */}
                    <td className="py-2 pl-2 pr-[23px] text-right text-[14px] font-semibold tabular-nums text-navy">
                      {total.totalLacs == null ? <span className="text-grey-2">—</span> : fmtLacs(total.totalLacs)}
                    </td>
                    <td className="px-2 py-2 text-right text-[11.5px] text-grey-2">
                      {total.totalLacs == null
                        ? `${rows.length - total.missing.length} of ${rows.length} entered`
                        : "all entered"}
                    </td>
                  </tr>
                  {total.totalLacs == null && (
                    <tr className="bg-page/60">
                      <td colSpan={5} className="px-4 pb-2.5 text-[11.5px] text-grey">
                        The total appears once every account above has a figure — a total of only some
                        of them would understate the company’s cash. Still to enter:{" "}
                        <span className="font-semibold text-navy">{total.missing.join(", ")}</span>.
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>

            {/* The credit facility, AFTER the total it reads. One block per bank
                in FACILITY_BANKS — Axis today. The utilised figure is typed HERE
                and nowhere else: the old per-account LC / BC utilised input is
                retired, so it cannot be entered twice. */}
            {FACILITY_BANKS.map((bank) => {
              const key = facilityKey(alias, bank);
              const draft = cc[key] ?? BLANK_CC;
              const row = storedCc.data?.get(ccLimitKey(alias, bank, date));
              const carriedHere = carried.data?.get(key);
              const f = facilityFor(alias, bank, rows, draftBalances, softDraft(draft), date);
              const disabled = !mayEdit || !ccReady;

              /** "carried from 07-09" while a box still holds the carried figure. */
              const carriedNote = (field: "ccLimit" | "lcBcLimit"): string => {
                const c = field === "ccLimit" ? carriedHere?.ccLimit : carriedHere?.lcBcLimit;
                if (row || !c || draft[field].trim() !== String(c.lacs)) return "sanctioned";
                return `carried from ${dmy(c.date).slice(0, 5)}`;
              };

              return (
                <div key={bank} className="border-t border-line px-4 py-3">
                  <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-navy">
                      Credit facility · {bank}
                    </h3>
                    <span className="text-[11px] text-grey-2">
                      {row ? `recorded for ${dmy(date)}` : `not recorded for ${dmy(date)}`}
                    </span>
                  </div>
                  {/* The client's sheet order, left to right, so the form reads
                      like the paper it replaces. */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 xl:grid-cols-7">
                    <FacilityBox
                      label="CC limit (₹ L)" note={carriedNote("ccLimit")} disabled={disabled}
                      value={draft.ccLimit} onChange={(v) => setCcField(key, "ccLimit", v)}
                    />
                    <FacilityFigure
                      label="Available balance (₹ L)"
                      value={f.availableBalance}
                      note={f.availableBalance == null ? "needs every account" : "company total"}
                      title={FACILITY_BALANCE_NOTE}
                    />
                    <FacilityBox
                      label="LC / BC limit (₹ L)" note={carriedNote("lcBcLimit")} disabled={disabled}
                      value={draft.lcBcLimit} onChange={(v) => setCcField(key, "lcBcLimit", v)}
                    />
                    <FacilityBox
                      label="Utilised (₹ L)" note="today" disabled={disabled}
                      value={draft.utilised} onChange={(v) => setCcField(key, "utilised", v)}
                    />
                    <FacilityFigure label="Free limit (₹ L)" value={f.lcBcFree} note="LC / BC limit − utilised" />
                    <FacilityBox
                      label="Held by bank (₹ L)" note="today" disabled={disabled}
                      value={draft.hold} onChange={(v) => setCcField(key, "hold", v)}
                    />
                    <FacilityFigure label="Available CC limit (₹ L)" value={f.availableCc} note="CC limit − held" />
                  </div>
                </div>
              );
            })}
          </Card>
        );
      })}

      {active.length === 0 && !accounts.isLoading && (
        <Card className="p-6 text-center text-[13px] text-grey">
          No active bank accounts yet. Add them under Bank accounts first.
        </Card>
      )}

      <p className="max-w-3xl text-[11.5px] text-grey-2">{BLANK_NOTE}</p>

      {/* -------------------------------------------------- the save bar --- */}
      {mayEdit && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="text-[12.5px]">
              {err ? (
                <span className="text-orange">{err}</span>
              ) : changes > 0 ? (
                <span className="font-semibold text-navy">
                  {changes} unsaved {changes === 1 ? "change" : "changes"}
                </span>
              ) : savedAt ? (
                <span className="text-emerald-700">Saved at {savedAt}</span>
              ) : (
                <span className="text-grey-2">No changes</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={discard} disabled={busy || changes === 0}>
                Discard
              </Button>
              {/* Explicit save, not autosave: a half-typed "2." losing focus
                  would otherwise save as 2, and a figure that saved itself is a
                  figure nobody re-checks. */}
              <Button size="sm" onClick={onSave} disabled={busy || changes === 0}>
                {busy ? "Saving…" : "Save all"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmClear && clearing.length > 0 && (
        <Modal open title="Clear recorded figures?" onClose={() => setConfirmClear(false)}>
          <p className="text-[13px] text-grey">
            {clearing.length === 1 ? (
              <>
                The {dmy(date)} figure for{" "}
                <span className="font-semibold text-navy">{clearing[0]}</span> will be removed.
              </>
            ) : (
              <>
                {clearing.length} recorded entries for {dmy(date)} will be removed:{" "}
                <span className="font-semibold text-navy">{clearing.join(", ")}</span>.
              </>
            )}{" "}
            The report will show them as <span className="font-semibold">not entered</span> rather
            than as zero.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>Cancel</Button>
            <Button size="sm" onClick={() => void commit()} disabled={busy}>
              {busy ? "Saving…" : "Clear and save"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
