// push-to-google — mirror a synced lead into the "Leads DB" Google Sheet and the
// "Visiting Cards" / "Voice Notes" Drive folders. Fired automatically by a Postgres
// trigger on app_leads (insert/update) via pg_net, so Save → Supabase → Google
// happens on its own, with no PC/script. Idempotent: upsert by Lead ID (no dup
// rows), media tracked in app_leads.google_media (no re-upload), and the row is
// stamped google_synced_at when done.
//
// Reuses the FETCH DAILY DATA `orange-o-tec` Google OAuth client headlessly via a
// refresh token (Sheets + Drive scopes) — all creds are Supabase secrets, never in
// the app bundle. Auth to THIS function: an x-push-secret header matching the
// PUSH_GOOGLE_SECRET secret (the trigger sends it).
//
// Body: { "id": "<lead id>" }  — or { "ids": [...] } / {} to (re)push many/all
// pending (manual backfill). Also accepts a Supabase DB-webhook shape { record:{id} }.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const BUCKET = 'lead-media';

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE = env('SUPABASE_SERVICE_ROLE_KEY');
const PUSH_SECRET = env('PUSH_GOOGLE_SECRET');

const GOOGLE_CLIENT_ID = env('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET');
const GOOGLE_REFRESH_TOKEN = env('GOOGLE_REFRESH_TOKEN');

const SPREADSHEET_ID = env('LEADS_SPREADSHEET_ID');
const SHEET_TAB = env('LEADS_SHEET_TAB') || 'Sheet1';
const CARDS_FOLDER_ID = env('LEADS_CARDS_FOLDER_ID');
const VOICE_FOLDER_ID = env('LEADS_VOICE_FOLDER_ID');

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ---- Sheet schema (order == column order) ---------------------------------
const COLUMNS: [string, string][] = [
  ['Lead ID', 'lead_id'],
  ['Captured On', 'captured_date'],
  ['Captured Time', 'captured_time'],
  ['Salesperson', 'salesperson'],
  ['Person Name', 'person_name'],
  ['Job Title', 'job_title'],
  ['Company', 'company'],
  ['Mobiles', 'mobiles'],
  ['Emails', 'emails'],
  ['Websites', 'websites'],
  ['Address', 'address'],
  ['Interest Level', 'interest'],
  ['Categories', 'categories'],
  ['Asked About', 'asked_about'],
  ['Follow-up Action', 'follow_up'],
  ['Quantity', 'quantity'],
  ['Team Size', 'team_size'],
  ['Notes', 'notes'],
  ['Voice Summary', 'voice_summary'],
  ['Voice Transcript', 'voice_transcript'],
  ['Follow-ups', 'follow_ups'],
  ['Visiting Card (front)', 'card_front'],
  ['Visiting Card (back)', 'card_back'],
  ['Voice Note(s)', 'voice_links'],
  ['Location', 'location'],
  ['Last Updated', 'last_updated'],
  // Appended (kept at the end so existing columns/rows never shift). The app
  // captures N people; the sheet surfaces a 2nd named contact + 3 phone columns,
  // while Mobiles/Emails above stay the lossless catch-all for everyone.
  ['Person 2 Name', 'person2_name'],
  ['Person 2 Job Title', 'person2_title'],
  ['Phone 1', 'phone1'],
  ['Phone 2', 'phone2'],
  ['Phone 3', 'phone3'],
  // Source (e.g. exhibition name) — appended at the end so existing columns/rows
  // never shift. resolved from the org-wide 'source' master via sourceId.
  ['Source', 'source'],
];
const HEADERS = COLUMNS.map(([h]) => h);

// ---- Google auth (refresh-token grant, cached per invocation) -------------
let cachedToken: string | null = null;
async function googleToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`google token: ${res.status} ${JSON.stringify(j)}`);
  cachedToken = j.access_token as string;
  return cachedToken;
}

