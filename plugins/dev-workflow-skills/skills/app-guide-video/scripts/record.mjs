// Records one chapter of an app walkthrough as a video, driven by a JSON chapter file.
// usage: node record.mjs <config.json> <chapter.json>
// Secrets never live in the config: values like ${APP_PASSWORD} are read from the environment.
import { readFileSync, mkdirSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
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

const pw = process.env.PLAYWRIGHT_CORE || cfg.playwrightCore || 'playwright-core';
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

// Full-HD by default: a desktop web app laid out for 1920px looks zoomed-in and cropped at 1280x720
// (sidebar + header eat the frame and only part of each page shows). The video is recorded 1:1 at this size.
const vp = cfg.viewport || { width: 1920, height: 1080 };
if (vp.width < 1600 && !cfg.allowSmallViewport) {
  console.error(`viewport ${vp.width}x${vp.height} is too small for a desktop web app (pages look zoomed and cropped).`
    + ' Use 1920x1080, or set "allowSmallViewport": true for a deliberately small/mobile layout.');
  process.exit(2);
}
// Headless Chrome sizes its compositor (and so the screencast) to the real display's work area: on a 1080p
// monitor minus the menu bar/dock that is ~993px, and the video ends early with a grey band at the bottom even
// though innerHeight reports 1080. Give headless Chrome a virtual screen taller than the viewport.
const browser = await chromium.launch({
  executablePath: cfg.chromePath || undefined, headless: cfg.headless !== false,
  args: ['--force-device-scale-factor=1', '--window-position=0,0', `--window-size=${vp.width},${vp.height}`,
         `--screen-info={${vp.width}x${vp.height + 320}}`],
});
// Fail fast if Chrome would still capture a shorter frame than the viewport (probe in a throwaway context, so the
// recorded context's own screencast is untouched).
{
  const pc = await browser.newContext({ viewport: vp }); const pp = await pc.newPage();
  await pp.setContent('<body style="margin:0;height:100vh;background:#fff"></body>');
  const cdp = await pc.newCDPSession(pp);
  const frameH = await new Promise((done) => {
    cdp.on('Page.screencastFrame', (f) => done(f.metadata.deviceHeight));
    cdp.send('Page.startScreencast', { format: 'jpeg', quality: 10 }).catch(() => done(null));
    pp.evaluate(() => { document.body.style.background = '#eee'; }).catch(() => {});
    setTimeout(() => done(null), 4000);
  });
  await pc.close();
  if (frameH && Math.round(frameH) < vp.height) {
    console.error(`video frame would be ${vp.width}x${Math.round(frameH)}, not ${vp.height} high (grey band at the bottom):`
      + ' Chrome is clamping to the display work area. Check the --screen-info launch argument.');
    await browser.close(); process.exit(2);
  }
}
const ctx = await browser.newContext({
  viewport: vp, locale: cfg.locale || 'en-US',
  recordVideo: { dir: recDir, size: vp },
});
await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
// ---- privacy mask: blur every row/option that is not demo data, and any element listed in `redact` ----
// A demo database is often a copy of production. A guide must never show real customers, so every
// "row-like" element whose text lacks one of the `keep` tokens is blurred, live, as the page changes.
// cfg.privacy = { keep: ["1107", "Demo"], rows: "<css>", redact: ["<css>", ...] } ; a chapter may override it,
// and a { "privacy": {...} } step changes it mid-chapter (re-applied after every goto).
const DEFAULT_ROWS = 'tbody tr, tr.mat-mdc-row, mat-row, .mat-mdc-row, mat-option, .mat-mdc-option, [role=option], mat-list-item, .mat-mdc-list-item';
let privacy = ch.privacy !== undefined ? ch.privacy : (cfg.privacy || null);
if (privacy && privacy.keep && !privacy.rows) privacy = { ...privacy, rows: DEFAULT_ROWS };
await ctx.addInitScript((initial) => {
  window.__gm = initial;
  const apply = () => {
    const m = window.__gm;
    if (!document.head) return;
    if (!document.getElementById('gm-style')) {
      const st = document.createElement('style'); st.id = 'gm-style';
      st.textContent = '[data-gm-blur]{filter:blur(7px)!important;}';
      document.head.appendChild(st);
    }
    const marked = new Set();
    if (m && m.keep && m.keep.length && m.rows) {
      for (const el of document.querySelectorAll(m.rows)) {
        if (el.closest('#guide-cap') || el.querySelector('th')) continue;
        const t = el.textContent || '';
        if (!t.trim()) continue;
        if (!m.keep.some((k) => t.includes(k))) marked.add(el);
      }
    }
    if (m && m.redact && m.redact.length) for (const el of document.querySelectorAll(m.redact.join(','))) marked.add(el);
    for (const el of document.querySelectorAll('[data-gm-blur]')) if (!marked.has(el)) el.removeAttribute('data-gm-blur');
    for (const el of marked) if (!el.hasAttribute('data-gm-blur')) el.setAttribute('data-gm-blur', '');
  };
  window.__gmApply = apply;
  const start = () => {
    new MutationObserver(() => { cancelAnimationFrame(window.__gmr); window.__gmr = requestAnimationFrame(apply); })
      .observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    setInterval(apply, 300);
    apply();
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
}, privacy);
const setPrivacy = async () => { await page.evaluate((m) => { window.__gm = m; window.__gmApply && window.__gmApply(); }, privacy).catch(() => {}); };
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
  if (cfg.dismissOverlay !== false && step.dismiss !== false) { await page.keyboard.press('Escape').catch(() => {}); await sleep(150); }
  await loc.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'nearest' })).catch(() => {});
  await sleep(300);
  await loc.click({ timeout: step.timeout || 10000, force: !!step.force });
}

