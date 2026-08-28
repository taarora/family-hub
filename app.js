/* ============================================================================
   FAMILY HUB — app.js
   All logic for the single-file kitchen dashboard. Sections:
     1. Config / settings persistence (per-device, localStorage)
     2. Clock, theme, night-dim
     3. Navigation + screen rotation engine
     4. Data layer (Firestore when configured, else localStorage) for
        groceries/to-do items and recipes
     5. Calendar: ICS fetch + parse + light RRULE expansion + categorising
     6. Weather: Open-Meteo (no key required)
     7. Ticker wall: iframe to the existing trading app, reachability check
     8. Screen renderers: Home, Calendar, Weather, Ticker, Lists, Recipes
     9. Settings screen wiring
    10. Boot
   ============================================================================ */

(() => {
"use strict";

/* ---------------------------------------------------------------- 1. CONFIG */
const DEFAULTS = {
  theme: "dark",                 // light | dark | auto
  night: { enabled:false, start:"21:00", end:"07:00" },
  rotate: { enabled:false, interval:30, screens:["home","calendar","weather","ticker","list"] },
  hideWeekendTicker: true,
  icsUrl: "",
  rtdbUrl: "",
  wallUrl: "",
  weather: { lat:null, lon:null, label:"" },
  keywords: {
    travel:  "trip,flight,airport,vacation,hotel,travel,road trip,fly,departure,layover",
    photo:   "photo,shoot,astro,night sky,milky way,aurora,star party,timelapse,photography",
    doctor:  "doctor,dentist,dr.,appt,appointment,physical,checkup,check-up,clinic,hospital,eye exam,vet,dermatolog,cardiolog",
    friends: "lunch,dinner,coffee,drinks,brunch,friend,meetup,meet up,hang,bbq,party,gathering,happy hour"
  },
  firebase: { apiKey:"", authDomain:"", projectId:"", appId:"", familyId:"" }
};

function loadCfg(){
  try{
    const raw = localStorage.getItem("hubConfig");
    if(!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return deepMerge(structuredClone(DEFAULTS), parsed);
  }catch(e){ return structuredClone(DEFAULTS); }
}
function deepMerge(base, extra){
  for(const k in extra){
    if(extra[k] && typeof extra[k]==="object" && !Array.isArray(extra[k])){
      base[k] = deepMerge(base[k] && typeof base[k]==="object" ? base[k] : {}, extra[k]);
    } else base[k] = extra[k];
  }
  return base;
}
let CFG = loadCfg();
function saveCfg(){ localStorage.setItem("hubConfig", JSON.stringify(CFG)); }

/* ------------------------------------------------------------------ toast */
let toastTimer = null;
function toast(msg){
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.remove("show"), 2400);
}

/* ---------------------------------------------------------- 2. CLOCK/THEME */
function tickClock(){
  const now = new Date();
  document.getElementById("clock").textContent = now.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
  document.getElementById("dateLine").textContent = now.toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"});
}
function timeToMinutes(t){ const [h,m] = t.split(":").map(Number); return h*60+m; }
function withinWindow(nowMin, startMin, endMin){
  if(startMin === endMin) return false;
  if(startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin; // wraps past midnight
}
function applyTheme(){
  let mode = CFG.theme;
  if(mode === "auto"){
    const h = new Date().getHours();
    mode = (h >= 19 || h < 7) ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", mode);
  document.getElementById("btnTheme").textContent = mode === "dark" ? "🌙" : "☀️";
}
function applyNightDim(){
  const overlay = document.getElementById("dimOverlay");
  if(!CFG.night.enabled){ overlay.classList.remove("on"); return; }
  const now = new Date();
  const nowMin = now.getHours()*60 + now.getMinutes();
  const on = withinWindow(nowMin, timeToMinutes(CFG.night.start), timeToMinutes(CFG.night.end)) && !overlay.dataset.woken;
  overlay.classList.toggle("on", !!on);
}
document.getElementById("dimOverlay").addEventListener("click", (e)=>{
  const overlay = e.currentTarget;
  overlay.dataset.woken = "1";
  overlay.classList.remove("on");
  clearTimeout(overlay._wakeTimer);
  overlay._wakeTimer = setTimeout(()=>{ delete overlay.dataset.woken; applyNightDim(); }, 5*60*1000);
});

/* -------------------------------------------------- 3. NAV + ROTATION ---- */
const ALL_SCREENS = ["home","calendar","weather","ticker","list","recipes","settings"];
const ROTATABLE = ["home","calendar","weather","ticker","list","recipes"];
let currentScreen = "home";
let rotTimer = null, idleResumeTimer = null, rotPaused = false;

function isWeekend(){ const d = new Date().getDay(); return d===0 || d===6; }

function visibleScreens(){
  return ALL_SCREENS.filter(s => !(s==="ticker" && CFG.hideWeekendTicker && isWeekend()));
}

function goto(screen){
  currentScreen = screen;
  document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("active", s.id === "screen-"+screen));
  document.querySelectorAll(".navbtn").forEach(b=>b.classList.toggle("active", b.dataset.screen === screen));
  if(screen === "calendar") renderCalendar();
  if(screen === "weather") renderWeather();
  if(screen === "ticker") renderTicker();
  if(screen === "list") renderList();
  if(screen === "recipes") renderRecipes();
  if(screen === "home") renderHome();
}

function renderNavVisibility(){
  const vis = visibleScreens();
  document.querySelectorAll(".navbtn").forEach(b=>{
    b.hidden = !vis.includes(b.dataset.screen);
  });
  if(!vis.includes(currentScreen)) goto("home");
}

function rotationList(){
  const vis = new Set(visibleScreens());
  return CFG.rotate.screens.filter(s => ROTATABLE.includes(s) && vis.has(s));
}
function renderRotDots(){
  const host = document.getElementById("rotDots");
  const list = rotationList();
  host.innerHTML = "";
  if(!CFG.rotate.enabled || list.length < 2) return;
  list.forEach(s=>{
    const dot = document.createElement("span");
    dot.className = s === currentScreen ? "on" : "";
    host.appendChild(dot);
  });
}
function stepRotation(){
  const list = rotationList();
  if(list.length < 2) return;
  const idx = list.indexOf(currentScreen);
  const next = list[(idx+1) % list.length];
  goto(next);
  renderRotDots();
}
function startRotation(){
  stopRotation();
  if(!CFG.rotate.enabled) { rotPaused = false; updateRotateBtn(); return; }
  rotPaused = false;
  rotTimer = setInterval(stepRotation, Math.max(5, CFG.rotate.interval) * 1000);
  updateRotateBtn();
}
function stopRotation(){ clearInterval(rotTimer); rotTimer = null; }
// Re-applies rotation settings (new interval/screen list) without silently
// un-pausing a rotation the user explicitly paused via the pause button.
function reapplyRotation(){
  if(rotPaused){ stopRotation(); updateRotateBtn(); }
  else { startRotation(); }
}
function updateRotateBtn(){
  const btn = document.getElementById("btnRotate");
  if(!CFG.rotate.enabled){ btn.textContent = "⏵"; btn.classList.remove("active"); btn.style.opacity=.4; return; }
  btn.style.opacity = 1;
  btn.textContent = rotPaused ? "⏵" : "⏸";
  btn.classList.toggle("active", !rotPaused);
}
document.getElementById("btnRotate").addEventListener("click", ()=>{
  if(!CFG.rotate.enabled) return;
  rotPaused = !rotPaused;
  if(rotPaused) stopRotation(); else startRotation();
  updateRotateBtn();
});
// Any touch resets the idle-resume clock so rotation never yanks the screen
// away mid check-off; it just quietly resumes a while after you stop touching it.
function noteInteraction(){
  if(!CFG.rotate.enabled || rotPaused) return;
  clearInterval(rotTimer); rotTimer = null;
  clearTimeout(idleResumeTimer);
  idleResumeTimer = setTimeout(()=>{ if(CFG.rotate.enabled && !rotPaused) startRotation(); }, 20000);
}
document.getElementById("screens").addEventListener("pointerdown", noteInteraction);

document.querySelectorAll(".navbtn").forEach(btn=>{
  btn.addEventListener("click", ()=>{ goto(btn.dataset.screen); renderRotDots(); noteInteraction(); });
});
document.querySelectorAll("[data-goto]").forEach(el=>{
  el.addEventListener("click", ()=>goto(el.dataset.goto));
});
document.getElementById("btnTheme").addEventListener("click", ()=>{
  const order = ["light","dark","auto"];
  CFG.theme = order[(order.indexOf(CFG.theme)+1) % order.length];
  saveCfg(); applyTheme(); toast("Theme: " + CFG.theme);
});

/* ------------------------------------------------------ 4. DATA LAYER --- */
// Uniform store interface: { list, add(obj), update(id,patch), remove(id), subscribe(fn) }
// Backed by Firestore when Firebase config is present & valid, otherwise localStorage.
function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : "id-"+Date.now()+"-"+Math.random().toString(16).slice(2)); }

function makeLocalStore(key){
  let list = JSON.parse(localStorage.getItem(key) || "[]");
  const subs = [];
  function persist(){ localStorage.setItem(key, JSON.stringify(list)); subs.forEach(fn=>fn(list)); }
  return {
    get list(){ return list; },
    add(obj){ list = [...list, {id:uid(), ...obj}]; persist(); },
    update(id, patch){ list = list.map(x => x.id===id ? {...x, ...patch} : x); persist(); },
    remove(id){ list = list.filter(x => x.id!==id); persist(); },
    subscribe(fn){ subs.push(fn); fn(list); }
  };
}

let fbApp = null, fbDb = null, fbReady = false;
function firebaseConfigured(){
  const f = CFG.firebase;
  return !!(f.apiKey && f.projectId && f.appId && f.familyId);
}
function makeFirestoreStore(collectionName){
  let list = [];
  const subs = [];
  const col = fbDb.collection("families").doc(CFG.firebase.familyId).collection(collectionName);
  col.onSnapshot(snap=>{
    list = snap.docs.map(d=>({id:d.id, ...d.data()}));
    list.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    subs.forEach(fn=>fn(list));
  }, err=>{
    console.warn("Firestore error on "+collectionName, err);
    toast("Sync error — check Firebase settings");
  });
  return {
    get list(){ return list; },
    add(obj){ col.add({...obj, createdAt: Date.now()}); },
    update(id, patch){ col.doc(id).update(patch); },
    remove(id){ col.doc(id).delete(); },
    subscribe(fn){ subs.push(fn); fn(list); }
  };
}

let itemsStore = makeLocalStore("hub_items_local");
let recipesStore = makeLocalStore("hub_recipes_local");

function initFirebase(){
  const dot = document.getElementById("fbStatusDot"), txt = document.getElementById("fbStatusText");
  if(!firebaseConfigured()){
    dot.className = "statusdot warn";
    txt.textContent = "Not connected — running on this device only";
    itemsStore = makeLocalStore("hub_items_local");
    recipesStore = makeLocalStore("hub_recipes_local");
    itemsStore.subscribe(renderAllListViews);
    recipesStore.subscribe(renderRecipes);
    return;
  }
  try{
    const f = CFG.firebase;
    if(!fbApp){
      fbApp = firebase.initializeApp({apiKey:f.apiKey, authDomain:f.authDomain || (f.projectId+".firebaseapp.com"), projectId:f.projectId, appId:f.appId});
      fbDb = firebase.firestore();
    }
    itemsStore = makeFirestoreStore("items");
    recipesStore = makeFirestoreStore("recipes");
    itemsStore.subscribe(renderAllListViews);
    recipesStore.subscribe(renderRecipes);
    dot.className = "statusdot ok";
    txt.textContent = "Connected — syncing live across devices";
    fbReady = true;
  }catch(e){
    console.warn("Firebase init failed", e);
    dot.className = "statusdot bad";
    txt.textContent = "Couldn't connect — check your config values";
    itemsStore = makeLocalStore("hub_items_local");
    recipesStore = makeLocalStore("hub_recipes_local");
    itemsStore.subscribe(renderAllListViews);
    recipesStore.subscribe(renderRecipes);
  }
}
function renderAllListViews(){ renderList(); renderHome(); }

/* ------------------------------------------------------- 5. CALENDAR ---- */
let calEvents = [];       // flattened, expanded occurrences within a working window
let calRawEvents = [];    // raw parsed VEVENTs (unexpanded)
let calDayCursor = new Date();
let calWeekCursor = new Date();
let calView = "schedule";

function unfoldICS(text){
  return text.replace(/\r\n/g,"\n").replace(/\n[ \t]/g, "");
}
function unescapeICSText(s){
  return (s||"").replace(/\\n/gi,"\n").replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\\\/g,"\\");
}
function parseICSDate(value, params){
  value = value.trim();
  if(params.includes("VALUE=DATE") || /^\d{8}$/.test(value)){
    const y=+value.slice(0,4), m=+value.slice(4,6)-1, d=+value.slice(6,8);
    return { date: new Date(y,m,d), allDay:true };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if(!m) return { date: new Date(value), allDay:false };
  const [,y,mo,d,h,mi,se,z] = m;
  if(z){
    return { date: new Date(Date.UTC(+y,+mo-1,+d,+h,+mi,+se)), allDay:false };
  }
  // Floating or TZID time: treat as local device time (a reasonable approximation
  // without a full IANA timezone database on board).
  return { date: new Date(+y,+mo-1,+d,+h,+mi,+se), allDay:false };
}
function parseICS(text){
  const lines = unfoldICS(text).split("\n").filter(l=>l.trim().length);
  const events = [];
  let cur = null;
  for(const line of lines){
    const idx = line.indexOf(":");
    if(idx === -1) continue;
    const left = line.slice(0,idx), value = line.slice(idx+1);
    const [prop, ...paramParts] = left.split(";");
    const params = paramParts;
    if(prop === "BEGIN" && value === "VEVENT"){ cur = {exdates:[]}; continue; }
    if(prop === "END" && value === "VEVENT"){ if(cur) events.push(cur); cur = null; continue; }
    if(!cur) continue;
    if(prop === "SUMMARY") cur.title = unescapeICSText(value);
    else if(prop === "UID") cur.uid = value;
    else if(prop === "DTSTART"){ const r = parseICSDate(value, params); cur.start = r.date; cur.allDay = r.allDay; }
    else if(prop === "DTEND"){ const r = parseICSDate(value, params); cur.end = r.date; }
    else if(prop === "RRULE") cur.rrule = value;
    else if(prop === "EXDATE"){ const r = parseICSDate(value, params); cur.exdates.push(+r.date); }
    else if(prop === "LOCATION") cur.location = unescapeICSText(value);
  }
  return events.filter(e => e.title && e.start);
}
function parseRRULEStr(str){
  const out = {};
  str.split(";").forEach(p=>{
    const [k,v] = p.split("=");
    out[k] = v;
  });
  return out;
}
// Best-effort recurrence expansion — supports FREQ=DAILY/WEEKLY/MONTHLY/YEARLY,
// INTERVAL, COUNT, UNTIL. Enough for the school-pickup / monthly-checkup shape
// of a family calendar; not a full RFC 5545 engine.
function expandEvent(ev, rangeStart, rangeEnd){
  const durMs = (ev.end ? ev.end - ev.start : (ev.allDay ? 24*3600*1000 : 3600*1000));
  const out = [];
  if(!ev.rrule){
    if(ev.start < rangeEnd && (ev.end || new Date(+ev.start+durMs)) > rangeStart) out.push({...ev, occStart:ev.start, occEnd:new Date(+ev.start+durMs)});
    return out;
  }
  const r = parseRRULEStr(ev.rrule);
  const freq = r.FREQ;
  const interval = parseInt(r.INTERVAL||"1",10);
  const count = r.COUNT ? parseInt(r.COUNT,10) : Infinity;
  const until = r.UNTIL ? parseICSDate(r.UNTIL, []).date : null;
  let cursor = new Date(ev.start);
  let n = 0, guard = 0;
  while(cursor < rangeEnd && n < count && guard < 2000){
    guard++;
    if(until && cursor > until) break;
    if(cursor >= rangeStart || (new Date(+cursor+durMs)) > rangeStart){
      if(!ev.exdates.includes(+cursor)){
        out.push({...ev, occStart:new Date(cursor), occEnd:new Date(+cursor+durMs)});
      }
    }
    n++;
    if(freq==="DAILY") cursor = new Date(+cursor + interval*86400000);
    else if(freq==="WEEKLY") cursor = new Date(+cursor + interval*7*86400000);
    else if(freq==="MONTHLY") { const d=new Date(cursor); d.setMonth(d.getMonth()+interval); cursor=d; }
    else if(freq==="YEARLY") { const d=new Date(cursor); d.setFullYear(d.getFullYear()+interval); cursor=d; }
    else break;
  }
  return out;
}
function categorize(title){
  const t = (title||"").toLowerCase();
  const kw = CFG.keywords;
  const test = (list)=> list.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean).some(k=>t.includes(k));
  if(test(kw.travel)) return "travel";
  if(test(kw.photo)) return "photo";
  if(test(kw.doctor)) return "doctor";
  if(test(kw.friends)) return "friends";
  return "other";
}
const CAT_META = {
  travel:  {label:"Travel",      icon:"✈️", cls:"cat-travel"},
  photo:   {label:"Photography", icon:"📷", cls:"cat-photo"},
  doctor:  {label:"Doctor",      icon:"⚕️", cls:"cat-doctor"},
  friends: {label:"Friends",     icon:"☕", cls:"cat-friends"},
  other:   {label:"Other",       icon:"•",  cls:"cat-other"}
};

