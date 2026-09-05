# Family Hub — setup

The app itself is done and works right away in "solo" mode (each device has its own local chores list and store-sorted grocery list, no calendar, no weather, no ticker wall). The steps below turn on the connected features. None of them require touching code — everything is a link, a paste, or a checkbox in the app's own Settings screen.

Do these roughly in order. Budget about 20–30 minutes total, most of it Firebase.

**Lost your settings?** (e.g. deleted the app to troubleshoot) — see `SETTINGS-CHEATSHEET.md` in this same folder before redoing all of this. It's not on GitHub on purpose (some of those values are effectively "anyone with this link can see your family's calendar/list data," so it stays local-only) — it lives only in this folder on whichever machine you're working from. Back it up somewhere of your own (Notes, a password manager) so losing that machine doesn't mean redoing Firebase too.

**As of 2026-09-02, the Raspberry Pi (`10.0.0.159`) is the 24/7 primary** for family-hub itself, the trading server, and Mealie. The Mac Studio is cold backup only — most of the IP/path references below now point at the Pi, not the Mac.

---

## 0. Quick tour

- **Home** — a 4-column dashboard, each card a different accent color (never red/green, so it's clear at a glance regardless of color vision): **Monthly** mini-calendar + **Week** view (colored by event category, same coloring as the Calendar tab); three **Groceries** cards, one per store (Wegmans, Indian, Costco); **Weather — Weekly** strip + **Chores — Appointments** + **Chores — Household**; **Markets Watchlist** (live quotes, refresh button, 52-week-high column — see section 5c, still shows something even when the trading server is off thanks to a fallback quote source); and a small **cycling photo frame** below the Watchlist card (add/remove photos in Settings → Home Photos).
- **Lists screen** — two tabs: **Chores** (flat checklist, add at the top) and **Grocery** (four columns — Indian, Wegmans, Trader Joe's, Costco — each with its own add box, so items file straight into the right store).
- **Meds** — editable medication lists, one card per person (Tarun's list is pre-filled; add Ruchi's or anyone else's with "+ Add medication"). Each row has a color dot for time-of-day (Morning/Evening/Morning & evening/Weekly/Every other week — legend at the top), editable Name/Units/TOD (times per day)/Time fields, and a Push checkbox to flag a medication for phone-push reminders later (checked by default on your critical meds — currently Plavix and Aspirin; actual push delivery isn't wired up yet). On iPhone the Push and delete columns are hidden to keep it readable — do the checkbox/delete edits from an iPad or the Mac where there's more room; the fields themselves are always editable everywhere.
- Everything else (Calendar, Weather, Markets, Recipes, Settings) is as described below.

---

## 1. Get it installed on your devices

**Fastest path (recommended): host it online, free, always-on — no Mac required.**

1. Create a free [GitHub](https://github.com) account if you don't have one.
2. Create a new **public** repository, e.g. `family-hub`.
3. Upload these files to it (drag-and-drop on the GitHub web page works fine): `index.html`, `app.js`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`.
4. In the repo, go to **Settings → Pages**, set Source to the `main` branch, root folder. Save.
5. GitHub gives you a URL like `https://yourname.github.io/family-hub/` — that's your hub, live 24/7, no computer of yours has to be on.
6. On the iPad/iPhone, open that URL in Safari → Share → **Add to Home Screen**. Do the same on any other device. Now it's an app icon, opens full-screen, no browser bars.

**Alternative:** keep the files in iCloud Drive and open `index.html` from the Files app in Safari on each device. This works too, but installability (Add to Home Screen) and the offline service worker are unreliable when the page is opened as a local file rather than served over `https://` — GitHub Pages avoids that entirely and it's free.

Either way, the file itself rarely needs to change once it's up — nearly everything on screen (calendar, weather, ticker, your lists, recipes) is pulled live from the services below, not baked into the file. You'll only re-upload if you want to tweak the design or ask me for a feature change.

---

## 2. Turn on cross-device sync (Firebase) — for groceries, to-do, recipes

This is what makes checking something off on the iPad show up on your phone instantly.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**. Name it anything (e.g. `family-hub`). You can skip Google Analytics.
2. Once created, click the **`</>`** (web) icon to register a web app. Name it anything, no need for Firebase Hosting.
3. It shows you a `firebaseConfig` object with `apiKey`, `authDomain`, `projectId`, `appId`, etc. Keep this tab open.
4. In the left sidebar go to **Build → Firestore Database → Create database**. Choose **Start in test mode** (fine for a private family app; the whole thing is only as findable as your project ID, which nobody else has). Pick any region.
5. Back in the Family Hub app → **Settings → Sync across devices** → paste in API Key, Auth Domain, Project ID, App ID from step 3.
6. Family / household ID: type any short word, e.g. `arora-family`. **Use the exact same word on every device** — it's what ties them together in the same Firestore data.
7. Tap **Save Settings**. The status dot should turn green: "Connected — syncing live across devices."
8. Repeat steps 5–7 (same values) on your other devices.

That's it — no server to run, no monthly bill at this scale (Firestore's free tier is generous; a family's grocery list won't come close).

---

## 3. Connect your Family Shared Calendar

Tried the simple route first — Safari can't read a private iCloud calendar directly, so the original plan was publishing a read-only ICS link and fetching it. In testing, Apple's calendar servers turned out to actively block that kind of fetch (direct and via CORS-relay both failed against `p182-caldav.icloud.com`), so that path is now the **fallback**, not the main one. The reliable route uses a Shortcuts Automation, which reads Calendar natively on-device — no CORS, nothing for Apple's CDN to block.

### 3a. Recommended: Shortcuts Automation → Realtime Database

**One-time: turn on Realtime Database** (a second free product in the same Firebase project from step 2 — separate from Firestore, and it's what makes this Shortcut simple to build: plain JSON, no typed-field wrapping):
1. [console.firebase.google.com](https://console.firebase.google.com) → your `family-hub` project → **Build → Realtime Database → Create Database** → start in **test mode** → pick any region.
2. Copy the **databaseURL** shown at the top of that page (looks like `https://family-hub-xxxxx-default-rtdb.firebaseio.com`).
3. In the Hub → **Settings → Family Calendar** → paste it into "Shortcuts feed — Realtime Database URL" → **Save Settings**.

**Build the Shortcut** (Shortcuts app, iPhone/iPad or Mac — it's the same app either way, and it syncs across your devices automatically once made on one):
1. New Shortcut, name it "Push Family Calendar".
2. Add **Find Calendar Events**: set "Start Date" → "is in the next" → `60` → `Days`. Tap it to expand advanced options, set **Calendars** to "Only" and pick your shared Family calendar (not "Any Calendar" — you don't want your personal calendar mixed in unless you want that).
3. Add **Repeat with Each**, using the Find Calendar Events result as the input.
4. Inside the repeat, add a **Dictionary** action with these key/value pairs (use the blue "Repeat Item" variable for each value):
   - `title` → Repeat Item
   - `start` → Repeat Item's Start Date, but first drop in a **Format Date** action set to **ISO 8601** and feed Repeat Item's Start Date through it, then use that formatted result here
   - `end` → same idea with Repeat Item's End Date through another Format Date (ISO 8601)
   - `allDay` → Repeat Item's "All-day" (boolean)
   - `location` → Repeat Item's Location
5. Still inside the repeat, add **Add to Variable** → new variable named `EventList`, add the Dictionary from step 4 to it.
6. After the repeat ends, add another **Dictionary** action: `events` → the `EventList` variable, `updatedAt` → Current Date (Format Date, ISO 8601).
7. Add **Get Contents of URL**:
   - URL: `<your databaseURL>/families/<your family ID>/calendarFeed.json` (same family ID you used in Firebase settings — e.g. `arora-family`)
   - Method: **PUT**
   - Request Body: **JSON**, set to the Dictionary from step 6
8. Run it once manually to test — then check the Hub's Settings screen; the status dot should go green with an event count.
9. Make it automatic: **Automation tab → + → Time of Day** → pick a time, set **Repeat: Hourly** (or whatever cadence you like) → choose **Push Family Calendar** → turn **off** "Ask Before Running" so it runs silently in the background.

If a step doesn't look quite like what's on your screen (Apple tweaks the Shortcuts UI often), tell me where it diverges and I'll help sort it out — I can also drive your Mac's screen directly if that's easier than describing it back and forth.

### 3b. Fallback: public ICS link (less reliable)

1. On iPhone/iPad: **Calendar app → Calendars** → tap the **(i)** next to your shared family calendar.
2. Tap **Public Calendar** → toggle it **on** → **Share Link** → copy it (`webcal://p182-caldav.icloud.com/published/2/…`).
3. Hub → **Settings → Family Calendar** → paste into "Fallback: public ICS / webcal link" → **Save Settings**.
4. This only gets used when the Shortcuts feed above isn't configured or fails — and even then, expect it to fail against Apple's servers more often than not. Keep it as a backstop, not the primary plan.

**Heads up:** "Public" here means anyone with that exact long random link could view the calendar read-only — nobody can guess it, but don't post the link anywhere public.

### Color-coding

Blue travel, green photography, red doctor, orange friends — done by matching keywords in the event title (edit the keyword lists in the same Settings section if something lands in the wrong bucket). Every event also gets a small icon (✈️ 📷 ⚕️ ☕) next to it so the category is never color-only — useful given deuteranopia washes out red/green specifically.

---

## 4. Weather

**Settings → Weather location** → type your city, tap Find, tap the right match. Done — no API key needed, it's pulling from Open-Meteo's free public weather service.

---

## 5. Markets / Ticker Wall (your existing trading app)

There are two different market-data spots in the Hub now, with two different dependencies:

- **Home's "Markets Watchlist" card** — a short list of tickers you pick (Settings → Markets → add tickers), showing last price, change, and 52-week-high. As of 2026-09-02 this pulls primarily from the trading server's own `/quotes/board` endpoint (Public.com for stocks/ETFs, yfinance as the automatic fallback for anything Public can't quote — mainly mutual funds), falling back to a small Cloudflare Worker (`family-hub-quotes.taarora-b77.workers.dev`) only if the trading server itself is unreachable. Has its own refresh button (⟳) on the card, and also auto-refreshes every 60 seconds while Home is on screen. See section 5c below for both sources.
- **The Markets tab** (full ticker heatmap) — this is still the trading project's `web/wall.html`, running its own local server at port 5056. The Hub just opens that as a screen — it can't run without the trading server being on, since that's where the live price data comes from. That's an inherent tradeoff of reusing it rather than rebuilding a separate live-data pipeline.

1. Start the trading app's server — on the RPi, `~/start-trading-server.sh` (sources `~/.secrets/trading.env` with `set -a` so Public.com's API key actually gets exported to the process — a plain `source` without that silently leaves it unset).
2. Find the server's local IP: on the RPi, run `hostname -I` or `ip addr` in a terminal (look for the wired `eth0` address, not `wlan0` — the Pi has both, and everything's configured to use the wired one). On a Mac it'd be System Settings → Wi-Fi → Details instead.
3. In the Hub → **Settings → Markets / Ticker Wall** → enter `http://<that IP>:5056/wall.html` → Save. (Currently `http://taruns-macbook-air.tail1ee8a6.ts.net/wall.html`.)
4. The Markets tab now shows it live whenever the RPi + trading server are on and your other device is on the same Wi-Fi. If not reachable, it shows a clear "offline" message instead of a blank screen.
5. Weekends: the Markets tab is hidden from navigation and rotation automatically (toggle this in Settings if you ever want it back).

**Heads up if the Hub is ever loaded over `https`** (e.g. a GitHub Pages URL): the trading server is plain `http`, and browsers block a secure page from embedding an insecure one ("mixed content") — it's not a reachability issue and retrying won't fix it, so the Markets tab instead shows an **"Open in Safari"** button that hands off to a normal browser tab, where it loads fine. If you ever want it truly embedded in-app instead, the trading server would need to run over `https` too (a self-signed cert trusted on each device) — ask if you want help setting that up.

---

## 5b. Recipes / Mealie (self-hosted recipe manager)

**Installed 2026-08-30, migrated from the Mac to the RPi on 2026-09-02** — Mealie (https://github.com/mealie-recipes/mealie) is a free, self-hosted recipe manager/meal planner with URL import, meal planning, and shopping lists, now running on the RPi. Same tradeoff as Markets above: the Recipes tab can only reach it while the RPi + Mealie are on and the device is on the same Wi-Fi. Steps below are for reference / setting it up again elsewhere.

1. Install Docker. On the RPi (Debian-based, no GUI): `curl -fsSL https://get.docker.com | sudo sh` then `sudo usermod -aG docker <your-user>` (log out/in, or use `sg docker -c "..."`, for the group change to take effect without a reboot). On a Mac it'd be Docker Desktop instead.
2. The compose file lives at `~/Documents/Claude/Code/repos/mealie/docker-compose.yml` (a sibling folder to this repo — not part of family-hub itself, so it never gets committed/pushed here):
   ```yaml
   services:
     mealie:
       image: ghcr.io/mealie-recipes/mealie:v3.24.0
       container_name: mealie
       restart: always
       ports:
         - "9925:9000"
       deploy:
         resources:
           limits:
             memory: 1000M
       volumes:
         - mealie-data:/app/data/
       environment:
         ALLOW_SIGNUP: "false"
         PUID: 1000
         PGID: 1000
         TZ: America/New_York

   volumes:
     mealie-data:
   ```
3. From that folder, run `docker compose up -d`. Visit `http://localhost:9925` to finish the one-time account setup (or restore a backup from an existing instance — see the migration note below).
4. Find the server's local IP the same way as the trading server above (`hostname -I` / `ip addr` on the RPi, wired `eth0` address).
5. In the Hub → **Settings → Recipes / Mealie** → enter `http://<that IP>:9925` → Save. (Currently `https://taruns-macbook-air.tail1ee8a6.ts.net:8445`.)
6. **Not embedded in the Recipes tab.** Mealie needs a login, and a cross-origin iframe's session cookie gets blocked by Chrome as "third-party" even when the iframe's own origin matches Mealie's — the login form would post successfully but the session would never stick, so the tab instead shows an **Open Mealie ↗** button that opens it in its own tab, where login works normally. This is unrelated to the mixed-content issue Markets has (it happens over plain `http` too) — it's specifically about third-party cookies in an iframe. Your existing "Quick Notes" recipe cards on the Recipes tab are untouched either way — that's the Hub's own separate, always-available list, not replaced by Mealie.

**Migrating an existing Mealie instance to a new machine**: Mealie's admin API has everything needed and it's fully scriptable — no need to touch either machine's filesystem directly. From the old instance, log in → your user's **API Tokens** → create one. Then: `POST /api/admin/backups` (creates a backup server-side) → `GET /api/admin/backups/{file_name}` (returns a short-lived `fileToken`) → `GET /api/utils/download?token=<fileToken>` (the actual zip bytes — the backups endpoint itself only ever returns that token, not the file). On the new instance, get a session token via `POST /api/auth/token` (its default first-run login if fresh — Mealie shows `changeme@example.com` / `MyPassword` right on its own login page until you log in and change it), then `POST /api/admin/backups/upload` (multipart, field name `archive`) followed by `POST /api/admin/backups/{file_name}/restore`. A full restore replaces the entire database, so the real account/password from the old instance comes through intact and the temporary `changeme` account disappears. Revoke the API token afterward (`DELETE /api/users/api-tokens/{id}`) since it's long-lived by default.

**Later, if you want recipes to work away from home Wi-Fi too**: this would mean exposing Mealie through a tunnel (e.g. Cloudflare Tunnel, same account as the Markets quotes Worker) and building a small proxy so the Hub can pull recipe data directly and render native cards instead of embedding Mealie's UI. Bigger lift — ask if/when you want to go there.

---

## 5c. Markets Watchlist quotes — trading server (primary) + Cloudflare Worker (fallback)

**Primary, as of 2026-09-02:** the trading server's own `/quotes/board?symbols=...` endpoint (hardcoded in `app.js` as `QUOTES_TRADING_SERVER`), same host as the Markets tab's `wall.html` in section 5. It's backed by `market_data.quote_board()` in the trading project: Public.com is the quote source for stocks/ETFs (real broker bid/ask/last, no key needed beyond the account already configured there), and yfinance is the automatic fallback for anything Public can't quote — mainly mutual funds (5-letter tickers ending in X, like VTSAX), since Public's brokerage has no mutual fund coverage at all. Also backfills 52-week-high via yfinance, since Public's quote response doesn't carry that field.

**Fallback**, used only if the trading server itself is unreachable: a small Cloudflare Worker, `family-hub-quotes.taarora-b77.workers.dev` (hardcoded as `QUOTES_FALLBACK_URL`; Cloudflare account: `Taarora@yahoo.com's Account`), which proxies Yahoo Finance's chart endpoint. This is separate from — and doesn't need — the RPi or the trading server, so it's what keeps the Watchlist card alive if the trading server is ever down.

You won't normally need to touch the Worker; it's here for reference if it ever needs updating (e.g. Yahoo changes its response format and the fallback stops working):

1. Go to the Cloudflare dashboard → **Workers & Pages** → `family-hub-quotes`.
2. Open the code editor (paste new code directly into the Monaco editor there — it can't be typed in via browser automation, has to be pasted by hand).
3. Click **Deploy**. If the Deploy button is greyed out, that means it sees no unsaved changes (i.e., it's already deployed) — not that something failed.
4. Test it by visiting `https://family-hub-quotes.taarora-b77.workers.dev/?symbols=AAPL` directly in a browser tab — a bare visit with no `?symbols=` param correctly returns `{"quotes":{}}`, that's expected, not an error.
5. CORS is locked to `https://taarora.github.io` only, so the Worker won't respond usefully from anywhere else.

## 6. Screen rotation, dark/light, night dimming

All in **Settings**:
- **Screen Rotation** — pick which screens cycle and how often (seconds). The play/pause button in the top bar pauses it anytime; any tap on the current screen also quietly pauses rotation for ~20 seconds so it never yanks the screen away while you're checking off groceries.
- **Theme** — Light / Dark / Auto (auto switches to dark 7pm–7am).
- **Dim at night** — visually dims the display between two times you set, tap anywhere to wake it for 5 minutes. This is a software dim, not a hardware brightness change — for true blue-light reduction also turn on iOS **Night Shift** (Settings → Display & Brightness) on each device, once, separately.

---

## 7. Copying settings to another device

Rather than re-typing all of the above on every iPad/iPhone/laptop: on the device you just configured, **Settings → Export Config** copies everything to your clipboard as text. On the next device, paste it into **Settings → Import Config → Apply**. (Firebase family ID has to match anyway for sync to work, so this saves the most typing.)

**Optional, on the Mac only:** Export Config also triggers a file download named `family-hub-config.json` (same filename every time, so repeat exports overwrite it rather than piling up like Backup Data's timestamped snapshots). If you point your Mac browser's default downloads folder at `~/Documents/Claude/Code/repos/family-hub/config/` (Safari: Settings → General → File download location; Chrome: Settings → Downloads), every export from the Mac lands there automatically as a real file you can glance at or hand to me — it's git-ignored, so it never gets pushed. This doesn't work across devices by itself, though — a browser can't reach into another device's folders. From the iPad/iPhone the same download just lands in Files/iCloud on that device; getting it onto the Mac still needs AirDrop, or you can skip the file entirely and just paste the clipboard text into Import Config on the other device.

---

## Phase 1 — 7am Morning Brief

Once you've done steps 2 and 3 above (Firebase + calendar link), send me those two values and I'll set up a daily 7am scheduled task that texts you your family rundown — today's schedule, who needs to be where, and what's still on the shopping list. That's a scheduled task on my end, separate from the dashboard file, so it'll keep running even with every device asleep.

Phase 2 (meal plan, bills due, emails needing replies) is intentionally not built yet, per your notes — just say the word when you're ready for it.
