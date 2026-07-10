import { getSql } from "@/lib/db";

// A per-merchant PWA manifest so a venue's installed app carries ITS name, colour
// and logo — not the generic PesaSwap shell. Public + cache-friendly. Branding is
// resolved from ?venue=<id> (a merchant) or ?org=<slug> (a reseller co-brand);
// with neither (or no match) it returns the default PesaSwap manifest, identical
// to the static /manifest.webmanifest so nothing regresses.
const DEFAULT_NAME = "PesaSwap Merchant";
const DEFAULT_SHORT = "PesaSwap";
const DEFAULT_COLOR = "#0f172a";

const BASE_ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  {
    src: "/icons/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

function isValidHex(color: unknown): color is string {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color);
}

// A brand logo is only usable as an install icon when it's a PNG/WebP (data: or
// https). SVG/other data URLs are skipped so install never breaks — the base PNG
// icons always remain.
function logoIcon(logo: unknown): Record<string, unknown> | null {
  if (typeof logo !== "string" || !logo) return null;
  const isPngLike =
    /^data:image\/(png|webp);/i.test(logo) ||
    /^https:\/\/.+\.(png|webp)(\?.*)?$/i.test(logo);
  if (!isPngLike) return null;
  return { src: logo, sizes: "any", type: "image/png", purpose: "any" };
}

function buildManifest(brand: {
  name?: string | null;
  color?: string | null;
  logo?: string | null;
}): Record<string, unknown> {
  const name = brand.name?.trim() || DEFAULT_NAME;
  const short = (brand.name?.trim() || DEFAULT_SHORT).slice(0, 12);
  const color = isValidHex(brand.color) ? brand.color : DEFAULT_COLOR;
  const brandIcon = logoIcon(brand.logo);
  return {
    name,
    short_name: short,
    description: `${name} — order, book and pay by M-Pesa, card or split bill.`,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: color,
    theme_color: color,
    categories: ["business", "finance", "food"],
    icons: brandIcon ? [brandIcon, ...BASE_ICONS] : BASE_ICONS,
  };
}

function manifestResponse(manifest: Record<string, unknown>): Response {
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

export async function handleManifestRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/manifest") return null;
  if (request.method !== "GET") return null;

  const venue = url.searchParams.get("venue");
  const org = url.searchParams.get("org");
  const sql = getSql(env);
  if (!sql || (!venue && !org)) {
    return manifestResponse(buildManifest({}));
  }

  try {
    if (venue) {
      const [row] = await sql`
        SELECT vb.business_name, vb.logo_url, vb.primary_color, v.name AS venue_name,
               o.name AS org_name, o.branding AS org_branding
        FROM venues v
        LEFT JOIN venue_branding vb ON vb.venue_id = v.id
        LEFT JOIN organizations o ON o.id = v.org_id
        WHERE v.id = ${venue} LIMIT 1`;
      if (row) {
        const orgBrand = (row.org_branding ?? {}) as Record<string, unknown>;
        return manifestResponse(
          buildManifest({
            name: (row.business_name as string) || (row.venue_name as string) || null,
            color:
              (row.primary_color as string) ||
              (orgBrand.primaryColor as string) ||
              null,
            logo:
              (row.logo_url as string) || (orgBrand.logoUrl as string) || null,
          }),
        );
      }
    } else if (org) {
      const [row] = await sql`
        SELECT name, branding FROM organizations WHERE slug = ${org} LIMIT 1`;
      if (row) {
        const b = (row.branding ?? {}) as Record<string, unknown>;
        return manifestResponse(
          buildManifest({
            name: (row.name as string) || null,
            color: (b.primaryColor as string) || null,
            logo: (b.logoUrl as string) || null,
          }),
        );
      }
    }
  } catch {
    /* fall through to the default manifest — never fail an install */
  }
  return manifestResponse(buildManifest({}));
}
