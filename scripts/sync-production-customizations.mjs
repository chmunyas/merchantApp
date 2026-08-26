import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "--check";

if (!new Set(["--check", "--write"]).has(mode)) {
  console.error(
    "Usage: node scripts/sync-production-customizations.mjs [--check|--write]",
  );
  process.exit(2);
}

const skillOwnership = {
  accessibility: [
    "WCAG 2.2 AA evidence for merchant, staff, guest, partner, and device-specific journeys, including semantics, keyboard use, focus, reflow, contrast, motion, status announcements, and screen-reader verification.",
    "Accessible denial, error, recovery, and confirmation behavior for every financial or destructive action changed in this domain.",
  ],
  accounting: [
    "Source-to-journal traceability, balanced double-entry posting, immutable entries, period locks, compensating corrections, financial statements, exports, and auditor evidence.",
    "Replay-safe posting for payments, refunds, invoices, settlements, fees, tips, inventory cost, and every new financial event.",
  ],
  "agentic-checkout": [
    "Versioned, scoped machine discovery and checkout contracts that bind price, venue, currency, order, caller, expiry, and idempotency on the server.",
    "Agent-safe confirmation, payment recovery, receipt, audit, rate-limit, sandbox, and human-escalation behavior without granting UI-equivalent ambient authority.",
  ],
  analytics: [
    "Traceable, tenant-scoped operational metrics with explicit definitions, timezone, currency, filters, freshness, drill-through, pagination, and export behavior.",
    "Reproducible cross-channel timelines and reports whose aggregates can be reconciled to source records and whose access matches the viewer's role.",
  ],
  "android-mpos": [
    "A versioned Android checkout SDK with coroutine APIs, unknown-safe results, cancellation, timeout and retry semantics, secure credential storage, telemetry hooks, contract tests, and a maintained sample application.",
    "The separate card-present mPOS boundary: approved PCI PTS hardware, EMV/contactless and acquirer certification, key handling, attestation, terminal lifecycle, reversal and recovery, receipt rules, compatibility evidence, and field support.",
  ],
  "auth-tenancy": [
    "Revocable organisation and venue membership, least-privilege RBAC and scopes, membership-version session invalidation, secure recovery, rate limits, device/session controls, and immutable identity events.",
    "Default-deny tenant isolation in every query, mutation, queue, webhook, export, support action, personal token, service principal, and agent tool path.",
  ],
  "auto-reorder": [
    "Explainable stockout prediction and supplier-grouped draft purchase orders based on server-authoritative stock, lead time, consumption, pack size, minimum order, and freshness.",
    "Manager approval, override reasons, duplicate prevention, audit history, degraded-data warnings, and a safe handoff from recommendation to procurement.",
  ],
  "bookings-enquiries": [
    "Server-authoritative availability, enquiries, reservations, covers, tables, deposits, confirmation, amendment, cancellation, no-show, assignment, and staff handoff.",
    "Concurrency, timezone and trading-day rules, accessible customer communication, payment linkage, consent, audit, and recovery from provider or notification failure.",
  ],
  "campaigns-automations": [
    "Consent-aware segmentation, preview, approval, scheduling, quiet hours, frequency limits, suppression, delivery status, retry, dead-letter recovery, pause, cancellation, and attribution.",
    "Channel-policy and role enforcement for every broadcast or sequence step, with test-send isolation and auditable actor, audience, content version, and outcome.",
  ],
  "crm-loyalty": [
    "Tenant-scoped contact identity, deduplication, consent and suppression, profile history, imports/exports, segmentation, and access appropriate to personal data sensitivity.",
    "Immutable loyalty earn, redeem, expire, reverse, and adjust events with server-derived balances, approval controls, receipt visibility, and reconciliation to originating commerce.",
  ],
  "customer-experience": [
    "The complete guest journey from discovery or QR scan through accurate browse, booking or order, split, tip, server-bound payment, status, receipt, loyalty, self-service, and human help.",
    "Accessible mobile-first success, denial, duplicate, timeout, offline/degraded, resume, cancellation, privacy, and recovery behavior without exposing internal operator controls.",
  ],
  "customer-portal": [
    "Verified, revocable customer access to the correct venue-scoped orders, invoices, receipts, profile, consent, loyalty balance, rewards, redemptions, and support path.",
    "Protection against token leakage, enumeration, replay, cross-customer access, duplicate redemption, stale balances, and unsafe account recovery.",
  ],
  "customer-value": [
    "Explainable and reproducible RFM, lifetime-value, churn-risk, cohort, and win-back outputs with defined inputs, windows, timezone, currency, freshness, and confidence.",
    "Consent-aware activation, role-appropriate detail, source-record drill-through, model/version traceability, and safeguards against treating predictions as facts.",
  ],
  "demand-forecasting": [
    "Reproducible forecasts and prep recommendations using server-authoritative demand, item mappings, trading calendar, timezone, horizon, version, freshness, confidence, and exception inputs.",
    "Manager review, override reasons, backtesting, degraded-data warnings, and a safe operational handoff without silently changing stock, labour, price, or orders.",
  ],
  inventory: [
    "Server-authoritative, multi-store items, SKU/barcode lookup, stock movements, counts, low-stock thresholds, cost access, suppliers, purchase orders, receiving, waste, transfer, and adjustments.",
    "Append-only movement history, concurrency and idempotency, negative-stock policy, approval and reason controls, valuation traceability, and reconciliation to sales and accounting.",
  ],
  invoicing: [
    "Server-numbered invoice draft, approval, issue, delivery, tax, due date, partial payment, reminder, recurrence, credit/reversal, write-off, status, pay-link, and export lifecycle.",
    "Minor-unit payment reconciliation and accrual-accounting traceability so invoice issue recognises receivable and payment settles it without duplicate revenue.",
  ],
  "knowledge-base": [
    "Tenant-scoped article authoring, review, publication, versioning, permissions, ingestion, deletion, provenance, embedding freshness, retrieval quality, and rollback.",
    "Grounded answers that expose uncertainty, respect channel and role policy, cite approved sources where appropriate, resist prompt injection, and hand off when evidence is insufficient.",
  ],
  manager: [
    "The complete manager journey for venue operations: staffing, shifts, menu or catalogue, inventory, bookings, orders, inbox, campaigns, bounded refunds/voids/discounts, tips, labour, close, and handover.",
    "Separation from owner authority: managers cannot grant manager/owner roles, alter settlement ownership, bypass approval limits, or gain cross-venue access without authoritative membership.",
  ],
  "menu-catalogue": [
    "Server-authoritative categories, items, variants or modifiers, prices, tax, dietary and allergen data, availability, schedules, images, channels, versions, and bulk operations.",
    "POS/dynamic-menu source precedence, conflict handling, publish and rollback, multi-device freshness, audit, and immediate propagation to customer and agent discovery surfaces.",
  ],
  "merchant-copilot": [
    "A role- and tenant-bound conversational operator whose reads, previews, mutations, approvals, idempotency, audit, and errors use the same domain services and policies as human workflows.",
    "Explicit confirmation for high-impact operations, prompt/tool abuse resistance, provenance and freshness for answers, safe recovery, human escalation, and evaluation evidence.",
  ],
  "merchant-owner": [
    "The complete owner lifecycle: organisation and venue setup, business and settlement configuration, vertical/tier choice, manager invitation and revocation, channels, brand, oversight, export, handover, and closure.",
    "Owner-only control over manager/owner authority and other material configuration, with maker-checker approval where required, immutable audit, support recovery, and multi-store visibility.",
  ],
  "omnichannel-agent": [
    "One tenant-scoped, consent-aware inbound/outbound pipeline across enabled channels with verified callbacks, identity continuity, delivery states, retry, dead-letter recovery, suppression, and human handoff.",
    "Policy-bounded AI answers and actions with source grounding, prompt/tool abuse controls, per-channel compliance, audit, observability, and no silent cross-channel or cross-tenant data disclosure.",
  ],
  "orders-kitchen": [
    "Server-authoritative table, counter, pickup and delivery orders plus kitchen tickets, with validated create, assign, hold, fire, accept, prepare, ready, serve, transfer, split, fulfil, cancel, void, and recovery transitions.",
    "Concurrent-device consistency, item and price snapshots, idempotency, permissions, payment and stock linkage, printer/display degradation, audit, and trading-day close behavior.",
  ],
  payments: [
    "Server-bound amount and payee authority, idempotent create/confirm/capture, provider-authenticated status, tips, split payments, pay links, refunds, disputes, reversals, receipts, and recoverable webhook/pull reconciliation.",
    "Minor-unit arithmetic, PCI scope control, no PAN or sensitive authentication data in application systems, maker-checker controls, immutable ledger linkage, observability, provider failure handling, and duplicate-money prevention.",
  ],
  "pesaswap-integration": [
    "The live provider contract for create, confirm, capture, refund, saved token, mandate, webhook, pull reconciliation, idempotency, timeout, error mapping, credential rotation, sandbox isolation, and go-live configuration.",
    "Version and compatibility evidence against official PesaSwap documentation, with live-money canaries, settlement reconciliation, incident ownership, and no unsupported claim about payment methods or certification.",
  ],
  "production-go-live": [
    "The cross-domain release decision: capability scope, persona journeys, trust boundaries, dependencies, risk, evidence state, blockers, owners, and honest customer-safe claims.",
    "The release evidence pack across source, migrations, security, finance, API/SDK, devices, accessibility, localization, operations, recovery, all four runtime tiers, and external certification.",
  ],
  reconciliation: [
    "Source-to-payment-to-fee-to-net-to-payout matching, resumable batches, explicit exceptions, line-level traceability, bank/POS/provider imports, approval, close, reopen, and audit-grade export.",
    "Idempotent and replay-safe recovery from delayed, duplicate, missing, reversed, partially refunded, unsynced, or mismatched transactions without editing settled history.",
  ],
  reputation: [
    "Consent-aware review and feedback capture, food/service/ambience/value dimensions, NPS where valid, provider linkage, moderation, alerts, response approval, publication state, and audit history.",
    "Traceable sentiment and generated response suggestions with source text, confidence, human control, privacy, platform-policy compliance, and no fabricated external review state.",
  ],
  "retail-commerce": [
    "Server-authoritative multi-store catalogue lookup, sales, stock movements, payment linkage, receipts, returns and void controls, suppliers, purchase orders, credit ledger, shift/cash controls, and reporting.",
    "Idempotent checkout, role-separated cost and margin access, barcode/scanner and peripheral recovery, concurrent-device consistency, finance traceability, and removal of browser-local business authority.",
  ],
  "revenue-optimisation": [
    "Reproducible menu-engineering classifications and contribution-margin recommendations using traceable volume, price, cost, period, timezone, tax, channel, confidence, and data-freshness inputs.",
    "Manager preview and approval, explainable impact, experiment and rollback behavior, role controls, and a safe handoff that never silently changes a live price or menu.",
  ],
  "smart-pricing": [
    "Explainable price and promotion recommendations with effective windows, timezone, channel, item eligibility, tax, margin floor, demand evidence, estimated impact, confidence, and versioned inputs.",
    "Manager approval, conflict detection, preview, publish, POS/channel propagation, rollback, customer price consistency, audit, and safeguards against discriminatory or unlawful pricing.",
  ],
  "staff-operations": [
    "Individual staff authentication, authoritative venue assignment, role-appropriate orders, kitchen, tables, customers, bills, payments, tips, shifts, notifications, handover, and offline/degraded recovery.",
    "No shared credentials or browser-local authority, restricted cost and finance visibility, fast session lock/revocation, managed-device behavior, audit attribution, and supervisor/manager escalation.",
  ],
  supervisor: [
    "The shift-lead journey for floor and inbox oversight, table or section assignment, bounded void/discount approval, conversation reassignment, exception escalation, shift reporting, and handover.",
    "Server-enforced approval thresholds and venue/shift scope so a supervisor cannot inherit manager configuration, finance, role-grant, or cross-venue authority through the UI or API.",
  ],
  tips: [
    "Customer tip capture, server attribution, configurable pooling, hours or fixed-share inputs, approval, payout ledger, reversal, reporting, statement, and employee visibility.",
    "Minor-unit conservation from capture through distribution and payout, transparent rules, locked periods, compensating corrections, role separation, privacy, and reconciliation to payment and accounting entries.",
  ],
  "unified-qr": [
    "One secure venue/table code for accurate browse, order, server-bound split/tip/payment, loyalty enrollment, receipt, self-service, expiration, regeneration, and staff recovery.",
    "Tamper, replay, enumeration, wrong-table, stale-menu, duplicate-order, partial-payment, offline/resume, accessibility, camera, and cross-device behavior with no amount or tenant authority in the URL.",
  ],
  verticals: [
    "One commercial capability catalogue in which vertical supplies defaults and paid tier supplies a server-enforced ceiling across navigation, APIs, agents, SDKs, jobs, exports, and multi-store aggregation.",
    "Complete, sellable vertical journeys with operator-controlled tier changes, audited overrides, upgrade/downgrade and grace behavior, usage/limit visibility, and no capability represented by an empty label or local demo.",
  ],
};

