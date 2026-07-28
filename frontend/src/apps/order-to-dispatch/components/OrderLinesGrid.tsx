import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn, type LineGridRow, newUid } from "@/shared/components/ui/LineGrid";
import { TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../store";

/**
 * The intake item grid — Item · Qty · Unit · Remark.
 *
 * ⚠ LineGrid is APPEND-ONLY and "blank means blank": it appends a trailing row on
 *   every render where the last row isn't blank. So `makeEmptyLine()` must return
 *   a genuinely empty row — the unit is filled in the item-picked handler, NOT
 *   seeded in the empty row, or `isLineBlank` never matches and the grid appends
 *   for ever. These two functions always change together.
 */
export interface OrderLineRow extends LineGridRow {
  itemId: string;
  quantity: string;
  unitId: string;
  lineRemark: string;
}

export const makeEmptyLine = (): OrderLineRow => ({
  uid: newUid(),
  itemId: "",
  quantity: "",
  unitId: "",
  lineRemark: "",
});

export const isLineBlank = (r: OrderLineRow): boolean =>
  !r.itemId && !r.quantity.trim() && !r.lineRemark.trim();

export default function OrderLinesGrid({
  rows,
  onRowsChange,
  disabled,
}: {
  rows: OrderLineRow[];
  onRowsChange: (rows: OrderLineRow[]) => void;
  disabled?: boolean;
}) {
  const s = useDispatchStore();

  const itemOptions: ComboOption[] = s.activeOf(s.items).map((i) => ({
    value: i.id,
    label: i.name,
    sublabel: i.code ?? undefined,
  }));
  const unitOptions: ComboOption[] = s.activeOf(s.units).map((u) => ({ value: u.id, label: u.name }));

  const columns: LineGridColumn<OrderLineRow>[] = [
    {
      key: "item",
      header: "Item",
      className: "min-w-[220px]",
      cell: (row, api) => (
        <Combobox
          value={row.itemId}
          onChange={(v) => {
            // Default the unit HERE, not in makeEmptyLine — see the header note.
            const item = s.items.find((i) => i.id === v);
            api.patch({ itemId: v, unitId: row.unitId || item?.unitId || "" });
            api.advance();
          }}
          options={itemOptions}
          placeholder="Select item…"
          searchable
          disabled={disabled}
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
      key: "unit",
      header: "Unit",
      className: "w-[120px] min-w-[120px]",
      cell: (row, api) => (
        <Combobox
          value={row.unitId}
          onChange={(v) => api.patch({ unitId: v })}
          options={unitOptions}
          placeholder="Unit"
          disabled={disabled}
          triggerClassName="px-2.5 py-1.5 text-[13.5px]"
          onTriggerKeyDown={api.keyHandler}
        />
      ),
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
