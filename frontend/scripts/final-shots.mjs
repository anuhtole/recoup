// The redesign's review screenshots, taken along one demo path. Needs a freshly reset demo DB
// (`make reset`) and changes it (drafts, sends, advances two weeks), so reset again afterwards.
//   node scripts/final-shots.mjs <out-dir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "shots";
const base = "http://localhost:5174";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const errors = [];
const watch = (page, tag) => {
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag} ${e}`));
};
const settle = async (page, ms = 900) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(ms);
};
const shot = async (page, name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${out}/${name}.png`);
};

// Phone first, on the untouched Oct 1 data.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
watch(phone, "390");
for (const [route, name] of [
  ["overview", "overview-390"],
  ["claims", "claims-390"],
  ["claims/2", "case-390"],
]) {
  await phone.goto(`${base}/#/${route}`);
  await settle(phone);
  await shot(phone, name);
}
await phone.close();

const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
watch(page, "1440");
// The overview first, so this session's recovery chart has its Oct 1 point.
await page.goto(`${base}/#/overview`);
await settle(page);
await page.goto(`${base}/#/claims`);
await settle(page);
await page.keyboard.press("j");
await page.keyboard.press("j");
await page.waitForTimeout(200);
await shot(page, "claims-1440");
await page.goto(`${base}/#/claims/2`);
await settle(page);
await shot(page, "case-1440");
await page.goto(`${base}/#/sources`);
await settle(page);
await shot(page, "sources-1440");

// Draft and review the Figma request: the approval sheet.
await page.goto(`${base}/#/claims/2`);
await settle(page);
await page.getByRole("complementary", { name: "Case sidebar" }).getByRole("button", { name: "Draft request" }).click();
await page.getByRole("complementary", { name: "Case sidebar" }).getByRole("button", { name: /^Send to/ }).click();
await page.waitForTimeout(900);
await shot(page, "case-sending-1440");
// Keyboard fallback: Enter, then Enter again.
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
await page.getByRole("dialog").waitFor({ state: "detached", timeout: 10_000 });

// A second request through the API, then two weeks pass in the UI.
const draft = await (await fetch(`${base}/api/findings/1/draft`, { method: "POST" })).json();
await fetch(`${base}/api/drafts/${draft.id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
await page.goto(`${base}/#/overview`);
await settle(page);
await page.getByRole("button", { name: "Advance 2 weeks" }).click();
await page.locator("[aria-live=polite] li").filter({ hasText: /credit posted/i }).first().waitFor();
await page.waitForTimeout(1600);
// Clear the notices so the screenshot shows the page, not the toasts over it.
const dismiss = page.getByRole("button", { name: "Dismiss notification" });
while ((await dismiss.count()) > 0) {
  await dismiss.first().click().catch(() => undefined);
  await page.waitForTimeout(250);
}
await page.waitForTimeout(600);
await shot(page, "overview-1440");
await page.goto(`${base}/#/recovered`);
await settle(page, 1200);
await shot(page, "recovered-1440");

await browser.close();
if (errors.length) {
  console.log("CONSOLE ERRORS:\n" + errors.join("\n"));
  process.exitCode = 1;
}
