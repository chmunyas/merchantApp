import { getSql } from "@/lib/db";

type Sql = NonNullable<ReturnType<typeof getSql>>;

export type MenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  dietary: string[];
  available: boolean;
  revision: number;
  // C6.5 — guest-facing overrides. `name` above stays the operational name the
  // kitchen and the agent use; `displayName` is what the guest reads.
  displayName: string | null;
  description: string | null;
  allergens: string[];
  tags: string[];
  // A6.4 — media. Alt text and the video description are authored by the
  // merchant so allergen/dietary meaning is never carried by a picture alone.
  imageUrl: string | null;
  imageAlt: string | null;
  videoUrl: string | null;
  videoDescription: string | null;
};

function toMenuItem(r: Record<string, unknown>): MenuItem {
  return {
    id: String(r.id),
    name: String(r.name),
    category: String(r.category),
    price: Number(r.price),
    currency: String(r.currency),
    dietary: (r.dietary as string[]) ?? [],
    available: Boolean(r.available),
    revision: Number(r.revision),
    displayName: (r.display_name as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    allergens: (r.allergens as string[]) ?? [],
    tags: (r.tags as string[]) ?? [],
    imageUrl: (r.image_url as string | null) ?? null,
    imageAlt: (r.image_alt as string | null) ?? null,
    videoUrl: (r.video_url as string | null) ?? null,
    videoDescription: (r.video_description as string | null) ?? null,
  };
}

/** What the guest should read: the override if the merchant wrote one. */
export function guestName(item: Pick<MenuItem, "name" | "displayName">): string {
  return item.displayName?.trim() || item.name;
}

const CATEGORY_ORDER = [
  "Starters",
  "Mains",
  "Sides",
  "Drinks",
  "Cocktails",
  "Desserts",
];

export async function getMenu(
  sql: Sql,
  venue: string,
  includeUnavailable = false,
): Promise<MenuItem[]> {
  const rows = await sql`
    SELECT id, name, category, price, currency, dietary, available, revision,
           display_name, description, allergens, tags,
           image_url, image_alt, video_url, video_description
    FROM menu_items
    WHERE venue_id = ${venue}
      AND (${includeUnavailable} OR available = true)
    ORDER BY category, price`;
  return rows.map(toMenuItem);
}

// A compact, WhatsApp-friendly rendering of the menu grouped by category.
export function formatMenu(items: MenuItem[]): string {
  if (items.length === 0) return "Our menu isn't available right now.";
  const byCategory = new Map<string, MenuItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }
  const categories = Array.from(byCategory.keys()).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const lines = ["Here's our menu:"];
  for (const category of categories) {
    lines.push(`\n*${category}*`);
    for (const item of byCategory.get(category)!) {
      lines.push(
        `• ${guestName(item)} — ${item.currency} ${item.price.toLocaleString()}`,
      );
    }
  }
  lines.push("\nReply with an item to hear more, or 'book' to reserve a table.");
  return lines.join("\n");
}

// Find a specific item by (fuzzy) name for "how much is X" questions.
export async function findMenuItem(
  sql: Sql,
  venue: string,
  query: string,
): Promise<MenuItem | null> {
  const words = (query.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(
    (w) =>
      ![
        "how", "much", "the", "price", "cost", "does", "your", "what", "for",
        "have", "you", "got", "one", "and", "with", "can",
      ].includes(w),
  );
  if (words.length === 0) return null;
  const [row] = await sql`
    SELECT id, name, category, price, currency, dietary, available, revision,
           display_name, description, allergens, tags,
           image_url, image_alt, video_url, video_description
    FROM menu_items
    WHERE venue_id = ${venue}
      AND EXISTS (SELECT 1 FROM unnest(${words}::text[]) w
                  WHERE lower(name) LIKE '%' || w || '%'
                     OR lower(coalesce(display_name, '')) LIKE '%' || w || '%')
    ORDER BY available DESC, price
    LIMIT 1`;
  return row ? toMenuItem(row) : null;
}
