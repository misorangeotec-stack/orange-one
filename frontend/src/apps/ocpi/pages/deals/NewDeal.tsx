import QuotationEditor from "./QuotationEditor";

/** Raise a new quotation. Thin on purpose — the editor is shared with Edit Draft. */
export default function NewDeal() {
  return <QuotationEditor />;
}
