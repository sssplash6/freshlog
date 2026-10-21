import { BUG_SHOT_MAX_BYTES, BUG_SHOT_MAX_EDGE } from "@/lib/bugs";

/**
 * Scale a screenshot down and re-encode it as WebP in the browser, as avatars
 * are, so a retina capture becomes a few hundred KB before it touches the
 * network — under the 1MB server-action body limit — and no native image
 * dependency is needed on the server. Each failed attempt shrinks it further.
 *
 * Shared by the upload form and the on-screen report, which hands it a canvas
 * with the marks already burned in. The server re-checks size and format; this
 * is a convenience, not a guarantee. Browser only.
 */
export async function shrinkToBlob(source: ImageBitmap | HTMLCanvasElement): Promise<Blob> {
  let scale = Math.min(1, BUG_SHOT_MAX_EDGE / Math.max(source.width, source.height));
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't process images.");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.8));
    const blob = (await encode("image/webp")) ?? (await encode("image/jpeg"));
    if (blob && blob.size <= BUG_SHOT_MAX_BYTES) return blob;
    scale *= 0.7;
  }
  throw new Error("That image is too large to attach.");
}

/** A picked file, upright, shrunk the same way. */
export async function toScreenshot(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return await shrinkToBlob(bitmap);
  } finally {
    bitmap.close();
  }
}
