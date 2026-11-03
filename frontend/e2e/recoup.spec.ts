import { expect, type Page, test } from "@playwright/test";

// One path through the review UI, in order: it changes the demo database, so run `make reset` first.

const tab = (page: Page, label: string) => page.getByRole("tab", { name: new RegExp(`^${label}`) });
const tabCount = async (page: Page, label: string) => Number((await tab(page, label).innerText()).replace(/\D+/g, ""));
const row = (page: Page, id: number) => page.locator(`[role=tabpanel]:not([inert]) [data-case-id="${id}"]`);
const caseTitle = (page: Page) => page.getByRole("article").getByRole("heading", { level: 2 });

test.describe.configure({ mode: "serial" });

test("review, send, advance and dismiss", async ({ page, request }) => {
  const summary = await (await request.get("/api/summary")).json();
  expect(summary.as_of, "Run `make reset` so the demo starts at Oct 1, 2026").toBe("2026-10-01");
  expect(summary.demo_mode, "The API must run with RECOUP_DEMO_MODE=true (make api)").toBe(true);

  const errors: string[] = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", (error) => errors.push(String(error)));

  await test.step("the overview is the landing page", async () => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Totals")).toContainText("$14,961.34");
    const expiring = page.getByRole("region", { name: "Expiring soon" });
    await expect(expiring.locator("[data-expiring-id]")).toHaveCount(5);
    await expect(expiring.locator("[data-expiring-id]").first()).toContainText("Figma");
    await expect(page.getByRole("region", { name: "Where it comes from" })).toContainText("Duplicate charges");
    await expect(page.getByRole("region", { name: "Top vendors" })).toContainText("Amazon Web Services");
    await expect(page.getByRole("region", { name: "Progress" })).toContainText("will show here");

    await expiring.locator('[data-expiring-id="2"]').click();
    await expect(page).toHaveURL(/#\/claims\/2$/);
    await expect(caseTitle(page)).toHaveText("Figma");
    await page.goBack();
    await expect(page.getByRole("region", { name: "Expiring soon" })).toBeVisible();
    await page.getByRole("button", { name: /^Review \d+ claims$/ }).click();
    await expect(page).toHaveURL(/#\/claims/);
  });

  await test.step("switch tabs, move with j/k", async () => {
    await expect(row(page, 2)).toBeVisible();
    for (const label of ["Waiting", "Done", "To do"]) {
      await tab(page, label).click();
      await expect(tab(page, label)).toHaveAttribute("aria-selected", "true");
    }
    const current = page.locator('[aria-current="true"]');
    const first = await current.getAttribute("data-case-id");
    await page.keyboard.press("j");
    await expect(current).not.toHaveAttribute("data-case-id", first ?? "");
    await page.keyboard.press("k");
    await expect(current).toHaveAttribute("data-case-id", first ?? "");
  });

  await test.step("Figma case: footnotes and source preview", async () => {
    await row(page, 2).click();
    await expect(caseTitle(page)).toHaveText("Figma");
    await expect(page.locator("[data-footnote]")).toHaveCount(2);
    await page.locator('[data-footnote="1"]').hover();
    await expect(page.getByRole("tooltip")).toContainText("FIG-202606");
  });

  await test.step("email footnote opens the original email; Escape closes it", async () => {
    await row(page, 15).click(); // United Airlines promised a refund by email
    await expect(caseTitle(page)).toHaveText("United Airlines");
    await page.locator('[data-footnote][aria-label*="Opens the email"]').first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.locator("mark")).toContainText("A refund of $612.40");
    await expect(sheet).toContainText("checked word for word");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  await test.step("draft, edit the subject, save, slide to confirm", async () => {
    await row(page, 2).click();
    await page.getByRole("button", { name: "Draft request" }).click();
    const subject = page.locator("#draft-subject");
    await subject.fill("Duplicate charge FIG-202606: please refund $480.00");
    await page.getByRole("button", { name: "Save edits" }).click();
    await expect(page.getByRole("button", { name: "Save edits" })).toBeDisabled();

    await page.getByRole("button", { name: "Send request" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("billing@figma.com");
    // Let the sheet finish rising before measuring the slider for the drag.
    await page.waitForTimeout(700);

    const sent = page.waitForRequest((r) => r.url().includes("/send") && r.method() === "POST");
    const thumb = page.getByRole("button", { name: /^Slide to send/ });
    const box = (await thumb.boundingBox())!;
    const track = (await thumb.locator("xpath=..").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(box.x + box.width / 2 + (track.width * i) / 24, box.y + box.height / 2, { steps: 2 });
    }
    await page.mouse.up();
    expect((await sent).postDataJSON()).toEqual({ confirm: true });
    await expect(sheet).toHaveCount(0, { timeout: 8_000 });
    await expect.poll(() => tabCount(page, "Waiting")).toBe(1);
  });

  await test.step("advance two weeks: notices, overview progress, morphing chip", async () => {
    await page.getByRole("link", { name: "Overview" }).click();
    const totals = page.getByLabel("Totals");
    const before = await totals.innerText();
    await page.getByRole("button", { name: "Advance 2 weeks" }).click();
    await expect(page.locator("[aria-live=polite] li").filter({ hasText: /credit posted/i })).toBeVisible();
    await expect(totals.locator('svg[role="img"]')).toHaveCount(1);
    await expect.poll(() => totals.innerText()).not.toBe(before);
    await expect(page.getByRole("region", { name: "Progress" })).toContainText("Figma");
    await page.getByRole("link", { name: "Claims" }).click();
    await tab(page, "Done").click();
    await expect(row(page, 2)).toContainText("Recovered");
    await tab(page, "To do").click();
  });

  await test.step("dismiss a case with a reason", async () => {
    const done = await tabCount(page, "Done");
    await row(page, 7).click(); // Lyft Ride
    await page.getByRole("button", { name: "Not owed, dismiss" }).click();
    await page.locator("#dismiss-reason").fill("Two separate rides that evening");
    await page.getByRole("button", { name: "Dismiss case" }).click();
    await expect.poll(() => tabCount(page, "Done")).toBe(done + 1);
  });

  expect(errors, "console errors").toEqual([]);
});
