import SalespersonCollectionReport from "./SalespersonCollectionReport";

/**
 * Collection Desk — one page for the collection team (21-10-2026): the Salesperson Collection
 * Report's filters and totals, the customer page's aging card summed over every customer shown, and
 * the Follow-ups worklist columns (Next follow-up, Last outcome, Last remark, Owner, + Log) on each
 * row. It IS that report in desk mode, so its figures always tie to it — see the `desk` prop.
 */
export default function CollectionDesk() {
  return <SalespersonCollectionReport desk />;
}
