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
1. **Config.** Copy `config.example.json` and set `baseUrl`, `apiUrl`, `auth` (the login path, the body, and where the token and user are stored in localStorage). Put secrets in environment variables and reference them as `${APP_PASSWORD}`. Never write passwords into files.
2. **Chapters.** One JSON file per video. Step types:
   - `goto` (path or full URL), `wait` (ms), `screenshot` (name)
   - `caption` (`{en, ar}` plus `ms`) and `clearCaption`
   - `click` (string text, or an object with `role`+`name`, `label`, `placeholder`, `text`, `selector`, `nth`)
   - `fill` (target + `value`), `select` (target + `value` or `index`), `check`
   - `scroll` (px), `expectText` (checks text is visible; `required: true` fails the run)
   - `note` (adds a line to the run log)
   Values can use `${ENV}`.
3. **Record.** `node scripts/record.mjs config.json chapter.json` for each chapter. Use the same config for all of them.
4. **Convert.** `DEMO_DIR=<outputDir> python3 scripts/make_clips.py <chapter-name> <clip-name> ...`
5. **Narrate and combine.** Write `plan.json`: `{"speed": 1.25, "voice": "Majed", "out": "guide.mp4", "clips": [{"file": "01-tour.mp4", "say": "text"}, ...]}`. Then run `combine.py`. If it prints `OVERRUN`, shorten that line.
6. **Check.** Look at a frame (`ffmpeg -ss 10 -i file -frames:v 1 frame.png`), check the total size against the limit, and check the audio level (`volumedetect`).

## Size and speed
- CRF 24 for clips and CRF 26 for the combined file keep text readable. Expect about 0.5 MB per 20 s of screen video.
- `speed` 1.25 is fast but readable. Narration has to fit each clip after the speed-up.

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
