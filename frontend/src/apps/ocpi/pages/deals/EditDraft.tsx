import { useParams } from "react-router-dom";
import QuotationEditor from "./QuotationEditor";

/** Finish a draft quotation. Shares the editor with New Quotation. */
export default function EditDraft() {
  const { id } = useParams<{ id: string }>();
  return <QuotationEditor dealId={id} />;
}
