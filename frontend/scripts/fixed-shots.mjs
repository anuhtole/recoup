// Read-only review screenshots of the v2 UI on :5174 (no drafts, sends or advances: the demo DB is shared).
//   node scripts/fixed-shots.mjs <out-dir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "shots";
const base = process.env.BASE ?? "http://localhost:5174";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const errors = [];
const posts = [];
const open = async (width, height, tag, phone = false) => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag} ${e}`));
  page.on("request", (r) => r.method() !== "GET" && posts.push(`${tag} ${r.method()} ${r.url()}`));
  return page;
};
const settle = async (page, ms = 700) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(ms);
};
const shot = async (page, name, full = false) => {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log(name);
};

for (const [w, h, tag, phone] of [
  [1440, 900, "1440", false],
  [1024, 768, "1024", false],
  [390, 844, "390", true],
]) {
  const page = await open(w, h, tag, phone);
  for (const [route, name, full] of [
    ["overview", "overview", true],
    ["claims", "claims", true],
    ["claims?tab=closed", "claims-closed", false],
    ["claims/2", "case-figma", true],
    ["claims/20", "case-price", true],
    ["claims/17", "case-aws", true],
    ["claims/6", "case-uber", false],
    ["claims/19", "case-zoom", false],
    ["recovered", "recovered", false],
    ["sources", "sources", true],
  ]) {
    await page.goto(`${base}/#/${route}`);
    await settle(page);
    await shot(page, `${name}-${tag}`, full);
  }
  // ⌘K with "fig".
  await page.goto(`${base}/#/claims`);
  await settle(page);
  if (phone) await page.getByRole("button", { name: "Search" }).click();
  else await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("fig");
  await page.waitForTimeout(300);
  await shot(page, `palette-fig-${tag}`);
  await page.keyboard.press("Escape");
  if (!phone) {
    // Demo menu opened with the mouse: nothing pre-selected.
    await page.getByRole("button", { name: /^Demo/ }).click();
    await page.waitForTimeout(250);
    await shot(page, `demo-menu-${tag}`);
    await page.keyboard.press("Escape");
  } else {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.waitForTimeout(500);
    await shot(page, `phone-menu-${tag}`);
    await page.keyboard.press("Escape");
  }
  await page.close();
}

await browser.close();
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
console.log(posts.length ? `NON-GET REQUESTS:\n${posts.join("\n")}` : "no writes");
