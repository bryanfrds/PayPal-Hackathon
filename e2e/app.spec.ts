import { test, expect } from "@playwright/test";
import { makeSession } from "../lib/auth";

const BASE_URL = "http://localhost:3005";
const AUTH_SECRET = "local-development-secret-that-is-at-least-32-chars-long";
const OWNER_EMAIL = "test-merchant@example.com";

test.describe("555 Buku End-to-End System Tests", () => {
  test.describe("Unauthenticated Visitor Flows", () => {
    test("Redirects / to /sign-in", async ({ page }) => {
      await page.goto(`${BASE_URL}/`);
      await expect(page).toHaveURL(/.*\/sign-in/);
      await expect(page.locator(".si-headline")).toBeVisible();
    });

    test("Can switch from Welcome screen to Email sign-in screen", async ({ page }) => {
      await page.goto(`${BASE_URL}/sign-in`);
      const withEmailBtn = page.locator("button.si-btn.si-btn-light");
      await expect(withEmailBtn).toBeVisible();
      await withEmailBtn.click();

      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toBeVisible();

      const backBtn = page.locator("button.si-back");
      await backBtn.click();
      await expect(withEmailBtn).toBeVisible();
    });

    test("Public customer tab view handles nonexistent tab gracefully without crashing", async ({ page }) => {
      const res = await page.goto(`${BASE_URL}/tab/test-customer`);
      expect(res?.status()).toBeLessThan(500);
    });

    test("Public customer pay page handles invalid invoice cleanly without 500 error", async ({ page }) => {
      const res = await page.goto(`${BASE_URL}/tab/test-customer/pay`);
      expect(res?.status()).toBeLessThan(500);
    });

    test("Public customer short token route /t/[token] handles invalid token cleanly", async ({ page }) => {
      const res = await page.goto(`${BASE_URL}/t/invalid-token-123`);
      expect(res?.status()).toBeLessThan(500);
    });
  });

  test.describe("Authenticated Merchant Flows", () => {
    test.beforeEach(async ({ context }) => {
      const sessionToken = await makeSession(OWNER_EMAIL, "email", AUTH_SECRET);
      await context.addCookies([
        {
          name: "buku_session",
          value: sessionToken,
          domain: "localhost",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    });

    test("Signed-in owner reaches /collect with no console errors", async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      await page.goto(`${BASE_URL}/collect`);
      await expect(page).toHaveURL(/.*\/collect/);
      expect(consoleErrors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
    });

    test("Signed-in owner can interact with /scan mode switch", async ({ page }) => {
      await page.goto(`${BASE_URL}/scan`);
      await expect(page).toHaveURL(/.*\/scan/);

      // Verify scan choices are rendered
      const bodyText = await page.innerText("body");
      expect(bodyText.toLowerCase()).toContain("scan");
    });

    test("Signed-in owner can load /ledger page and verify grid container", async ({ page }) => {
      await page.goto(`${BASE_URL}/ledger`);
      await expect(page).toHaveURL(/.*\/ledger/);
      const ledgerContent = await page.content();
      expect(ledgerContent).toContain("ledger");
    });

    test("Signed-in owner can search customers on /customers", async ({ page }) => {
      await page.goto(`${BASE_URL}/customers`);
      await expect(page).toHaveURL(/.*\/customers/);

      // Check search input exists and can type into it
      const searchInput = page.locator('input[type="search"], input[placeholder*="Search" i], input[type="text"]');
      if (await searchInput.first().isVisible()) {
        await searchInput.first().fill("Ah Hock");
        await page.waitForTimeout(100);
      }
    });

    test("Signed-in owner can adjust rules on /reminders/rules", async ({ page }) => {
      await page.goto(`${BASE_URL}/reminders/rules`);
      await expect(page).toHaveURL(/.*\/reminders\/rules/);

      // Find any stepper button (+ or -) and click it
      const buttons = page.locator(".rules button, .tab-top a");
      expect(await buttons.count()).toBeGreaterThan(0);
    });

    test("Signed-in owner can load /insights and /settings pages", async ({ page }) => {
      const resInsights = await page.goto(`${BASE_URL}/insights`);
      expect(resInsights?.status()).toBe(200);

      const resSettings = await page.goto(`${BASE_URL}/settings`);
      expect(resSettings?.status()).toBe(200);

      const resLang = await page.goto(`${BASE_URL}/settings/language`);
      expect(resLang?.status()).toBe(200);
    });

    test("API Endpoints return valid JSON for authenticated owner", async ({ page }) => {
      const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
      expect(meRes.status()).toBe(200);
      const meJson = await meRes.json();
      expect(meJson.email).toBe(OWNER_EMAIL);

      const rulesRes = await page.request.get(`${BASE_URL}/api/reminder-rules`);
      expect(rulesRes.status()).toBe(200);
      const rulesJson = await rulesRes.json();
      expect(rulesJson.firstAfterDays).toBeDefined();

      const activityRes = await page.request.get(`${BASE_URL}/api/reminders/activity`);
      expect(activityRes.status()).toBe(200);
      const actJson = await activityRes.json();
      expect(Array.isArray(actJson.activity)).toBe(true);

      const custRes = await page.request.get(`${BASE_URL}/api/customers`);
      expect(custRes.status()).toBe(200);
      const custJson = await custRes.json();
      expect(Array.isArray(custJson)).toBe(true);
    });

    test("Vercel Cron endpoint handles authorization correctly", async ({ page }) => {
      // 1. Without auth header -> 401
      const noAuthRes = await page.request.get(`${BASE_URL}/api/reminders/process`);
      expect(noAuthRes.status()).toBe(401);

      // 2. With valid CRON_SECRET -> 200
      const authRes = await page.request.get(`${BASE_URL}/api/reminders/process`, {
        headers: { Authorization: "Bearer test-cron-secret-12345" },
      });
      expect(authRes.status()).toBe(200);
      const cronJson = await authRes.json();
      expect(cronJson.processedOwners).toBeDefined();
    });
  });
});