async function fetchICS(){
  let url = CFG.icsUrl.trim();
  if(!url) return null;
  if(url.startsWith("webcal://")) url = "https://" + url.slice(9);
  const tryFetch = async (u) => {
    const res = await fetch(u, {cache:"no-store"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    return res.text();
  };
  try{
    return await tryFetch(url);
  }catch(e){
    // Most CalDAV publish endpoints don't send CORS headers for cross-origin
    // fetch from a page that isn't on icloud.com — relay through a public
    // CORS proxy as a fallback. See SETUP.md for the privacy note on this.
    try{
      return await tryFetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(url));
    }catch(e2){
      throw e2;
    }
  }
}
// Shortcuts → Realtime Database feed. A Shortcuts Automation reads Calendar
// natively on-device (zero CORS, zero Apple-CDN blocking — the thing that
// makes the ICS/CORS-proxy path below unreliable) and PUTs the events as
// plain JSON to a Firebase Realtime Database path. Shortcuts already expands
// recurrence into concrete occurrences, so no RRULE work is needed here —
// events go straight into calEvents. See SETUP.md for the Shortcut build.
async function fetchRtdbEvents(){
  const base = CFG.rtdbUrl.trim().replace(/\/+$/, "");
  const familyId = CFG.firebase.familyId.trim() || "default";
  const url = `${base}/families/${encodeURIComponent(familyId)}/calendarFeed.json`;
  const res = await fetch(url, {cache:"no-store"});
  if(!res.ok) throw new Error("Realtime Database HTTP "+res.status);
  const data = await res.json();
  if(!data || !Array.isArray(data.events)) throw new Error("No calendar feed yet — run the Shortcut once");
  return data.events;
}
function eventsToCalEvents(rawEvents){
  return rawEvents.map(e => ({
    title: e.title || "(untitled)",
    occStart: new Date(e.start),
    occEnd: new Date(e.end || e.start),
    allDay: !!e.allDay,
    location: e.location || "",
    cat: categorize(e.title || "")
  })).filter(e => !isNaN(+e.occStart)).sort((a,b)=>a.occStart-b.occStart);
}
async function loadCalendar(){
  const dot = document.getElementById("icsStatusDot"), txt = document.getElementById("icsStatusText");

  // Preferred path: the Shortcuts-fed Realtime Database snapshot.
  if(CFG.rtdbUrl.trim()){
    try{
      const rawEvents = await fetchRtdbEvents();
      calEvents = eventsToCalEvents(rawEvents);
      localStorage.setItem("hub_rtdb_cache", JSON.stringify({at:Date.now(), rawEvents}));
      if(dot){ dot.className="statusdot ok"; txt.textContent = "Connected (Shortcuts feed) — " + calEvents.length + " events"; }
      return;
    }catch(e){
      console.warn("Realtime Database calendar fetch failed", e);
      const cached = localStorage.getItem("hub_rtdb_cache");
      if(cached){
        const {at, rawEvents} = JSON.parse(cached);
        calEvents = eventsToCalEvents(rawEvents);
        if(dot){ dot.className="statusdot warn"; txt.textContent = "Using cached Shortcuts feed from " + new Date(at).toLocaleString(); }
        return;
      }
      if(dot){ dot.className="statusdot bad"; txt.textContent = "Shortcuts feed: " + e.message; }
      if(!CFG.icsUrl.trim()){ calEvents = []; return; }
      // fall through to the ICS path below as a second attempt
    }
  }

  // Fallback / alternative path: direct public ICS link, with a CORS-proxy
  // relay for hosts (Apple's included) that don't set CORS headers. Less
  // reliable against Apple's CDN specifically — see SETUP.md — which is why
  // the Realtime Database path above is preferred when configured.
  if(!CFG.icsUrl.trim()){
    if(dot){ dot.className="statusdot warn"; txt.textContent="No calendar source set yet"; }
    calRawEvents = [];
    localStorage.removeItem("hub_ics_cache");
    return;
  }
  try{
    const text = await fetchICS();
    calRawEvents = parseICS(text);
    localStorage.setItem("hub_ics_cache", JSON.stringify({at:Date.now(), text}));
    if(dot){ dot.className="statusdot ok"; txt.textContent = "Connected — " + calRawEvents.length + " events found"; }
  }catch(e){
    console.warn("ICS fetch failed", e);
    const cached = localStorage.getItem("hub_ics_cache");
    if(cached){
      const {at, text} = JSON.parse(cached);
      calRawEvents = parseICS(text);
      if(dot){ dot.className="statusdot warn"; txt.textContent = "Using cached data from " + new Date(at).toLocaleString(); }
    } else {
      calRawEvents = [];
      if(dot){ dot.className="statusdot bad"; txt.textContent = "Couldn't reach calendar link"; }
    }
  }
  buildCalWindow();
}
function buildCalWindow(){
  const rangeStart = new Date(); rangeStart.setDate(rangeStart.getDate()-2); rangeStart.setHours(0,0,0,0);
  const rangeEnd = new Date(); rangeEnd.setDate(rangeEnd.getDate()+60);
  calEvents = calRawEvents.flatMap(ev => expandEvent(ev, rangeStart, rangeEnd))
    .map(ev => ({...ev, cat: categorize(ev.title)}))
    .sort((a,b)=>a.occStart-b.occStart);
}
function fmtTime(d, allDay){
  if(allDay) return "All day";
  return d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
}
function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

function renderCalLegend(){
  const host = document.getElementById("calLegend");
  host.innerHTML = Object.entries(CAT_META).filter(([k])=>k!=="other").map(([k,m])=>
    `<div class="li"><span class="sw" style="background:var(--cat-${k==='doctor'?'doctor':k})"></span>${m.icon} ${m.label}</div>`
  ).join("");
}
function renderScheduleView(){
  const host = document.getElementById("calSchedule");
  const now = new Date();
  const upcoming = calEvents.filter(e => e.occEnd > now).slice(0, 60);
  if(!upcoming.length){ host.innerHTML = `<div class="empty">No upcoming events. Add your iCloud calendar link in Settings.</div>`; return; }
  const byDay = new Map();
  upcoming.forEach(e=>{
    const key = e.occStart.toDateString();
    if(!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  });
  let html = "";
  for(const [key, evts] of byDay){
    const d = new Date(key);
    const label = sameDay(d, now) ? "Today" : (sameDay(d, new Date(+now+86400000)) ? "Tomorrow" : d.toLocaleDateString([], {weekday:"long", month:"short", day:"numeric"}));
    html += `<div class="sched-day"><h4>${label}</h4>` + evts.map(evtHtml).join("") + `</div>`;
  }
  host.innerHTML = html;
}
function evtHtml(e){
  const m = CAT_META[e.cat];
  return `<div class="agenda-item">
    <div class="agenda-time">${fmtTime(e.occStart, e.allDay)}${e.end && !e.allDay ? "<small>– "+fmtTime(e.occEnd,false)+"</small>" : ""}</div>
    <div class="cat-chip ${m.cls}"></div>
    <div class="agenda-main">
      <div class="agenda-title ${m.cls}"><span class="cat-icon">${m.icon}</span>${escapeHtml(e.title)}</div>
      ${e.location ? `<div class="agenda-meta">${escapeHtml(e.location)}</div>` : ""}
    </div>
  </div>`;
}
function renderDailyView(){
  document.getElementById("dayLabel").textContent = calDayCursor.toLocaleDateString([], {weekday:"long", month:"short", day:"numeric"});
  const dayEvents = calEvents.filter(e => sameDay(e.occStart, calDayCursor));
  const host = document.getElementById("dayTimeline");
  const allDay = dayEvents.filter(e=>e.allDay);
  let html = "";
  if(allDay.length){
    html += `<div class="tl-row"><div class="tl-hour">All day</div><div class="tl-events">` +
      allDay.map(e=>`<div class="tl-evt ${CAT_META[e.cat].cls}">${CAT_META[e.cat].icon} ${escapeHtml(e.title)}</div>`).join("") + `</div></div>`;
  }
  for(let h=6; h<=22; h++){
    const hourEvts = dayEvents.filter(e=>!e.allDay && e.occStart.getHours()===h);
    const label = new Date(2000,0,1,h).toLocaleTimeString([], {hour:"numeric"});
    html += `<div class="tl-row"><div class="tl-hour">${label}</div><div class="tl-events">` +
      hourEvts.map(e=>`<div class="tl-evt ${CAT_META[e.cat].cls}">${CAT_META[e.cat].icon} ${escapeHtml(e.title)} <span style="opacity:.7;">· ${fmtTime(e.occStart,false)}</span></div>`).join("") +
      `</div></div>`;
  }
  host.innerHTML = html;
}
function startOfWeek(d){ const x=new Date(d); const day=x.getDay(); x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; }
function renderWeeklyView(){
  const start = startOfWeek(calWeekCursor);
  const end = new Date(+start + 6*86400000);
  document.getElementById("weekLabel").textContent = start.toLocaleDateString([], {month:"short",day:"numeric"}) + " – " + end.toLocaleDateString([], {month:"short",day:"numeric"});
  const host = document.getElementById("weekGrid");
  const today = new Date();
  let html = "";
  for(let i=0;i<7;i++){
    const d = new Date(+start + i*86400000);
    const dayEvts = calEvents.filter(e=>sameDay(e.occStart,d)).slice(0,8);
    html += `<div class="wday ${sameDay(d,today)?'today':''}">
      <div class="wd-head">${d.toLocaleDateString([],{weekday:'short'})}<b>${d.getDate()}</b></div>
      ${dayEvts.map(e=>`<div class="wevt ${CAT_META[e.cat].cls}">${CAT_META[e.cat].icon} ${escapeHtml(e.title)}</div>`).join("") || ""}
    </div>`;
  }
  host.innerHTML = html;
}
function renderCalendar(){
  renderCalLegend();
  if(calView==="schedule") renderScheduleView();
  if(calView==="daily") renderDailyView();
  if(calView==="weekly") renderWeeklyView();
}
document.querySelectorAll(".viewtabs button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".viewtabs button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    calView = btn.dataset.view;
    document.getElementById("calSchedule").style.display = calView==="schedule" ? "" : "none";
    document.getElementById("calDaily").style.display = calView==="daily" ? "" : "none";
    document.getElementById("calWeekly").style.display = calView==="weekly" ? "" : "none";
    renderCalendar();
  });
});
document.getElementById("dayPrev").addEventListener("click", ()=>{ calDayCursor = new Date(+calDayCursor-86400000); renderDailyView(); });
document.getElementById("dayNext").addEventListener("click", ()=>{ calDayCursor = new Date(+calDayCursor+86400000); renderDailyView(); });
document.getElementById("weekPrev").addEventListener("click", ()=>{ calWeekCursor = new Date(+calWeekCursor-7*86400000); renderWeeklyView(); });
document.getElementById("weekNext").addEventListener("click", ()=>{ calWeekCursor = new Date(+calWeekCursor+7*86400000); renderWeeklyView(); });
document.getElementById("calRefresh").addEventListener("click", ()=>{ loadCalendar().then(renderCalendar); toast("Refreshing calendar…"); });