// ---- Sheets REST ----------------------------------------------------------
const SHEETS = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;
async function gfetch(url: string, init: RequestInit = {}): Promise<any> {
  const token = await googleToken();
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`google ${res.status}: ${text.slice(0, 300)}`);
  return body;
}

async function readColumnA(): Promise<string[]> {
  const r = await gfetch(`${SHEETS}/values/${encodeURIComponent(`${SHEET_TAB}!A:A`)}`);
  return (r.values ?? []).map((row: string[]) => (row[0] ?? '').trim());
}

async function ensureHeader(): Promise<void> {
  // Read the actual header row (row 1) so we can detect a widened schema, not just
  // presence — when new columns are appended, rewrite the header to label them.
  const r = await gfetch(`${SHEETS}/values/${encodeURIComponent(`${SHEET_TAB}!1:1`)}`);
  const row1: string[] = (r.values?.[0] ?? []).map((v: string) => (v ?? '').trim());
  if (row1[0] === 'Lead ID' && row1.length >= HEADERS.length) return; // present and wide enough
  await gfetch(`${SHEETS}/values/${encodeURIComponent(`${SHEET_TAB}!A1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [HEADERS] }),
  });
}

async function updateRow(rownum: number, values: string[]): Promise<void> {
  await gfetch(
    `${SHEETS}/values/${encodeURIComponent(`${SHEET_TAB}!A${rownum}`)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [values] }) },
  );
}

async function appendRow(values: string[]): Promise<void> {
  await gfetch(
    `${SHEETS}/values/${encodeURIComponent(`${SHEET_TAB}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [values] }) },
  );
}

// Numeric gid of the tab (needed by batchUpdate deleteDimension, which can't use
// the tab name). Cached per invocation.
let cachedSheetId: number | null = null;
async function sheetIdForTab(): Promise<number> {
  if (cachedSheetId !== null) return cachedSheetId;
  const r = await gfetch(`${SHEETS}?fields=sheets(properties(sheetId,title))`);
  const sheet = (r.sheets ?? []).find((s: any) => s.properties?.title === SHEET_TAB);
  if (!sheet?.properties) throw new Error(`sheet tab not found: ${SHEET_TAB}`);
  cachedSheetId = sheet.properties.sheetId as number;
  return cachedSheetId;
}

/** Delete a 1-based sheet row entirely (rows below shift up). */
async function deleteSheetRow(rownum: number): Promise<void> {
  const sheetId = await sheetIdForTab();
  await gfetch(`${SHEETS}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rownum - 1, endIndex: rownum } } }],
    }),
  });
}

// ---- Drive REST (upload media in two steps: bytes, then name+move+link) ----
async function driveUpload(folderId: string, name: string, bytes: Uint8Array, contentType: string): Promise<{ id: string; link: string }> {
  const token = await googleToken();
  const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=media&supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: bytes,
  });
  const upj = await up.json();
  if (!up.ok || !upj.id) throw new Error(`drive upload: ${up.status} ${JSON.stringify(upj)}`);
  const patch = await gfetch(
    `https://www.googleapis.com/drive/v3/files/${upj.id}?addParents=${folderId}&removeParents=root&supportsAllDrives=true&fields=id,webViewLink`,
    { method: 'PATCH', body: JSON.stringify({ name }) },
  );
  return { id: patch.id, link: patch.webViewLink ?? '' };
}

