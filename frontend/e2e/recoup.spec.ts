import { expect, type Page, test } from "@playwright/test";

// One path through the review UI, in order: it changes the demo database, so run `make reset` first.

const nav = (page: Page, label: string) => page.getByRole("navigation", { name: "Pages" }).first().getByRole("link", { name: new RegExp(`^${label}`) });
const tab = (page: Page, label: string) => page.getByRole("tab", { name: new RegExp(`^${label}`) });
const tabCount = async (page: Page, label: string) => Number((await tab(page, label).innerText()).replace(/\D+/g, ""));
const row = (page: Page, id: number) => page.locator(`tr[data-case-id="${id}"]`);
const caseTitle = (page: Page) => page.getByRole("article").getByRole("heading", { level: 1 });
const sidebar = (page: Page) => page.getByRole("complementary", { name: "Case sidebar" });

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
    await expect(nav(page, "Overview")).toHaveAttribute("aria-current", "page");
    await expect(nav(page, "Claims")).toContainText("15");
    await expect(page.getByRole("status").filter({ hasText: "Demo data" })).toContainText("As of Oct 1, 2026");
    await expect(page.getByRole("region", { name: "Ready to claim" })).toContainText("$13,710.09");
    await expect(page.getByRole("region", { name: "Ready to claim" })).toContainText("Chart fills in as money comes back");
    await expect(page.getByRole("region", { name: "Totals" })).toContainText("Recovered");
    const needs = page.getByRole("region", { name: "Needs action" });
    await expect(needs.locator("[data-needs-id]")).toHaveCount(5);
    await expect(needs.locator("[data-needs-id]").first()).toContainText("Figma");
    await expect(needs.locator("[data-needs-id]").first()).toContainText("1 day");
    await expect(page.getByRole("region", { name: "Where it comes from" })).toContainText("Duplicate charges");
    await expect(page.getByRole("region", { name: "Top vendors" })).toContainText("Amazon Web Services");
    await expect(page.getByRole("region", { name: "Recently recovered" })).toContainText("will show here");
    await expect(page.getByRole("region", { name: "Sources", exact: true })).toContainText("Status pages");

    await needs.locator('[data-needs-id="2"]').click();
    await expect(page).toHaveURL(/#\/claims\/2$/);
    await expect(caseTitle(page)).toHaveText("Figma");
    await page.goBack();
    await expect(page.getByRole("region", { name: "Needs action" })).toBeVisible();
    await page.getByRole("button", { name: /^Review 15 claims/ }).click();
    await expect(page).toHaveURL(/#\/claims$/);
  });

  await test.step("tabs, search and type filters live in the hash", async () => {
    await expect(row(page, 2)).toBeVisible();
    await expect(tab(page, "Window closed")).toContainText("5");
    for (const label of ["Waiting", "Done", "Window closed", "To do"]) {
      await tab(page, label).click();
      await expect(tab(page, label)).toHaveAttribute("aria-selected", "true");
    }
    await page.getByRole("searchbox", { name: "Search vendors or references" }).fill("FIG-202606");
    await expect(page).toHaveURL(/q=FIG-202606/);
    await expect(page.locator("tr[data-case-id]")).toHaveCount(1);
    await page.getByRole("searchbox", { name: "Search vendors or references" }).fill("nothing like this");
    await expect(page.getByText(/No to do claims match/)).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("group", { name: "Filter by type" }).getByRole("button", { name: "Outages" }).click();
    await expect(page).toHaveURL(/type=sla_credit/);
    await expect(page.locator("tr[data-case-id]")).toHaveCount(2);
    await page.reload();
    await expect(page.locator("tr[data-case-id]")).toHaveCount(2);
    await page.getByRole("group", { name: "Filter by type" }).getByRole("button", { name: "All types" }).click();
    await expect(page).toHaveURL(/#\/claims$/);
  });

  await test.step("keyboard: j / k move, x selects, Enter opens, Esc returns", async () => {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("j");
    await expect(page.locator("tr[data-cursor]")).toHaveAttribute("data-case-id", "2");
    await page.keyboard.press("j");
    const second = await page.locator("tr[data-cursor]").getAttribute("data-case-id");
    expect(second).not.toBe("2");
    await page.keyboard.press("k");
    await expect(page.locator("tr[data-cursor]")).toHaveAttribute("data-case-id", "2");
    await page.keyboard.press("x");
    await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/claims\/2$/);
    await expect(caseTitle(page)).toHaveText("Figma");
    await page.keyboard.press("j");
    await expect(page).toHaveURL(new RegExp(`#/claims/${second}$`));
    await expect(caseTitle(page)).not.toHaveText("Figma");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/#\/claims$/);
  });

  await test.step("Figma case: footnotes, rule checks, sidebar", async () => {
    await row(page, 2).click();
    await expect(caseTitle(page)).toHaveText("Figma");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Figma");
    await expect(page.locator("[data-footnote]")).toHaveCount(2);
    await page.locator('[data-footnote="1"]').hover();
    await expect(page.getByRole("tooltip")).toContainText("FIG-202606");
    await expect(page.getByRole("region", { name: "How Recoup found this" })).toContainText("No matching refund has posted");
    await expect(page.getByRole("region", { name: "Respond by" })).toContainText("1 day left");
    await expect(page.locator("[data-reference]")).toHaveText("FIG-202606");
    await expect(sidebar(page).getByRole("region", { name: "Facts" })).toContainText("Duplicate charge");
  });

  await test.step("email footnote opens the original email; Escape closes it", async () => {
    await page.goto("/#/claims/15"); // United Airlines promised a refund by email
    await expect(caseTitle(page)).toHaveText("United Airlines");
    await page.locator('[data-footnote][aria-label*="Opens the email"]').first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.locator("mark")).toContainText("A refund of $612.40");
    await expect(sheet).toContainText("checked word for word");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(caseTitle(page)).toHaveText("United Airlines");
  });

  await test.step("draft, edit the subject, save, review and slide to send", async () => {
    await page.goto("/#/claims/2");
    await sidebar(page).getByRole("button", { name: "Draft request" }).click();
    const subject = page.locator("#draft-subject");
    await subject.fill("Duplicate charge FIG-202606: please refund $480.00");
    await page.getByRole("button", { name: "Save edits" }).click();
    await expect(page.getByRole("button", { name: "Save edits" })).toBeDisabled();

    await sidebar(page).getByRole("button", { name: /^Send to billing@figma\.com · \$480\.00/ }).click();
    const sheet = page.getByRole("dialog", { name: "Approve this request" });
    await expect(sheet).toContainText("billing@figma.com");
    await expect(sheet).toContainText("$480.00");
    await expect(sheet).toContainText("FIG-202606");
    await expect(sheet).toContainText("Duplicate charge FIG-202606: please refund $480.00");
    await expect(sheet).toContainText("Can't be edited after sending");
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
    await expect(page.getByRole("region", { name: "Status" })).toContainText("Waiting on the vendor");
    await page.goto("/#/claims");
    await expect.poll(() => tabCount(page, "Waiting")).toBe(1);
  });

  await test.step("bulk: draft two requests at once, nothing sent", async () => {
    await row(page, 1).getByRole("checkbox").check();
    await row(page, 3).getByRole("checkbox").check();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toContainText("2 selected");
    await bar.getByRole("button", { name: /Draft requests/ }).click();
    await expect(page.locator("[aria-live=polite] li").filter({ hasText: "2 drafts ready" })).toBeVisible();
    await expect(bar).toHaveCount(0);
    await expect(row(page, 1)).toContainText("Draft ready");
    await expect.poll(() => tabCount(page, "Waiting")).toBe(1);
  });

  await test.step("advance two weeks: notices, overview totals, recovered feed", async () => {
    await nav(page, "Overview").click();
    const band = page.getByRole("region", { name: "Totals" });
    const before = await band.innerText();
    await page.getByRole("button", { name: "Advance 2 weeks" }).click();
    await expect(page.locator("[aria-live=polite] li").filter({ hasText: /credit posted/i })).toBeVisible();
    await expect.poll(() => band.getByRole("img").getAttribute("aria-label")).not.toContain("$0.00 recovered");
    await expect.poll(() => band.innerText()).not.toBe(before);
    await expect(page.getByRole("region", { name: "Recently recovered" })).toContainText("Figma");
    await nav(page, "Recovered").click();
    await expect(page).toHaveURL(/#\/recovered$/);
    const feed = page.getByRole("region", { name: "Activity" });
    await expect(feed.locator('[data-activity="recovered"]').filter({ hasText: "Figma" })).toBeVisible();
    await expect(feed.locator('[data-activity="sent"]').filter({ hasText: "Figma" })).toBeVisible();
    await feed.locator('[data-activity="recovered"]').filter({ hasText: "Figma" }).click();
    await expect(page).toHaveURL(/#\/claims\/2$/);
    await expect(page.getByRole("region", { name: "Recovered" })).toContainText("+$480.00");
    await page.goto("/#/claims?tab=done");
    await expect(row(page, 2)).toContainText("Recovered");
  });

  await test.step("dismiss a case with a reason", async () => {
    await page.goto("/#/claims");
    const done = await tabCount(page, "Done");
    await row(page, 7).click(); // Lyft Ride
    await sidebar(page).getByRole("button", { name: "Not owed, dismiss" }).click();
    await page.locator("#dismiss-reason").fill("Two separate rides that evening");
    await page.getByRole("button", { name: "Dismiss case" }).click();
    await expect(page.getByRole("region", { name: "Status" })).toContainText("Dismissed");
    await page.goto("/#/claims");
    await expect.poll(() => tabCount(page, "Done")).toBe(done + 1);
  });

  await test.step("price above contract: the comparison leads the evidence", async () => {
    const findings: { id: number; leak_type: string }[] = await (await request.get("/api/findings")).json();
    const price = findings.find((f) => f.leak_type === "price_overcharge");
    expect(price, "the demo data has a price-above-contract case").toBeTruthy();
    await page.goto(`/#/claims/${price!.id}`);
    const comparison = page.getByLabel("Contract price compared with what was charged");
    await expect(comparison).toContainText("Contract price");
    await expect(comparison).toContainText("Over by");
  });

  await test.step("sources page: rows, setup help, sync", async () => {
    await page.goto("/#/sources");
    await expect(nav(page, "Sources")).toHaveAttribute("aria-current", "page");
    const list = page.getByRole("region", { name: "Data sources" });
    await expect(list).toContainText("Ramp transactions");
    await expect(list).toContainText("Gmail vendor email");
    await expect(list).toContainText("no credentials needed");
    await expect(list).toContainText("recoup connect gmail");
    await expect(page.getByRole("button", { name: "Sync now" })).toBeEnabled();
  });

  expect(errors, "console errors").toEqual([]);
});

test("phone layout: top bar, tab bar, list and case", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await page.goto("/#/claims");
  const tabs = page.getByRole("navigation", { name: "Pages" }).last();
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("link", { name: /Claims/ })).toHaveAttribute("aria-current", "page");
  await page.locator("a[data-case-id]").first().click();
  await expect(page).toHaveURL(/#\/claims\/\d+$/);
  await expect(page.getByRole("region", { name: "Next step" })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, "no horizontal scroll").toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Workspace" })).toContainText("Demo controls");
  await page.keyboard.press("Escape");
  await context.close();
});
