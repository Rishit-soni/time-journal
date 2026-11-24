# Daybook: time journal

A personal time-tracking PWA that shows where each day goes. It helps you find time for new learning and freelancing.
Everything is stored on your phone (IndexedDB). There is no account and no server, and the app works offline.

## What it does

- **One-tap logging.** Tap an activity to start it; whatever was running stops. Hold a button to log time you already spent. Use **+** to fill a gap with a start time and a duration chip.
- **Office out-time.** Check in, and Daybook shows when to leave: check-in + 8h 30m of work + breaks. A 30-minute lunch is planned for you, and any real break you log replaces it or pushes the out-time later.
- **24-hour dial** of the day. Tap any block to edit it. Dashed blocks are untracked time; tap one to log it.
- **Growth goal** (learning + freelance, 2h a day by default), with the free windows left before bedtime.
- **Sleep target.** Log "Going to sleep" and "I'm awake" and Daybook tells you when to sleep tonight. It also tracks sleep debt for the week.
- **Insights.** Day and week reports split time into Productive, Necessary, Leisure, Waste and Untracked, with time per activity and this week vs last week. Time-leak alerts flag things like "Social media up 40%".
- **Routines.** Save a typical day once, then log it in one tap.
- **Journal.** Add a note to any day or entry, and search them all.
- **Backup.** Share or download a JSON backup, restore it by merging or replacing, and export CSVs (entries and a daily summary) for Excel or Sheets.

## Install on Android

1. Open the GitHub Pages link in Chrome.
2. Tap **Install** in the banner, or use Chrome's menu ⋮ → **Add to Home screen / Install app**.
3. Long-press the Daybook icon for shortcuts: Add time, Check in, I'm awake, Going to sleep.

## Hosting (GitHub Pages)

Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**. The site appears at `https://<user>.github.io/time-journal/`.

## Updating the app

Bump `VERSION` in `sw.js` whenever any file changes. Installed copies then show "A new version of Daybook is ready · Update".

## Files

- `index.html`, `styles.css`: the app shell and its look.
- `js/app.js`: screens, sheets and actions.
- `js/engine.js`: the minute-by-minute day model, out-time maths, free windows, sleep and weekly stats, and alerts.
- `js/store.js`, `js/db.js`: state, IndexedDB storage, undo, backup and restore.
- `sw.js`, `manifest.webmanifest`, `icons/`: offline support and install.
- `fonts/manrope.woff2`: Manrope, SIL Open Font License 1.1.

Your data never leaves the phone unless you export it. Back up regularly: if you clear Chrome's site data, the journal is deleted with it.
