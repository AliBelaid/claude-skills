---
name: app-guide-video
description: Make short walkthrough videos of any web app from a JSON description of its screens. Records the real UI with Playwright (logs in through the app's API), converts each chapter to a small MP4, and combines chapters into one narrated video with a voice from macOS `say` (Arabic, English or any installed voice), sped up and kept under a size limit (WhatsApp-friendly). Use when the user asks for a video guide, walkthrough, demo video, or a screen recording of an app for a team, a user guide, or a messaging app.
---

# App guide video

Works for any web app that has a login. The app-specific parts live in two JSON files: a **config** (URLs, login, voice, speed) and one **chapter file per video** (the steps to perform). Nothing app-specific is hard-coded in the scripts.

## Files
- `scripts/record.mjs`: runs one chapter (`node record.mjs <config.json> <chapter.json>`) and writes `rec/<chapter>/*.webm` and screenshots.
- `scripts/make_clips.py`: `DEMO_DIR=<out> python3 make_clips.py <chapter> <name> [...]` converts recordings to MP4.
- `scripts/combine.py`: `DEMO_DIR=<out> python3 combine.py plan.json` builds one narrated video.
- `config.example.json`: template for a new app.
- `examples/trms/`: an example for a specific app (config and a tour chapter). Copy its shape for a new app.

## Requirements
- Node 18+ and Playwright (`playwright-core`). Set `playwrightCore` in the config to the package path if it's not on the module path.
- Google Chrome (set `chromePath`), or Playwright's bundled browser.
- Playwright needs an ffmpeg binary to record video. Link Homebrew's: `ln -sf "$(which ffmpeg)" ~/Library/Caches/ms-playwright/ffmpeg-<rev>/ffmpeg-mac` (the revision is in the error message).
- ffmpeg and ffprobe for conversion.
- macOS `say` for narration. On other systems, replace the `say` call in `combine.py` with another TTS.

## Steps
0. **Study the app before writing a single chapter.** A guide that only opens pages is a tour, not a guide.
   - Read the README / CLAUDE.md / docs index: what the system is for, its roles, its state machines.
   - Read the router (`app.routes.ts`, `*.routes.ts`, `routes.tsx`, `urls.py` …) and the nav menu config:
     list every screen with its path, then mark the ones that **create** something (a `new`/`create`/`:id/edit`
     route, a dialog opened from a list).
   - Write the **business flow** as an ordered chain where each step's output feeds the next, e.g.
     carrier → contract → provider → subscriber → claim → review → approval → settlement → voucher → card.
     Order chapters by that chain; a chapter that needs a record must run after the chapter that creates it.
   - For each create-screen, open its template and note the real labels/`formControlName`s, the select
     type (native `<select>` vs `mat-select` vs autocomplete) and the submit button text. Write selectors
     from that, not from guesses. Note which buttons only appear in certain states.
   - Save this as `flow.md` next to the chapters: it is the script of the video and the narration source.
1. **Config.** Copy `config.example.json` and set `baseUrl`, `apiUrl`, `auth` (the login path, the body, and where the token and user are stored in localStorage). Put secrets in environment variables and reference them as `${APP_PASSWORD}`. Never write passwords into files.
2. **Chapters.** One JSON file per video. Step types:
   - `goto` (path or full URL), `wait` (ms), `screenshot` (name)
   - `caption` (`{en, ar}` plus `ms`) and `clearCaption`
   - `click` (string text, or an object with `role`+`name`, `label`, `placeholder`, `text`, `selector`, `nth`)
   - `fill` (target + `value`), `select` (target + `value`, `index`, or `labelContains` for option text that
     carries live data such as a balance), `check`
   - `scroll` (px; scrolls the page, or the largest scrollable container, or `selector`), `expectText` (checks text is visible; `required: true` fails the run)
   - `note` (adds a line to the run log)
   - `waitFor` (text, or `{selector, state, timeout}`): wait on a condition — prefer it to `wait` after
     every navigation or save, since a fixed sleep races lazy chunks and API calls
   - `type` (target + `value`): keystroke typing, for autocompletes that filter on input events
   - `option` (text): pick an option from an open `mat-select` / `mat-autocomplete` / `[role=option]` list
   - `key` (e.g. `Enter`, `Tab`) and `upload` (file path, optional `selector`)
   - `evaluate` (a JS expression run in the page; its JSON result is logged): `until: true` waits until it is
     truthy, `required: true` fails the run on a falsy result or `ok:false` — for DOM checks such as a video's
     `readyState` or an image's `naturalWidth`
   - Any `click`/`type` step can carry `"dismiss": false` to skip the Escape the recorder sends before
     clicking (needed for a button inside an open MatDialog, which Escape would close), and `"force": true`
     when a floating `mat-label` intercepts the click on an input
   - On a failing step the recorder saves `shots/<chapter>-FAILED-step<N>.png`, keeps the video and exits 1:
     read the screenshot, fix the step, re-run. Never paper over it with a longer sleep.
   Values can use `${ENV}`.
3. **Record.** `node scripts/record.mjs config.json chapter.json` for each chapter. Use the same config for all of them.
4. **Convert.** `DEMO_DIR=<outputDir> python3 scripts/make_clips.py <chapter-name> <clip-name> ...`
5. **Narrate and combine.** Write `plan.json`: `{"speed": 1.25, "voice": "Majed", "out": "guide.mp4", "clips": [{"file": "01-tour.mp4", "say": "text"}, ...]}`. Then run `combine.py`. If it prints `OVERRUN`, shorten that line.
6. **Check.** Look at a frame (`ffmpeg -ss 10 -i file -frames:v 1 frame.png`), check the total size against the limit, and check the audio level (`volumedetect`).

## Full-flow (create) videos
- Use unique, obviously fake names with a run suffix (`Demo Carrier 1105`) so chapters can find what an
  earlier chapter created, and re-runs do not collide with the previous run's records.
- Chapters run in chain order and each one only *depends* on records, never on the previous chapter's page.
- Many chapters across a big app is work for parallel agents (one per flow segment reads its screens and
  drafts the chapter), but **recording is sequential**: one runner records the chain in order and fixes
  selectors from the FAILED screenshots.
- Finish with intro/outro cards built from the client's logo (render an HTML card with Chrome, then
  `ffmpeg -loop 1 -t 6`), so the video carries the brand.

