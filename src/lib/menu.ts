import { getSql } from "@/lib/db";

type Sql = NonNullable<ReturnType<typeof getSql>>;

export type MenuItem = {
  name: string;
  category: string;
  price: number;
  currency: string;
  dietary: string[];
  available: boolean;
};

const CATEGORY_ORDER = [
  "Starters",
  "Mains",
  "Sides",
  "Drinks",
  "Cocktails",
  "Desserts",
];

export async function getMenu(sql: Sql, venue: string): Promise<MenuItem[]> {
  const rows = await sql`
    SELECT name, category, price, currency, dietary, available
    FROM menu_items WHERE venue_id = ${venue} AND available = true
    ORDER BY category, price`;
  return rows.map((r) => ({
    name: r.name,
    category: r.category,
    price: Number(r.price),
    currency: r.currency,
    dietary: r.dietary ?? [],
    available: r.available,
  }));
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
      lines.push(`• ${item.name} — ${item.currency} ${item.price.toLocaleString()}`);
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
    SELECT name, category, price, currency, dietary, available
    FROM menu_items
    WHERE venue_id = ${venue}
      AND EXISTS (SELECT 1 FROM unnest(${words}::text[]) w
                  WHERE lower(name) LIKE '%' || w || '%')
    ORDER BY available DESC, price
    LIMIT 1`;
  if (!row) return null;
  return {
    name: row.name,
    category: row.category,
    price: Number(row.price),
    currency: row.currency,
    dietary: row.dietary ?? [],
    available: row.available,
  };
}