/* --------------------------------------------------------- 6. WEATHER --- */
function wmoIcon(code){
  const map = {0:"☀️",1:"🌤️",2:"⛅",3:"☁️",45:"🌫️",48:"🌫️",51:"🌦️",53:"🌦️",55:"🌦️",56:"🌧️",57:"🌧️",
    61:"🌧️",63:"🌧️",65:"🌧️",66:"🌧️",67:"🌧️",71:"🌨️",73:"🌨️",75:"🌨️",77:"🌨️",80:"🌦️",81:"🌦️",82:"⛈️",
    85:"🌨️",86:"🌨️",95:"⛈️",96:"⛈️",99:"⛈️"};
  return map[code] || "🌡️";
}
function wmoText(code){
  const map = {0:"Clear",1:"Mostly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Freezing fog",
    51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",56:"Freezing drizzle",57:"Freezing drizzle",
    61:"Light rain",63:"Rain",65:"Heavy rain",66:"Freezing rain",67:"Freezing rain",
    71:"Light snow",73:"Snow",75:"Heavy snow",77:"Snow grains",80:"Rain showers",81:"Rain showers",
    82:"Violent showers",85:"Snow showers",86:"Snow showers",95:"Thunderstorm",96:"Thunderstorm w/ hail",99:"Thunderstorm w/ hail"};
  return map[code] || "—";
}
async function geocodeCity(q){
  const res = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=5&name=" + encodeURIComponent(q));
  const j = await res.json();
  return j.results || [];
}
let wxCache = null;
async function fetchWeather(){
  if(CFG.weather.lat == null) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${CFG.weather.lat}&longitude=${CFG.weather.lon}` +
    `&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m` +
    `&hourly=temperature_2m,weather_code,precipitation_probability` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=6`;
  const res = await fetch(url, {cache:"no-store"});
  if(!res.ok) throw new Error("weather HTTP "+res.status);
  const j = await res.json();
  wxCache = j;
  localStorage.setItem("hub_wx_cache", JSON.stringify({at:Date.now(), data:j}));
  return j;
}
function renderHourlyGraph(hours){
  const temps = hours.map(h=>h.t);
  const min = Math.min(...temps), max = Math.max(...temps);
  const w = hours.length * 40, h = 60;
  const pts = hours.map((hh,i)=>{
    const x = i*40 + 20;
    const y = max===min ? h/2 : h - ((hh.t-min)/(max-min))*(h-14) - 6;
    return x+","+y;
  }).join(" ");
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block;">
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
async function renderWeather(){
  document.getElementById("wxLocLabel").textContent = "Weather" + (CFG.weather.label ? " · " + CFG.weather.label : "");
  if(CFG.weather.lat == null){
    document.getElementById("wxNow").innerHTML = `<div class="empty">Set your location in Settings to see weather.</div>`;
    document.getElementById("wxHourly").innerHTML = "";
    document.getElementById("wxDays").innerHTML = "";
    return;
  }
  let data = wxCache;
  try{
    data = await fetchWeather();
  }catch(e){
    console.warn("weather fetch failed", e);
    const cached = localStorage.getItem("hub_wx_cache");
    if(cached) data = JSON.parse(cached).data;
  }
  if(!data) return;
  const cur = data.current;
  document.getElementById("wxNow").innerHTML = `
    <div class="wx-icon">${wmoIcon(cur.weather_code)}</div>
    <div>
      <div class="wx-temp">${Math.round(cur.temperature_2m)}°</div>
      <div class="wx-desc">${wmoText(cur.weather_code)}</div>
      <div class="wx-meta"><span>💧 ${cur.relative_humidity_2m}%</span><span>💨 ${Math.round(cur.wind_speed_10m)} mph</span></div>
    </div>`;
  const nowIdx = data.hourly.time.findIndex(t => new Date(t) >= new Date());
  const hrs = [];
  for(let i = Math.max(0,nowIdx); i < Math.min(data.hourly.time.length, Math.max(0,nowIdx)+16); i++){
    hrs.push({time:new Date(data.hourly.time[i]), t:data.hourly.temperature_2m[i], code:data.hourly.weather_code[i]});
  }
  const chips = hrs.map(hh => `<div class="wx-hour">${hh.time.toLocaleTimeString([], {hour:"numeric"})}<div>${wmoIcon(hh.code)}</div><div class="t">${Math.round(hh.t)}°</div></div>`).join("");
  document.getElementById("wxHourly").innerHTML = renderHourlyGraph(hrs) + `<div style="display:flex; gap:2px;">${chips}</div>`;
  const days = data.daily.time.map((t,i)=>({
    date:new Date(t), hi:data.daily.temperature_2m_max[i], lo:data.daily.temperature_2m_min[i], code:data.daily.weather_code[i]
  })).slice(0,5);
  document.getElementById("wxDays").innerHTML = days.map(d=>`
    <div class="wx-day">
      <div class="d">${d.date.toLocaleDateString([], {weekday:"short"})}</div>
      <div class="ic">${wmoIcon(d.code)}</div>
      <div class="hl">${Math.round(d.hi)}° <span class="lo">${Math.round(d.lo)}°</span></div>
    </div>`).join("");
}
document.getElementById("wxRefresh").addEventListener("click", ()=>{ renderWeather(); toast("Refreshing weather…"); });
document.getElementById("wxSearchBtn").addEventListener("click", async ()=>{
  const q = document.getElementById("wxSearchInput").value.trim();
  if(!q) return;
  const results = await geocodeCity(q);
  const host = document.getElementById("wxSearchResults");
  if(!results.length){ host.innerHTML = `<div class="hint">No matches.</div>`; return; }
  host.innerHTML = results.map((r,i)=>
    `<button class="btn ghost" style="display:block; width:100%; text-align:left; margin-bottom:6px;" data-i="${i}">${r.name}${r.admin1? ", "+r.admin1:""} — ${r.country}</button>`
  ).join("");
  host.querySelectorAll("button").forEach(b=>{
    b.addEventListener("click", ()=>{
      const r = results[+b.dataset.i];
      CFG.weather = {lat:r.latitude, lon:r.longitude, label: r.name + (r.admin1 ? ", "+r.admin1 : "")};
      saveCfg();
      document.getElementById("wxCurrentLoc").textContent = CFG.weather.label;
      host.innerHTML = "";
      document.getElementById("wxSearchInput").value = "";
      toast("Location set: " + CFG.weather.label);
    });
  });
});

/* ---------------------------------------------------------- 7. TICKER --- */
async function reachable(url, timeoutMs=2500){
  try{
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), timeoutMs);
    await fetch(url, {mode:"no-cors", signal:ctrl.signal, cache:"no-store"});
    clearTimeout(t);
    return true;
  }catch(e){ return false; }
}
async function renderTicker(){
  const host = document.getElementById("tickerHost");
  if(!CFG.wallUrl.trim()){
    host.innerHTML = `<div class="ticker-off"><div class="big">📈</div><div>No ticker wall URL set.</div><div class="hint">Add your trading app's network address in Settings.</div></div>`;
    return;
  }
  host.innerHTML = `<div class="ticker-off"><div class="big">⏳</div><div>Checking connection…</div></div>`;
  const ok = await reachable(CFG.wallUrl.trim());
  if(!ok){
    host.innerHTML = `<div class="ticker-off"><div class="big">📴</div><div>Ticker wall isn't reachable.</div>
      <div class="hint">Make sure your Mac and the trading server are on, and this device is on the same Wi-Fi as ${escapeHtml(CFG.wallUrl)}.</div></div>`;
    return;
  }
  host.innerHTML = `<iframe id="tickerFrame" src="${escapeAttr(CFG.wallUrl.trim())}"></iframe>`;
}
document.getElementById("tickerRetry").addEventListener("click", renderTicker);