## Size and speed
- CRF 24 for clips and CRF 26 for the combined file keep text readable. Expect about 0.5 MB per 20 s of screen video.
- `speed` 1.25 is fast but readable. Narration has to fit each clip after the speed-up.

## Frame size: record at 1920x1080, 100% zoom
- A desktop web app recorded at 1280x720 looks zoomed in: the sidebar and header take most of the frame and
  only part of each page is visible. Record at **1920x1080** (the default; `record.mjs` refuses < 1600px wide
  unless `"allowSmallViewport": true` for a mobile layout). The browser runs at device scale 1 = 100% zoom,
  and the video is recorded 1:1 at the viewport size — never record small and upscale, never record big and
  shrink to 720p (text becomes unreadable).
- After every `goto` the recorder checks the page fits: horizontal overflow or a zoom other than 100% prints
  `FIT WARNING` in the run log. Treat it as a failure: fix the viewport or the page, then re-record.
- Grey band at the bottom of every frame (page ends ~85px early although `innerHeight` is 1080): headless Chrome
  sizes its screencast to the real display's work area (a 1080p monitor minus menu bar/dock ≈ 993px).
  `record.mjs` launches Chrome with `--window-position=0,0 --window-size=W,H --screen-info={Wx(H+320)}` and
  probes one screencast frame before recording; it exits 2 if the frame would still be shorter than the viewport.
- Make intro/outro cards at the same size as the recordings (render the HTML card at 1920x1080).
  Set `dir="rtl"` on Arabic cards, or a mixed line such as «اربط أنظمتك بحسابات ERP» renders in the wrong order.
  `combine.py` takes its output size from the largest clip (or `"size": [w, h]` in the plan) and fits every
  clip into it without distortion.
- Before shipping, look at one full frame at its real size (`ffmpeg -ss 30 -i out.mp4 -frames:v 1 f.png`) and
  confirm the whole page (sidebar, header, the full table/form) is visible.
- 1080p roughly doubles size: expect ~1 MB per 20 s at CRF 26.

- The fit check runs after every `goto` and after every click that lands on a new URL; warnings print at once.

## Privacy mask: no real customer data in any frame
- A demo/staging database is often a **copy of production**. A guide shown to all users must never display
  real customers, providers, members or business totals. Turn on the mask in the config or per chapter:
  `"privacy": {"keep": ["1107", "Demo"], "redact": [".stat-value", ".kpi-card .amount"]}`
  - every row-like element (`tbody tr`, mat rows, `mat-option`, `[role=option]`, list items; override with
    `rows`) whose text has none of the `keep` tokens is blurred, live, as the page changes;
  - every element matching `redact` is always blurred (dashboard totals, a password/OTP box);
  - a `{"privacy": {...}}` step changes it mid-chapter (e.g. drop `mat-option` from `rows` while picking a
    harmless enum like gender, or add a `redact` before a "password reset" dialog).
- Create demo records with one unique token in every name (suffix) and put that token in `keep`.
- Blur strength scales with text size (≥10px, `0.45em`) and fades the content: a fixed 7px blur left large KPI
  digits guessable. Big number panels (dashboards, list KPI bands) still belong in `redact` explicitly.
- The mask is a guard, not proof: an independent reviewer still inspects frames (every ~2 s) for any readable
  name/number that is not demo data, and passwords. Aggregates (totals, counts, KPI cards) are real data too.

## Secrets on screen
- A chapter that sets or resets a password shows it in the frame (a minted one-time password, a "reset done"
  dialog). Before the video leaves the team, cut that moment or blur the box: find the time with a frame grab,
  then `ffmpeg -vf "boxblur=10:enable='between(t,a,b)'"` on a `crop`/`overlay` of that region.

## Traps learned on a real app
- Log in through the API and seed localStorage before the page loads (`auth` in the config). This avoids UI login steps in every chapter.
- The app's CORS allowlist may only include some dev ports. Use the port the API allows.
- Many apps scroll inside a container, so Playwright's auto-scroll can miss the bottom of a page. The recorder scrolls the element into view before each click.
- Global search overlays can intercept clicks. The recorder presses Escape first (`dismissOverlay`, on by default).
- Put captions at the top of the frame, or they cover bottom buttons.
- Accept native dialogs, or confirmations fail silently (done by default).
- Button text can carry icons or special punctuation. Use `text` with partial matching, or `nth`, rather than an exact name.
- Exact-name matches on `getByRole` can hit a header control first. Use `nth` or `text` scoped to the right container.
- Approval and workflow buttons may only appear in certain states. Check what the screen shows before writing the step.

## Safety
- Record only on a local, staging, or demo copy unless the user explicitly asks for production. Recording creates data.
- Create demo data with clearly fake names and IDs. Keep real personal data out of narration and captions.
- If a step changes a record by mistake, say so and offer to revert it. Don't guess at a revert.
