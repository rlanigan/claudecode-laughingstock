import { chromium } from "@playwright/test";
import fs from "node:fs";
const [logPath, boardId, out] = process.argv.slice(2);
const base = "http://localhost:3000";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto(`${base}/login`);
await page.fill('input[name="email"]', "demo@example.com");
const before = fs.readFileSync(logPath, "utf8").length;
await page.click('button[type="submit"]');
await page.waitForURL(/check-email/, { timeout: 30000 });
let link = null;
for (let i = 0; i < 40 && !link; i++) { const m = fs.readFileSync(logPath, "utf8").slice(before).match(/(http:\/\/localhost:3000\/api\/auth\/callback\/resend\?[^\s]+)/); if (m) link = m[1]; else await new Promise((r) => setTimeout(r, 500)); }
await page.goto(link); await page.waitForLoadState("networkidle");
const reqs = [];
page.on("request", (r) => { if (r.url().includes("/api/")) reqs.push(`${r.method()} ${r.url().replace(base, "")}`); });
page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text().slice(0, 200)); });
await page.goto(`${base}/boards/${boardId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const vp = async () => page.$eval(".react-flow__viewport", (el) => el.style.transform);
console.log("viewport before", await vp());
reqs.length = 0;
const cards = await page.$$(".react-flow__node-card");
console.log("cards", cards.length);
const box = await cards[0].boundingBox();
const sx = box.x + box.width / 2, sy = box.y + box.height / 2;
await page.mouse.move(sx, sy);
await page.mouse.down();
const frames = [];
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(sx + i * 10, sy + i * 6);
  if (i % 5 === 0) { frames.push(await vp()); await page.screenshot({ path: `${out}/drag-${i}.png` }); }
}
console.log("viewport during", frames);
console.log("requests during drag", reqs.length, reqs.slice(0, 5));
reqs.length = 0;
await page.mouse.up();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/drag-after.png` });
console.log("viewport after", await vp());
console.log("requests after drop", reqs.length); for (const r of reqs) console.log("  ", r);
const box2 = await (await page.$$(".react-flow__node-card"))[0].boundingBox();
console.log("card moved", Math.round(box2.x - box.x), Math.round(box2.y - box.y));
await browser.close();
