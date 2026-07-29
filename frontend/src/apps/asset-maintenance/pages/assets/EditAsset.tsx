import { useNavigate, useParams } from "react-router-dom";
import AssetForm, { type AssetFormValues } from "../../components/AssetForm";
import { useAssetStore } from "../../store";

/**
 * Edit an asset's own facts. Its TRACKS are edited on the detail page, where each
 * one shows its dates and history — they are not form fields.
 */
export default function EditAsset() {
  const { id = "" } = useParams();
  const s = useAssetStore();
  const nav = useNavigate();
  const asset = s.assetById(id);

  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (!asset) return <p className="text-[13.5px] text-grey-2">That asset no longer exists.</p>;

  const submit = async (v: AssetFormValues) => {
    await s.updateAsset(asset.id, v);
    nav(`/asset-maintenance/assets/${asset.id}`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Edit {asset.assetNo}</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">{asset.name}</p>
      </div>
      <AssetForm
        initial={asset}
        submitLabel="Save changes"
        onSubmit={submit}
        onCancel={() => nav(`/asset-maintenance/assets/${asset.id}`)}
      />
    </div>
  );
}
