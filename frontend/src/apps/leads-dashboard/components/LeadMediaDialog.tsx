/**
 * Per-lead detail dialog. Its reason for existing is media: it plays the voice
 * note(s) and shows the business-card scans + person photos, all resolved from
 * the private `lead-media` bucket to signed urls at view time. A compact contact
 * strip gives the media context (who / which company / when).
 */

import { useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import { formatDateTimeDMY } from "@/shared/lib/date";
import type { Lead, Masters } from "../lib/types";
import { labelOf, colorOf } from "../lib/transforms";
import { useSignedMedia } from "../lib/mediaUrl";

export default function LeadMediaDialog({ lead, masters, onClose }: { lead: Lead | null; masters: Masters; onClose: () => void }) {
  const [zoom, setZoom] = useState<string | null>(null);
  if (!lead) return null;

  const interest = labelOf(masters, "interestLevels", lead.interestLevelId);
  const interestColor = colorOf(masters, "interestLevels", lead.interestLevelId);
  const follow = labelOf(masters, "followUpActions", lead.followUpActionId);
  const cats = lead.categoryIds.map((c) => labelOf(masters, "categories", c)).filter(Boolean);

  return (
    <Modal
      open={!!lead}
      onClose={onClose}
      size="xl"
      title={lead.companyName || lead.personName || "Lead"}
      subtitle={[lead.personName, lead.jobTitle].filter(Boolean).join(" · ") || undefined}
    >
      <div className="space-y-5 pb-2">
        {/* Context strip */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px]">
          <Meta label="Salesperson" value={lead.salesperson} />
          <Meta label="Captured" value={lead.capturedOn ? formatDateTimeDMY(lead.capturedOn) : "—"} />
          {lead.location && <Meta label="Location" value={lead.location} />}
          {interest && (
            <div>
              <div className="text-[10.5px] uppercase tracking-wide text-grey-2">Interest</div>
              <div className="inline-flex items-center gap-1.5 text-navy font-medium mt-0.5">
                <span className="w-2 h-2 rounded-full" style={{ background: interestColor || "#94A3B8" }} />
                {interest}
              </div>
            </div>
          )}
          {follow && <Meta label="Follow-up" value={follow} />}
        </div>

        {(lead.mobiles.length > 0 || lead.emails.length > 0) && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px]">
            {lead.mobiles.length > 0 && (
              <div>
                <div className="text-[10.5px] uppercase tracking-wide text-grey-2 mb-1">Phones</div>
                <div className="flex flex-wrap gap-1.5">
                  {lead.mobiles.map((m) => (
                    <a key={m} href={`tel:${m}`} className="rounded-full bg-page border border-line px-2.5 py-1 text-navy hover:border-orange transition">{m}</a>
                  ))}
                </div>
              </div>
            )}
            {lead.emails.length > 0 && (
              <div>
                <div className="text-[10.5px] uppercase tracking-wide text-grey-2 mb-1">Emails</div>
                <div className="flex flex-wrap gap-1.5">
                  {lead.emails.map((m) => (
                    <a key={m} href={`mailto:${m}`} className="rounded-full bg-page border border-line px-2.5 py-1 text-navy hover:border-orange transition">{m}</a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {cats.length > 0 && (
          <div>
            <div className="text-[10.5px] uppercase tracking-wide text-grey-2 mb-1">Categories</div>
            <div className="flex flex-wrap gap-1.5">
              {cats.map((c, i) => <span key={i} className="rounded-full bg-page border border-line px-2.5 py-1 text-[12px] text-navy">{c}</span>)}
            </div>
          </div>
        )}

        {/* Voice notes */}
        <Section title="Voice note" count={lead.voiceNotes.length}>
          {lead.voiceNotes.length === 0 ? (
            <Empty>No voice note recorded for this lead.</Empty>
          ) : (
            <div className="space-y-3">
              {lead.voiceNotes.map((v, i) => <VoiceCard key={i} uri={v.uri} transcript={v.transcript} summary={v.summary} status={v.status} />)}
            </div>
          )}
        </Section>

        {/* Card scans */}
        <Section title="Business card" count={lead.cardImages.length}>
          {lead.cardImages.length === 0 ? (
            <Empty>No card scan captured.</Empty>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {lead.cardImages.map((uri, i) => <Thumb key={i} uri={uri} caption={i === 0 ? "Front" : "Back"} onZoom={setZoom} />)}
            </div>
          )}
        </Section>

        {/* Person photos */}
        {lead.photos.length > 0 && (
          <Section title="Photos" count={lead.photos.length}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {lead.photos.map((p, i) => <Thumb key={i} uri={p.uri} caption={p.label} onZoom={setZoom} />)}
            </div>
          </Section>
        )}
      </div>

      {zoom && <Lightbox uri={zoom} onClose={() => setZoom(null)} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-grey-2">{label}</div>
      <div className="text-navy font-medium mt-0.5">{value}</div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="border-t border-line/70 pt-4">
      <h3 className="text-[13px] font-bold text-navy mb-2.5">
        {title}{typeof count === "number" && count > 1 ? <span className="text-grey-2 font-medium"> ({count})</span> : null}
      </h3>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-grey-2 italic">{children}</p>;
}

/** A signed-url image thumbnail that opens the lightbox on click. */
function Thumb({ uri, caption, onZoom }: { uri: string; caption?: string; onZoom: (url: string) => void }) {
  const { url, loading } = useSignedMedia(uri);
  return (
    <figure className="space-y-1">
      <button
        type="button"
        onClick={() => url && onZoom(url)}
        disabled={!url}
        className="block w-full aspect-[4/3] rounded-xl overflow-hidden border border-line bg-page relative group"
      >
        {url ? (
          <img src={url} alt={caption || "Lead media"} className="w-full h-full object-cover group-hover:scale-[1.03] transition" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-grey-2 text-[11px]">{loading ? "Loading…" : "Unavailable"}</span>
        )}
      </button>
      {caption && <figcaption className="text-[11px] text-grey-2 text-center">{caption}</figcaption>}
    </figure>
  );
}

/** A voice note: audio player + transcript / summary. */
function VoiceCard({ uri, transcript, summary, status }: { uri: string; transcript: string | null; summary: string | null; status: string | null }) {
  const { url, loading } = useSignedMedia(uri);
  return (
    <div className="rounded-xl border border-line bg-page/60 p-3.5 space-y-2.5">
      {url ? (
        <audio controls src={url} className="w-full h-9" />
      ) : (
        <div className="text-[12px] text-grey-2">{loading ? "Loading audio…" : status === "pending" ? "Audio still uploading…" : "Audio unavailable."}</div>
      )}
      {summary && (
        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-grey-2 mb-0.5">Summary</div>
          <p className="text-[12.5px] text-navy leading-relaxed">{summary}</p>
        </div>
      )}
      {transcript && (
        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-grey-2 mb-0.5">Transcript</div>
          <p className="text-[12.5px] text-grey leading-relaxed whitespace-pre-wrap">{transcript}</p>
        </div>
      )}
      {!summary && !transcript && status !== "pending" && <p className="text-[12px] text-grey-2 italic">No transcript available.</p>}
    </div>
  );
}

/** Full-screen zoom overlay for a single (already-signed) image url. */
function Lightbox({ uri, onClose }: { uri: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-navy/80 backdrop-blur-sm" onClick={onClose}>
      <img src={uri} alt="Lead media" className="max-w-full max-h-full rounded-lg shadow-card object-contain" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-navy flex items-center justify-center hover:bg-white transition">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
      </button>
    </div>
  );
}