const agentOwnership = {
  "accessibility-engineer.agent.md": [
    "Own measurable WCAG 2.2 AA release evidence across the affected persona and device journeys, not lint-only claims.",
    "Block release on keyboard traps, unnamed controls, broken focus/reflow, inaccessible financial state, failed contrast, or missing screen-reader evidence applicable to the change.",
  ],
  "android-mpos-engineer.agent.md": [
    "Own the versioned Android checkout SDK, sample app, generated contract tests, managed-device lifecycle, secure credential use, observability, compatibility matrix, and field recovery.",
    "Treat certified card-present mPOS as a separate PCI PTS, EMV, acquirer, key-management, attestation, terminal and support programme; never relabel card-not-present checkout as mPOS.",
  ],
  "production-go-live-engineer.agent.md": [
    "Coordinate the evidence-backed release decision across every enabled business domain, persona, runtime tier, device class, integration, operational control, and external certification boundary.",
    "Keep the current readiness verdict and roadmap honest: source-complete work is not environment-verified, and no domain becomes production-ready while a required blocker remains open.",
  ],
  "retail-commerce-engineer.agent.md": [
    "Complete the transition from the existing server retail foundation to a fully server-authoritative multi-store counter, inventory, supplier, purchase-order, credit, returns, shift/cash and reporting journey.",
    "Keep sales, stock, payments and finance transactionally traceable; eliminate localStorage as business authority while preserving an explicit degraded/offline recovery design.",
  ],
  "sunday-parity-engineer.agent.md": [
    "Implement selected Sunday-parity roadmap items without weakening the global production contract, especially tenant, finance, approval, POS, device, accessibility and recovery controls.",
    "Record exact roadmap and evidence-state changes; parity with a competitor is supporting scope evidence, not by itself a production-readiness or certification claim.",
  ],
  "sunday-spec-researcher.agent.md": [
    "Return source-grounded competitor acceptance criteria, documented dependencies, edge cases and unknowns that can feed a production design or parity decision.",
    "Remain read-only and never convert research into an implementation, deployment, certification or production-readiness claim.",
  ],
  "vertical-productisation-engineer.agent.md": [
    "Own a server-enforced, auditable commercial capability catalogue across UI, APIs, agents, jobs, exports and SDKs, with vertical defaults below an operator-controlled paid-tier ceiling.",
    "Require every marketed capability to complete a real persona journey and define upgrade, downgrade, grace, override, limit, multi-store and support behavior.",
  ],
};

