import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { formatDateDMY } from "@/shared/lib/date";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useTravelStore } from "../../store";
import { money } from "../../lib/format";
import {
  RATE_TYPE_META, RATE_TYPE_ORDER, TRAVEL_CATEGORIES,
  type TravelRate, type RateType, type TravelCategory, type CityTier,
} from "../../types";

const TIERS: CityTier[] = [1, 2, 3];
const TIER_HEAD: Record<CityTier, string> = { 1: "Tier 1", 2: "Tier 2", 3: "Tier 3" };

/**
 * The Domestic Travel Policy, as an editable document.
 *
 * ⚠ WHY THIS IS NOT A MasterCrud TAB. Every figure here is read as part of a
 *   GRID — "what does a TC-C traveller get in a Tier 1 city" is a question you
 *   answer by looking across a row and down a column. Flattened into a list of
 *   rows ("TC-C / Tier 1 / 1750") the same twelve numbers become unreadable, and
 *   this is the one screen a Director is asked to sign. Same reasoning that gave
 *   OCPI's machine templates a real editor rather than a JSON blob.
 *
 * ⚠ EDITING A DISPUTED CELL IS WHAT RESOLVES IT. Setting the value IS the act of
 *   deciding which of the policy's two answers is real, so `setRate` clears the
 *   flag at the same moment. Once the last one clears, the card becomes
 *   signable. Nobody has to remember to unmark anything.
 */
