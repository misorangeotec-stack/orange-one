import { SandboxProvider } from "@/shared/sandbox/SandboxContext";
import { ImportStoreProvider, useImportStore } from "../store";
import NewRequest from "../pages/requests/NewRequest";

/**
 * Purchase RM Import's New Request, for the Ink IMS "Place order" slide-over. Same providers and
 * the same edit gate as the `requests/new` route, so nobody raises here who could not raise there.
 */
function Gate({ inkId, onSubmitted }: { inkId: string; onSubmitted: (id: string) => void }) {
  const { canEdit } = useImportStore();
  if (!canEdit) {
    return (
      <p className="p-6 text-sm text-red-700">
        You do not have rights to raise requests in Purchase RM Import. Ask an admin for edit access.
      </p>
    );
  }
  return <NewRequest inkId={inkId} onSubmitted={onSubmitted} />;
}

export default function ImportRaiseFromInk(props: { inkId: string; onSubmitted: (id: string) => void }) {
  return (
    <SandboxProvider scope="import" homePath="/import">
      <ImportStoreProvider>
        <Gate {...props} />
      </ImportStoreProvider>
    </SandboxProvider>
  );
}