const claudeAgentDomains = {
  "accounting-engineer.md": "accounting",
  "agentic-checkout-engineer.md": "agentic-checkout",
  "analytics-engineer.md": "analytics",
  "auth-tenancy-engineer.md": "auth-tenancy",
  "auto-reorder-engineer.md": "auto-reorder",
  "bookings-engineer.md": "bookings-enquiries",
  "campaigns-engineer.md": "campaigns-automations",
  "crm-engineer.md": "crm-loyalty",
  "customer-experience-engineer.md": "customer-experience",
  "customer-portal-engineer.md": "customer-portal",
  "customer-value-engineer.md": "customer-value",
  "demand-forecasting-engineer.md": "demand-forecasting",
  "inventory-engineer.md": "inventory",
  "invoicing-engineer.md": "invoicing",
  "knowledge-base-engineer.md": "knowledge-base",
  "manager-engineer.md": "manager",
  "menu-engineer.md": "menu-catalogue",
  "merchant-copilot-engineer.md": "merchant-copilot",
  "merchant-owner-engineer.md": "merchant-owner",
  "omnichannel-engineer.md": "omnichannel-agent",
  "orders-kitchen-engineer.md": "orders-kitchen",
  "payments-engineer.md": "payments",
  "pesaswap-integration-engineer.md": "pesaswap-integration",
  "reconciliation-engineer.md": "reconciliation",
  "reputation-engineer.md": "reputation",
  "revenue-optimisation-engineer.md": "revenue-optimisation",
  "smart-pricing-engineer.md": "smart-pricing",
  "staff-operations-engineer.md": "staff-operations",
  "supervisor-engineer.md": "supervisor",
  "tips-engineer.md": "tips",
  "unified-qr-engineer.md": "unified-qr",
};

