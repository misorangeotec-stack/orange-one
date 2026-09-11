import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { useSession } from "@/core/platform/session";
import { useBankAccounts, useCompanyOptions, upsertBankAccount, setBankAccountActive } from "../data/bankAccounts";
import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPE_RANK, entityLabel, entityRank } from "../lib/labels";
import { fmtLacs } from "../lib/format";
import { REPORT_LOCATIONS, type BankAccount, type BankAccountType } from "../types";

/**
 * Daily Report → Bank accounts.
 *
 * The list of accounts the report tracks: which entity owns each, where it is
 * reported, what the bank calls it, and the sanctioned limits the facility block
 * is computed from. Portal-owned — Tally holds the bank LEDGERS but not the
 * account numbers, the limits, or a label short enough for a grid column head.
 *
 * Eleven rows today. Deliberately a master screen rather than a settings panel:
 * the Excel round trip MasterCrud gives for free is how eleven accounts were
 * seeded in one paste, and how a twelfth gets added without a migration.
 */

const TypeChip = ({ type }: { type: BankAccountType }) => (
  <span
    className={
      type === "cc" || type === "od"
        ? "rounded bg-orange/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-orange"
        : "rounded bg-navy/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-navy"
    }
  >
    {ACCOUNT_TYPE_LABEL[type]}
  </span>
);

/** A money column: blank is UNSET, which is not the same as a nil limit. */
const limitCol = (
  header: string,
  get: (a: BankAccount) => number | null,
): MasterColumn<BankAccount> => ({
  header,
  className: "w-32",
  render: (a) =>
    get(a) == null
      ? <span className="text-grey-2">—</span>
      : <span className="tabular-nums">{fmtLacs(get(a))}</span>,
  // "1,200.00" sorts before "9.00" as text, so money always declares this.
  // -1 keeps "no limit" out of the top of a descending sort.
  sortValue: (a) => get(a) ?? -1,
  filter: { get: (a) => (get(a) == null ? "" : fmtLacs(get(a))) },
});

