// A6.4 / C6.5 — product and menu media.
//
// There is NO object-storage binding in this Worker (no R2 bucket in
// wrangler.toml), so this build does not accept file uploads: a merchant
// supplies a URL that already lives on a CDN or their site, and we validate it.
// Building a storage service was out of scope for these rows; when one is added
// the only change here is where the URL comes from.
//
// Validation is a security boundary, not a formality: these strings end up in
// `<img src>` and `<video src>`, so anything that is not an absolute https URL
// is rejected outright — `javascript:`, `data:` and protocol-relative URLs
// included.

export const MAX_MEDIA_URL_LENGTH = 2048;

/** Sunday's stated video constraint: MP4, portrait 9:16, 10 seconds maximum. */
export const VIDEO_GUIDANCE =
  "MP4, portrait (9:16), 10 seconds maximum. Plays muted, without autoplaying sound, and always has controls.";

export type MediaKind = "image" | "video";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"];
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];

/**
 * Returns the normalized URL, or null when the value is absent. Throws nothing:
 * callers distinguish "not supplied" (null) from "supplied and invalid" by
 * checking `isBlank` first.
 */
export function safeMediaUrl(value: unknown, kind: MediaKind): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > MAX_MEDIA_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname || url.hostname === "localhost") return null;
  const path = url.pathname.toLowerCase();
  const extensions = kind === "image" ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS;
  // A query-string-driven image CDN has no extension; allow it, but keep the
  // obviously-wrong case (a .mp4 in an image slot) out.
  const otherExtensions = kind === "image" ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS;
  if (otherExtensions.some((ext) => path.endsWith(ext))) return null;
  if (kind === "video" && !extensions.some((ext) => path.endsWith(ext))) return null;
  return url.toString();
}

export function isBlank(value: unknown): boolean {
  return String(value ?? "").trim().length === 0;
}

/**
 * Alt text is authorable, and we do not invent it. When a merchant leaves it
 * empty we fall back to the product name so a screen reader announces something
 * meaningful rather than the URL — but the merchant's words always win.
 */
export function mediaAltText(
  authored: string | null | undefined,
  fallbackName: string,
): string {
  const alt = String(authored ?? "").trim();
  return alt || fallbackName;
}
