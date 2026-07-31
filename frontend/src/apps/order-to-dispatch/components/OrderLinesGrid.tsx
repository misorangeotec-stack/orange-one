import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
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
  const itemOptions: ComboOption[] = allowedItems.map((i) => ({
    value: i.id,
    label: i.name,
    sublabel: i.code ?? undefined,
  }));

  const columns: LineGridColumn<OrderLineRow>[] = [
    {
      key: "item",
      header: "Item",
      className: "min-w-[220px]",
      cell: (row, api) => (
        <Combobox
          value={row.itemId}
          onChange={(v) => {
            api.patch({ itemId: v });
            api.advance();
          }}
          options={itemOptions}
          placeholder={
            !customerId ? "Pick a customer first"
            : itemOptions.length === 0 ? "No items mapped to this customer"
            : "Select item…"
          }
          searchable
          disabled={disabled || !customerId || itemOptions.length === 0}
          triggerClassName="px-2.5 py-1.5 text-[13.5px]"
          onTriggerKeyDown={api.keyHandler}
        />
      ),
    },
    {
      key: "qty",
      header: "Quantity",
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
          className="px-2.5 py-1.5 text-[13.5px]"
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

  return (
    <LineGrid<OrderLineRow>
      rows={rows}
      onRowsChange={onRowsChange}
      columns={columns}
      makeEmptyRow={makeEmptyLine}
      isRowBlank={isLineBlank}
      footer={
        <div className="flex justify-end gap-6 px-3 py-2 text-[13px]">
          <span className="text-grey-2">Total quantity</span>
          <span className="font-semibold text-navy">{total || "—"}</span>
        </div>
      }
    />
  );
}
