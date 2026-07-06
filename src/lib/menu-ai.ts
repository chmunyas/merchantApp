// AI selling layer for the menu: deterministic upsell recommendations (work
// without any AI provider) + an AI menu-translation prompt builder. Pure so the
// recommendation logic is unit-testable.

export type MenuItemLite = {
  id?: string;
  name: string;
  category: string;
  price: number;
  available?: boolean;
  description?: string | null;
};

export type CartLine = { id?: string; name?: string; category?: string };

const key = (v: string | undefined) => (v ?? "").trim().toLowerCase();

// Suggest complementary items the guest hasn't added yet — a drink to go with
// food, then a dessert, then a side, then popular low-cost add-ons. This is the
// "a Coke with that burger?" upsell, done deterministically (an AI layer can
// re-rank the output later).
export function recommendUpsells(
  menu: MenuItemLite[],
  cart: CartLine[],
  max = 3,
): { item: MenuItemLite; reason: string }[] {
  const available = menu.filter((m) => m.available !== false);
  const inCart = new Set(
    cart.flatMap((c) => [key(c.id), key(c.name)]).filter(Boolean),
  );
  const cartCats = new Set(cart.map((c) => key(c.category)));
  const has = (cat: string) => cartCats.has(cat.toLowerCase());
  const notInCart = (m: MenuItemLite) =>
    !inCart.has(key(m.id)) && !inCart.has(key(m.name));
  const cheapestIn = (cats: string[]) =>
    available
      .filter((m) => cats.includes(m.category) && notInCart(m))
      .sort((a, b) => a.price - b.price)[0];

  const recs: { item: MenuItemLite; reason: string }[] = [];
  const pushed = new Set<string>();
  const add = (item: MenuItemLite | undefined, reason: string) => {
    const id = key(item?.id) || key(item?.name);
    if (item && id && !pushed.has(id) && recs.length < max) {
      recs.push({ item, reason });
      pushed.add(id);
    }
  };

  const hasFood = has("Mains") || has("Sides");
  if (hasFood && !has("Drinks") && !has("Cocktails")) {
    add(cheapestIn(["Drinks", "Cocktails"]), "Pair it with a drink");
  }
  if (!has("Desserts")) add(cheapestIn(["Desserts"]), "Save room for dessert");
  if (has("Mains") && !has("Sides")) add(cheapestIn(["Sides"]), "Add a side");

  for (const m of available.filter(notInCart).sort((a, b) => a.price - b.price)) {
    if (recs.length >= max) break;
    add(m, "You might also like");
  }
  return recs.slice(0, max);
}

// Build the chat prompt to translate a menu into `lang`. The model must return a
// JSON array of {name, description} in the SAME order; parseTranslation validates.
export function buildTranslatePrompt(
  lang: string,
  items: { name: string; description?: string | null }[],
): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        "You are a menu translator. Translate each dish name and description into the target language. " +
        "Return ONLY a JSON array of objects {\"name\":string,\"description\":string} in the SAME order, no prose, no code fences.",
    },
    {
      role: "user",
      content: `Target language: ${lang}\nItems:\n${JSON.stringify(
        items.map((i) => ({ name: i.name, description: i.description ?? "" })),
      )}`,
    },
  ];
}

// Safely parse the model's translation output back into name/description pairs.
export function parseTranslation(
  raw: string | null,
  expected: number,
): { name: string; description: string }[] | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== expected) return null;
    return parsed.map((p) => ({
      name: String((p as { name?: unknown }).name ?? ""),
      description: String((p as { description?: unknown }).description ?? ""),
    }));
  } catch {
    return null;
  }
}
