import { test, expect } from "@playwright/test";
import { makeSession } from "../lib/auth";

const AUTH_SECRET = "local-development-secret-that-is-at-least-32-chars-long";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const ENTRY = {
  id: "scan-e2e-r1-e1",
  customerName: "Pak Hamid",
  item: "Beras 5kg",
  amountSen: 2450,
  rawAmountText: "24.50",
  date: "2026-11-01",
  classification: "debt",
  isAmbiguous: false,
  included: true,
};

test.beforeEach(async ({ context }) => {
  const value = await makeSession("test-merchant@example.com", "email", AUTH_SECRET);
  await context.addCookies([{ name: "buku_session", value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
});

test("an invoice sent from another device shows as sent here and isn't offered again", async ({ page }) => {
  const debt = { id: "appr-elsewhere", ownerEmail: "test-merchant@example.com", sourceEntryId: "entry-x", scanId: "scan-x", customerId: "cust-x", customerName: "Puan Rohana", customerEmail: "rohana@example.com", amountSen: 5200, currency: "MYR", item: "Gula", date: "2026-11-01", approvedAt: "2026-11-01T00:00:00Z", handoffKey: "x" };
  await page.route("**/api/debts/approved", (route) =>
    route.fulfill({ json: { approvedDebts: [], withdrawnDebtIds: [], invoiced: [{ debt, invoice: { id: "INV2-ELSEWHERE", number: "0099", amountSen: 5200, sentAt: "2026-11-02T00:00:00Z" } }] } }),
  );

  await page.goto("/collect");
  await expect(page.getByRole("tab", { name: /Sent/ })).toBeVisible();
  await expect(page.locator(".collect-card").filter({ hasText: "Puan Rohana" })).toHaveCount(0);
  await page.getByRole("tab", { name: /Sent/ }).click();
  await expect(page.locator(".collect-row").filter({ hasText: "Puan Rohana" })).toContainText("52.00");
});

test("a line flagged as a repayment can't be ticked until the owner corrects it", async ({ page }) => {
  await page.route("**/api/scans", (route) =>
    route.fulfill({ status: 201, json: { scan: { id: "scan-e2e-r" }, entries: [{ ...ENTRY, id: "scan-e2e-r-r1-e1", classification: "repayment", included: false }] } }),
  );
  await page.route("**/api/scans/scan-e2e-r/image", (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: JPEG }));

  await page.goto("/scan");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "page.jpg", mimeType: "image/jpeg", buffer: JPEG });

  const tick = page.getByRole("checkbox");
  await expect(tick).toBeDisabled({ timeout: 15000 });
  await page.getByRole("button", { name: /Pak Hamid/ }).click();
  await page.getByLabel("Amount").fill("30.00");
  await expect(tick).toBeEnabled();
});

test("a scanned line with no customer email reaches the ledger and waits for an email on Collect", async ({ page }) => {
  // The AI reader isn't set up in E2E runs, so its answer is fixed here.
  await page.route("**/api/scans", (route) =>
    route.fulfill({ status: 201, json: { scan: { id: "scan-e2e" }, entries: [ENTRY], isDuplicate: true, warning: "This photo was uploaded before." } }),
  );
  await page.route("**/api/scans/scan-e2e/image", (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: JPEG }));

  await page.goto("/scan");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "page.jpg", mimeType: "image/jpeg", buffer: JPEG });

  const add = page.getByRole("button", { name: "Add 1 debt to ledger" });
  await expect(add).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("status").filter({ hasText: "This photo was uploaded before." })).toHaveClass(/notice-warning/);

  // Finding a customer is offered, not required, and its words aren't garbled.
  await page.getByRole("button", { name: /Pak Hamid/ }).click();
  await expect(page.getByText("Optional: add this line now")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find customer matches" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("â€");

  await add.click();
  await expect(page).toHaveURL(/\/ledger\?scanned=1/);
  await expect(page.getByText("Pak Hamid").first()).toBeVisible();

  await page.goto("/collect");
  const card = page.locator(".collect-card").filter({ hasText: "Pak Hamid" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Add email" })).toBeVisible();
  await expect(card.getByRole("switch")).toBeDisabled();
  await expect(card).toContainText("24.50");

  // The same photo again, untouched: no second debt.
  await page.goto("/scan");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "page.jpg", mimeType: "image/jpeg", buffer: JPEG });
  await expect(add).toBeVisible({ timeout: 15000 });
  await add.click();
  await expect(page).toHaveURL(/\/ledger\?scanned=0/);
  await page.goto("/collect");
  await expect(card).toContainText("24.50");
  await expect(card).not.toContainText("49.00");
});
