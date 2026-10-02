import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../../store";
import {
  LEDGER_FORMS_QK, deleteLedgerForm, fetchLedgerForms, saveLedgerForm,
  type LedgerForm,
} from "../../data/ledgerForms";

/**
 * FORMS — the ledger → form-name master (OD-16).
 *
 * The form name is what a customer reads on the Order Desk in place of one of our
 * companies. "O-tec - Surat" is our legal entity and our Tally book; the form is
 * the name we and that customer both use for the paper the order goes on.
 *
 * ⚠ ONE ROW IS ONE LEDGER, NOT ONE CUSTOMER, and the difference shows up the
 *   moment a customer is ticked into two books. Such a customer sees TWO forms on
 *   the Order Desk and picks between them, so both ledgers need a row here — and
 *   they are meant to differ, because that choice is the whole point of the picker.
 *
 * ⚠ SEVERAL LEDGERS MAY SHARE ONE FORM NAME, deliberately unconstrained. Two
 *   customers ordering on the same printed form is ordinary, and a unique index
 *   would refuse the commonest real case. The grid groups by name so that is
 *   visible rather than surprising.
 *
 * ⚠ REMOVING A ROW DOES NOT BREAK ANYTHING. The Desk falls back to the company
 *   label for an unmapped ledger, which is what it showed before OD-16 — so this
 *   screen is additive, and an empty table is a working system, not a broken one.
 *   That is also why nothing here is required before a customer can be switched on.
 */
