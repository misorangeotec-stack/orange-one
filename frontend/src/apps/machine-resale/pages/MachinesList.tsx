import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { mediaUrl } from "../data/client";
import { PageHeader, StatusPill, VideoPill } from "../components/Pills";
import { dmy, place } from "../lib/format";
import { refreshVideoState, VIDEO_PENDING } from "../lib/video";
import { B } from "../nav";
import { useMrStore } from "../store";
import { STATUS_LABEL, VIDEO_LABEL, type Machine } from "../types";

export default function MachinesList() {
  const s = useMrStore();
  const navigate = useNavigate();

  // One status check per page load for videos still on their way, so the list
  // does not show "Processing" for a video Bunny finished an hour ago. Editors
  // only: the video service refuses a view-only pass.
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current || !s.canEdit) return;
    checked.current = true;
    const pending = s.machines.filter((m) => m.bunnyVideoId && m.bunnyVideoStatus && VIDEO_PENDING.includes(m.bunnyVideoStatus));
    if (!pending.length) return;
    void Promise.all(
      pending.map((m) => refreshVideoState(m.id, m.bunnyVideoId!, m.bunnyVideoStatus).catch(() => null)),
    ).then((out) => {
      if (out.some((r) => r && "state" in r)) void s.refresh();
    });
  }, [s]);

  const cat = (m: Machine) => s.categoryById(m.categoryId)?.name ?? "";
  const head = (m: Machine) => s.printHeadById(m.subcategoryId)?.name ?? "";
  const master = (id: string | null) => s.masterById(id)?.value ?? "";

  const text = (key: string, header: string, get: (m: Machine) => string, cls = "text-grey"): QueueColumn<Machine> => ({
    key,
    header,
    cell: (m) => <span className={cls}>{get(m)}</span>,
    sortValue: get,
    exportValue: get,
    filter: { kind: "select", get },
  });

  const columns: QueueColumn<Machine>[] = [
    {
      key: "listing",
      header: "Listing ID",
      cell: (m) => <span className="font-mono text-[12.5px] font-semibold text-navy">{m.listingNo}</span>,
      sortValue: (m) => m.listingNo,
      exportValue: (m) => m.listingNo,
      filter: { kind: "select", get: (m) => m.listingNo },
      resize: { width: 100 },
    },
    {
      key: "cover",
      header: "Photo",
      cell: (m) => {
        const url = mediaUrl(m.photos[0]?.storagePath);
        return url ? (
          <img src={url} alt="" loading="lazy" className="h-10 w-14 rounded-md border border-line object-cover" />
        ) : (
          <span className="text-[12px] text-grey-2">None</span>
        );
      },
      sortValue: (m) => (m.photos.length ? 1 : 0),
      exportValue: (m) => (m.photos.length ? "Yes" : "No"),
      filter: { kind: "select", get: (m) => (m.photos.length ? "Has a photo" : "No photo") },
      resize: false,
    },
    text("title", "Title", (m) => m.title, "font-medium text-navy"),
    text("category", "Category", cat),
    text("head", "Print head", head),
    text("brand", "Printer brand", (m) => master(m.printerBrandId)),
    text("condition", "Condition", (m) => master(m.conditionId)),
    text("location", "Location", (m) => place(m.city, m.state)),
    text("seller", "Seller", (m) => m.sellerName ?? ""),
    text("salesperson", "Salesperson", (m) => m.salespersonName ?? ""),
    {
      key: "status",
      header: "Status",
      cell: (m) => <StatusPill status={m.status} />,
      sortValue: (m) => ({ active: 0, inactive: 1, sold: 2 })[m.status],
      exportValue: (m) => STATUS_LABEL[m.status],
      filter: { kind: "select", get: (m) => STATUS_LABEL[m.status] },
      resize: false,
    },
    {
      key: "featured",
      header: "Featured",
      cell: (m) => <span className={m.featured ? "font-semibold text-navy" : "text-grey-2"}>{m.featured ? "Yes" : "No"}</span>,
      sortValue: (m) => (m.featured ? 0 : 1),
      exportValue: (m) => (m.featured ? "Yes" : "No"),
      filter: { kind: "select", get: (m) => (m.featured ? "Yes" : "No") },
    },
    {
      key: "video",
      header: "Video",
      cell: (m) => <VideoPill state={m.bunnyVideoStatus} />,
      sortValue: (m) => (m.bunnyVideoStatus ? VIDEO_LABEL[m.bunnyVideoStatus] : ""),
      exportValue: (m) => (m.bunnyVideoStatus ? VIDEO_LABEL[m.bunnyVideoStatus] : "None"),
      filter: { kind: "select", get: (m) => (m.bunnyVideoStatus ? VIDEO_LABEL[m.bunnyVideoStatus] : "None") },
    },
    {
      key: "photos",
      header: "Photos",
      align: "right",
      cell: (m) => <span className="tabular-nums">{m.photos.length}</span>,
      sortValue: (m) => m.photos.length,
      exportValue: (m) => m.photos.length,
      filter: { kind: "number", get: (m) => m.photos.length },
    },
    {
      key: "updated",
      header: "Updated",
      cell: (m) => <span className="whitespace-nowrap text-grey">{dmy(m.updatedAt)}</span>,
      sortValue: (m) => m.updatedAt,
      exportValue: (m) => dmy(m.updatedAt),
      filter: { kind: "date", get: (m) => m.updatedAt },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Machines" sub="Every pre-owned printer listed or waiting to be listed. Open a row to edit it.">
        {s.canEdit && (
          <Link to={`${B}/machines/new`}>
            <Button size="sm">New machine</Button>
          </Link>
        )}
      </PageHeader>
      <QueueTable<Machine>
        rows={s.machines}
        rowKey={(m) => m.id}
        columns={columns}
        rowsLabel="machines"
        onRowClick={(m) => navigate(`${B}/machines/${m.id}`)}
        initialSort={{ key: "listing", dir: "desc" }}
        emptyTitle="No machines yet"
        emptyMessage={s.canEdit ? "Add the first one with New machine." : "None have been added yet."}
        exportName="Machines"
      />
    </div>
  );
}
