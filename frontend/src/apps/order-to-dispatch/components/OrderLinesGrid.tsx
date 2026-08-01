import Combobox, { type ComboOption, type ComboboxHandle } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn, type LineGridRow, newUid } from "@/shared/components/ui/LineGrid";
import { TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../store";

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
}: {
  rows: OrderLineRow[];
  onRowsChange: (rows: OrderLineRow[]) => void;
  /** Scopes the picker to what this customer may order. */
  customerId: string;
  disabled?: boolean;
}) {
  const s = useDispatchStore();

  const allowedItems = s.itemsForCustomer(customerId);

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
              : allowedItems.length === 0 ? "No items mapped to this customer"
              // Every mapped item is already on the order — say so rather than
              // showing an empty "Select item…" that never opens.
              : options.length === 0 ? "All items already added"
              : "Select item…"
            }
            searchable
            disabled={disabled || !customerId || options.length === 0}
            triggerClassName="px-2.5 py-1.5 text-[13.5px]"
            onTriggerKeyDown={api.keyHandler}
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
  );
}
