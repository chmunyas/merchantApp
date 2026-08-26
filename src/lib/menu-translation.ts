// A6.2 / C6.13 — AI menu translation, cached.
//
// Sunday configures additional languages in Settings and translates them
// "automatically using AI". Two consequences are load-bearing here:
//   * A guest must NEVER trigger a model call per page view, so every read goes
//     through a cache keyed by (venue, language, entity) and pinned to a hash of
//     the source text. Editing a dish invalidates only that dish.
//   * Translation is a nicety, not a dependency. If the provider is missing,
//     slow, or returns something unparseable, the guest sees the ORIGINAL text.
//     There is no code path here that can produce an empty or partial menu.
//
// Pure — the SQL read/write lives in the route, the decisions live here.

export type Translatable = {
  id: string;
  name: string;
  description?: string | null;
};

export type CachedTranslation = {
  entityId: string;
  sourceHash: string;
  name: string | null;
  description: string | null;
};

export type TranslationPlan<T extends Translatable> = {
  /** Entries whose cached translation is present and still matches the source. */
  fresh: Map<string, { name: string; description: string | null }>;
  /** Entries that need a model call — missing from the cache, or stale. */
  stale: T[];
};

/**
 * Stable, cheap content hash (FNV-1a, 32-bit, hex). Not a security primitive —
 * it exists only to notice that a merchant edited a name or description, so it
 * does not need to resist an adversary.
 */
export function translationSourceHash(entry: Translatable): string {
  const source = `${entry.name}\u0000${entry.description ?? ""}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** BCP-47-ish: `fr`, `sw`, `pt-BR`. Anything else is rejected, not guessed. */
export function normalizeLanguageTag(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const match = /^([A-Za-z]{2})(?:-([A-Za-z0-9]{2,8}))?$/.exec(raw);
  if (!match) return null;
  return match[2] ? `${match[1].toLowerCase()}-${match[2]}` : match[1].toLowerCase();
}

export function normalizeLanguageList(value: unknown, max = 8): string[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const tag = normalizeLanguageTag(entry);
    if (tag) seen.add(tag);
    if (seen.size >= max) break;
  }
  return Array.from(seen);
}

/** Split a menu into "already translated" and "needs the model". */
export function planTranslation<T extends Translatable>(
  entries: readonly T[],
  cached: readonly CachedTranslation[],
): TranslationPlan<T> {
  const byId = new Map(cached.map((row) => [row.entityId, row]));
  const fresh = new Map<string, { name: string; description: string | null }>();
  const stale: T[] = [];
  for (const entry of entries) {
    const row = byId.get(entry.id);
    if (row && row.sourceHash === translationSourceHash(entry) && row.name) {
      fresh.set(entry.id, { name: row.name, description: row.description });
      continue;
    }
    stale.push(entry);
  }
  return { fresh, stale };
}

/**
 * Overlay translations onto the menu. Any item without a usable translation
 * keeps its original name and description — this is the graceful-degradation
 * guarantee, and it is why the return type is never nullable.
 */
export function applyTranslations<T extends Translatable>(
  entries: readonly T[],
  translations: ReadonlyMap<string, { name: string; description: string | null }>,
): T[] {
  return entries.map((entry) => {
    const hit = translations.get(entry.id);
    if (!hit || !hit.name.trim()) return entry;
    return {
      ...entry,
      name: hit.name,
      description: hit.description?.trim() ? hit.description : entry.description ?? null,
    };
  });
}
