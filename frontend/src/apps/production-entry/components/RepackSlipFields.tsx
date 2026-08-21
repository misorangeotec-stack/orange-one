import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import RequestMasterModal from "./RequestMasterModal";
import PackLinesGrid from "./PackLinesGrid";
import { masterTypeLabel } from "../lib/masterFields";
import type { RepackFormApi } from "../pages/requests/useRepackForm";

/**
 * The REPACKAGING issue-slip form body (FG item, the one quantity, the packaging
 * grid, remarks). Shared by New Request and Edit Request so both stay in
 * lock-step — the same arrangement IssueSlipFields has for production cards, and
 * deliberately the same shape on screen so the two tabs read as one form.
 *
 * There is no BOM, no raw-material grid and no wastage: the packed quantity IS
 * the FG quantity, so ONE number drives the packaging grid's pack-size auto-fill
 * and every downstream figure. The page supplies the Lot/Batch field via
 * `batchField` and the action buttons via `children`.
 */
export default function RepackSlipFields({
  f,
  batchField,
  children,
}: {
  f: RepackFormApi;
  batchField?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <Card className="p-5 space-y-4">
        {batchField}

        {/* Same rule as the production tab — capped in the picker and re-checked
            in build(), because a typed date bypasses `max` in some browsers. */}
        <FieldLabel label="Job Date" required>
          <TextInput
            type="date"
            max={todayLocalIso()}
            value={f.issueDate}
            onChange={(e) => f.setIssueDate(e.target.value)}
          />
        </FieldLabel>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldLabel label="FG Item Name" required>
            <Combobox
              value={f.fgItemId}
              onChange={f.setFgItemId}
              options={f.fgItemOptions}
              placeholder="Select finished-good item"
              searchable
              onCreate={(name) => f.setRaise({ mt: "fg_item", prefill: { name } })}
              createLabel={(q) => `Request new FG item “${q}”`}
              autoAdvance
            />
          </FieldLabel>
          <FieldLabel label="FG / Packing Quantity" required>
            <div className="flex items-center gap-2">
              <TextInput
                type="number"
                className="text-right tabular-nums"
                value={f.fgQty}
                onChange={(e) => f.setFgQty(e.target.value)}
                placeholder="e.g. 500"
              />
              {f.fgUnitName && <span className="shrink-0 text-[13px] text-grey-2">{f.fgUnitName}</span>}
            </div>
          </FieldLabel>
          {/* The lot the goods ARRIVED with — the supplier / import lot printed
              on the FG being repacked. Deliberately NOT the Lot/Batch Card
              number above, which this system allocates; both travel together
              from here through every later step. */}
          <FieldLabel label="FG Item Lot Number" required>
            <TextInput
              value={f.fgLotNo}
              onChange={(e) => f.setFgLotNo(e.target.value)}
              placeholder="Lot number on the goods being repacked"
            />
          </FieldLabel>
        </div>

        {/* The same grid and the same rules as the Log Book Entry — here it divides
            by the FG quantity, because for a repack the two are one number. */}
        <PackLinesGrid
          rows={f.packRows}
          onRowsChange={f.setPackRows}
          packedQty={f.fgQty}
          onRaiseMaster={(name) => f.setRaise({ mt: "packaging_item", prefill: { name } })}
          label="Packaging Material *"
          hint={null}
        />

        {f.requested && (
          <p className="text-[12px] text-teal">Requested {f.requested} — selectable once the master's owner approves it.</p>
        )}

        <FieldLabel label="Remarks">
          <TextArea
            rows={2}
            value={f.issueRemarks}
            onChange={(e) => f.setIssueRemarks(e.target.value)}
            placeholder="Anything the team should know"
          />
        </FieldLabel>

        {f.err && <p className="text-[12.5px] text-ryg-red">{f.err}</p>}

        {children}
      </Card>

      <RequestMasterModal
        open={f.raise !== null}
        onClose={() => f.setRaise(null)}
        masterType={f.raise?.mt ?? null}
        lockType
        prefill={f.raise?.prefill}
        onRequested={(_id, mt, name) => f.setRequested(`${masterTypeLabel(mt).toLowerCase()} “${name}”`)}
      />
    </>
  );
}
