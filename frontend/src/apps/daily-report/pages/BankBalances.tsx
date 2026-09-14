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
  balanceKey, saveBalances, useBalanceStatus, useBankBalances, usePreviousBalances,
  type BalanceWrite,
} from "../data/bankBalances";
import { entityLabel, entityRank, BLANK_NOTE } from "../lib/labels";
import { addDays, dmy, fmtLacs, isSunday, longDate, todayIso } from "../lib/format";
import type { BankAccount } from "../types";

/**
 * Daily Report → Bank balances. The one thing on this report that is typed.
 *
 * Read off the bank portal at about 7pm. Deliberately NOT Tally's book balance,
 * which excludes uncleared cheques and bank-only entries like interest and
 * charges, and so is a different number rather than a stale one.
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

  /** accountId → the text in its boxes. Seeded from what is stored. */
  const [closing, setClosing] = useState<Record<string, string>>({});
  const [lcBc, setLcBc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<{ account: BankAccount } | null>(null);

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

  // Re-seed whenever the day or the stored figures change. Keyed on the query
  // data itself, so a save that refetches lands back in the boxes rather than
  // leaving them showing what was typed before the round trip.
  useEffect(() => {
    if (!stored.data) return;
    const c: Record<string, string> = {};
    const l: Record<string, string> = {};
    for (const a of active) {
      const row = stored.data.get(balanceKey(a.id, date));
      c[a.id] = row ? String(row.closingLacs) : "";
      l[a.id] = row?.lcBcUtilisedLacs == null ? "" : String(row.lcBcUtilisedLacs);
    }
    setClosing(c);
    setLcBc(l);
    setSavedAt(null);
  }, [stored.data, active, date]);

  const setDate = (next: string) => {
    const p = new URLSearchParams(params);
    p.set("d", next);
    setParams(p, { replace: true });
  };

  /** What would be written, and whether anything differs from what is stored. */
  const pending = useMemo((): BalanceWrite[] => {
    const out: BalanceWrite[] = [];
    for (const a of active) {
      const row = stored.data?.get(balanceKey(a.id, date));
      const typedC = (closing[a.id] ?? "").trim();
      const typedL = (lcBc[a.id] ?? "").trim();
      const storedC = row ? String(row.closingLacs) : "";
      const storedL = row?.lcBcUtilisedLacs == null ? "" : String(row.lcBcUtilisedLacs);
      if (typedC === storedC && typedL === storedL) continue;

      // An empty box on a day that has nothing stored is not a change — it is
      // simply a day nobody recorded, and writing it would be writing a zero.
      if (typedC === "" && !row) continue;

      let c: number | null;
      let l: number | null;
      try {
        c = parseMoney(typedC, a.name);
        l = parseMoney(typedL, `${a.name} LC/BC`);
      } catch {
        // Surfaced on save with the real message; skipped from the count here so
        // a typo does not silently inflate "3 unsaved changes".
        continue;
      }
      out.push({ bankAccountId: a.id, date, closingLacs: c, lcBcUtilisedLacs: l });
    }
    return out;
  }, [active, closing, lcBc, stored.data, date]);

  /** Rows whose closing box would CLEAR a stored figure. Asked about first. */
  const clearing = pending.filter((p) => p.closingLacs == null);

  async function commit(rows: BalanceWrite[]) {
    setBusy(true);
    setErr(null);
    try {
      // Re-parse here so a typo raises with its real message rather than being
      // quietly dropped as it is in the `pending` count above.
      for (const a of active) {
        parseMoney(closing[a.id] ?? "", a.name);
        parseMoney(lcBc[a.id] ?? "", `${a.name} LC/BC`);
      }
      const n = await saveBalances(rows);
      await qc.invalidateQueries({ queryKey: ["daily-report"] });
      setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
      if (n === 0) setErr("Nothing to save.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirmClear(null);
    }
  }

  const onSave = () => {
    if (clearing.length > 0) {
      const first = active.find((a) => a.id === clearing[0].bankAccountId);
      if (first) {
        setConfirmClear({ account: first });
        return;
      }
    }
    void commit(pending);
  };

  const discard = () => {
    if (!stored.data) return;
    const c: Record<string, string> = {};
    const l: Record<string, string> = {};
    for (const a of active) {
      const row = stored.data.get(balanceKey(a.id, date));
      c[a.id] = row ? String(row.closingLacs) : "";
      l[a.id] = row?.lcBcUtilisedLacs == null ? "" : String(row.lcBcUtilisedLacs);
    }
    setClosing(c);
    setLcBc(l);
    setErr(null);
  };

  const byEntity = useMemo(() => {
    const groups = new Map<string, BankAccount[]>();
    for (const a of active) {
      const list = groups.get(a.entityAlias) ?? [];
      list.push(a);
      groups.set(a.entityAlias, list);
    }
    return [...groups.entries()].sort((x, y) => entityRank(x[0]) - entityRank(y[0]));
  }, [active]);

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

      <p className="max-w-3xl text-[12px] text-grey">
        Closing balance in ₹ lakhs, as the bank portal shows it.{" "}
        <span className="font-semibold text-navy">Leave a box empty for a day an account was not recorded</span>{" "}
        — an empty box is not a zero, and the report prints it as “not entered”. Type 0.00 when the
        account genuinely stood at zero.
      </p>

      {/* ------------------------------------------------------ the entity -- */}
      {byEntity.map(([alias, rows]) => (
        <Card key={alias} className="p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-navy">
              {entityLabel(alias)}
            </h2>
          </div>
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
                  <tr key={a.id} className="border-b border-line/60 last:border-0">
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
          </table>

          {/* LC/BC utilised, only on the borrowing accounts that carry a limit.
              The one facility figure with no source anywhere — optional, and the
              report shows a dash for the free limit while it is blank. */}
          {rows.some((a) => a.lcBcLimitLacs != null) && (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-grey">LC / BC utilised (optional)</p>
              <div className="flex flex-wrap gap-4">
                {rows
                  .filter((a) => a.lcBcLimitLacs != null)
                  .map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-[12px] text-grey">
                      <span className="font-semibold text-navy">{a.name}</span>
                      <span className="text-grey-2">limit {fmtLacs(a.lcBcLimitLacs)}</span>
                      <TextInput
                        inputMode="decimal"
                        value={lcBc[a.id] ?? ""}
                        disabled={!mayEdit}
                        onChange={(e) => setLcBc((s) => ({ ...s, [a.id]: e.target.value }))}
                        className="w-24 text-right tabular-nums"
                        placeholder="—"
                      />
                    </label>
                  ))}
              </div>
            </div>
          )}
        </Card>
      ))}

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
              ) : pending.length > 0 ? (
                <span className="font-semibold text-navy">
                  {pending.length} unsaved {pending.length === 1 ? "change" : "changes"}
                </span>
              ) : savedAt ? (
                <span className="text-emerald-700">Saved at {savedAt}</span>
              ) : (
                <span className="text-grey-2">No changes</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={discard} disabled={busy || pending.length === 0}>
                Discard
              </Button>
              {/* Explicit save, not autosave: a half-typed "2." losing focus
                  would otherwise save as 2, and a figure that saved itself is a
                  figure nobody re-checks. */}
              <Button size="sm" onClick={onSave} disabled={busy || pending.length === 0}>
                {busy ? "Saving…" : "Save all"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmClear && (
        <Modal open title="Clear a recorded balance?" onClose={() => setConfirmClear(null)}>
          <p className="text-[13px] text-grey">
            {clearing.length === 1 ? (
              <>
                The {dmy(date)} figure for{" "}
                <span className="font-semibold text-navy">{confirmClear.account.name}</span> will be
                removed.
              </>
            ) : (
              <>
                {clearing.length} recorded figures for {dmy(date)} will be removed, starting with{" "}
                <span className="font-semibold text-navy">{confirmClear.account.name}</span>.
              </>
            )}{" "}
            The report will show the day as <span className="font-semibold">not entered</span> rather
            than as zero.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(null)}>Cancel</Button>
            <Button size="sm" onClick={() => void commit(pending)} disabled={busy}>
              {busy ? "Saving…" : "Clear and save"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
