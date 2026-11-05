// Records one chapter of an app walkthrough as a video, driven by a JSON chapter file.
// usage: node record.mjs <config.json> <chapter.json>
// Secrets never live in the config: values like ${APP_PASSWORD} are read from the environment.
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const [cfgPath, chPath] = process.argv.slice(2);
if (!cfgPath || !chPath) { console.error('usage: node record.mjs <config.json> <chapter.json>'); process.exit(2); }

const expand = (s) => s.replace(/\$\{(\w+)\}/g, (_, k) => {
  if (process.env[k] === undefined) throw new Error(`environment variable ${k} is not set`);
  return process.env[k];
});
const expandDeep = (v) => typeof v === 'string' ? expand(v)
  : Array.isArray(v) ? v.map(expandDeep)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandDeep(x)]))
  : v;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const ch = JSON.parse(readFileSync(chPath, 'utf8'));
const baseUrl = cfg.baseUrl.replace(/\/$/, '');
const outDir = resolve((cfg.outputDir || './guide-output').replace(/^~/, homedir()));
const recDir = join(outDir, 'rec', ch.name);
const shotDir = join(outDir, 'shots');
mkdirSync(recDir, { recursive: true }); mkdirSync(shotDir, { recursive: true });

const pw = cfg.playwrightCore || 'playwright-core';
const mod = await import(pw.startsWith('/') ? pathToFileURL(pw).href : pw);
const chromium = mod.chromium ?? mod.default.chromium;

// ---- login through the API, seeding localStorage before any page script runs ----
let storage = {};
if (cfg.auth) {
  const body = expandDeep(cfg.auth.body);
  const res = await fetch(cfg.apiUrl.replace(/\/$/, '') + cfg.auth.path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  const json = await res.json();
  for (const [key, field] of Object.entries(cfg.auth.storage || {})) {
    const v = field === '$response' ? json : getPath(json, field);
    storage[key] = typeof v === 'string' ? v : JSON.stringify(v);
  }
}

const browser = await chromium.launch({
  executablePath: cfg.chromePath || undefined, headless: cfg.headless !== false, args: ['--force-device-scale-factor=1'],
});
const vp = cfg.viewport || { width: 1280, height: 720 };
const ctx = await browser.newContext({
  viewport: vp, locale: cfg.locale || 'en-US',
  recordVideo: { dir: recDir, size: vp },
});
await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());

async function target(step) {
  let loc;
  if (step.role) loc = page.getByRole(step.role, { name: step.name, exact: !!step.exact });
  else if (step.label) loc = page.getByLabel(step.label, { exact: !!step.exact });
  else if (step.placeholder) loc = page.getByPlaceholder(step.placeholder);
  else if (step.text) loc = page.locator('button,a,[role=button],[role=menuitem],[role=tab],label').filter({ hasText: step.text });
  else if (step.selector) loc = page.locator(step.selector);
  else throw new Error('step needs role/label/placeholder/text/selector');
  return step.nth !== undefined ? loc.nth(step.nth) : loc.first();
}

// Scroll the element into view inside nested scrollers, then click. Clears any open overlay first.
async function press(loc, step) {
  if (cfg.dismissOverlay !== false) { await page.keyboard.press('Escape').catch(() => {}); await sleep(150); }
  await loc.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'nearest' })).catch(() => {});
  await sleep(300);
  await loc.click({ timeout: step.timeout || 10000, force: !!step.force });
}

const log = [];
for (const raw of ch.steps) {
  const step = expandDeep(raw);
  if (step.goto !== undefined) {
    const url = step.goto.startsWith('http') ? step.goto : baseUrl + step.goto;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(step.wait ?? cfg.pageSettleMs ?? 2500);
  } else if (step.caption !== undefined) {
    const { en, ar, ms } = typeof step.caption === 'string' ? { en: step.caption, ms: step.ms } : step.caption;
    await page.evaluate(([e, a]) => {
      // inline copy of CAPTION_JS (functions cannot be passed to evaluate directly here)
      let el = document.getElementById('guide-cap');
      if (!el) {
        el = document.createElement('div'); el.id = 'guide-cap';
        el.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:99999;background:rgba(15,23,42,.88);color:#fff;padding:10px 20px;border-radius:12px;font:600 17px system-ui,sans-serif;text-align:center;pointer-events:none;max-width:90%;box-shadow:0 6px 24px rgba(0,0,0,.3)';
        document.body.appendChild(el);
      }
      el.innerHTML = `<div>${e || ''}</div>` + (a ? `<div dir="rtl" style="font-size:15px;opacity:.9;margin-top:3px">${a}</div>` : '');
    }, [en || '', ar || '']);
    await sleep(ms ?? cfg.captionMs ?? 2500);
  } else if (step.clearCaption) {
    await page.evaluate(() => document.getElementById('guide-cap')?.remove());
  } else if (step.click !== undefined) {
    await press(await target({ ...step, ...(typeof step.click === 'object' ? step.click : { text: step.click }) }), step);
    await sleep(step.wait ?? 1200);
  } else if (step.fill !== undefined) {
    const loc = await target({ ...step, ...(typeof step.fill === 'object' ? step.fill : {}) });
    await loc.fill(String(step.value));
  } else if (step.select !== undefined) {
    const loc = await target({ ...step, ...(typeof step.select === 'object' ? step.select : {}) });
    if (step.index !== undefined) await loc.selectOption({ index: step.index }); else await loc.selectOption(String(step.value));
  } else if (step.check !== undefined) {
    await (await target({ ...step, ...(typeof step.check === 'object' ? step.check : {}) })).check();
  } else if (step.expectText !== undefined) {
    const ok = await page.getByText(step.expectText).first().isVisible().catch(() => false);
    log.push(`expectText "${step.expectText}": ${ok ? 'found' : 'NOT FOUND'}`);
    if (!ok && step.required) throw new Error(`required text not found: ${step.expectText}`);
  } else if (step.wait !== undefined) {
    await sleep(step.wait);
  } else if (step.screenshot !== undefined) {
    await page.screenshot({ path: join(shotDir, `${ch.name}-${step.screenshot}.png`) });
  } else if (step.scroll !== undefined) {
    await page.evaluate((y) => window.scrollBy(0, y), step.scroll);
    await sleep(900);
  } else if (step.note !== undefined) {
    log.push(step.note);
  } else {
    throw new Error(`unknown step: ${JSON.stringify(raw)}`);
  }
}

await ctx.close(); await browser.close();
const video = readdirSync(recDir).filter((f) => f.endsWith('.webm')).map((f) => join(recDir, f))[0];
console.log(`chapter "${ch.name}" recorded: ${video}`);
for (const l of log) console.log(l);
