import { expect, test, type Page } from "@playwright/test";

// The scripted demo, start to finish, as the presenter runs it: every step is a real API call.
// It follows docs' demo flow: connect Gmail, scan, urgent, draft, one slide to send, two weeks later,
// refunds, savings, restart. It resets the demo before and after, so run it on a throwaway world
// (`npm run e2e:isolated`) or on a demo nobody is using.

const nav = (page: Page, label: string) => page.getByRole("navigation", { name: "Pages" }).first().getByRole("link", { name: new RegExp(`^${label}`) });
// The presenter types every line; there are no preset replies.
const say = async (page: Page, line: string) => {
  const input = page.getByLabel("Message Recoup");
  await expect(input).toBeEnabled({ timeout: 20_000 });
  await input.fill(line);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({ timeout: 20_000 });
  await input.press("Enter");
};
const log = (page: Page) => page.getByRole("log");

test.beforeAll(async ({ request }) => {
  expect((await request.post("/api/demo/reset")).ok(), "POST /api/demo/reset (the API must run with RECOUP_DEMO_MODE=true)").toBe(true);
});
test.afterAll(async ({ request }) => {
  await request.post("/api/demo/reset");
});

test("the scripted demo: connect, scan, send, two weeks later, saved, restart", async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", (error) => errors.push(String(error)));
  const sends: string[] = [];
  page.on("request", (r) => r.method() === "POST" && /\/api\/drafts\/\d+\/send$/.test(r.url()) && sends.push(r.url()));

  await test.step("clean slate: nothing found, Ramp connected, Gmail not, no preview label", async () => {
    await page.goto("/");
    await expect(nav(page, "Agent")).toHaveAttribute("aria-current", "page");
    await expect(log(page)).toContainText("Ramp is connected. Nothing found yet.");
    const sources = page.getByRole("region", { name: "Sources" });
    await expect(sources).toContainText("Ramp");
    await expect(sources.getByRole("button", { name: "Connect Gmail" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run scan" })).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("Scripted replies");
    await expect(page.getByRole("button", { name: "What is my company owed?" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/\bDemo\b/);
    expect(await (await request.get("/api/findings")).json()).toEqual([]);
  });

  await test.step("before the scan: other pages say nothing is found, and detection refuses to run", async () => {
    await nav(page, "Overview").click();
    await expect(page.getByText("Nothing found yet. Run a scan from the Agent tab")).toBeVisible();
    await nav(page, "Claims").click();
    await expect(page.getByText("Nothing found yet. Run a scan from the Agent tab")).toBeVisible();
    await page.getByRole("button", { name: /^Oct 1/ }).click();
    await page.getByRole("menuitem", { name: "Run detection" }).click();
    await expect(page.locator("[aria-live=polite] li").filter({ hasText: /scan/i })).toBeVisible();
    expect(await (await request.get("/api/findings")).json(), "nothing was detected early").toEqual([]);
    await page.getByRole("link", { name: "Open Agent" }).click();
    await expect(page).toHaveURL(/#\/agent$/);
  });

  await test.step("1. intro, then Recoup connects Gmail through the pop-up", async () => {
    await say(page, "What is my company owed?");
    await expect(log(page)).toContainText("Gmail is not. Connect it?");
    await say(page, "yes");
    const dialog = page.getByRole("dialog", { name: "Connect your Gmail" });
    await expect(dialog).toContainText("finance@acme.com");
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await expect(log(page)).toContainText("Gmail is connected: finance@acme.com");
    await expect(page.getByRole("region", { name: "Sources" }).getByRole("button", { name: "Connect Gmail" })).toHaveCount(0);
  });

  await test.step("2. Run scan: the claims are found and Overview shows them", async () => {
    await page.getByRole("button", { name: "Run scan" }).click();
    await expect(log(page)).toContainText("15 claims found, worth $13,710.09, across 11 vendors", { timeout: 30_000 });
    await expect(page.getByRole("img", { name: /Who owes the most/ })).toBeVisible({ timeout: 15_000 });
    await log(page).getByRole("button", { name: "Open Overview" }).click();
    await expect(page).toHaveURL(/#\/overview$/);
    await expect(page.getByRole("region", { name: "Open claims" })).toContainText("$13,710.09");
    await nav(page, "Agent").click();
    await expect(log(page)).toContainText("15 claims found");
  });

  await test.step("3. urgent, draft, one slide sends all five, then in flight", async () => {
    await say(page, "Which ones are urgent?");
    await expect(log(page)).toContainText("6 claims fall due in the next 30 days, worth $5,383.29", { timeout: 15_000 });
    await expect(page.getByRole("img", { name: /Deadline clock/ })).toBeVisible({ timeout: 15_000 });
    await say(page, "yes");
    const slide = page.getByRole("button", { name: /Slide to send all 5/ });
    await expect(slide).toBeVisible({ timeout: 30_000 });
    await expect(log(page)).toContainText("5 requests are drafted, worth $5,319.09");
    expect(sends, "drafting sends nothing").toHaveLength(0);
    await page.waitForTimeout(600);
    await slide.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("5 requests sent, worth $5,319.09", { timeout: 30_000 });
    expect(sends, "one slide, five sends").toHaveLength(5);
    await log(page).getByRole("button", { name: "See them in flight" }).click();
    await expect(page).toHaveURL(/#\/recovered\?view=inflight$/);
    await expect(page.locator("[data-inflight-id]")).toHaveCount(5);
  });

  await test.step("4. two weeks later, from any page, by the shortcut", async () => {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+Shift+Period");
    await expect(page.getByRole("button", { name: /^Oct 15/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-inflight-id]")).toHaveCount(2);
  });

  await test.step("5. how the requests are doing: three refunded, one agreed, one waiting", async () => {
    await nav(page, "Agent").click();
    await say(page, "How are my requests doing?");
    await expect(log(page)).toContainText("3 of 5 refunded: $4,789.38 is back in Ramp", { timeout: 15_000 });
    await expect(log(page)).toContainText("Amazon Web Services agreed to $385.71");
    await expect(log(page)).toContainText("Figma hasn't replied about $144.00");
    await expect(page.getByRole("img", { name: /Money back: \$4,789\.38/ })).toBeVisible({ timeout: 15_000 });
    await expect(log(page).getByRole("button", { name: "Open Recovered" })).toBeVisible();
  });

  await test.step("6. how much is saved, then straight to Recovered", async () => {
    await say(page, "How much has the company saved now?");
    await expect(log(page)).toContainText("$4,789.38 recovered so far", { timeout: 15_000 });
    await expect(page.getByRole("img", { name: /Saved so far: \$4,789\.38/ })).toBeVisible({ timeout: 15_000 });
    await log(page).getByRole("button", { name: "Open Recovered" }).last().click();
    await expect(page).toHaveURL(/#\/recovered$/);
    await expect(page.locator("[data-recovered-id]")).toHaveCount(3);
    await expect(page.getByRole("region", { name: "Recovered totals" })).toContainText("$4,789.38");
  });

  await test.step("restart: back to the clean slate", async () => {
    await page.getByRole("button", { name: /^Oct 15/ }).click();
    await page.getByRole("menuitem", { name: "Restart demo" }).click();
    await expect(page).toHaveURL(/#\/agent$/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^Oct 1$/ })).toBeVisible({ timeout: 15_000 });
    await expect(log(page)).toContainText("Ramp is connected. Nothing found yet.");
    await expect(log(page)).not.toContainText("requests sent");
    await expect(page.getByRole("region", { name: "Sources" }).getByRole("button", { name: "Connect Gmail" })).toBeVisible();
    expect(await (await request.get("/api/findings")).json()).toEqual([]);
  });

  // The one expected error is the browser logging the refused "Run detection" before the scan (409).
  const refused = errors.filter((text) => /status of 409/.test(text));
  expect(refused, "exactly one refused request, the early Run detection").toHaveLength(1);
  expect(errors.filter((text) => !/status of 409/.test(text)), "console errors").toEqual([]);
});
