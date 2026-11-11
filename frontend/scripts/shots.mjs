// Screenshots of each screen at desktop and phone width, for design review.
//   node scripts/shots.mjs <out-dir> [route ...]
// Routes look like "overview", "claims", "claims/2", "recovered", "sources". Read-only: it never clicks.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "shots";
const routes = process.argv.slice(3).length ? process.argv.slice(3) : ["overview", "claims", "claims/2", "recovered", "sources"];
const sizes = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];
const full = process.env.FULL === "1";

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const errors = [];
for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
  page.on("console", (m) => m.type() === "error" && errors.push(`${size.name} ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${size.name} ${e}`));
  for (const route of routes) {
    await page.goto(`http://localhost:5174/#/${route}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(900);
    const file = `${out}/${route.replace(/\//g, "-")}-${size.name}.png`;
    await page.screenshot({ path: file, fullPage: full });
    console.log(file);
  }
  await page.close();
}
await browser.close();
if (errors.length) console.log("CONSOLE ERRORS:\n" + errors.join("\n"));