export default function RateCards() {
  const s = useTravelStore();
  const orgPersonById = useOrgPersonById();

  const [cardId, setCardId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TravelRate | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const card = useMemo(
    () => s.rateCards.find((c) => c.id === cardId) ?? s.effectiveCard,
    [s.rateCards, s.effectiveCard, cardId],
  );

  const rates = useMemo(() => (card ? s.ratesFor(card.id) : []), [s, card]);
  const blockers = card ? s.blockersOn(card.id) : 0;
  const canManage = s.canManageMaster("rate_card");

  const byType = useMemo(() => {
    const m = new Map<RateType, TravelRate[]>();
    for (const r of rates) {
      const list = m.get(r.rateType) ?? [];
      list.push(r);
      m.set(r.rateType, list);
    }
    return m;
  }, [rates]);

  if (!card) {
    return (
      <Card className="max-w-2xl p-6">
        <h1 className="text-[18px] font-bold text-navy">No rate card yet</h1>
        <p className="mt-2 text-[13.5px] text-grey-2">
          Nothing can be priced until a rate card exists. One is seeded with the policy&rsquo;s
          proposed figures when the module is installed.
        </p>
      </Card>
    );
  }

  const openCell = (r: TravelRate) => {
    setEditing(r);
    setDraftValue(
      RATE_TYPE_META[r.rateType].unit === "text"
        ? r.textValue ?? ""
        : r.amount === null ? "" : String(r.amount),
    );
    setErr(null);
  };

  const saveCell = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      const meta = RATE_TYPE_META[editing.rateType];
      if (meta.unit === "text") {
        await s.setRate(editing.id, { textValue: draftValue.trim() || null });
      } else {
        const t = draftValue.trim();
        // An EMPTY cell is a real answer for a cap: §10 gives TC-A "no cap,
        // actuals with a receipt". So blank means uncapped, not unset.
        const n = t === "" ? null : Number(t);
        if (t !== "" && !Number.isFinite(n)) throw new Error("That is not a number.");
        await s.setRate(editing.id, { amount: n });
      }
      setEditing(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.confirmRateCard(card.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cellFor = (type: RateType, tc: TravelCategory | null, tier: CityTier | null, key: string | null) =>
    (byType.get(type) ?? []).find(
      (r) => r.travelCategory === tc && r.cityTier === tier && r.key === key,
    );

  const renderValue = (r: TravelRate | undefined, type: RateType) => {
    if (!r) return <span className="text-grey-2">—</span>;
    const meta = RATE_TYPE_META[type];
    const body =
      meta.unit === "text"
        ? r.textValue ?? <span className="text-grey-2">—</span>
        : r.amount === null
          ? <span className="italic text-grey-2">no cap</span>
          : money(r.amount);
    return (
      <span className={r.disputed ? "font-semibold text-ryg-red" : ""}>
        {body}
        {r.disputed && <span className="ml-1 text-[11px] font-bold">⚠</span>}
      </span>
    );
  };

  const cellButton = (r: TravelRate | undefined, type: RateType) =>
    r && canManage ? (
      <button
        type="button"
        onClick={() => openCell(r)}
        title={r.notes ?? undefined}
        className="w-full rounded px-2 py-1 text-left hover:bg-[#F2F5F9]"
      >
        {renderValue(r, type)}
      </button>
    ) : (
      <span title={r?.notes ?? undefined} className="px-2">{renderValue(r, type)}</span>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">Rate cards</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] text-grey-2">
            The Domestic Travel Policy as data. A <strong>draft</strong> card prices everything but
            its caps only advise; a <strong>confirmed</strong> card enforces them.
          </p>
        </div>
        {s.rateCards.length > 1 && (
          <select
            value={card.id}
            onChange={(e) => setCardId(e.target.value)}
            className="rounded-lg border border-line px-3 py-2 text-[13px]"
          >
            {s.rateCards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} · {formatDateDMY(c.effectiveFrom)} · {c.status}
              </option>
            ))}
          </select>
        )}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-navy">{card.label}</h2>
            <p className="mt-0.5 text-[13px] text-grey-2">
              Effective {formatDateDMY(card.effectiveFrom)} ·{" "}
              {card.status === "confirmed" ? (
                <span className="font-semibold text-ryg-green">
                  Confirmed
                  {card.confirmedBy ? ` by ${orgPersonById(card.confirmedBy)?.name ?? "someone"}` : ""}
                  {card.confirmedAt ? ` on ${formatDateDMY(card.confirmedAt)}` : ""} — caps enforce
                </span>
              ) : card.status === "superseded" ? (
                <span className="text-grey-2">Superseded — kept so older trips still price correctly</span>
              ) : (
                <span className="font-semibold text-orange">Draft — caps advise, they do not block</span>
              )}
            </p>
          </div>
          {card.status === "draft" && canManage && (
            <Button onClick={confirm} disabled={busy || blockers > 0}>
              {blockers > 0 ? `${blockers} to resolve first` : "Sign off this card"}
            </Button>
          )}
        </div>

        {blockers > 0 && (
          <div className="mt-3 rounded-lg border border-ryg-red/30 bg-ryg-red/5 p-3">
            <p className="text-[13.5px] font-semibold text-ryg-red">
              {blockers} figure{blockers === 1 ? "" : "s"} the policy contradicts itself on
            </p>
            <p className="mt-1 text-[13px] text-grey">
              The source document gives two different answers in two different places for each of
              these, marked <strong>⚠</strong> below. This card cannot be signed off until somebody
              decides which is right — <strong>setting the value is the decision</strong>, so
              clicking the cell and confirming the figure resolves it.
            </p>
            <ul className="mt-2 space-y-1">
              {rates.filter((r) => r.disputed).map((r) => (
                <li key={r.id} className="text-[12.5px] text-grey-2">
                  <strong className="text-navy">
                    {RATE_TYPE_META[r.rateType].label}
                    {r.travelCategory ? ` · ${r.travelCategory}` : ""}
                    {r.key ? ` · ${r.key}` : ""}
                  </strong>{" "}
                  — {r.notes}
                </li>
              ))}
            </ul>
          </div>
        )}

        {err && <p className="mt-3 text-[12.5px] text-ryg-red">{err}</p>}
      </Card>

      {RATE_TYPE_ORDER.filter((t) => (byType.get(t) ?? []).length > 0).map((type) => {
        const meta = RATE_TYPE_META[type];
        const rows = byType.get(type) ?? [];
        const keys = Array.from(new Set(rows.map((r) => r.key).filter(Boolean))) as string[];
        const hasCategory = rows.some((r) => r.travelCategory !== null);

        return (
          <Card key={type} className="p-4">
            <h2 className="text-[15px] font-bold text-navy">{meta.label}</h2>
            <p className="mt-1 max-w-3xl text-[13px] text-grey-2">{meta.blurb}</p>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-grey-2">
                    <th className="py-2 pr-3">{hasCategory ? "Category" : "Rule"}</th>
                    {/* ⚠ THE KEY COLUMNS ONLY EXIST WHEN THERE IS A CATEGORY AXIS
                        TO CROSS THEM WITH. Without one — band → category, or the
                        general rules like `min_distance_km` — each ROW already IS
                        a key, so one column per key would print nine headers over
                        two cells. */}
                    {meta.byTier
                      ? TIERS.map((t) => <th key={t} className="py-2 pr-3">{TIER_HEAD[t]}</th>)
                      : hasCategory && keys.length
                        ? keys.map((k) => <th key={k} className="py-2 pr-3">{k.replace(/_/g, " ")}</th>)
                        : <th className="py-2 pr-3">Value</th>}
                  </tr>
                </thead>
                <tbody>
                  {hasCategory
                    ? TRAVEL_CATEGORIES.filter((tc) =>
                        rows.some((r) => r.travelCategory === tc.value),
                      ).map((tc) => (
                        <tr key={tc.value} className="border-b border-line/60">
                          <td className="py-1.5 pr-3 font-medium text-navy">{tc.label}</td>
                          {meta.byTier
                            ? TIERS.map((tier) => (
                                <td key={tier} className="py-1.5 pr-3">
                                  {cellButton(
                                    cellFor(type, tc.value, tier, null)
                                      ?? cellFor(type, tc.value, null, null),
                                    type,
                                  )}
                                </td>
                              ))
                            : keys.length
                              ? keys.map((k) => (
                                  <td key={k} className="py-1.5 pr-3">
                                    {cellButton(cellFor(type, tc.value, null, k), type)}
                                  </td>
                                ))
                              : (
                                <td className="py-1.5 pr-3">
                                  {cellButton(cellFor(type, tc.value, null, null), type)}
                                </td>
                              )}
                        </tr>
                      ))
                    : rows
                        .slice()
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((r) => (
                          <tr key={r.id} className="border-b border-line/60">
                            <td className="py-1.5 pr-3 font-medium text-navy">
                              {type === "band_category"
                                ? `Band ${r.key}`
                                : (r.key ?? "").replace(/_/g, " ") || "Value"}
                            </td>
                            <td className="py-1.5 pr-3">{cellButton(r, type)}</td>
                          </tr>
                        ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={`${RATE_TYPE_META[editing.rateType].label}${editing.travelCategory ? ` · ${editing.travelCategory}` : ""}`}
        >
          <div className="space-y-3">
            {editing.disputed && (
              <div className="rounded-lg border border-ryg-red/30 bg-ryg-red/5 p-3 text-[13px] text-grey">
                <p className="font-semibold text-ryg-red">The policy contradicts itself here</p>
                <p className="mt-1">{editing.notes}</p>
                <p className="mt-2 text-[12.5px]">
                  Confirming a value below <strong>records the decision</strong> and clears the flag.
                </p>
              </div>
            )}
            {!editing.disputed && editing.notes && (
              <p className="text-[12.5px] text-grey-2">{editing.notes}</p>
            )}

            <label className="block">
              <span className="text-[13px] font-medium text-navy">
                {RATE_TYPE_META[editing.rateType].unit === "text" ? "Entitlement" : "Amount (₹)"}
              </span>
              <input
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[13.5px]"
                placeholder={
                  RATE_TYPE_META[editing.rateType].unit === "text" ? "e.g. Economy — Saver fare" : "e.g. 1750"
                }
              />
              {RATE_TYPE_META[editing.rateType].unit !== "text" && (
                <span className="mt-1 block text-[12px] text-grey-2">
                  Leave it empty to mean <strong>no cap</strong> — actuals with a receipt.
                </span>
              )}
            </label>

            {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={saveCell} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