/* ------------------------------------------------------------ 8. HOME --- */
function renderHome(){
  const now = new Date();
  const upcoming = calEvents.filter(e=>e.occEnd > now).slice(0,6);
  const agendaHost = document.getElementById("homeAgenda");
  agendaHost.innerHTML = upcoming.length ? upcoming.map(evtHtml).join("") : `<div class="empty">No upcoming events.</div>`;

  const items = itemsStore.list.filter(i=>!i.done).slice(0,10);
  const listHost = document.getElementById("homeList");
  listHost.innerHTML = items.length ? items.map(itemHtml).join("") : `<div class="empty">Nothing on the list 🎉</div>`;
  wireCheckboxes(listHost);
}
function itemHtml(item){
  return `<div class="list-item ${item.done?'done':''}" data-id="${item.id}">
    <div class="check ${item.done?'on':''}">✓</div>
    <div class="list-text">${escapeHtml(item.text)}</div>
    <span class="list-tag">${item.tag==='grocery'?'🛒':'☑️'}</span>
  </div>`;
}
function wireCheckboxes(root){
  root.querySelectorAll(".check").forEach(c=>{
    c.addEventListener("click", (e)=>{
      e.stopPropagation();
      const row = c.closest(".list-item");
      const id = row.dataset.id;
      const item = itemsStore.list.find(i=>i.id===id);
      if(item) itemsStore.update(id, {done: !item.done});
    });
  });
}