export default function FormsSection() {
  const s = useDispatchStore();
  const qc = useQueryClient();

  const [partyId, setPartyId] = useState("");
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  /** The row being renamed, and the text in flight. Null means nobody is editing. */
  const [editing, setEditing] = useState<{ partyId: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const forms = useQuery({ queryKey: LEDGER_FORMS_QK, queryFn: fetchLedgerForms, staleTime: 60_000 });
  const rows = useMemo(() => forms.data ?? [], [forms.data]);

  const done = () => {
    setErr(null);
    return qc.invalidateQueries({ queryKey: LEDGER_FORMS_QK });
  };
  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : String(e));

  const save = useMutation({
    mutationFn: (v: { partyId: string; formName: string }) => saveLedgerForm(v),
    onSuccess: done,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteLedgerForm(id),
    onSuccess: done,
    onError: fail,
  });

  const mapped = useMemo(() => new Set(rows.map((r) => r.partyId)), [rows]);

  /*
    ⚠ ONLY LEDGERS NOT ALREADY MAPPED. The save is an upsert, so offering a mapped
      ledger would silently overwrite its form from the ADD row — which reads as
      "added" and is actually "renamed something I could not see". Renaming is the
      grid's job, where the old value is on screen.

    The full ledger list is thousands of rows; Combobox searches, and the book is
    in the label because two ledgers genuinely share a name across books.
  */
  const ledgerOptions: ComboOption[] = useMemo(
    () =>
      s
        .activeOf(s.customers)
        .filter((c) => !mapped.has(c.id))
        .map((c) => ({
          value: c.id,
          label: c.name,
          sublabel: c.companyId ? s.masterName("company", c.companyId) : undefined,
        })),
    [s, mapped],
  );

  const shown = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.formName.toUpperCase().includes(q) ||
        r.partyName.toUpperCase().includes(q) ||
        (r.companyLabel ?? "").toUpperCase().includes(q),
    );
  }, [rows, search]);

  const add = () => {
    if (!partyId || !name.trim()) return;
    save.mutate(
      { partyId, formName: name },
      { onSuccess: () => { setPartyId(""); setName(""); } },
    );
  };

  const commitRename = () => {
    if (!editing) return;
    const text = editing.text.trim();
    // Unchanged or emptied: close without a write. An empty name is refused by the
    // server anyway, and bouncing that back as a red line for a no-op edit is noise.
    const before = rows.find((r) => r.partyId === editing.partyId)?.formName ?? "";
    if (!text || text === before) { setEditing(null); return; }
    save.mutate({ partyId: editing.partyId, formName: text }, { onSuccess: () => setEditing(null) });
  };

  const busy = save.isPending || remove.isPending;

  return (
    <Card className="p-5 space-y-4 max-w-3xl">
      <div>
        <p className="text-[12.5px] text-grey">
          The name a customer reads on their order screen, per Tally ledger. It replaces our
          company name there — a customer never sees “{"O-tec - Surat"}” once their ledger
          has a form.
        </p>
        <p className="text-[12.5px] text-grey-2 mt-1">
          A ledger with no form here still works: that customer sees the company name, as
          before. Nothing has to be filled in for an order to be placed.
        </p>
      </div>

      {/* ---------------------------------------------------------------- add */}
      <div className="border-t border-line pt-4 space-y-2">
        <div className="text-[13px] font-semibold text-navy">Add a form</div>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-[260px] flex-1">
            <Combobox
              value={partyId}
              onChange={setPartyId}
              options={ledgerOptions}
              placeholder="Search the ledger…"
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Form name the customer reads"
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            />
          </div>
          <Button size="sm" onClick={add} disabled={!partyId || !name.trim() || busy}>
            Add
          </Button>
        </div>
      </div>

      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}

      {/* --------------------------------------------------------------- grid */}
      <div className="border-t border-line pt-4 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[13px] font-semibold text-navy">Forms in use</div>
          <div className="text-[11.5px] text-grey-2">
            {shown.length !== rows.length ? `${shown.length} of ${rows.length}` : `${rows.length}`}
            {rows.length === 1 ? " form" : " forms"}
          </div>
        </div>

        {rows.length > 8 && (
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a form, a ledger or a book…"
          />
        )}

        {forms.isLoading ? (
          <p className="text-[12.5px] text-grey-2">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[12.5px] text-grey-2">
            No forms yet. Every customer sees our company name on their order screen until one
            is added here.
          </p>
        ) : shown.length === 0 ? (
          <p className="text-[12.5px] text-grey-2">Nothing matches “{search.trim()}”.</p>
        ) : (
          <div className="rounded-lg border border-line divide-y divide-line">
            {shown.map((r) => (
              <Row
                key={r.partyId}
                row={r}
                editing={editing?.partyId === r.partyId ? editing.text : null}
                busy={busy}
                onEdit={() => setEditing({ partyId: r.partyId, text: r.formName })}
                onEditText={(t) => setEditing({ partyId: r.partyId, text: t })}
                onCommit={commitRename}
                onCancelEdit={() => setEditing(null)}
                onRemove={() => remove.mutate(r.partyId)}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function Row({
  row, editing, busy, onEdit, onEditText, onCommit, onCancelEdit, onRemove,
}: {
  row: LedgerForm;
  /** The in-flight text, or null when this row is not being edited. */
  editing: string | null;
  busy: boolean;
  onEdit: () => void;
  onEditText: (t: string) => void;
  onCommit: () => void;
  onCancelEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
      <div className="min-w-0 flex-1">
        {editing !== null ? (
          <TextInput
            value={editing}
            onChange={(e) => onEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommit();
              if (e.key === "Escape") onCancelEdit();
            }}
            autoFocus
          />
        ) : (
          <span className="font-semibold text-ink">{row.formName}</span>
        )}
      </div>
      {/* The ledger and its book, for the admin only — neither ever reaches a customer. */}
      <div className="min-w-0 flex-1 truncate text-grey-2" title={row.partyName}>
        {row.partyName}
        {row.companyLabel && <span className="text-grey-2"> · {row.companyLabel}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {editing !== null ? (
          <>
            <Button size="sm" onClick={onCommit} disabled={busy}>Save</Button>
            <Button size="sm" variant="ghost" onClick={onCancelEdit} disabled={busy}>Cancel</Button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="rounded px-1.5 text-[11.5px] text-grey-2 underline hover:text-ink"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="rounded px-1.5 text-[15px] leading-none text-grey-2 hover:bg-page hover:text-ryg-red"
              aria-label={`Remove the form on ${row.partyName}`}
              title={`Remove ${row.formName} from ${row.partyName} — that customer goes back to seeing our company name`}
            >
              ×
            </button>
          </>
        )}
      </div>
    </div>
  );
}
