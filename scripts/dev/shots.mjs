import { chromium, devices } from "@playwright/test";
import fs from "node:fs";
const out = process.argv[2];
const logPath = process.argv[3];
const base = "http://localhost:3000";
fs.mkdirSync(out, { recursive: true });

async function signIn(context) {
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', "demo@example.com");
  const before = fs.readFileSync(logPath, "utf8").length;
  await page.click('button[type="submit"]');
  await page.waitForURL(/check-email/, { timeout: 30000 });
  let link = null;
  for (let i = 0; i < 40 && !link; i++) {
    const log = fs.readFileSync(logPath, "utf8").slice(before);
    const m = log.match(/(http:\/\/localhost:3000\/api\/auth\/callback\/resend\?[^\s]+)/);
    if (m) link = m[1];
    else await new Promise((r) => setTimeout(r, 500));
  }
  if (!link) throw new Error("no magic link in log");
  await page.goto(link);
  await page.waitForLoadState("networkidle");
  await page.close();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const shots = JSON.parse(process.argv[4]);
for (const [name, cfg] of Object.entries({ phone: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } }, desktop: { viewport: { width: 1280, height: 800 } } })) {
  const context = await browser.newContext(cfg);
  await signIn(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  for (const s of shots[name]) {
    await page.goto(`${base}${s.path}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${name}-${s.id}.png`, fullPage: false });
    console.log(`${name} ${s.id} ${page.url()}`);
  }
  if (errors.length) console.log(`${name} errors:\n` + errors.slice(0, 10).join("\n"));
  await context.close();
}
await browser.close();
