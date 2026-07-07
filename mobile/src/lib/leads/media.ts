/**
 * Media + device helpers used across the lead-capture flow: photo capture/pick
 * (expo-image-picker), geo-tagging (expo-location), and small formatters.
 * All wrapped so a denied permission degrades gracefully instead of throwing.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Dimensions } from 'react-native';

import type { CapturedAt } from './types';

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

/** Best-effort current location → reverse-geocoded address. Never throws. */
export async function captureLocation(): Promise<CapturedAt | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { latitude, longitude } = pos.coords;
    let address = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    try {
      const places = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (places.length) {
        const p = places[0];
        address = [p.name, p.street, p.city, p.region, p.postalCode, p.country]
          .filter(Boolean)
          .join(', ');
      }
    } catch {
      /* keep coord string */
    }
    return { lat: latitude, lng: longitude, address };
  } catch {
    return null;
  }
}
