// Generates the PWA install-listing screenshots (public/screenshots/*.png) from
// branded SVGs using sharp. Run inside the app container:
//   docker exec pesaswap-merchant-app sh -lc 'cd /app && node scripts/gen-screenshots.mjs'
// Replace with real captured screenshots when available.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/screenshots",
);

const BG = "#0f172a";
const EMERALD = "#10b981";

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mobileSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BG}"/>
      <stop offset="1" stop-color="#064e3b"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#g)"/>
  <text x="80" y="150" fill="#e2e8f0" font-family="Inter, sans-serif" font-size="46" font-weight="700">PesaSwap</text>
  <circle cx="1000" cy="135" r="14" fill="${EMERALD}"/>
  <text x="80" y="440" fill="#ffffff" font-family="Inter, sans-serif" font-size="92" font-weight="800">Tap. Pay.</text>
  <text x="80" y="560" fill="#ffffff" font-family="Inter, sans-serif" font-size="92" font-weight="800">Done.</text>
  <text x="80" y="660" fill="#94a3b8" font-family="Inter, sans-serif" font-size="40">M-Pesa checkout in seconds.</text>
  <rect x="80" y="760" width="920" height="620" rx="48" fill="#0b1220" stroke="#1e293b" stroke-width="2"/>
  <text x="140" y="880" fill="#64748b" font-family="Inter, sans-serif" font-size="34">Pay to</text>
  <text x="140" y="950" fill="#e2e8f0" font-family="Inter, sans-serif" font-size="52" font-weight="700">Naivas Supermarket</text>
  <text x="140" y="1120" fill="#94a3b8" font-family="Inter, sans-serif" font-size="38">Amount</text>
  <text x="140" y="1210" fill="${EMERALD}" font-family="Inter, sans-serif" font-size="96" font-weight="800">KES 2,450</text>
  <rect x="140" y="1270" width="800" height="72" rx="20" fill="${EMERALD}"/>
  <text x="540" y="1318" fill="#04170f" font-family="Inter, sans-serif" font-size="38" font-weight="700" text-anchor="middle">Pay now</text>
  <text x="80" y="1560" fill="#64748b" font-family="Inter, sans-serif" font-size="36">Payments · Invoices · Bookings · WhatsApp AI</text>
</svg>`;
}

function wideSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BG}"/>
      <stop offset="1" stop-color="#064e3b"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#g)"/>
  <text x="120" y="140" fill="#e2e8f0" font-family="Inter, sans-serif" font-size="42" font-weight="700">PesaSwap</text>
  <circle cx="430" cy="126" r="12" fill="${EMERALD}"/>
  <text x="120" y="430" fill="#ffffff" font-family="Inter, sans-serif" font-size="86" font-weight="800">Run your business</text>
  <text x="120" y="540" fill="#ffffff" font-family="Inter, sans-serif" font-size="86" font-weight="800">from one app.</text>
  <text x="120" y="640" fill="#94a3b8" font-family="Inter, sans-serif" font-size="40">Payments, invoicing, bookings and an AI assistant on WhatsApp &amp; Telegram.</text>
  ${[0, 1, 2, 3]
    .map(
      (i) =>
        `<rect x="${1060 + (i % 2) * 400}" y="${260 + Math.floor(i / 2) * 300}" width="360" height="260" rx="32" fill="#0b1220" stroke="#1e293b" stroke-width="2"/>`,
    )
    .join("")}
  <text x="1100" y="360" fill="${EMERALD}" font-family="Inter, sans-serif" font-size="34" font-weight="700">Today</text>
  <text x="1100" y="440" fill="#e2e8f0" font-family="Inter, sans-serif" font-size="56" font-weight="800">KES 84,200</text>
  <text x="1500" y="360" fill="#94a3b8" font-family="Inter, sans-serif" font-size="34">Invoices</text>
  <text x="1500" y="440" fill="#e2e8f0" font-family="Inter, sans-serif" font-size="56" font-weight="800">18 paid</text>
  <text x="1100" y="660" fill="#94a3b8" font-family="Inter, sans-serif" font-size="34">Bookings</text>
  <text x="1100" y="740" fill="#e2e8f0" font-family="Inter, sans-serif" font-size="56" font-weight="800">12 covers</text>
  <text x="1500" y="660" fill="#94a3b8" font-family="Inter, sans-serif" font-size="34">Chats</text>
  <text x="1500" y="740" fill="#e2e8f0" font-family="Inter, sans-serif" font-size="56" font-weight="800">6 open</text>
</svg>`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await sharp(Buffer.from(mobileSvg()))
    .png()
    .toFile(path.join(OUT, "mobile.png"));
  await sharp(Buffer.from(wideSvg())).png().toFile(path.join(OUT, "desktop.png"));
  // Touch esc() so linters keep the helper if screenshots later add dynamic text.
  void esc;
  console.log("Screenshots written to", OUT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