export default function BankAccounts() {
  const { canEditModule } = useSession();
  const qc = useQueryClient();
  const accounts = useBankAccounts();
  const companies = useCompanyOptions();

  const mayManage = canEditModule("daily-report");

  const companyOptions = useMemo(
    () =>
      (companies.data ?? []).map((c) => ({
        value: c.id,
        // Both halves: the alias is what the rest of the portal shows, and the
        // Tally book's own location is what tells two same-alias rows apart.
        label: `${entityLabel(c.alias)}${c.location ? ` — ${c.location}` : ""}`,
        sublabel: c.alias,
      })),
    [companies.data],
  );

  const aliasOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies.data ?? []) m.set(c.id, c.alias);
    return m;
  }, [companies.data]);

  const columns: MasterColumn<BankAccount>[] = [
    {
      header: "Column head",
      className: "w-36",
      render: (a) => <span className="font-semibold text-navy">{a.name}</span>,
      filter: { get: (a) => a.name },
    },
    {
      header: "Entity",
      render: (a) => entityLabel(a.entityAlias),
      // The order the report prints entities in, not alphabetical.
      sortValue: (a) => entityRank(a.entityAlias),
      filter: { get: (a) => entityLabel(a.entityAlias) },
    },
    {
      header: "Location",
      className: "w-24",
      render: (a) => a.location,
      filter: { get: (a) => a.location },
    },
    { header: "Bank", className: "w-24", render: (a) => a.bank, filter: { get: (a) => a.bank } },
    {
      header: "Account no.",
      className: "w-36",
      // Only the last four on screen; the full number is in the edit form.
      render: (a) =>
        a.accountNo
          ? <span className="tabular-nums text-grey">•••• {a.accountNo.slice(-4)}</span>
          : <span className="text-grey-2">—</span>,
      // Every row is unique, so a dropdown here would only restate the table.
      filter: false,
    },
    {
      header: "Type",
      className: "w-28",
      // ⚠ A BADGE. MasterCrud otherwise sorts and filters on the text a cell
      //   RENDERS, and a component cell can yield nothing before React has
      //   rendered it — so both are declared. The order is cc → od → current →
      //   savings, which is how a bank position is read, not alphabetical.
      render: (a) => <TypeChip type={a.accountType} />,
      sortValue: (a) => ACCOUNT_TYPE_RANK[a.accountType],
      filter: { get: (a) => ACCOUNT_TYPE_LABEL[a.accountType] },
    },
    limitCol("CC limit (₹ L)", (a) => a.ccLimitLacs),
    limitCol("LC / BC limit (₹ L)", (a) => a.lcBcLimitLacs),
    limitCol("Held by bank (₹ L)", (a) => a.holdByBankLacs),
    {
      header: "Tally ledger",
      render: (a) =>
        a.tallyLedgerGuid
          ? <span className="text-[12px] text-grey">{a.tallyLedgerName ?? "linked"}</span>
          : <span className="text-[12px] text-orange">not linked</span>,
      // Sorts and filters on the QUESTION a reader actually has — "which
      // accounts still need linking?" — not on the ledger's name.
      sortValue: (a) => (a.tallyLedgerGuid ? 1 : 0),
      filter: { get: (a) => (a.tallyLedgerGuid ? "Linked" : "Not linked") },
    },
    {
      header: "Order",
      className: "w-20",
      render: (a) => <span className="tabular-nums text-grey">{a.sortOrder}</span>,
      sortValue: (a) => a.sortOrder,
      filter: false,
    },
  ];

  const fields: MasterFieldDef[] = [
    {
      key: "name", label: "Column head", type: "text", required: true,
      hint: "The SHORT name the balance grid prints as a column head — “AXIS CC 0346”, “ICICI 3289”. Keep it under about twelve characters: each account gets one narrow column, and a long name is truncated rather than wrapped.",
    },
    {
      key: "companyId", label: "Entity", type: "select", required: true, options: companyOptions,
      hint: "Whose account this is. The same company list the rest of the portal uses, which is what lets the report put this balance beside that entity's sales.",
    },
    {
      key: "location", label: "Location", type: "choice", required: true,
      options: REPORT_LOCATIONS.map((l) => ({ value: l, label: l })),
      hint: "Where the REPORT files this account, which is not always where its Tally book is. Delhi has bank accounts but no Tally company of its own — its account sits inside the O-tec Noida book, and the report says so rather than showing empty sales tables.",
    },
    { key: "bank", label: "Bank", type: "text", required: true,
      hint: "AXIS, ICICI, HDFC… Spell it the same way every time: the facility block groups on this, so “Axis” and “AXIS” would read as two banks." },
    { key: "branch", label: "Branch / note", type: "text",
      hint: "Free text, shown only on this screen. “Surat (CC)”, “Surat (new)” — whatever tells two accounts at the same bank apart." },
    { key: "accountNo", label: "Account number", type: "text",
      hint: "The full number. Only the last four digits are shown on this list and on the report." },
    { key: "ifsc", label: "IFSC", type: "text", hint: "Reference only — nothing computes from it." },
    {
      key: "accountType", label: "Account type", type: "choice", required: true,
      options: (Object.keys(ACCOUNT_TYPE_LABEL) as BankAccountType[]).map((t) => ({
        value: t, label: ACCOUNT_TYPE_LABEL[t],
      })),
      hint: "Cash credit and overdraft are the borrowing accounts, and the only ones the facility block reports on. A fixed vocabulary, hence buttons.",
    },
    {
      key: "tallyLedgerName", label: "Tally ledger name", type: "text",
      hint: "The bank ledger as it reads in Tally today. Display and drift-detection only — nothing joins on it, because a Tally rename would silently orphan the account.",
    },
    {
      key: "tallyLedgerGuid", label: "Tally ledger GUID", type: "text",
      hint: "The stable identity behind the name above, from ConnectWave's ledger master. Leave blank if this account genuinely has no Tally ledger — it still records and reports its balance normally.",
    },
    {
      key: "ccLimitLacs", label: "CC limit (₹ lakhs)", type: "text",
      hint: "Sanctioned cash-credit limit, IN LAKHS. Leave blank on an account that has none — a zero here reads as a facility the bank has withdrawn, which is a different statement.",
    },
    {
      key: "lcBcLimitLacs", label: "LC / BC limit (₹ lakhs)", type: "text",
      hint: "Sanctioned letter-of-credit / bill-collection limit. The FREE limit is computed as this minus the utilised figure typed each evening — never type a free limit anywhere.",
    },
    {
      key: "holdByBankLacs", label: "Held by bank (₹ lakhs)", type: "text",
      hint: "The standing hold the bank keeps against the CC limit. AVAILABLE CC LIMIT is computed as CC limit minus this. Change it only when the bank does.",
    },
    {
      key: "sortOrder", label: "Sort order", type: "text", placeholder: "0",
      hint: "Left-to-right order of this account's column in the balance grid, and top-to-bottom on the evening form. Lower first; ties fall back to the column head.",
    },
    { key: "notes", label: "Notes", type: "textarea",
      hint: "Anything a later reader needs — how the Tally ledger was matched, why a limit is blank." },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-semibold text-navy">Bank accounts</h1>
        <p className="mt-1 max-w-3xl text-[12.5px] text-grey">
          The accounts the Daily Report tracks. Tally holds the bank ledgers, but not the account
          numbers, the sanctioned limits, or a label short enough to head a grid column — so those
          live here. Limits are in ₹ lakhs.
        </p>
      </div>

      <MasterCrud<BankAccount>
        singular="bank account"
        rows={accounts.data ?? []}
        columns={columns}
        fields={fields}
        canManage={mayManage}
        searchText={(a) =>
          `${a.name} ${a.bank} ${a.location} ${a.accountNo ?? ""} ${a.ifsc ?? ""} ` +
          `${entityLabel(a.entityAlias)} ${a.tallyLedgerName ?? ""}`}
        // Not alphabetical: this master's own order IS the balance grid's column
        // order, so a reader checking "is the grid laid out right?" has to see
        // it in that order.
        defaultOrder={(a) => a.sortOrder}
        statusNote="A deactivated account stops being asked for on the evening entry form and drops out of the balance grid's columns from today onward. Balances already typed against it are kept, and it keeps its column on any past date it holds a figure for."
        emptyValues={{
          name: "", companyId: "", location: "Surat", bank: "", branch: "", accountNo: "",
          ifsc: "", accountType: "current", tallyLedgerName: "", tallyLedgerGuid: "",
          ccLimitLacs: "", lcBcLimitLacs: "", holdByBankLacs: "", sortOrder: "500", notes: "",
        }}
        toValues={(a) => ({
          name: a.name,
          companyId: a.companyId,
          location: a.location,
          bank: a.bank,
          branch: a.branch ?? "",
          accountNo: a.accountNo ?? "",
          ifsc: a.ifsc ?? "",
          accountType: a.accountType,
          tallyLedgerName: a.tallyLedgerName ?? "",
          tallyLedgerGuid: a.tallyLedgerGuid ?? "",
          // "" is UNSET and is not 0 — an account with no CC limit must not read
          // as one whose limit was withdrawn to nil.
          ccLimitLacs: a.ccLimitLacs == null ? "" : String(a.ccLimitLacs),
          lcBcLimitLacs: a.lcBcLimitLacs == null ? "" : String(a.lcBcLimitLacs),
          holdByBankLacs: a.holdByBankLacs == null ? "" : String(a.holdByBankLacs),
          sortOrder: String(a.sortOrder),
          notes: a.notes ?? "",
        })}
        onSubmit={async (id, v, active) => {
          await upsertBankAccount(id, v, active);
          await qc.invalidateQueries({ queryKey: ["daily-report"] });
        }}
        onToggleActive={async (row, active) => {
          await setBankAccountActive(row.id, active);
          await qc.invalidateQueries({ queryKey: ["daily-report"] });
        }}
      />

      {/* The entity picker is only as good as the company master behind it; say
          so here rather than leaving someone hunting for a missing entity. */}
      {aliasOf.size === 0 && !companies.isLoading && (
        <p className="text-[12px] text-orange">
          No companies are available to pick from. Add them in Admin → Masters → Companies first.
        </p>
      )}
    </div>
  );
}
