/**
 * Shrink a camera photo before it is uploaded.
 *
 * WHY THIS EXISTS. Proof-of-delivery photos are taken on a phone, at a
 * customer's gate, on mobile data. A modern phone camera produces 3–8 MB per
 * shot; four pages of an LR is then 20–30 MB over a connection that is often
 * one bar. Downscaled to ~1600px the same page is 300–600 KB and still
 * comfortably legible — a signature and a rubber stamp survive the round trip,
 * which is the only thing the document has to prove.
 *
 * ⚠ IT NEVER THROWS, AND NEVER BLOCKS A SAVE. Canvas decoding is the flakiest
 *   surface in a mobile browser: memory pressure, an unsupported codec, a
 *   tainted canvas, a vendor quirk. Every failure path returns the ORIGINAL
 *   file. A slow upload is a bad afternoon; a delivery that cannot be confirmed
 *   because the compressor choked is a lorry nobody can account for.
 */

/** Anything that is not an image is returned untouched — see `compressImage`. */
const isImage = (file: File): boolean => file.type.startsWith("image/");

/**
 * Small enough that re-encoding would cost more than it saves. A scan or a
 * screenshot is routinely already under this and does not want a second lossy
 * pass through JPEG.
 */
const SKIP_BELOW_BYTES = 400 * 1024;

/** `photo.heic` → `photo.jpg`; `IMG_0042` → `IMG_0042.jpg`. */
const asJpegName = (name: string): string =>
  /\.[a-z0-9]+$/i.test(name) ? name.replace(/\.[a-z0-9]+$/i, ".jpg") : `${name}.jpg`;

/**
 * Decode to a bitmap, honouring EXIF orientation and downscaling during decode
 * where the browser supports it.
 *
 * ⚠ `imageOrientation: "from-image"` IS LOAD-BEARING. Phones record portrait
 *   shots as a landscape buffer plus an EXIF rotation flag. Drawing the raw
 *   buffer to a canvas silently discards that flag, and every portrait photo of
 *   an LR arrives on its side — which is exactly the sort of thing that looks
 *   like it works right up until it reaches the person who has to read it.
 *
 * ⚠ `resizeWidth`/`resizeHeight` ask the DECODER to scale, so a 12 MP image is
 *   never fully materialised. On a low-end Android that is the difference
 *   between a resize and a tab crash.
 */
async function decode(file: File, maxEdge: number): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // ⚠ THE PROBE ASKS FOR from-image TOO. Reading the dimensions off a
      //   default-orientation bitmap and only requesting the flag on the resize
      //   pass leaves every already-small portrait photo lying on its side —
      //   the exact bug this option exists to prevent, hidden behind a size
      //   threshold so it only shows up on some phones.
      const probe = await createImageBitmap(file, { imageOrientation: "from-image" });
      const { width, height } = probe;
      // Small enough to scale on the canvas; the bitmap is already upright.
      if (Math.max(width, height) <= maxEdge) return probe;

      // Too big to hold at full size on a cheap phone — ask the decoder to do
      // the scaling instead, and drop the probe before allocating the second.
      probe.close();
      const portrait = height > width;
      return await createImageBitmap(file, {
        imageOrientation: "from-image",
        ...(portrait ? { resizeHeight: maxEdge } : { resizeWidth: maxEdge }),
        resizeQuality: "high",
      });
    } catch {
      /* Fall through to the <img> path — older Safari rejects the options bag. */
    }
  }

  // Fallback. Browsers that land here apply EXIF orientation themselves when
  // rendering an <img>, so the result is upright for the same reason.
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Downscale an image file to at most `maxEdge` on its longest side and
 * re-encode it as JPEG.
 *
 * Non-images (a scanned PDF of the LR is a perfectly ordinary attachment) pass
 * straight through, as does anything already small enough to leave alone.
 */
export async function compressImage(
  file: File,
  maxEdge = 1600,
  quality = 0.85,
): Promise<File> {
  if (!isImage(file)) return file;

  try {
    const source = await decode(file, maxEdge);
    // ImageBitmap exposes its true pixel size; a detached HTMLImageElement
    // reports naturalWidth through `width`, so both agree here.
    const width = source.width;
    const height = source.height;
    if (!width || !height) return file;

    // `decode` has usually resized already; this covers the fallback path and
    // clamps anything the decoder declined to scale.
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    // Already small AND already small on disk: re-encoding is pure loss.
    if (scale === 1 && file.size <= SKIP_BELOW_BYTES) return file;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(source, 0, 0, w, h);
    if ("close" in source) source.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    // A null blob, or one that came out BIGGER than the original (which happens
    // with an already-optimised source), means the compressor had nothing to
    // contribute. Keep what the camera gave us.
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], asJpegName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