// ---- helpers --------------------------------------------------------------
const IMG = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic']);
const AUD = new Set(['m4a', 'mp4', 'wav', 'aac', 'caf', 'mp3', 'ogg']);
const ext = (p: string) => p.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
const isAudio = (p: string) => AUD.has(ext(p));
function contentType(p: string): string {
  const e = ext(p);
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
    m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', caf: 'audio/x-caf', mp3: 'audio/mpeg', ogg: 'audio/ogg',
  };
  return map[e] ?? 'application/octet-stream';
}
const join = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join(', ') : v ? String(v).trim() : '');
const sanitize = (s: string) => (s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x');
// Timestamps are stored in UTC; the team is in IST (UTC+5:30, no DST). Shift the
// instant by +5:30 and read the UTC parts so the sheet shows IST wall-clock time.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function splitDt(iso: string): [string, string] {
  const t = Date.parse(iso);
  if (isNaN(t)) return [iso, ''];
  const d = new Date(t + IST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return [`${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`, `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`];
}
const fmtDt = (iso: string) => { const [d, t] = splitDt(iso); return t ? `${d} ${t}` : d; };

type MediaMap = Record<string, { id: string; link: string }>;

function collectMedia(payload: any): [string, string][] {
  const out: [string, string][] = [];
  const add = (val: unknown, kind: string) => {
    if (typeof val === 'string' && val.startsWith(`${BUCKET}/`)) out.push([val, kind]);
  };
  const card = payload.cardImages ?? {};
  add(card.front, 'card-front');
  add(card.back, 'card-back');
  add(payload.person?.photoUri, 'photo');
  add(payload.company?.logoUri, 'logo');
  (payload.reminderPhotos ?? []).forEach((p: unknown, i: number) => add(p, `photo-${i + 1}`));
  (payload.voiceNotes ?? []).forEach((v: any, i: number) => add(v?.uri, `voice-${i + 1}`));
  return out;
}

// De-duplicate a list of strings by a normalized key (last-10 digits for phones,
// lowercase for emails), preserving the first-seen original form.
function dedupeBy(arr: unknown[], key: (s: string) => string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    const s = String(v ?? '').trim();
    if (!s) continue;
    const k = key(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
const phoneKey = (s: string) => s.replace(/\D/g, '').slice(-10) || s;
const emailKey = (s: string) => s.toLowerCase();

function buildRow(lead: any, masters: Record<string, Record<string, string>>, prof: any, links: MediaMap): string[] {
  const p = lead.payload ?? {};
  const person = p.person ?? {};
  const extraPeople: any[] = Array.isArray(p.additionalPeople) ? p.additionalPeople : [];
  const company = p.company ?? {};
  const notes = p.notes ?? [];
  const vnotes = p.voiceNotes ?? [];
  const card = p.cardImages ?? {};
  const cap = p.capturedAt ?? {};
  const label = (t: string, id: unknown) => (id ? masters[t]?.[id as string] ?? '' : '');
  const labels = (t: string, ids: unknown) => (Array.isArray(ids) ? ids.map((i) => masters[t]?.[i as string]).filter(Boolean).join(', ') : '');
  const link = (u: unknown) => (typeof u === 'string' ? links[u]?.link ?? '' : '');
  const [cd, ct] = splitDt(p.capturedOn ?? lead.updated_at ?? '');

  // Aggregate phones/emails across EVERY person + the company (lossless catch-all),
  // and expose the 2nd contact + first three phones in their own columns.
  const allMobiles = dedupeBy(
    [...(person.mobiles ?? []), ...extraPeople.flatMap((x) => x?.mobiles ?? []), ...(company.mobiles ?? [])],
    phoneKey
  );
  const allEmails = dedupeBy(
    [...(person.emails ?? []), ...extraPeople.flatMap((x) => x?.emails ?? []), ...(company.emails ?? [])],
    emailKey
  );
  const p2 = extraPeople[0] ?? {};

  const ctx: Record<string, string> = {
    lead_id: lead.id,
    captured_date: cd,
    captured_time: ct,
    salesperson: prof?.name || prof?.email || lead.user_id,
    person_name: person.name ?? '',
    job_title: join(person.jobTitles),
    company: company.name ?? '',
    mobiles: allMobiles.join(', '),
    emails: allEmails.join(', '),
    person2_name: p2.name ?? '',
    person2_title: join(p2.jobTitles),
    phone1: allMobiles[0] ?? '',
    phone2: allMobiles[1] ?? '',
    phone3: allMobiles[2] ?? '',
    websites: join(company.websites),
    address: join(company.addresses),
    source: label('source', p.sourceId),
    interest: label('interestLevels', p.interestLevelId),
    categories: labels('categories', p.categoryIds),
    asked_about: labels('askedAbout', p.askedAboutIds),
    follow_up: label('followUpActions', p.followUpActionId),
    quantity: String(p.quantityNeeded ?? ''),
    team_size: String(p.teamSize ?? ''),
    notes: notes.map((n: any) => n?.text).filter(Boolean).join(' | '),
    voice_summary: vnotes.map((v: any) => v?.summary).filter(Boolean).join(' | '),
    voice_transcript: vnotes.map((v: any) => v?.transcript).filter(Boolean).join('\n\n'),
    follow_ups: vnotes.flatMap((v: any) => v?.followUps ?? []).join('; '),
    card_front: link(card.front),
    card_back: link(card.back),
    voice_links: vnotes.map((v: any) => link(v?.uri)).filter(Boolean).join(', '),
    location: typeof cap?.address === 'string' ? cap.address : '',
    last_updated: fmtDt(lead.updated_at ?? ''),
  };
  return COLUMNS.map(([, k]) => ctx[k] ?? '');
}

function mediaName(row: { company: string; person: string; date: string }, kind: string, path: string): string {
  return `${row.date.replace(/-/g, '') || 'nodate'}_${sanitize(row.company || 'NoCompany')}_${sanitize(row.person || 'NoName')}_${kind}_${lead6(path)}.${ext(path)}`;
}
const lead6 = (storagePath: string) => storagePath.split('/')[2]?.split('-').pop()?.slice(0, 6) ?? 'xxxxxx';

// ---- master/profile caches ------------------------------------------------
// Masters are now admin-managed org-wide in `app_lead_masters_global` (id='global'),
// not the retired per-user `app_lead_masters` — read the global row so the sheet's
// Interest/Categories/Asked-About/Follow-up labels populate. Cached once per run.
const mastersCache = new Map<string, Record<string, Record<string, string>>>();
async function mastersFor(_uid: string) {
  const KEY = 'global';
  if (mastersCache.has(KEY)) return mastersCache.get(KEY)!;
  const { data } = await supa.from('app_lead_masters_global').select('masters').eq('id', 'global').maybeSingle();
  const maps: Record<string, Record<string, string>> = {};
  for (const [type, items] of Object.entries((data?.masters as any) ?? {})) {
    if (Array.isArray(items)) maps[type] = Object.fromEntries(items.filter((i: any) => i?.id).map((i: any) => [i.id, i.label ?? '']));
  }
  mastersCache.set(KEY, maps);
  return maps;
}
const profileCache = new Map<string, any>();
async function profileFor(uid: string) {
  if (profileCache.has(uid)) return profileCache.get(uid);
  const { data } = await supa.from('profiles').select('name,email').eq('id', uid).maybeSingle();
  profileCache.set(uid, data);
  return data;
}

// ---- process one lead -----------------------------------------------------
async function pushLead(id: string): Promise<string> {
  const { data: lead, error } = await supa.from('app_leads').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!lead) return `skip ${id} (not found)`;

  // Deleted lead → mirror the delete into the sheet: find its row by Lead ID and
  // remove it, so the sheet matches the app (the row is a soft-delete tombstone in
  // app_leads; we don't touch that). Stamp google_synced_at so it isn't reprocessed.
  if (lead.deleted) {
    const colA = await readColumnA();
    const idx = colA.findIndex((v, i) => i > 0 && v === lead.id);
    if (idx >= 0) await deleteSheetRow(idx + 1);
    await supa.from('app_leads').update({ google_synced_at: new Date().toISOString() }).eq('id', lead.id);
    return idx >= 0 ? `removed-row ${lead.id}` : `skip ${id} (deleted, not in sheet)`;
  }

  const payload = lead.payload ?? {};

  // Don't mirror a not-yet-read scan (the empty skeleton row saved before AI runs):
  // wait until the card is read (pendingExtract cleared). This removes the blank row
  // that otherwise races the later enriched push and produces a duplicate. Manual
  // entries have no pendingExtract, so they push normally.
  if (payload.pendingExtract === true) return `skip ${id} (pending extract)`;

  const google_media: MediaMap = { ...((lead.google_media as MediaMap) ?? {}) };

  const masters = await mastersFor(lead.user_id);
  const prof = await profileFor(lead.user_id);
  const nameCtx = {
    company: payload.company?.name ?? '',
    person: payload.person?.name ?? '',
    date: splitDt(payload.capturedOn ?? lead.updated_at ?? '')[0],
  };

  // 1) upload any not-yet-mirrored media
  for (const [path, kind] of collectMedia(payload)) {
    if (google_media[path]?.link) continue;
    const objectPath = path.slice(BUCKET.length + 1); // strip "lead-media/"
    const { data: blob, error: dlErr } = await supa.storage.from(BUCKET).download(objectPath);
    if (dlErr || !blob) { console.error(`media download failed ${path}: ${dlErr?.message}`); continue; }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const folder = isAudio(path) ? VOICE_FOLDER_ID : CARDS_FOLDER_ID;
    const info = await driveUpload(folder, mediaName(nameCtx, kind, path), bytes, contentType(path));
    google_media[path] = info;
  }

  // 2) upsert the sheet row by Lead ID — collapsing any duplicates first
  await ensureHeader();
  const values = buildRow(lead, masters, prof, google_media);
  const colA = await readColumnA();
  // Every row that already carries this Lead ID (skip the header at index 0). If an
  // earlier append race left more than one, delete the extras (bottom-up so indices
  // stay valid) and keep the first — converging to a single row per lead.
  const rowsFor = colA.map((v, i) => ({ v, i })).filter((x) => x.i > 0 && x.v === lead.id).map((x) => x.i);
  for (const rowIdx of rowsFor.slice(1).sort((a, b) => b - a)) await deleteSheetRow(rowIdx + 1);
  const keep = rowsFor[0] ?? -1;
  if (keep >= 0) await updateRow(keep + 1, values); // colA is 0-based; sheet row = idx+1
  else await appendRow(values);

  // 3) stamp so the row isn't reprocessed (media map persisted too)
  await supa.from('app_leads').update({ google_synced_at: new Date().toISOString(), google_media }).eq('id', lead.id);
  const collapsed = rowsFor.length > 1 ? ` (collapsed ${rowsFor.length - 1} dup)` : '';
  return `${keep >= 0 ? 'updated' : 'appended'} ${lead.id}${collapsed}`;
}

async function pendingIds(): Promise<string[]> {
  const { data } = await supa.from('app_leads').select('id,updated_at,google_synced_at').eq('deleted', false);
  return (data ?? [])
    .filter((r: any) => !r.google_synced_at || new Date(r.google_synced_at) < new Date(r.updated_at))
    .map((r: any) => r.id);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  // Shared-secret auth (the DB trigger sends x-push-secret).
  if (!PUSH_SECRET || req.headers.get('x-push-secret') !== PUSH_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: any = {};
  try { payload = await req.json(); } catch { /* empty body = sweep */ }

  let ids: string[] = [];
  if (payload?.record?.id) ids = [payload.record.id]; // Supabase DB-webhook shape
  else if (payload?.id) ids = [payload.id];
  else if (Array.isArray(payload?.ids)) ids = payload.ids;
  else ids = await pendingIds(); // {} → backfill all pending

  const results: string[] = [];
  for (const id of ids) {
    try { results.push(await pushLead(id)); }
    catch (e) { results.push(`error ${id}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return json({ count: results.length, results });
});
