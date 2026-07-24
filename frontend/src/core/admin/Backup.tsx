import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";

/**
 * Admin → Backup.
 *
 * Lets an admin take a full, restorable .sql backup of both Supabase projects.
 * The actual dump runs as a LOCAL CLI (`npm run backup`) — a browser cannot run
 * `pg_dump`, and the app is a static SPA on Vercel with no server runtime. So
 * this page is a guide/launcher: pick what to back up, then copy the exact
 * command to run in your terminal. See frontend/scripts/backup-db.mjs.
 */

interface Db {
  key: "identity" | "receivables";
  label: string;
  ref: string;
  blurb: string;
}

const DATABASES: Db[] = [
  {
    key: "identity",
    label: "Identity / auth",
    ref: "icutjkrqkbzwvmnfbzpr",
    blurb: "Users, roles, departments, hierarchy, tasks, recurring tasks, notifications, RPC functions + RLS policies.",
  },
  {
    key: "receivables",
    label: "Receivables data",
    ref: "lkwtvcpeamkzzqkfnkuc",
    blurb: "Customers, invoices, receipts, credit/debit notes, journals and dashboard tables (fed by the Tally pipeline).",
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — user can select the text manually */
    }
  };
  return (
    <button
      onClick={copy}
      className="text-[12px] font-semibold text-orange hover:text-orange-2 transition px-2.5 py-1.5 rounded-lg hover:bg-orange-soft shrink-0"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function CommandBlock({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-2 bg-navy rounded-card px-3.5 py-2.5">
      <code className="text-[12.5px] text-white/90 font-mono break-all flex-1 leading-relaxed">{command}</code>
      <CopyButton text={command} />
    </div>
  );
}

export default function Backup() {
  const [showModal, setShowModal] = useState(false);
  const [sel, setSel] = useState<Record<Db["key"], boolean>>({ identity: true, receivables: true });

  const toggle = (k: Db["key"]) => setSel((s) => ({ ...s, [k]: !s[k] }));

  const chosen = DATABASES.filter((d) => sel[d.key]);
  const command = useMemo(() => {
    if (chosen.length === 0) return "";
    if (chosen.length === DATABASES.length) return "npm run backup";
    return `npm run backup -- --only=${chosen[0].key}`;
  }, [chosen]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-grey">Take a restorable backup of the databases</p>
        <Button size="sm" onClick={() => setShowModal(true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
          </svg>
          Create backup
        </Button>
      </div>

      {/* Explainer: why this runs locally, not on Vercel. */}
      <Card className="p-5">
        <h3 className="text-[15px] font-bold text-navy">How backups work</h3>
        <p className="text-[13px] text-grey leading-relaxed mt-1.5">
          A backup produces a full, <span className="font-semibold text-navy">restorable <code className="font-mono text-[12px]">.sql</code> file</span> (structure
          + data + functions + security rules) for each database, saved into the{" "}
          <code className="font-mono text-[12px] bg-page px-1 py-0.5 rounded">backups/</code> folder on your computer.
        </p>
        <div className="mt-3 flex gap-2.5 rounded-card bg-[#FFF7ED] border border-[#FCE4C6] p-3.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C2740C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
            <path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          <p className="text-[12.5px] text-[#8a5a16] leading-relaxed">
            This runs <span className="font-semibold">on your machine, not on the live website</span>. A browser can't create a database dump,
            and the deployed app has no server to do it. So you run one command in a terminal — it works on localhost only.
          </p>
        </div>
      </Card>

      {/* What gets backed up. */}
      <Card className="p-5">
        <h3 className="text-[15px] font-bold text-navy">What gets backed up</h3>
        <ul className="mt-3 space-y-3">
          {DATABASES.map((d) => (
            <li key={d.key} className="flex gap-3">
              <span className="w-9 h-9 rounded-card bg-orange-soft text-orange flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
                </svg>
              </span>
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-navy">
                  {d.label} <span className="text-[11.5px] text-grey-2 font-normal font-mono">{d.ref}</span>
                </div>
                <div className="text-[12px] text-grey-2 leading-relaxed">{d.blurb}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* One-time setup. */}
      <Card className="p-5">
        <h3 className="text-[15px] font-bold text-navy">One-time setup</h3>
        <ol className="mt-2.5 space-y-2 text-[13px] text-grey leading-relaxed list-decimal pl-5">
          <li>
            Install the PostgreSQL client tools so <code className="font-mono text-[12px]">pg_dump</code> is available
            (Windows: <code className="font-mono text-[12px]">winget install PostgreSQL.PostgreSQL</code>).
          </li>
          <li>
            In the repo-root <code className="font-mono text-[12px] bg-page px-1 py-0.5 rounded">.env</code> (or{" "}
            <code className="font-mono text-[12px] bg-page px-1 py-0.5 rounded">frontend/.env.local</code>), add a connection string for each
            project (Supabase → Connect → <span className="font-medium">Session pooler</span> URI):
            <code className="font-mono text-[11.5px] text-grey-2 block mt-1">BACKUP_IDENTITY_DB_URL=…</code>
            <code className="font-mono text-[11.5px] text-grey-2 block">BACKUP_RECEIVABLES_DB_URL=…</code>
          </li>
        </ol>
      </Card>

      {/* Choose-scope modal → generates the exact command. */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Choose what to back up"
        subtitle="Then copy the command and run it in your terminal."
        footer={<Button variant="ghost" onClick={() => setShowModal(false)}>Close</Button>}
      >
        <div className="space-y-3">
          {DATABASES.map((d) => (
            <label
              key={d.key}
              className="flex items-start gap-3 rounded-card border border-line p-3 cursor-pointer hover:border-[#d9e2f0] transition"
            >
              <input
                type="checkbox"
                checked={sel[d.key]}
                onChange={() => toggle(d.key)}
                className="mt-0.5 w-4 h-4 accent-orange shrink-0"
              />
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-navy">{d.label}</div>
                <div className="text-[11.5px] text-grey-2 leading-relaxed">{d.blurb}</div>
              </div>
            </label>
          ))}

          <div className="pt-1">
            <p className="text-[12px] text-grey mb-1.5">
              Run this from the <code className="font-mono text-[11.5px]">frontend/</code> folder:
            </p>
            {command ? (
              <CommandBlock command={command} />
            ) : (
              <p className="text-[12.5px] text-[#d4493f]">Select at least one database.</p>
            )}
            <p className="text-[11.5px] text-grey-2 mt-2 leading-relaxed">
              Files are written to the <code className="font-mono">backups/</code> folder. Add{" "}
              <code className="font-mono">--schema-only</code> for structure only, or{" "}
              <code className="font-mono">--data-only</code> for rows only.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
