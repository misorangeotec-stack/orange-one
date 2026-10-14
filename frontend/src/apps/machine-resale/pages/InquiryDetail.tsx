import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import Modal from "@/shared/components/ui/Modal";
import { FieldHeading, FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { addInquiryNote, setInquiryStatus, setMachineStatus } from "../data/mrWrites";
import { InquiryStatusPill, PageHeader, StatusPill } from "../components/Pills";
import { dmyTime } from "../lib/format";
import { B } from "../nav";
import { useMrStore } from "../store";
import { SOURCE_LABEL } from "../types";

/**
 * One inquiry. Reached as /machine-resale/inquiries/<IQ-0001> from the list, and
 * by its id too, so the alert email's link works whichever it carries.
 */
export default function InquiryDetail() {
  const s = useMrStore();
  const { key } = useParams();
  const inq = s.inquiryByKey(key);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [askSold, setAskSold] = useState(false);

  if (!inq) {
    return (
      <Card className="max-w-xl p-6">
        <h1 className="text-[18px] font-bold text-navy">Inquiry not found</h1>
        <p className="mt-2 text-[13.5px] text-grey">
          <Link to={`${B}/inquiries`} className="font-semibold text-orange hover:underline">Back to inquiries</Link>
        </p>
      </Card>
    );
  }

  const machine = s.machineById(inq.machineId);
  const status = s.masterById(inq.statusId)?.value ?? "";
  const statusOptions = s
    .mastersOf("inquiry_status", inq.statusId)
    .map((m) => ({ value: m.id, label: m.active ? m.value : `${m.value} (switched off)` }));

  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      await s.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (id: string) => {
    if (!id || id === inq.statusId) return;
    void run(async () => {
      await setInquiryStatus(inq.id, id);
      // A won deal usually means the machine is gone. Asked, not assumed: one
      // machine can have several buyers asking, and only one of them buys it.
      if (s.masterById(id)?.value === "Closed won" && machine && machine.status !== "sold") setAskSold(true);
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader title={`${inq.inquiryNo} · ${inq.buyerName}`} sub={`Received ${dmyTime(inq.createdAt)} by ${SOURCE_LABEL[inq.source].toLowerCase()}.`}>
        <InquiryStatusPill label={status} />
        <Link to={`${B}/inquiries`}>
          <Button variant="ghost" size="sm">Back to inquiries</Button>
        </Link>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-2 p-5">
          <h2 className="text-[15px] font-bold text-navy">Buyer</h2>
          <Detail label="Name" value={inq.buyerName} />
          <Detail label="Company" value={inq.company} />
          <Detail label="Phone" value={inq.phone} href={`tel:${inq.phone.replace(/[^\d+]/g, "")}`} />
          <Detail label="Email" value={inq.email} href={inq.email ? `mailto:${inq.email}` : undefined} />
          <Detail label="City" value={inq.city} />
          {inq.message && (
            <div className="pt-1">
              <div className="text-[12px] font-medium text-grey-2">Message</div>
              <p className="whitespace-pre-wrap text-[13.5px] text-ink">{inq.message}</p>
            </div>
          )}
        </Card>

        <Card className="space-y-2 p-5">
          <h2 className="text-[15px] font-bold text-navy">Machine</h2>
          {inq.machineId || inq.listingNoSnapshot ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {machine ? (
                  <Link to={`${B}/machines/${machine.id}`} className="font-semibold text-orange hover:underline">
                    {machine.listingNo} · {machine.title}
                  </Link>
                ) : (
                  <span className="font-semibold text-navy">
                    {inq.listingNoSnapshot} · {inq.machineTitleSnapshot}
                  </span>
                )}
                {machine && <StatusPill status={machine.status} />}
              </div>
              <Detail label="Salesperson" value={inq.salespersonName} />
              <Detail label="Salesperson email" value={inq.salespersonEmail} />
            </>
          ) : (
            <p className="text-[13.5px] text-grey">A general inquiry, not about one machine.</p>
          )}
        </Card>
      </div>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Follow-up</h2>
        <div className="max-w-sm">
          <FieldHeading label="Status" />
          <Combobox value={inq.statusId ?? ""} options={statusOptions} onChange={changeStatus} disabled={!s.canEdit || busy} />
        </div>

        <div>
          <div className="mb-2 text-[13px] font-medium text-navy">Notes</div>
          {inq.notes.length ? (
            <ol className="space-y-3 border-l-2 border-line pl-4">
              {inq.notes.map((n) => (
                <li key={n.id}>
                  <div className="text-[12px] text-grey-2">
                    {dmyTime(n.createdAt)} · {n.authorName ?? "Unknown"}
                  </div>
                  <p className="whitespace-pre-wrap text-[13.5px] text-ink">{n.note}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-grey-2">No notes yet.</p>
          )}
        </div>

        {s.canEdit && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const t = note.trim();
              if (!t) return;
              void run(async () => {
                await addInquiryNote(inq.id, t);
                setNote("");
              });
            }}
          >
            <FieldLabel label="Add a note">
              <TextArea
                value={note}
                maxLength={4000}
                rows={3}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="What was said, and what happens next. Ctrl+Enter adds it."
              />
            </FieldLabel>
            <Button type="submit" size="sm" disabled={busy || !note.trim()}>
              {busy ? "Saving..." : "Add note"}
            </Button>
          </form>
        )}
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </Card>

      <Modal
        open={askSold}
        onClose={() => setAskSold(false)}
        title={`Mark ${machine?.listingNo ?? "the machine"} as sold too?`}
        subtitle={machine?.title}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAskSold(false)} disabled={busy}>
              Not now
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (machine) await setMachineStatus(machine.id, "sold");
                  setAskSold(false);
                })
              }
            >
              Mark sold
            </Button>
          </div>
        }
      >
        <p className="text-[13.5px] text-grey">
          It stays on the website with a Sold ribbon and no inquiry buttons.
        </p>
      </Modal>
    </div>
  );
}

function Detail({ label, value, href }: { label: string; value: string | null | undefined; href?: string }) {
  return (
    <div className="flex gap-3 text-[13.5px]">
      <span className="w-36 shrink-0 text-grey-2">{label}</span>
      {value ? (
        href ? (
          <a href={href} className="font-medium text-navy hover:underline">{value}</a>
        ) : (
          <span className="font-medium text-ink">{value}</span>
        )
      ) : (
        <span className="text-grey-2">Not given</span>
      )}
    </div>
  );
}