/* ------------------------------------------------------------ LIST ----- */
let listFilter = "all";
document.querySelectorAll(".segbtn [data-list]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".segbtn [data-list]").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    listFilter = btn.dataset.list;
    renderList();
  });
});
function renderList(){
  const host = document.getElementById("listBody");
  let items = itemsStore.list;
  if(listFilter !== "all") items = items.filter(i=>i.tag===listFilter);
  items = [...items].sort((a,b)=>(a.done?1:0)-(b.done?1:0));
  host.innerHTML = items.length ? items.map(i=>`
    <div class="list-item ${i.done?'done':''}" data-id="${i.id}">
      <div class="check ${i.done?'on':''}">✓</div>
      <div class="list-text">${escapeHtml(i.text)}</div>
      <span class="list-tag">${i.tag==='grocery'?'🛒 grocery':'☑️ to-do'}</span>
      <button class="del">✕</button>
    </div>`).join("") : `<div class="empty">Nothing here yet — add something above.</div>`;
  wireCheckboxes(host);
  host.querySelectorAll(".del").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.closest(".list-item").dataset.id;
      itemsStore.remove(id);
    });
  });
}
function addListItem(){
  const input = document.getElementById("listInput");
  const text = input.value.trim();
  if(!text) return;
  const tag = document.getElementById("listInputTag").value;
  itemsStore.add({text, tag, done:false});
  input.value = "";
  input.focus();
}
document.getElementById("listAdd").addEventListener("click", addListItem);
document.getElementById("listInput").addEventListener("keydown", (e)=>{ if(e.key==="Enter") addListItem(); });

