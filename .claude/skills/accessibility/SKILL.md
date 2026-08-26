---
name: accessibility
description: >-
  WCAG 2.2 conformance and the accessibility lint ratchet. Use when a task
  mentions accessibility, a11y, WCAG, screen reader, keyboard navigation, focus
  management, skip links, ARIA attributes, colour contrast, target size, form
  labels, jsx-a11y, axe, or Lighthouse accessibility.
---

# Accessibility

Accessibility here is a **build gate**, not a review comment.

## What is enforced today

`eslint-plugin-jsx-a11y` runs over all source via [eslint.config.js](../../eslint.config.js).

| Status                            | Rules                                                                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Error (ratchet, 0 violations)** | `alt-text`, `anchor-has-content`, `aria-props`, `aria-proptypes`, `aria-unsupported-elements`, `role-has-required-aria-props`, `role-supports-aria-props`, `no-redundant-roles`, `no-autofocus`, `click-events-have-key-events`, `no-static-element-interactions` |
| **Warning (existing debt)**       | `label-has-associated-control` (74)                                                                                                                                                                                                                               |

**The ratchet rule:** when a warning-level rule reaches zero violations, promote
it to `"error"` in the same commit. Never demote a rule to make a build pass.

### Remaining debt: `label-has-associated-control` (74)

Concentrated in [src/routes/dashboard/retail.tsx](../../../src/routes/dashboard/retail.tsx) (16)
and [src/routes/dashboard/staff.tsx](../../../src/routes/dashboard/staff.tsx) (10).
Two distinct failures hide behind one rule name:

- _"must have accessible text"_ — the `<label>` does wrap its control, but the
  text is a dynamic `{label}` expression the rule cannot statically see. Harmless
  at runtime, but it also means nothing verifies the prop is ever non-empty.
- _"must be associated with a control"_ — genuinely broken; the label is a
  sibling of its input and screen readers announce neither.

The fix for both is one shared `Field` primitive using `useId()` with explicit
`htmlFor`/`id`, replacing the per-file `Field` helpers that already exist in at
least three files.

## Implemented patterns

- **Skip link** (WCAG 2.4.1) in `src/routes/dashboard.tsx` — 40+ sidebar links
  precede content on every page, so bypass is mandatory, not optional.
- **Landmarks** — labelled `<nav aria-label="Dashboard sections">`, focusable
  `<main id="dashboard-main" tabIndex={-1}>`.
- **Current page** — `aria-current="page"` on the active link (WCAG 4.1.2).
- **Dashboard navigation** — visible groups are native headings + lists; root
  matching is exact so one link is current; desktop and mobile targets are 44px;
  the long rail keeps the current item in view; the Radix drawer has a named
  trigger/dialog/close control, trapped focus, Escape, restoration and safe-area
  padding. `e2e-browser/dashboard-navigation.spec.ts` enforces these with axe,
  keyboard, geometry and focus checks.
- **Decorative icons** — `aria-hidden="true"`; badges pair a hidden number with
  an `sr-only` sentence so a screen reader hears "3 new enquiries", not "3".
- **Focus visibility** — `focus-visible:ring-*` on interactive elements.
- **Modal overlays** — every click-outside-to-close surface goes through
  [`ModalOverlay`](../../../src/components/ui/modal-overlay.tsx) (10 call sites).
  It replaced a hand-rolled backdrop `<div onClick={close}>` wrapping a panel
  `<div onClick={stopPropagation}>`. That shape had two defects the lint warnings
  were only a symptom of: the backdrop was unreachable by keyboard, so a
  keyboard-only user had **no way to dismiss the dialog at all** (WCAG 2.1.1);
  and the `stopPropagation` existed purely to undo the backdrop being the panel's
  parent. `ModalOverlay` makes the backdrop a real `<button>` _sibling_ — so no
  propagation games — adds Escape-to-close, and sets
  `role="dialog" aria-modal="true"` with a required accessible name.
  Not yet done: focus trapping and focus restore on close.

## Rules of thumb

1. **Semantic HTML first.** A `<button>` is keyboard-operable, focusable and
   announced correctly for free. `<div role="button">` needs `tabIndex`, key
   handlers and ARIA to reach the same place — and usually gets one wrong.
2. **Never `aria-label` an element with visible text.** It overrides the visible
   label for screen-reader users and silently drifts out of sync.
3. **Never `autoFocus`.** It moves focus before the user has oriented.
4. **Announce async state.** A payment or order that changes silently is
   invisible to a screen-reader user — use `role="status"` / `aria-live`.
5. **Errors need three things:** programmatic association (`aria-describedby`),
   an `aria-invalid` flag, and text that says how to fix it.

## Verification ladder

| Level             | Tool                                  | Status                        |
| ----------------- | ------------------------------------- | ----------------------------- |
| Static            | `eslint-plugin-jsx-a11y`              | ✅ Enforced in `npm run lint` |
| Automated runtime | `@axe-core/playwright`                | 🟡 Dashboard navigation only  |
| Contrast          | axe rendered-color checks             | 🟡 Dashboard navigation only  |
| Keyboard          | Playwright Tab/Shift-Tab/Enter/Escape | 🟡 Dashboard navigation only  |
| Screen reader     | NVDA / VoiceOver                      | 🔴 Unverified                 |

**Do not claim WCAG 2.2 AA conformance.** Lint cannot see contrast, focus order,
or whether a live region actually announces. The honest current statement is:
"dashboard navigation automated and lint-enforced; application-wide conformance
and real screen-reader behavior remain unverified".

## Priority when triaging

1. **Barriers** — keyboard-unreachable controls, unnamed inputs, focus traps.
2. **Comprehension** — labels, error identification, status messages.
3. **Comfort** — target size, motion, contrast refinement.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: accessibility -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- WCAG 2.2 AA evidence for merchant, staff, guest, partner, and device-specific journeys, including semantics, keyboard use, focus, reflow, contrast, motion, status announcements, and screen-reader verification.
- Accessible denial, error, recovery, and confirmation behavior for every financial or destructive action changed in this domain.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
