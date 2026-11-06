// Read-only review screenshots of v2 pages. Changes nothing in the demo DB.
//   node scripts/v2-shots.mjs <out-dir> [route ...]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "shots";
const routes = process.argv.slice(3).length ? process.argv.slice(3) : ["overview"];
const base = process.env.BASE ?? "http://localhost:5174";
mkdirSync(out, { recursive: true });

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ channel: "chrome" });
}
const errors = [];
const watch = (page, tag) => {
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag} ${e}`));
};
const settle = async (page, ms = 900) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(ms);
};

// SIZES="1024x768,768x1024" overrides the default desktop and phone pair.
const sizes = process.env.SIZES
  ? process.env.SIZES.split(",").map((s) => {
      const [w, h] = s.split("x").map(Number);
      return [w, h, w < 600];
    })
  : [
      [1440, 900, false],
      [390, 844, true],
    ];

for (const [width, height, mobile] of sizes) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  watch(page, String(width));
  for (const route of routes) {
    await page.goto(`${base}/#/${route}`);
    await settle(page);
    const name = `${route.replace(/\W+/g, "-")}-${width}`;
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) errors.push(`${name} scrolls sideways by ${overflow}px`);
    await page.screenshot({ path: `${out}/${name}.png` });
    await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
    console.log(`${out}/${name}.png`);
  }
  await page.close();
}

await browser.close();
if (errors.length) {
  console.log("CONSOLE ERRORS:\n" + errors.join("\n"));
  process.exitCode = 1;
}
