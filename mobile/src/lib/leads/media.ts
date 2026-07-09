/**
 * Media + device helpers used across the lead-capture flow: photo capture/pick
 * (expo-image-picker), geo-tagging (expo-location), and small formatters.
 * All wrapped so a denied permission degrades gracefully instead of throwing.
 */

import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Dimensions } from 'react-native';

import { resolveMediaUrl, withTimeout } from './sync';
import type { CapturedAt, Contact, ContactDraft } from './types';

// ---- Base64 from any media uri --------------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Pure-JS Uint8Array → base64 (Hermes has no reliable btoa). */
function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  let out = '';
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < len ? B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < len ? B64_ALPHABET[b2 & 63] : '=';
  }
  return out;
}

/**
 * Read ANY media uri to base64 — whether it's a LOCAL file (`file://` /
 * `content://` / the app documents dir) or a Supabase STORAGE PATH
 * (`lead-media/...`) that only exists remotely (the case on another device / user
 * / fresh install, where the lead was pulled from Supabase with no local copy).
 * Storage paths are signed + fetched; local files are read directly. Returns null
 * on any failure. This is what lets the deferred AI (card extraction + voice
 * transcription) run from a device that has no local copy of the media, instead
 * of failing forever and wedging the card on "Processing…".
 */
export async function bytesBase64FromUri(uri?: string | null): Promise<string | null> {
  if (!uri) return null;
  try {
    // Remote: a Supabase storage path (needs a signed url) or a plain http(s) url.
    if (uri.startsWith('lead-media/') || uri.startsWith('http')) {
      const url = await resolveMediaUrl(uri); // storage path → signed url; http passes through
      if (!url) return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      return bytesToBase64(new Uint8Array(await res.arrayBuffer()));
    }
    // Local file (file:// / content:// / app documents dir).
    return await new File(uri).base64();
  } catch {
    return null;
  }
}

/**
 * Card-alignment frame geometry, shared between the camera overlay (camera.tsx)
 * and the crop math below so they always agree. The frame is centred on screen,
 * `FRAME_WIDTH_RATIO` of the window width, at a credit-card-ish aspect ratio.
 */
export const FRAME_WIDTH_RATIO = 0.82;
export const FRAME_ASPECT = 1.6; // width / height

/** mm:ss from milliseconds. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Copy a freshly-captured file into the app's durable `leads/` documents dir and
 * return the new uri. Camera/recorder/picker files often land in the CACHE dir,
 * which the OS can purge — persisting them means media survives until it can be
 * uploaded (deferred/offline sync). Remote (http) or already-persisted uris pass
 * through unchanged. Best-effort: returns the original uri on any failure.
 */