/* --------------------------------------------------------- RECIPES ----- */
let editingRecipeId = null;
function renderRecipes(){
  const q = (document.getElementById("recipeSearch").value || "").toLowerCase();
  const host = document.getElementById("recipeGrid");
  let list = recipesStore.list;
  if(q) list = list.filter(r => (r.title||"").toLowerCase().includes(q) || (r.tags||[]).some(t=>t.toLowerCase().includes(q)));
  host.innerHTML = list.length ? list.map(r=>`
    <div class="rcard" data-id="${r.id}">
      <h4>${escapeHtml(r.title||"Untitled")}</h4>
      <p>${escapeHtml((r.ingredients||[]).slice(0,3).join(", "))}</p>
      <div class="tags">${(r.tags||[]).map(t=>`<span>${escapeHtml(t)}</span>`).join("")}</div>
    </div>`).join("") : `<div class="empty">No recipes yet. Tap "+ New Recipe" to add your first one.</div>`;
  host.querySelectorAll(".rcard").forEach(card=>{
    card.addEventListener("click", ()=>openRecipeModal(card.dataset.id));
  });
}
document.getElementById("recipeSearch").addEventListener("input", renderRecipes);
document.getElementById("recipeAdd").addEventListener("click", ()=>openRecipeModal(null));
function openRecipeModal(id){
  editingRecipeId = id;
  const back = document.getElementById("recipeModalBack");
  const r = id ? recipesStore.list.find(x=>x.id===id) : null;
  document.getElementById("recipeModalTitle").textContent = id ? "Edit Recipe" : "New Recipe";
  document.getElementById("rTitle").value = r?.title || "";
  document.getElementById("rTags").value = (r?.tags||[]).join(", ");
  document.getElementById("rIngredients").value = (r?.ingredients||[]).join("\n");
  document.getElementById("rSteps").value = (r?.steps||[]).join("\n");
  document.getElementById("rNotes").value = r?.notes || "";
  document.getElementById("rDelete").style.display = id ? "" : "none";
  back.hidden = false;
}
document.getElementById("rCancel").addEventListener("click", ()=>{ document.getElementById("recipeModalBack").hidden = true; });
document.getElementById("rSave").addEventListener("click", ()=>{
  const obj = {
    title: document.getElementById("rTitle").value.trim() || "Untitled",
    tags: document.getElementById("rTags").value.split(",").map(s=>s.trim()).filter(Boolean),
    ingredients: document.getElementById("rIngredients").value.split("\n").map(s=>s.trim()).filter(Boolean),
    steps: document.getElementById("rSteps").value.split("\n").map(s=>s.trim()).filter(Boolean),
    notes: document.getElementById("rNotes").value.trim()
  };
  if(editingRecipeId) recipesStore.update(editingRecipeId, obj); else recipesStore.add(obj);
  document.getElementById("recipeModalBack").hidden = true;
  toast("Recipe saved");
});
document.getElementById("rDelete").addEventListener("click", ()=>{
  if(editingRecipeId) recipesStore.remove(editingRecipeId);
  document.getElementById("recipeModalBack").hidden = true;
  toast("Recipe deleted");
});