const markerStart = "<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->";
const markerEnd = "<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->";
const existingBlock = new RegExp(
  `\\r?\\n?${escapeRegExp(markerStart)}[\\s\\S]*?${escapeRegExp(markerEnd)}\\r?\\n?`,
  "g",
);
const legacyFooters = [
  /\r?\n## Definition of Done[^\r\n]*(?:\r?\n)+A feature is not done until it has \*\*full parity across all three runtime tiers\*\*[\s\S]*?`\.claude\/DEPLOYMENT-PARITY\.md`\.\s*$/,
  /\r?\nDefinition of Done: full parity[\s\S]*?`\.claude\/DEPLOYMENT-PARITY\.md`\.\s*$/,
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function customizationFiles() {
  const skillsRoot = join(root, ".claude", "skills");
  const skillFolders = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const claudeAgentRoot = join(root, ".claude", "agents");
  const claudeAgents = (await readdir(claudeAgentRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const githubAgentRoot = join(root, ".github", "agents");
  const githubAgents = (await readdir(githubAgentRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"))
    .map((entry) => entry.name)
    .sort();

  return [
    ...skillFolders.map((key) => ({
      type: "skill",
      key,
      file: join(skillsRoot, key, "SKILL.md"),
      ownership: skillOwnership[key],
      contractLink: "../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md",
      roadmapLink: "../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md",
      readinessLink: "../../../docs/GLOBAL-READINESS-REVIEW.md",
      parityLink: "../../DEPLOYMENT-PARITY.md",
    })),
    ...claudeAgents.map((key) => ({
      type: "claude-agent",
      key,
      file: join(claudeAgentRoot, key),
      ownership: skillOwnership[claudeAgentDomains[key]],
      contractLink: "../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md",
      roadmapLink: "../../docs/GLOBAL-ENTERPRISE-ROADMAP.md",
      readinessLink: "../../docs/GLOBAL-READINESS-REVIEW.md",
      parityLink: "../DEPLOYMENT-PARITY.md",
    })),
    ...githubAgents.map((key) => ({
      type: "github-agent",
      key,
      file: join(githubAgentRoot, key),
      ownership: agentOwnership[key],
      contractLink: "../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md",
      roadmapLink: "../../docs/GLOBAL-ENTERPRISE-ROADMAP.md",
      readinessLink: "../../docs/GLOBAL-READINESS-REVIEW.md",
      parityLink: "../../.claude/DEPLOYMENT-PARITY.md",
    })),
  ];
}

function productionBlock(entry) {
  const label = entry.type === "skill" ? "skill" : "agent";
  return [
    markerStart,
    `<!-- PRODUCTION_GO_LIVE_DOMAIN: ${entry.key} -->`,
    "## Production go-live ownership",
    "",
    `This ${label} inherits the [Production Go-Live Capability Contract](${entry.contractLink})`,
    "(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The",
    `[Global Enterprise Roadmap](${entry.roadmapLink}) defines delivery order, and the`,
    `[Global Readiness Review](${entry.readinessLink}) records the current verdict.`,
    "",
    "It owns production acceptance for:",
    "",
    ...entry.ownership.map((requirement) => `- ${requirement}`),
    "",
    "For every change in this domain:",
    "",
    "- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.",
    "- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.",
    "- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.",
    "- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.",
    "",
    `A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](${entry.parityLink}); never infer live readiness from source tests or a single environment.`,
    markerEnd,
  ].join("\n");
}

function updateContent(content, entry) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const withoutExisting = content.replace(existingBlock, "\n");
  const withoutLegacy = legacyFooters.reduce(
    (candidate, footer) => candidate.replace(footer, ""),
    withoutExisting,
  );
  const block = productionBlock(entry).replaceAll("\n", newline);
  return `${withoutLegacy.trimEnd()}${newline}${newline}${block}${newline}`;
}

function managedBlock(content) {
  const normalized = content.replaceAll("\r\n", "\n");
  const start = normalized.indexOf(markerStart);
  const end = normalized.indexOf(markerEnd, start + markerStart.length);
  if (start < 0 || end < 0) return null;
  return normalized.slice(start, end + markerEnd.length).trim();
}

function frontmatterIsValid(content) {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n"))
    return false;
  const normalized = content.replaceAll("\r\n", "\n");
  const close = normalized.indexOf("\n---\n", 4);
  if (close < 0) return false;
  const frontmatter = normalized.slice(4, close);
  return (
    /^name:\s*\S+/m.test(frontmatter) &&
    /^description:\s*(?:\S|>-?)/m.test(frontmatter)
  );
}

function validateContent(content, entry) {
  const errors = [];
  const normalized = content.replaceAll("\r\n", "\n");
  const startCount = normalized.split(markerStart).length - 1;
  const endCount = normalized.split(markerEnd).length - 1;

  if (!entry.ownership) errors.push("has no explicit domain ownership mapping");
  if (!frontmatterIsValid(content))
    errors.push("has missing or invalid name/description frontmatter");
  if (startCount !== 1 || endCount !== 1)
    errors.push("must contain exactly one production contract block");
  if (!normalized.includes(`PRODUCTION_GO_LIVE_DOMAIN: ${entry.key}`)) {
    errors.push("has a missing or incorrect domain marker");
  }
  if (!normalized.includes("## Production go-live ownership")) {
    errors.push("is missing the production ownership heading");
  }
  if (!normalized.includes("PRODUCTION_GO_LIVE_CONTRACT: v1")) {
    errors.push("does not inherit the canonical contract version");
  }
  if (!normalized.includes(entry.contractLink))
    errors.push("does not link the canonical contract");
  if (!normalized.includes(entry.roadmapLink))
    errors.push("does not link the global roadmap");
  if (!normalized.includes(entry.readinessLink))
    errors.push("does not link the readiness review");
  if (!normalized.includes(entry.parityLink))
    errors.push("does not link the deployment procedure");
  if (/all three runtime tiers|the three tiers/i.test(normalized)) {
    errors.push("still contains stale three-runtime-tier language");
  }
  if (
    entry.key === "retail-commerce-engineer.agent.md" &&
    /makes\s+\*\*zero API calls\*\*|There is no `src\/api\/retail\.ts`|single-browser tool, not a product/i.test(
      normalized,
    )
  ) {
    errors.push(
      "still contains the obsolete pre-retail-API implementation claim",
    );
  }
  return errors;
}

const entries = await customizationFiles();
const expectedSkillKeys = new Set(Object.keys(skillOwnership));
const expectedClaudeAgentKeys = new Set(Object.keys(claudeAgentDomains));
const expectedGithubAgentKeys = new Set(Object.keys(agentOwnership));
const actualSkillKeys = new Set(
  entries.filter((entry) => entry.type === "skill").map((entry) => entry.key),
);
const actualClaudeAgentKeys = new Set(
  entries
    .filter((entry) => entry.type === "claude-agent")
    .map((entry) => entry.key),
);
const actualGithubAgentKeys = new Set(
  entries
    .filter((entry) => entry.type === "github-agent")
    .map((entry) => entry.key),
);
const inventoryErrors = [];

for (const key of expectedSkillKeys) {
  if (!actualSkillKeys.has(key)) inventoryErrors.push(`missing skill: ${key}`);
}
for (const key of expectedClaudeAgentKeys) {
  if (!actualClaudeAgentKeys.has(key))
    inventoryErrors.push(`missing Claude agent: ${key}`);
}
for (const key of expectedGithubAgentKeys) {
  if (!actualGithubAgentKeys.has(key))
    inventoryErrors.push(`missing GitHub agent: ${key}`);
}

if (mode === "--write" && inventoryErrors.length) {
  console.error(inventoryErrors.join("\n"));
  process.exit(1);
}

let changed = 0;
const validationErrors = [...inventoryErrors];

for (const entry of entries) {
  if (!entry.ownership) {
    validationErrors.push(
      `${relative(root, entry.file)}: has no ownership mapping`,
    );
    continue;
  }
  const content = await readFile(entry.file, "utf8");
  const prettierConfig = (await resolveConfig(entry.file)) ?? {};
  const synchronized = await format(updateContent(content, entry), {
    ...prettierConfig,
    filepath: entry.file,
  });
  const candidate = mode === "--write" ? synchronized : content;
  if (mode === "--write" && candidate !== content) {
    await writeFile(entry.file, candidate, "utf8");
    changed += 1;
  }
  if (
    mode === "--check" &&
    managedBlock(content) !== managedBlock(synchronized)
  ) {
    validationErrors.push(
      `${relative(root, entry.file)}: managed production ownership block is out of sync; run npm run customizations:sync`,
    );
  }
  for (const error of validateContent(candidate, entry)) {
    validationErrors.push(`${relative(root, entry.file)}: ${error}`);
  }
}

const contract = await readFile(
  join(root, "docs", "PRODUCTION-GO-LIVE-CAPABILITIES.md"),
  "utf8",
);
for (const required of [
  "PRODUCTION_GO_LIVE_CONTRACT: v1",
  "## People and complete journeys",
  "## Android and mPOS boundary",
  "## Four required runtime tiers",
  "## Definition of production done",
]) {
  if (!contract.includes(required))
    validationErrors.push(`canonical contract: missing ${required}`);
}

if (validationErrors.length) {
  console.error(validationErrors.join("\n"));
  process.exit(1);
}

console.log(
  `Production customization contract valid: ${actualSkillKeys.size} skills, ${actualClaudeAgentKeys.size} Claude agents, ${actualGithubAgentKeys.size} GitHub agents${mode === "--write" ? ` (${changed} updated)` : ""}.`,
);
