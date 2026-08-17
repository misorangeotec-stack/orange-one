import type { Dispatch, SetStateAction } from "react";
import Combobox, { type ComboOption, type ComboboxHandle } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn, type LineGridRow, newUid } from "@/shared/components/ui/LineGrid";
import { TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../store";
import type { MasterRaise } from "../pages/orders/useSalesOrderForm";

/**
 * The intake item grid — Item · Qty · Unit · Remark.
 *
 * ⚠ THE ITEM LIST IS THE CUSTOMER'S, NOT THE CATALOGUE. `customerId` scopes the
 *   picker to that customer's mapped items; with no customer chosen yet the list
 *   is empty and says so. The RPC enforces the same rule, so a stale row cannot
 *   sneak an unmapped item through.
 *
 * ⚠ ONE ITEM, ONE LINE. The picker is built PER ROW (`optionsFor`) so an item another
 *   row already took is not offered again — the same rule every other FMS grid follows.
 *
 * ⚠ LineGrid is APPEND-ONLY and "blank means blank": it appends a trailing row on
 *   every render where the last row isn't blank. So `makeEmptyLine()` must return
 *   a genuinely empty row, and `isLineBlank` must agree with it, or the grid
 *   appends for ever. These two functions always change together.
 */
export interface OrderLineRow extends LineGridRow {
  itemId: string;
  quantity: string;
  lineRemark: string;
}

export const makeEmptyLine = (): OrderLineRow => ({
  uid: newUid(),
  itemId: "",
  quantity: "",
  lineRemark: "",
});

export const isLineBlank = (r: OrderLineRow): boolean =>
  !r.itemId && !r.quantity.trim() && !r.lineRemark.trim();

export default function OrderLinesGrid({
  rows,
  onRowsChange,
  customerId,
  disabled,
  onRaise,
  requested,
}: {
  rows: OrderLineRow[];
  /** Forwarded straight to LineGrid, so it must keep the updater form. */
  onRowsChange: Dispatch<SetStateAction<OrderLineRow[]>>;
  /** Scopes the picker to what this customer may order. */
  customerId: string;
  disabled?: boolean;
  /**
   * Raise the master this picker could not offer. Wired to the intake form's
   * shared RequestMasterModal (see SalesOrderFields) — omit it and the picker
   * simply offers no "request" row.
   */
  onRaise?: (raise: MasterRaise) => void;
  /** "Requested …", once something has been asked for from this grid. */
  requested?: string | null;
}) {
  const s = useDispatchStore();

  const allowedItems = s.itemsForCustomer(customerId);

  /**
   * WHAT A MISSING ITEM ACTUALLY MEANS HERE, and it is two different things:
   *
   *   · the item exists in the catalogue but is not MAPPED to this customer —
   *     what's missing is the mapping, and the request carries both halves of it;
   *   · the item does not exist at all — what's missing is the item, and the
   *     mapping can only be asked for once it does.
   *
   * Asking for a new item in the first case would be asking for a duplicate, and
   * the unique index would reject it at approval — after the owner had agreed.
   */
  const raiseFor = (typed: string): MasterRaise => {
    const name = typed.trim();
    const existing = s.items.find((i) => i.name.trim().toLowerCase() === name.toLowerCase());
    return existing
      ? { mt: "customer_item", prefill: { customer_id: customerId, item_id: existing.id }, from: "lines" }
      : { mt: "item", prefill: { name }, from: "lines" };
  };
  const isKnownItem = (typed: string) =>
    s.items.some((i) => i.name.trim().toLowerCase() === typed.trim().toLowerCase());

  /**
   * The picker for ONE row: the customer's items minus the ones other rows already
   * took. Excluding only OTHER rows is the point — dropping the row's own item too
   * would leave its trigger with nothing to render and the cell would read blank.
   */
  const optionsFor = (row: OrderLineRow): ComboOption[] => {
    const taken = new Set(rows.filter((r) => r.uid !== row.uid && r.itemId).map((r) => r.itemId));
    return allowedItems
      .filter((i) => !taken.has(i.id))
      .map((i) => ({ value: i.id, label: i.name, sublabel: i.code ?? undefined }));
  };

  const columns: LineGridColumn<OrderLineRow>[] = [
    {
      key: "item",
      header: "Item",
      className: "min-w-[220px]",
      cell: (row, api) => {
        const options = optionsFor(row);
        return (
          <Combobox
            // Registering the cell is what makes Tab off the row's last field land
            // HERE on the next row. Without it LineGrid's walk cannot see the Item
            // cell and skips straight to that row's Quantity.
            ref={api.focusRef as (el: ComboboxHandle | null) => void}
            value={row.itemId}
            onChange={(v) => {
              api.patch({ itemId: v });
              api.advance();
            }}
            options={options}
            placeholder={
              !customerId ? "Pick a customer first"
              : allowedItems.length === 0 ? "Nothing mapped yet — type to request"
              // Every mapped item is already on the order — say so rather than
              // showing an empty "Select item…" that never opens.
              : options.length === 0 ? "All items already added"
              : "Select item…"
            }
            searchable
            /*
              Enabled as soon as there is a customer, even with an EMPTY list.
              It used to disable itself exactly when the list was empty, which is
              the one moment the person needs to ask for something — the picker
              that had nothing to offer also refused to open.
            */
            disabled={disabled || !customerId}
            triggerClassName="px-2.5 py-1.5 text-[13.5px]"
            onTriggerKeyDown={api.keyHandler}
            onCreate={onRaise ? (name) => onRaise(raiseFor(name)) : undefined}
            createLabel={(q) =>
              isKnownItem(q) ? `Request “${q}” for this customer` : `Request new item “${q}”`
            }
          />
        );
      },
    },
    {
      key: "qty",
      header: <span className="block text-right">Quantity</span>,
      // Quantity inputs need an explicit min width: the table-fixed grid collapses
      // them below four digits otherwise.
      className: "w-[130px] min-w-[130px]",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as never}
          value={row.quantity}
          inputMode="decimal"
          disabled={disabled}
          onChange={(e) => api.patch({ quantity: e.target.value })}
          onKeyDown={api.keyHandler}
          // Right-aligned like every other quantity column in the app — it also puts
          // the digits directly above the total in the footer.
          className="px-2.5 py-1.5 text-[13.5px] text-right tabular-nums"
          placeholder="0"
        />
      ),
    },
    {
      // READ-ONLY. The unit is a property of the item, so there is nothing to
      // choose — and the old picker let an item measured in KGS be ordered in BOX.
      key: "unit",
      header: "Unit",
      className: "w-[110px] min-w-[110px]",
      // Nothing to focus here, so Tab steps over it to Remark.
      skipFocus: true,
      cell: (row) => {
        const unit = allowedItems.find((i) => i.id === row.itemId)?.unit;
        return (
          <span className="block px-2.5 py-1.5 text-[13.5px] text-grey-2">
            {unit || "—"}
          </span>
        );
      },
    },
    {
      key: "remark",
      header: "Remark",
      className: "min-w-[180px]",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as never}
          value={row.lineRemark}
          disabled={disabled}
          onChange={(e) => api.patch({ lineRemark: e.target.value })}
          onKeyDown={api.keyHandler}
          className="px-2.5 py-1.5 text-[13.5px]"
          placeholder="optional"
        />
      ),
    },
  ];

  const total = rows.reduce((a, r) => a + (Number(r.quantity) || 0), 0);
  // The unit only belongs on the total when every line agrees on one.
  const units = new Set(
    rows.map((r) => allowedItems.find((i) => i.id === r.itemId)?.unit ?? "").filter(Boolean),
  );
  const totalUnit = units.size === 1 ? ([...units][0] ?? "") : "";

  return (
    <div className="space-y-2">
      <LineGrid<OrderLineRow>
        rows={rows}
        onRowsChange={onRowsChange}
        columns={columns}
        makeEmptyRow={makeEmptyLine}
        isRowBlank={isLineBlank}
        /*
          A real <tfoot>, not a <div>. LineGrid drops this straight inside <table>, and
          a browser hoists non-table content OUT of the table — the old div rendered
          below the border with the figure nowhere near the column it totals.
        */
        footer={
          <tfoot>
            <tr className="border-t border-line text-navy">
              <td className="px-2.5 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                Total
              </td>
              <td className="px-2.5 py-2 text-right tabular-nums font-bold">{total || "—"}</td>
              <td className="px-2.5 py-2 text-[12.5px] text-grey-2">{totalUnit || "—"}</td>
              <td />
              <td />
            </tr>
          </tfoot>
        }
      />

      {onRaise && (
        <p className="text-[12px] text-grey-2">
          Only what this customer is mapped to is offered. Missing something? Type its name in the
          Item box to request it.
        </p>
      )}
      {requested && (
        <p className="text-[12px] text-teal">
          Requested {requested} — orderable once the master's owner approves it.
        </p>
      )}
    </div>
  );
}
