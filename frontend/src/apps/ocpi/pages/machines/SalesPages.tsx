import { useMemo } from "react";
import { Link } from "react-router-dom";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { useOcpiStore } from "../../store";
import {
  createSalesPage, setSalesPageActive, updateSalesPage,
} from "../../data/ocpiSalesPageWrites";
import type { OcpiSalesPage } from "../../types";

/**
 * The sales pages — page 2 of a machine's Performa Invoice.
 *
 * ⚠ ONE PAGE SERVES A WHOLE FAMILY, and that is why this is its own master
 *   rather than a block of text on each machine. The single "Key Benefits of
 *   Alpha II" page covers the 1.8 m, 1.9 m and 2.2 m models; "KoloRado ALPHA III"
 *   covers the 8-, 16- and 24-head Alpha 3.2s. Copying the copy onto each machine
 *   would mean three places to correct and they would not stay in step.
 *
 * ⚠ THESE ARE TRANSCRIPTIONS, NOT COPY WRITTEN HERE. All twelve were lifted
 *   verbatim, rendered with pdf.js, out of Performa Invoices real customers have
 *   already been sent. Rewording one changes what FUTURE invoices say; an issued
 *   PI is frozen on its version row like every other paper in this module.
 *
 * ⚠ THE HEADING IS A STORED FIELD, NOT A PATTERN. Eight real pages read "Key
 *   Benefits of …" and four read "Advantages of …". Assuming the first phrase is
 *   exactly what made the first sweep of this work miss Pengda, Alpha 15 and Fab
 *   Pro entirely.
 *
 * ⚠ THE BODY IS EDITED ON ITS OWN PAGE, the same split Machines makes with
 *   MachineTemplate. A page body is an ORDERED document of taglines, paragraphs,
 *   sub-headings and bullets; MasterCrud's form is built for flat values, and a
 *   JSON blob in a textarea is not an editor.
 */
export default function SalesPages() {
  const s = useOcpiStore();

  /** Which machines print this page. Empty is legitimate — a page can be spare. */
  const usedBy = (p: OcpiSalesPage) =>
    s.machines.filter((m) => m.salesPageId === p.id).map((m) => m.name);

  const columns = useMemo<MasterColumn<OcpiSalesPage>[]>(
    () => [
      {
        header: "Family",
        render: (p) => <span className="font-semibold text-navy">{p.name}</span>,
        filter: { get: (p) => p.name },
      },
      {
        header: "Heading, as printed",
        render: (p) => p.heading,
        filter: { get: (p) => p.heading },
      },
      {
        header: "Machines",
        render: (p) => {
          const names = usedBy(p);
          return names.length ? (
            names.join(", ")
          ) : (
            <span className="text-grey-2">none yet</span>
          );
        },
        // Ordered by HOW MANY machines print it, not by the joined names — a page
        // nobody points at is the thing worth finding, and alphabetical text hides it.
        sortValue: (p) => usedBy(p).length,
        filter: { get: (p) => usedBy(p).join(", ") },
      },
      {
        header: "Body",
        render: (p) => (
          <Link
            to={`/ocpi/sales-pages/${p.id}`}
            className={
              p.blocks.length
                ? "font-medium text-orange hover:underline"
                : "text-grey-2 hover:text-orange hover:underline"
            }
          >
            {p.blocks.length ? `${p.blocks.length} lines` : "empty"}
          </Link>
        ),
        // The ANSWER, not the link text: "12 lines" must not sort beside "empty".
        sortValue: (p) => p.blocks.length,
        filter: { get: (p) => (p.blocks.length ? "Written" : "Empty") },
      },
    ],
    [s],
  );

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Family", type: "text", required: true,
      hint: "The machine family this page belongs to, e.g. “Alpha II” or “Homer K24”. This is what the picker on the Machines master shows." },
    { key: "heading", label: "Heading, exactly as it prints", type: "text", required: true,
      hint: "Copy it off the real invoice, word for word — eight pages read “Key Benefits of …” and four read “Advantages of …”. It is printed as typed, not generated." },
    { key: "sortOrder", label: "Sort order", type: "text" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Performa Invoice sales pages</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Page two of a machine&rsquo;s Performa Invoice &mdash; the tagline, the paragraph and the
          advantages. One page serves a whole family, so several machines point at the same one; set
          which on the{" "}
          <Link to="/ocpi/machines" className="font-semibold text-orange hover:underline">
            Machines
          </Link>{" "}
          master. A machine with no page still issues its invoice, one page shorter.
        </p>
      </div>

      <MasterCrud<OcpiSalesPage>
        singular="sales page"
        rows={s.salesPages}
        columns={columns}
        fields={fields}
        searchText={(p) => `${p.name} ${p.heading} ${usedBy(p).join(" ")}`}
        defaultOrder={(p) => p.sortOrder}
        canManage={s.canManageMaster("machine")}
        statusNote="A deactivated page stops printing on new invoices. Machines still pointing at it simply issue the shorter form — nothing breaks, and invoices already issued are unchanged."
        emptyValues={{ name: "", heading: "", sortOrder: "500" }}
        toValues={(p) => ({
          name: p.name,
          heading: p.heading,
          sortOrder: String(p.sortOrder),
        })}
        onSubmit={async (id, values, active) => {
          const patch = {
            name: values.name,
            heading: values.heading,
            sortOrder: Number(values.sortOrder) || 500,
            active,
          };
          if (id) await updateSalesPage(id, patch);
          // ⚠ A NEW PAGE STARTS EMPTY, and the Body link is how it gets filled.
          //   Creating it here with no blocks is deliberate: the copy is lifted
          //   off a real invoice, which is a reading job, not a form field.
          else await createSalesPage({ ...patch, blocks: [] });
          await s.refresh();
        }}
        onToggleActive={async (row, active) => {
          await setSalesPageActive(row.id, active);
          await s.refresh();
        }}
      />
    </div>
  );
}
