# Family Hub — setup

The app itself is done and works right away in "solo" mode (each device has its own local groceries/to-do list, no calendar, no weather, no ticker wall). The steps below turn on the connected features. None of them require touching code — everything is a link, a paste, or a checkbox in the app's own Settings screen.

Do these roughly in order. Budget about 20–30 minutes total, most of it Firebase.

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

Your ticker heatmap already exists in the trading project (`web/wall.html`) and runs its own local server on your Mac at port 5056. The Hub just opens that as a screen — it can't run without your Mac and the trading server being on, since that's where the live price data comes from. That's an inherent tradeoff of reusing it rather than rebuilding a separate live-data pipeline.

1. On your Mac, start the trading app's server as usual (the one that serves `wall.html` on port 5056).
2. Find your Mac's local IP (**System Settings → Wi-Fi → Details** → look for an address like `192.168.1.xx`).
3. In the Hub → **Settings → Markets / Ticker Wall** → enter `http://192.168.1.xx:5056/wall.html` (your actual IP) → Save.
4. The Markets tab now shows it live whenever your Mac + server are on and your other device is on the same Wi-Fi. If not reachable, it shows a clear "offline" message instead of a blank screen.
5. Weekends: the Markets tab is hidden from navigation and rotation automatically (toggle this in Settings if you ever want it back).

---

## 6. Screen rotation, dark/light, night dimming

All in **Settings**:
- **Screen Rotation** — pick which screens cycle and how often (seconds). The play/pause button in the top bar pauses it anytime; any tap on the current screen also quietly pauses rotation for ~20 seconds so it never yanks the screen away while you're checking off groceries.
- **Theme** — Light / Dark / Auto (auto switches to dark 7pm–7am).
- **Dim at night** — visually dims the display between two times you set, tap anywhere to wake it for 5 minutes. This is a software dim, not a hardware brightness change — for true blue-light reduction also turn on iOS **Night Shift** (Settings → Display & Brightness) on each device, once, separately.

---

## 7. Copying settings to another device

Rather than re-typing all of the above on every iPad/iPhone/laptop: on the device you just configured, **Settings → Export Config** copies everything to your clipboard as text. On the next device, paste it into **Settings → Import Config → Apply**. (Firebase family ID has to match anyway for sync to work, so this saves the most typing.)

---

## Phase 1 — 7am Morning Brief

Once you've done steps 2 and 3 above (Firebase + calendar link), send me those two values and I'll set up a daily 7am scheduled task that texts you your family rundown — today's schedule, who needs to be where, and what's still on the shopping list. That's a scheduled task on my end, separate from the dashboard file, so it'll keep running even with every device asleep.

Phase 2 (meal plan, bills due, emails needing replies) is intentionally not built yet, per your notes — just say the word when you're ready for it.