const log = [];
// printed at once AND kept for the summary, so a killed run still shows them
const warn = (m) => { console.log(m); log.push(m); };
// Warn when a page does not fit the frame: horizontal overflow or a browser zoom other than 100%.
const fitSeen = new Set();
async function fitCheck(where) {
  const key = page.url().split('?')[0];
  if (fitSeen.has(key)) return; fitSeen.add(key);
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, iw: window.innerWidth,
    dpr: window.devicePixelRatio, zoom: getComputedStyle(document.documentElement).zoom || '1',
  })).catch(() => null);
  if (!m) return;
  if (m.sw > m.iw + 8) warn(`FIT WARNING ${where}: page is ${m.sw}px wide in a ${m.iw}px frame (cropped)`);
  if (m.dpr !== 1 || (m.zoom !== '1' && m.zoom !== 'normal')) warn(`FIT WARNING ${where}: zoom ${m.zoom}, dpr ${m.dpr} (expected 100%)`);
}
const captured = existsSync(join(outDir, 'captured.json')) ? JSON.parse(readFileSync(join(outDir, 'captured.json'), 'utf8')) : {};
let failed = null, stepNo = 0;
try {
for (const raw of ch.steps) {
  stepNo++;
  const step = expandDeep(raw);
  if (step.goto !== undefined) {
    const url = step.goto.startsWith('http') ? step.goto : baseUrl + step.goto;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(step.wait ?? cfg.pageSettleMs ?? 2500);
    await setPrivacy();
    await fitCheck(step.goto);
  } else if (step.caption !== undefined) {
    const { en, ar, ms } = typeof step.caption === 'string' ? { en: step.caption, ms: step.ms } : step.caption;
    await page.evaluate(([e, a]) => {
      // inline copy of CAPTION_JS (functions cannot be passed to evaluate directly here)
      let el = document.getElementById('guide-cap');
      if (!el) {
        el = document.createElement('div'); el.id = 'guide-cap';
        el.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:99999;background:rgba(15,23,42,.88);color:#fff;padding:10px 20px;border-radius:12px;font:600 22px system-ui,sans-serif;text-align:center;pointer-events:none;max-width:90%;box-shadow:0 6px 24px rgba(0,0,0,.3)';
        document.body.appendChild(el);
      }
      el.innerHTML = `<div>${e || ''}</div>` + (a ? `<div dir="rtl" style="font-size:20px;opacity:.9;margin-top:4px">${a}</div>` : '');
    }, [en || '', ar || '']);
    await sleep(ms ?? cfg.captionMs ?? 2500);
  } else if (step.clearCaption) {
    await page.evaluate(() => document.getElementById('guide-cap')?.remove());
  } else if (step.click !== undefined) {
    await press(await target({ ...step, ...(typeof step.click === 'object' ? step.click : { text: step.click }) }), step);
    await sleep(step.wait ?? 1200);
    await fitCheck(page.url());
  } else if (step.fill !== undefined) {
    const loc = await target({ ...step, ...(typeof step.fill === 'object' ? step.fill : {}) });
    await loc.fill(String(step.value));
  } else if (step.select !== undefined) {
    const loc = await target({ ...step, ...(typeof step.select === 'object' ? step.select : {}) });
    if (step.labelContains !== undefined) {
      // native <select> whose option text carries live data (e.g. "Annual leave — 30/30"): pick by partial text
      const texts = await loc.locator('option').allTextContents();
      const i = texts.findIndex((t) => t.includes(step.labelContains));
      if (i < 0) throw new Error(`no option containing "${step.labelContains}" (have: ${texts.join(' | ').slice(0, 200)})`);
      await loc.selectOption({ index: i });
    } else if (step.index !== undefined) await loc.selectOption({ index: step.index }); else await loc.selectOption(String(step.value));
  } else if (step.check !== undefined) {
    await (await target({ ...step, ...(typeof step.check === 'object' ? step.check : {}) })).check();
  } else if (step.expectText !== undefined) {
    const ok = await page.getByText(step.expectText).first().isVisible().catch(() => false);
    log.push(`expectText "${step.expectText}": ${ok ? 'found' : 'NOT FOUND'}`);
    if (!ok && step.required) throw new Error(`required text not found: ${step.expectText}`);
  } else if (step.capture !== undefined) {
    // Save the first group of step.pattern found in the current URL, e.g. {"capture":"BATCH_ID","pattern":"batches/(\\d+)"}.
    // Later chapters read it as ${BATCH_ID} in their steps, and the runner passes it on as an environment variable.
    const m = page.url().match(new RegExp(step.pattern));
    if (!m) throw new Error(`capture ${step.capture}: pattern ${step.pattern} not in ${page.url()}`);
    captured[step.capture] = m[1];
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'captured.json'), JSON.stringify(captured, null, 2));
    log.push(`captured ${step.capture}=${m[1]}`);
  } else if (step.waitFor !== undefined) {
    // wait on a condition, never a fixed sleep: visible text, or a selector
    const w = typeof step.waitFor === 'string' ? { text: step.waitFor } : step.waitFor;
    const loc = w.selector ? page.locator(w.selector).first() : page.getByText(w.text).first();
    await loc.waitFor({ state: w.state || 'visible', timeout: w.timeout || 20000 });
    await sleep(step.after ?? 500);
  } else if (step.type !== undefined) {
    // keystroke-by-keystroke typing, for autocompletes that react to input events
    const loc = await target({ ...step, ...(typeof step.type === 'object' ? step.type : {}) });
    await press(loc, step);
    await loc.pressSequentially(String(step.value), { delay: step.delay ?? 60 });
    await sleep(step.wait ?? 1200);
  } else if (step.key !== undefined) {
    await page.keyboard.press(step.key);
    await sleep(step.wait ?? 500);
  } else if (step.option !== undefined) {
    // pick an option in an open mat-select / mat-autocomplete / native-like overlay
    const loc = page.locator('mat-option,[role=option]').filter({ hasText: step.option });
    await (step.nth !== undefined ? loc.nth(step.nth) : loc.first()).click({ timeout: step.timeout || 10000 });
    await sleep(step.wait ?? 800);
  } else if (step.upload !== undefined) {
    await page.locator(step.selector || 'input[type=file]').first().setInputFiles(step.upload);
    await sleep(step.wait ?? 1500);
  } else if (step.wait !== undefined) {
    await sleep(step.wait);
  } else if (step.screenshot !== undefined) {
    await page.screenshot({ path: join(shotDir, `${ch.name}-${step.screenshot}.png`) });
  } else if (step.scroll !== undefined) {
    // Many apps scroll inside a container, not the window: scroll the page if it can, else the largest
    // scrollable element (or step.selector). Smooth, so the viewer can follow.
    const moved = await page.evaluate(([y, sel]) => {
      const canScroll = (el) => el && el.scrollHeight > el.clientHeight + 4
        && /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY);
      let el = sel ? document.querySelector(sel) : null;
      const root = document.scrollingElement;
      if (!el && root && root.scrollHeight > window.innerHeight + 4) el = root;
      if (!el) {
        let best = null, area = 0;
        for (const e of document.querySelectorAll('*')) {
          if (!canScroll(e)) continue;
          const r = e.getBoundingClientRect(), a = r.width * r.height;
          if (a > area) { area = a; best = e; }
        }
        el = best;
      }
      if (!el) return false;
      const before = el.scrollTop;
      el.scrollBy({ top: y, behavior: 'smooth' });
      return { before, tag: el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '') };
    }, [step.scroll, step.selector || null]);
    if (!moved) log.push(`scroll ${step.scroll}: nothing scrollable on this page`);
    await sleep(step.wait ?? 1200);
  } else if (step.privacy !== undefined) {
    privacy = step.privacy && step.privacy.keep && !step.privacy.rows ? { ...step.privacy, rows: DEFAULT_ROWS } : step.privacy;
    await setPrivacy();
    await sleep(300);
  } else if (step.note !== undefined) {
    log.push(step.note);
  } else {
    throw new Error(`unknown step: ${JSON.stringify(raw)}`);
  }
}

} catch (e) {
  // keep the evidence: a screenshot of the failing state + the video up to here
  failed = `step ${stepNo} failed: ${e.message.split('\n')[0]}`;
  await page.screenshot({ path: join(shotDir, `${ch.name}-FAILED-step${stepNo}.png`) }).catch(() => {});
}
const bounded = (p, ms) => Promise.race([p, sleep(ms)]);
await bounded(ctx.close(), 30000); await bounded(browser.close(), 15000);
const video = readdirSync(recDir).filter((f) => f.endsWith('.webm')).map((f) => join(recDir, f))
  .sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)[0]; // newest: re-runs keep older takes in the folder
console.log(`chapter "${ch.name}" recorded at ${vp.width}x${vp.height}: ${video}`);
for (const l of log) console.log(l);
if (failed) { console.error('FAILED', failed, '— see shots/' + ch.name + '-FAILED-step' + stepNo + '.png'); process.exit(1); }
process.exit(0); // do not linger on open handles (seen: node idle after Chrome exited)
