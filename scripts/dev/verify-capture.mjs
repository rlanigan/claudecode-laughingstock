// Dev helper: sign in, type into the D1 capture box, screenshot it. Not part of the app.
import { chromium } from "@playwright/test";
import fs from "node:fs";
const base = "http://localhost:3000";
const [logPath, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto(`${base}/login`);
await page.fill('input[name="email"]', "demo@example.com");
const before = fs.readFileSync(logPath, "utf8").length;
await page.click('button[type="submit"]');
await page.waitForURL(/check-email/);
let link = null;
for (let i = 0; i < 40 && !link; i++) {
  const m = fs.readFileSync(logPath, "utf8").slice(before).match(/(http:\/\/localhost:3000\/api\/auth\/callback\/resend\?\S+)/);
  if (m) link = m[1];
  else await new Promise((r) => setTimeout(r, 500));
}
await page.goto(link);
await page.goto(`${base}/inbox`, { waitUntil: "networkidle" });
await page.locator('textarea[aria-label="Note"]').first().fill("Here is a thought\nAnd here is the rest of it.");
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/capture-fix.png`, clip: { x: 220, y: 52, width: 760, height: 220 } });
await browser.close();
