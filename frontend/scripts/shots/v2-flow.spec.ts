import { expect, test } from "@playwright/test";

// Review screenshots of the states that need writes: a draft, the send sheet, the bulk bar, and what
// Recovered looks like once money is back. Runs only on the isolated world:
//   RECOUP_E2E_DIR=scripts/shots npm run e2e:isolated
const out = process.env.SHOTS_OUT ?? "../.pipeline/v2/build";

test.use({ deviceScaleFactor: 2 });

test("v2 flow shots", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: "Claim details" });
  const settle = () => page.waitForTimeout(700);

  await page.goto("/#/claims");
  await page.locator('tr[data-case-id="1"]').getByRole("checkbox").check();
  await page.locator('tr[data-case-id="3"]').getByRole("checkbox").check();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("2 selected");
  await settle();
  await page.screenshot({ path: `${out}/claims-bulk-1440.png` });

  await page.goto("/#/claims/2");
  await sidebar.getByRole("button", { name: "Draft request" }).click();
  await expect(page.locator("#draft-subject")).toBeVisible();
  await settle();
  await page.screenshot({ path: `${out}/case-draft-1440-full.png`, fullPage: true });

  await sidebar.getByRole("button", { name: "Review and send" }).click();
  const sheet = page.getByRole("dialog", { name: "Approve this request" });
  await expect(sheet).toBeVisible();
  await settle();
  await page.screenshot({ path: `${out}/send-sheet-1440.png` });

  // The keyboard path: the slider has focus; Enter arms it, Enter again sends.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(sheet).toHaveCount(0, { timeout: 8_000 });

  await page.getByRole("button", { name: /^Demo/ }).click();
  await page.getByRole("menuitem", { name: "Advance 2 weeks" }).click();
  await expect(page.locator("[aria-live=polite] li").filter({ hasText: /credit posted/i })).toBeVisible();
  await settle();
  await page.screenshot({ path: `${out}/overview-after-advance-1440.png` });

  // A second advance, so the recovery chart has more than one date to draw.
  await page.goto("/#/overview");
  await page.reload();
  await page.getByRole("button", { name: /^Demo/ }).click();
  await page.getByRole("menuitem", { name: "Advance 2 weeks" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/overview-after-second-advance-notices-1440.png` });

  for (const [route, name] of [
    ["overview", "overview-after-advance"],
    ["recovered", "recovered-after-advance"],
    ["claims/2", "case-recovered"],
    ["claims?tab=done", "claims-done"],
  ]) {
    await page.goto(`/#/${route}`);
    await page.reload(); // clears the notices, which would cover the page
    await page.waitForLoadState("networkidle");
    await settle();
    await page.screenshot({ path: `${out}/${name}-1440.png`, fullPage: true });
  }
});