/* --------------------------------------------------------- 9. SETTINGS - */
function loadSettingsUI(){
  document.querySelectorAll("#screen-settings [data-theme]").forEach(b=>b.classList.toggle("active", b.dataset.theme===CFG.theme));
  document.getElementById("swNight").classList.toggle("on", CFG.night.enabled);
  document.getElementById("nightStart").value = CFG.night.start;
  document.getElementById("nightEnd").value = CFG.night.end;
  document.getElementById("swRotate").classList.toggle("on", CFG.rotate.enabled);
  document.getElementById("rotateInterval").value = CFG.rotate.interval;
  document.getElementById("swWeekendHide").classList.toggle("on", CFG.hideWeekendTicker);
  const rs = document.getElementById("rotateScreens");
  rs.innerHTML = ROTATABLE.map(s => `<button class="chip-toggle ${CFG.rotate.screens.includes(s)?'on':''}" data-s="${s}">${s[0].toUpperCase()+s.slice(1)}</button>`).join("");
  rs.querySelectorAll("button").forEach(b=>{
    b.addEventListener("click", ()=>{
      const s = b.dataset.s;
      const set = new Set(CFG.rotate.screens);
      set.has(s) ? set.delete(s) : set.add(s);
      CFG.rotate.screens = [...set];
      b.classList.toggle("on");
    });
  });
  document.getElementById("setRtdb").value = CFG.rtdbUrl;
  document.getElementById("setIcs").value = CFG.icsUrl;
  document.getElementById("kwTravel").value = CFG.keywords.travel;
  document.getElementById("kwPhoto").value = CFG.keywords.photo;
  document.getElementById("kwDoctor").value = CFG.keywords.doctor;
  document.getElementById("kwFriends").value = CFG.keywords.friends;
  document.getElementById("wxCurrentLoc").textContent = CFG.weather.label || "not set";
  document.getElementById("setWallUrl").value = CFG.wallUrl;
  document.getElementById("fbApiKey").value = CFG.firebase.apiKey;
  document.getElementById("fbAuthDomain").value = CFG.firebase.authDomain;
  document.getElementById("fbProjectId").value = CFG.firebase.projectId;
  document.getElementById("fbAppId").value = CFG.firebase.appId;
  document.getElementById("fbFamilyId").value = CFG.firebase.familyId;
}
document.querySelectorAll("#screen-settings [data-theme]").forEach(b=>{
  b.addEventListener("click", ()=>{
    CFG.theme = b.dataset.theme;
    document.querySelectorAll("#screen-settings [data-theme]").forEach(x=>x.classList.toggle("active", x===b));
    applyTheme();
  });
});
document.getElementById("swNight").addEventListener("click", (e)=>{ CFG.night.enabled = !CFG.night.enabled; e.currentTarget.classList.toggle("on"); });
document.getElementById("swRotate").addEventListener("click", (e)=>{ CFG.rotate.enabled = !CFG.rotate.enabled; e.currentTarget.classList.toggle("on"); });
document.getElementById("swWeekendHide").addEventListener("click", (e)=>{ CFG.hideWeekendTicker = !CFG.hideWeekendTicker; e.currentTarget.classList.toggle("on"); });