export function persistMedia(uri: string, prefix = 'media'): string {
  try {
    if (!uri || uri.startsWith('http')) return uri;
    if (uri.includes('/leads/')) return uri;
    const dir = new Directory(Paths.document, 'leads');
    try {
      if (!dir.exists) dir.create({ intermediates: true });
    } catch {
      /* already exists */
    }
    const ext = (uri.split('/').pop()?.split('?')[0]?.split('.').pop() || 'dat').toLowerCase();
    const dest = new File(dir, `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
    new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

/**
 * Crop a full-frame camera capture down to just the on-screen alignment frame.
 *
 * `CameraView` fills the screen with **cover** scaling, so the visible preview is
 * a centre-crop of the still. We invert that mapping: scale the still to cover
 * the window, find how much overflows each edge, then map the centred frame
 * rectangle back into the still's pixel space and crop there.
 *
 * Best-effort: on any failure (bad dimensions, EXIF-rotated still, native error)
 * it falls back to the full image so a capture is never lost. Returns a persisted
 * uri + base64 (base64 feeds the background card extraction).
 */
export async function cropToFrame(pic: { uri: string; width?: number; height?: number; base64?: string | null }): Promise<{ uri: string; base64: string | null }> {
  try {
    const pw = pic.width ?? 0;
    const ph = pic.height ?? 0;
    if (!pw || !ph) throw new Error('missing dimensions');

    const win = Dimensions.get('window');
    const ws = win.width;
    const hs = win.height;

    // Screen-space frame rect (must match camera.tsx overlay).
    const frameW = FRAME_WIDTH_RATIO * ws;
    const frameH = frameW / FRAME_ASPECT;
    const frameLeft = (ws - frameW) / 2;
    const frameTop = (hs - frameH) / 2;

    // Cover-fit the still to the window, measure the overflow cropped off-screen.
    const scale = Math.max(ws / pw, hs / ph);
    const offsetX = (pw * scale - ws) / 2;
    const offsetY = (ph * scale - hs) / 2;

    // Map the frame's screen corners back into still pixels.
    let originX = (frameLeft + offsetX) / scale;
    let originY = (frameTop + offsetY) / scale;
    let cropW = frameW / scale;
    let cropH = frameH / scale;

    // Clamp inside the still.
    originX = Math.max(0, Math.min(originX, pw - 1));
    originY = Math.max(0, Math.min(originY, ph - 1));
    cropW = Math.max(1, Math.min(cropW, pw - originX));
    cropH = Math.max(1, Math.min(cropH, ph - originY));

    const out = await manipulateAsync(
      pic.uri,
      [{ crop: { originX, originY, width: cropW, height: cropH } }],
      { compress: 0.6, base64: true, format: SaveFormat.JPEG }
    );
    return { uri: persistMedia(out.uri, 'card'), base64: out.base64 ?? null };
  } catch {
    return { uri: persistMedia(pic.uri, 'card'), base64: pic.base64 ?? null };
  }
}

/** Take a photo with the camera. Returns the local uri or null if cancelled/denied. */
export async function capturePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
  if (res.canceled || !res.assets?.length) return null;
  return persistMedia(res.assets[0].uri, 'photo');
}

/** Pick a photo from the library. Returns the local uri or null. */
export async function pickPhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: false });
  if (res.canceled || !res.assets?.length) return null;
  return persistMedia(res.assets[0].uri, 'photo');
}

/** Pick a card image from the library WITH base64 (for server-side extraction). */
export async function pickImageData(): Promise<{ uri: string; base64: string | null } | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.5, allowsEditing: false, base64: true });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  return { uri: persistMedia(a.uri, 'card'), base64: a.base64 ?? null };
}

// ---- Location ---------------------------------------------------------------
//
// Saving a lead must NEVER wait on the GPS. `getCurrentPositionAsync` forces a
// fresh satellite fix, and offline — no cell/wifi trilateration, no A-GPS
// ephemeris — that cold fix takes 30-120s. So: keep the last fix in memory for
// TTL, warm it in the background while the camera/review screen is open, and let
// `save()` read it synchronously via peekLocation(). Leads captured at one
// exhibition are metres apart, so reusing a few-minute-old fix is accurate enough.

const LOCATION_TTL_MS = 10 * 60 * 1000;

let lastFix: { value: CapturedAt; at: number } | null = null;
let warming: Promise<CapturedAt | null> | null = null;

/** A bare "lat, lng" address — what we store when the geocoder was unreachable. */
const COORD_ADDRESS = /^-?\d+\.\d+, *-?\d+\.\d+$/;
export const isCoordAddress = (address?: string | null): boolean => !!address && COORD_ADDRESS.test(address);

const coordAddress = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

async function isOnline(): Promise<boolean> {
  try {
    const net = await NetInfo.fetch();
    return net.isConnected !== false && net.isInternetReachable !== false;
  } catch {
    return false;
  }
}

/** Coords → human address. Needs the network; returns null when it can't resolve. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!places.length) return null;
    const p = places[0];
    const address = [p.name, p.street, p.city, p.region, p.postalCode, p.country].filter(Boolean).join(', ');
    return address || null;
  } catch {
    return null;
  }
}

/** The cached fix, if it is still fresh. Synchronous — safe to call from a tap handler. */
export function peekLocation(): CapturedAt | null {
  if (!lastFix) return null;
  return Date.now() - lastFix.at < LOCATION_TTL_MS ? lastFix.value : null;
}

/**
 * Acquire a location, bounded. Prefers the OS's last-known fix (instant); only
 * then waits — briefly — on a real fix. Reverse-geocoding is skipped when
 * offline, leaving a coord-string address that a later sync backfills.
 * Never throws, never hangs.
 */
export async function captureLocationFast(): Promise<CapturedAt | null> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;

    let coords = (await Location.getLastKnownPositionAsync())?.coords ?? null;
    if (!coords) {
      const pos = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        5000,
        'gps fix'
      ).catch(() => null);
      coords = pos?.coords ?? null;
    }
    if (!coords) return null;

    const { latitude, longitude } = coords;
    let address = coordAddress(latitude, longitude);
    if (await isOnline()) address = (await reverseGeocode(latitude, longitude)) ?? address;

    const value: CapturedAt = { lat: latitude, lng: longitude, address };
    lastFix = { value, at: Date.now() };
    return value;
  } catch {
    return null;
  }
}

/** A fix, coalescing concurrent callers onto one acquisition. */
function acquireLocation(): Promise<CapturedAt | null> {
  const fresh = peekLocation();
  if (fresh) return Promise.resolve(fresh);
  if (!warming) {
    warming = captureLocationFast().finally(() => {
      warming = null;
    });
  }
  return warming;
}

/**
 * Fire-and-forget: get a fix warm so the next `peekLocation()` hits. Call it when
 * a capture screen mounts — by the time the user taps Save it has usually landed.
 */
export function warmLocation(): void {
  void acquireLocation();
}

/**
 * Cold-start fallback: the lead was saved with no fix at all (nothing was warm
 * yet). Acquire one in the background and patch the saved contact. Re-reads the
 * contact when the fix lands, so a concurrent sync enrichment isn't clobbered.
 */
export function backfillLocation(
  id: string,
  getContact: (id: string) => Contact | undefined,
  updateContact: (id: string, draft: ContactDraft) => void
): void {
  acquireLocation()
    .then((loc) => {
      if (!loc) return;
      const current = getContact(id);
      if (current && !current.capturedAt) updateContact(id, { ...current, capturedAt: loc });
    })
    .catch(() => {});
}

/** @deprecated Blocks the caller. Prefer peekLocation() + warmLocation(). */
export const captureLocation = captureLocationFast;
