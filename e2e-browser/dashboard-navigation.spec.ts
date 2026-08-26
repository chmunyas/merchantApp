import axe, { type AxeResults } from "axe-core";
import { expect, test, type Page } from "@playwright/test";

import { seedAuth } from "./_auth";

const rnd = () => Math.random().toString(36).slice(2, 8);
const wcagTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function analyzeWithAxe(
  page: Page,
  selector: string,
): Promise<AxeResults> {
  await page.addScriptTag({ content: axe.source });
  return page.evaluate(
    async ({ contextSelector, tags }) => {
      const context = document.querySelector(contextSelector);
      if (!context)
        throw new Error(`axe context not found: ${contextSelector}`);
      const axeApi = (
        window as unknown as {
          axe: {
            run: (
              element: Element,
              options: { runOnly: { type: "tag"; values: string[] } },
            ) => Promise<AxeResults>;
          };
        }
      ).axe;
      return axeApi.run(context, {
        runOnly: { type: "tag", values: tags },
      });
    },
    { contextSelector: selector, tags: wcagTags },
  );
}

async function openAuthenticatedDashboard(
  page: Page,
  request: Page["request"],
) {
  const response = await request.post("/api/auth/signup", {
    data: {
      businessName: `A11y Navigation ${rnd()}`,
      email: `a11y-navigation-${rnd()}@e2e.test`,
      password: "e2e-passw0rd",
    },
  });
  const merchant = await response.json();
  expect(response.ok()).toBe(true);
  await seedAuth(page, {
    token: merchant.token,
    venue: merchant.user.venue,
    name: merchant.user.name,
  });
  await page.goto("/dashboard/payments");
  await expect(page.locator("#dashboard-main")).toBeVisible();
}

test.describe("dashboard navigation accessibility", () => {
  test("desktop rail has semantic groups, one current page, visible focus and AA targets", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openAuthenticatedDashboard(page, request);

    const rail = page.getByRole("complementary", {
      name: "Dashboard navigation panel",
    });
    const navigation = rail.getByRole("navigation", {
      name: "Dashboard sections",
    });
    await expect(navigation.locator('a[aria-current="page"]')).toHaveCount(1);
    await expect(
      navigation.getByRole("link", { name: "Payments", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(navigation.locator("section[aria-labelledby]")).toHaveCount(6);
    await expect(navigation.locator("section ul")).toHaveCount(6);

    const targetHeights = await navigation
      .getByRole("link")
      .evaluateAll((links) =>
        links.map((link) => link.getBoundingClientRect().height),
      );
    expect(targetHeights.every((height) => height >= 44)).toBe(true);

    const currentIsVisible = await navigation
      .locator('a[aria-current="page"]')
      .evaluate((link) => {
        const linkRect = link.getBoundingClientRect();
        const scroller = link.closest(".overflow-y-auto");
        const scrollRect = scroller?.getBoundingClientRect();
        return Boolean(
          scrollRect &&
          linkRect.top >= scrollRect.top &&
          linkRect.bottom <= scrollRect.bottom,
        );
      });
    expect(currentIsVisible).toBe(true);

    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute("tabindex");
    });
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Tab");
    const overview = navigation.getByRole("link", { name: "Overview" });
    await expect(overview).toBeFocused();
    expect(
      await overview.evaluate((link) => getComputedStyle(link).boxShadow),
    ).toContain("2px inset");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("#dashboard-main")).toBeFocused();

    const results = await analyzeWithAxe(
      page,
      'aside[aria-label="Dashboard navigation panel"]',
    );
    expect(results.violations).toEqual([]);
  });

  test("mobile drawer is named, trapped, safe-area aware and restores focus", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAuthenticatedDashboard(page, request);

    const opener = page.getByRole("button", {
      name: "Open dashboard navigation",
    });
    const openerBox = await opener.boundingBox();
    expect(openerBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(openerBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(/.+/);
    const close = dialog.getByRole("button", {
      name: "Close dashboard navigation",
    });
    await expect(close).toHaveCount(1);
    const closeBox = await close.boundingBox();
    expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(dialog.locator('a[aria-current="page"]')).toHaveCount(1);

    const geometry = await dialog.evaluate((element) => {
      const links = [...element.querySelectorAll("nav a")];
      return {
        width: element.getBoundingClientRect().width,
        minTarget: Math.min(
          ...links.map((link) => link.getBoundingClientRect().height),
        ),
        paddingBottom: Number.parseFloat(
          getComputedStyle(element).paddingBottom,
        ),
      };
    });
    expect(geometry.width).toBeLessThanOrEqual(374);
    expect(geometry.minTarget).toBeGreaterThanOrEqual(44);
    expect(geometry.paddingBottom).toBeGreaterThanOrEqual(16);

    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.keyboard.press("Shift+Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);

    const results = await analyzeWithAxe(page, '[role="dialog"]');
    expect(results.violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(
      await opener.evaluate((button) => getComputedStyle(button).boxShadow),
    ).toMatch(/(?:2|4)px/);
  });
});