document.getElementById("settingsSave").addEventListener("click", async ()=>{
  CFG.night.start = document.getElementById("nightStart").value;
  CFG.night.end = document.getElementById("nightEnd").value;
  CFG.rotate.interval = Math.max(5, parseInt(document.getElementById("rotateInterval").value,10) || 30);
  CFG.rtdbUrl = document.getElementById("setRtdb").value.trim();
  CFG.icsUrl = document.getElementById("setIcs").value.trim();
  CFG.keywords.travel = document.getElementById("kwTravel").value;
  CFG.keywords.photo = document.getElementById("kwPhoto").value;
  CFG.keywords.doctor = document.getElementById("kwDoctor").value;
  CFG.keywords.friends = document.getElementById("kwFriends").value;
  CFG.wallUrl = document.getElementById("setWallUrl").value.trim();
  CFG.firebase = {
    apiKey: document.getElementById("fbApiKey").value.trim(),
    authDomain: document.getElementById("fbAuthDomain").value.trim(),
    projectId: document.getElementById("fbProjectId").value.trim(),
    appId: document.getElementById("fbAppId").value.trim(),
    familyId: document.getElementById("fbFamilyId").value.trim()
  };
  saveCfg();
  applyTheme(); applyNightDim(); renderNavVisibility(); renderRotDots(); reapplyRotation();
  initFirebase();
  await loadCalendar();
  renderCalendar();
  toast("Settings saved");
});
document.getElementById("settingsExport").addEventListener("click", async ()=>{
  const json = JSON.stringify(CFG, null, 2);
  try{ await navigator.clipboard.writeText(json); toast("Config copied to clipboard"); }
  catch(e){
    const ta = document.createElement("textarea"); ta.value = json; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove(); toast("Config copied to clipboard");
  }
});
document.getElementById("settingsImport").addEventListener("click", ()=>{ document.getElementById("importModalBack").hidden = false; });
document.getElementById("importCancel").addEventListener("click", ()=>{ document.getElementById("importModalBack").hidden = true; });
document.getElementById("importApply").addEventListener("click", async ()=>{
  try{
    const parsed = JSON.parse(document.getElementById("importText").value);
    CFG = deepMerge(structuredClone(DEFAULTS), parsed);
    saveCfg();
    loadSettingsUI();
    applyTheme(); applyNightDim(); renderNavVisibility(); renderRotDots(); reapplyRotation();
    initFirebase();
    await loadCalendar();
    renderCalendar(); renderWeather();
    document.getElementById("importModalBack").hidden = true;
    toast("Config imported");
  }catch(e){ toast("That didn't look like valid config JSON"); }
});

/* -------------------------------------------------------------- utils -- */
function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

/* -------------------------------------------------------------- 10. BOOT */
function boot(){
  loadSettingsUI();
  applyTheme();
  tickClock(); setInterval(tickClock, 1000);
  setInterval(applyTheme, 60000);
  setInterval(applyNightDim, 30000);
  applyNightDim();
  renderNavVisibility();
  renderRotDots();
  initFirebase();
  loadCalendar().then(()=>{ renderCalendar(); renderHome(); });
  renderWeather();
  setInterval(()=>loadCalendar().then(()=>{ if(currentScreen==="calendar") renderCalendar(); renderHome(); }), 15*60*1000);
  setInterval(()=>{ if(currentScreen==="weather") renderWeather(); }, 30*60*1000);
  setInterval(renderNavVisibility, 5*60*1000);
  startRotation();
  goto("home");

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
}
document.addEventListener("DOMContentLoaded", boot);
})();
