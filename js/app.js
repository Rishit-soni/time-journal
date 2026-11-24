import { $, $$, esc, uid, MIN, DAY, clamp, setClock, dkey, addDays, dayStart, todayKey, weekKey, hm, hmToMin, minToHm, atTime, minOfDay, fmtClock, fmtMinClock, fmtDur, fmtElapsed, dayShort, fmtDate, relDay, fmtWeek, ago, debounce } from './util.js';
import { S, KINDS, KIND_ORDER, SWATCHES, OFFICE, SLEEP, MEALS, cat, visibleCats, load, saveSettings, saveCats, saveRoutines, putEntry, delEntry, putShift, delShift, putNote, running, openShift, snapshot, undo, exportData, validateBackup, importData, eraseAll } from './store.js';
import * as E from './engine.js';
import { icon, CAT_ICONS } from './icons.js';

const VERSION = '1.0.0';
const U = { tab: 'today', day: todayKey(), follow: true, ins: 'day', insDay: todayKey(), insWeek: weekKey(todayKey()), q: '', jLimit: 30 };
const view = $('#view'), sheet = $('#sheet');
let SH = null;            // state of the open sheet
let installPrompt = null; // Android install prompt

/* ---------- small render helpers ---------- */
const btn = (act, ic, label, cls = '', extra = '') => `<button class="btn ${cls}" data-act="${act}" ${extra}>${icon(ic)}<span>${esc(label)}</span></button>`;
const srcAttrs = src => src.type === 'shift' ? `data-act="shift" data-date="${esc(src.shift.date)}"` : `data-act="edit" data-id="${esc(src.entry.id)}"`;
const toggle = (key, on) => `<span class="sw"><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}><i></i></span>`;
const shortHour = m => S.settings.clock === '24' ? String(Math.floor(m / 60) % 24).padStart(2, '0') : ({ 0: '12a', 360: '6a', 720: '12p', 1080: '6p', 1440: '12a' })[m];
const shortDur = m => m < 60 ? `${Math.round(m)}m` : `${(m / 60).toFixed(1).replace(/\.0$/, '')}h`;
const breakName = e => e.cat === MEALS ? E.mealLabel(e.start) : e.cat === 'rest' ? 'Break' : cat(e.cat).name;
const planName = pl => pl.label || (pl.cat === MEALS ? 'Lunch' : pl.cat === 'rest' ? 'Break' : cat(pl.cat).name);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

function render() {
  setClock(S.settings.clock);
  if (U.follow && U.day !== todayKey()) U.day = todayKey();
  U.follow = U.day === todayKey();
  const f = { today: vToday, insights: vInsights, journal: vJournal, settings: vSettings }[U.tab];
  view.innerHTML = f();
  $$('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === U.tab ? 'page' : 'false'));
  $('#fab').hidden = U.tab === 'settings';
  if (U.tab === 'settings') showPersist();
  tick();
}
function tick() { const now = Date.now(); $$('[data-tick]').forEach(el => { el.textContent = fmtElapsed(now - +el.dataset.tick); }); }

/* ================= TODAY ================= */
function vToday() {
  const k = U.day, now = Date.now(), isToday = k === todayKey();
  const p = E.paint(k, now), sum = E.summarize(p), r = running();
  return `
  <header class="dayhead">
    <button class="icon-btn" data-act="day" data-d="-1" aria-label="Previous day">${icon('left')}</button>
    <div class="dh-mid"><h1>${esc(relDay(k))}</h1><p>${esc(fmtDate(k, true))}</p></div>
    ${isToday ? '<span class="icon-btn spacer"></span>' : `<button class="icon-btn" data-act="day" data-d="1" aria-label="Next day">${icon('right')}</button>`}
  </header>
  ${isToday ? banners(now) : `<button class="link center" data-act="goToday">${icon('today')} Back to today</button>`}
  <section class="hero">
    <div class="dial">${dialSVG(p, isToday)}<div class="dial-c">${dialCenter(p, sum, isToday, r, now)}</div></div>
    ${isToday ? nowActions(r, now) : ''}
    ${kindChips(sum)}
  </section>
  ${officeCard(k, isToday, now)}
  ${goalCard(k, sum, isToday, now)}
  ${isToday ? topAlert() : ''}
  ${isToday ? quickGrid(r) : ''}
  ${routineRow()}
  <section class="sec"><div class="sec-h"><h2>Timeline</h2>${isToday ? '' : `<button class="link" data-act="add">${icon('plus')} Add time</button>`}</div>${timeline(p, isToday)}</section>
  <section class="sec"><h2>Notes</h2><textarea id="dayNote" rows="3" placeholder="How did the day go? What will you change tomorrow?">${esc(S.notes[k]?.text || '')}</textarea></section>`;
}

function banners(now) {
  const out = [], os = openShift(), r = running();
  if (os && os.date !== todayKey()) {
    const guess = os.in + (os.target ?? S.settings.workMin) * MIN + (os.plan || []).reduce((s, p) => s + p.dur, 0) * MIN;
    out.push(`<div class="banner warn">${icon('briefcase')}<div><b>${esc(relDay(os.date))}'s office shift is still open</b><p>When did you leave?</p><div class="ci-row"><input type="time" id="staleOut" value="${hm(guess)}" aria-label="Check-out time"><button class="btn pri" data-act="closeStale" data-date="${esc(os.date)}">Set check-out</button></div></div></div>`);
  }
  if (r && now - r.start > (r.cat === SLEEP ? 16 : 10) * 3600000) out.push(`<div class="banner warn">${icon('clock')}<div><b>${esc(E.entryName(r))} has been running for ${fmtDur((now - r.start) / MIN)}</b><p>Forgot to stop it? Fix the end time.</p></div><button class="btn sm" data-act="edit" data-id="${esc(r.id)}">Fix</button></div>`);
  if (installPrompt && !isStandalone() && !S.settings.hideInstall) out.push(`<div class="banner">${icon('download')}<div><b>Install Daybook</b><p>One tap from your home screen, works offline.</p></div><button class="btn sm pri" data-act="install">Install</button><button class="icon-btn sm" data-act="hideInstall" aria-label="Dismiss">${icon('x')}</button></div>`);
  const since = S.settings.lastBackup || S.settings.installed || now;
  if (S.entries.length >= 15 && now - since > 7 * DAY) out.push(`<div class="banner">${icon('download')}<div><b>Back up your journal</b><p>Last backup ${esc(ago(S.settings.lastBackup))}. Your data lives only on this phone.</p></div><button class="btn sm" data-act="shareBackup">Back up</button></div>`);
  return out.join('');
}

function arcD(a, b, R = 118, C = 160) {
  const ang = m => (m / 1440) * Math.PI * 2 - Math.PI / 2;
  const pt = m => `${(C + R * Math.cos(ang(m))).toFixed(2)} ${(C + R * Math.sin(ang(m))).toFixed(2)}`;
  if (b - a >= 1439) return `M${pt(a)}A${R} ${R} 0 1 1 ${pt(a + 720)}A${R} ${R} 0 1 1 ${pt(a + 1439.5)}`;
  return `M${pt(a)}A${R} ${R} 0 ${b - a > 720 ? 1 : 0} 1 ${pt(b)}`;
}
function dialSVG(p, isToday) {
  let arcs = '';
  for (const r of E.runs(p)) {
    if (r.s === -2) continue;
    const g = r.b - r.a > 8 ? 1.4 : 0, a = r.a + g / 2, b = r.b - g / 2;
    if (r.s === -1) { arcs += `<path class="arc gap" d="${arcD(a, b)}" data-act="gap" data-a="${r.a}" data-b="${r.b}"/>`; continue; }
    const src = p.sources[r.s];
    arcs += `<path class="arc${r.fut ? ' fut' : ''}" d="${arcD(a, b)}" stroke="${esc(cat(src.cat).color)}" ${srcAttrs(src)}/>`;
  }
  let ticks = '';
  for (let h = 0; h < 24; h++) {
    const an = h / 24 * Math.PI * 2 - Math.PI / 2, r1 = 134, r2 = h % 6 ? 138 : 142;
    ticks += `<line x1="${(160 + r1 * Math.cos(an)).toFixed(1)}" y1="${(160 + r1 * Math.sin(an)).toFixed(1)}" x2="${(160 + r2 * Math.cos(an)).toFixed(1)}" y2="${(160 + r2 * Math.sin(an)).toFixed(1)}"/>`;
  }
  const lab = [[0, 160, 8], [360, 316, 160], [720, 160, 314], [1080, 4, 160]].map(([m, x, y]) => `<text x="${x}" y="${y}">${shortHour(m)}</text>`).join('');
  let nowDot = '';
  if (isToday) { const an = p.nowMin / 1440 * Math.PI * 2 - Math.PI / 2; nowDot = `<circle class="nowdot" cx="${(160 + 118 * Math.cos(an)).toFixed(1)}" cy="${(160 + 118 * Math.sin(an)).toFixed(1)}" r="7"/>`; }
  return `<svg viewBox="-14 -14 348 348" role="img" aria-label="24-hour view of the day. Tap a coloured block to edit it."><circle class="track" cx="160" cy="160" r="118"/>${arcs}<g class="ticks">${ticks}</g><g class="hl">${lab}</g>${nowDot}</svg>`;
}
function dialCenter(p, sum, isToday, r, now) {
  if (!isToday) return `<small>Tracked</small><strong>${fmtDur(sum.tracked)}</strong><span>${fmtDur(sum.untracked)} untracked</span>`;
  const os = S.shifts[p.k];
  if (r) { const c = cat(r.cat); return `<small><i class="dot" style="--c:${esc(c.color)}"></i>${esc(E.entryName(r))}</small><strong data-tick="${r.start}">${fmtElapsed(now - r.start)}</strong><span>since ${fmtClock(r.start)}</span>`; }
  if (os && !os.out) { const inf = E.shiftInfo(os, now); return `<small><i class="dot" style="--c:${esc(cat(OFFICE).color)}"></i>At work</small><strong>${fmtDur(inf.worked)}</strong><span>leave at ${fmtClock(inf.expectedOut)}</span>`; }
  const ends = [...S.entries.filter(e => e.end && e.end <= now).map(e => e.end), ...Object.values(S.shifts).filter(s => s.out && s.out <= now).map(s => s.out)];
  const lastEnd = ends.length ? Math.max(...ends) : 0;
  if (lastEnd && now - lastEnd < 18 * 3600000) return `<small>Untracked for</small><strong data-tick="${lastEnd}">${fmtElapsed(now - lastEnd)}</strong><span>since ${fmtClock(lastEnd)}</span>`;
  return `<small>Nothing running</small><strong>${fmtClock(now)}</strong><span>Tap an activity to start</span>`;
}
function nowActions(r, now) {
  const b = [], os = S.shifts[todayKey()], atWork = os && !os.out;
  if (r && r.cat === SLEEP) b.push(btn('wake', 'sun', "I'm awake", 'pri'));
  else if (r) {
    b.push(atWork ? btn('stop', 'briefcase', 'Back to work', 'pri') : btn('stop', 'stop', 'Stop', 'pri'));
    b.push(btn('edit', 'note', 'Note or edit', '', `data-id="${esc(r.id)}"`));
  } else {
    const h = new Date(now).getHours();
    if (h >= 4 && h < 12 && !E.sleepOf(todayKey())) b.push(btn('wake', 'sun', 'Log wake-up', 'pri'));
    if (h >= 20 || h < 3) b.push(btn('sleep', 'moon', 'Going to sleep', h >= 21 || h < 3 ? 'pri' : ''));
  }
  return b.length ? `<div class="now-acts">${b.join('')}</div>` : '';
}
function kindChips(sum) {
  const items = KIND_ORDER.map(k => [KINDS[k].name, KINDS[k].color, sum.byKind[k]]).filter(x => x[2] > 0);
  if (sum.untracked) items.push(['Untracked', 'var(--unt)', sum.untracked]);
  return items.length ? `<div class="kinds">${items.map(([n, c, v]) => `<span><i style="--c:${c}"></i>${n} <b>${fmtDur(v)}</b></span>`).join('')}</div>` : '';
}

function officeCard(k, isToday, now) {
  const sh = S.shifts[k];
  if (!sh) {
    if (!isToday) return !E.isWorkDay(k) ? '' : `<div class="card slim"><span class="muted">No office hours logged</span><button class="link" data-act="shiftNew">${icon('plus')} Add office hours</button></div>`;
    if (openShift()) return '';
    if (!E.isWorkDay(k)) return `<div class="card slim"><span class="muted">Not a work day</span><button class="link" data-act="checkin">${icon('in')} Check in anyway</button></div>`;
    const u = E.usualShift();
    if (minOfDay(now) > u.outMin + 60) return `<div class="card slim"><span class="muted">No office check-in today</span><button class="link" data-act="shiftNew">${icon('plus')} Add office hours</button></div>`;
    return `<div class="card office">
      <div class="card-h"><h2>Office</h2><span class="muted">${u.real ? 'usually' : 'e.g.'} ${fmtMinClock(u.inMin)} – ${fmtMinClock(u.outMin)}</span></div>
      <div class="ci-row"><label class="tfield"><span>In at</span><input type="time" id="ciTime" value="${hm(now)}"></label><button class="btn pri grow" data-act="checkin">${icon('in')}<span>Check in</span></button></div>
      <p class="hint">Leave time = check-in + ${fmtDur(S.settings.workMin)} of work${S.settings.breaksExtend ? ' + breaks' : ''}.${S.settings.autoLunch ? ` A ${S.settings.autoLunch}m lunch is added for you.` : ''}</p>
    </div>`;
  }
  const inf = E.shiftInfo(sh, now);
  const edit = `<button class="icon-btn sm" data-act="shift" data-date="${esc(k)}" aria-label="Edit office hours">${icon('edit')}</button>`;
  if (sh.out) {
    const ot = inf.overtime;
    return `<div class="card office">
      <div class="card-h"><h2>Office</h2>${edit}</div>
      <div class="o-sum"><div><small>In</small><b>${fmtClock(sh.in)}</b></div><div><small>Out</small><b>${fmtClock(sh.out)}</b></div><div><small>Worked</small><b>${fmtDur(inf.worked)}</b></div></div>
      <p class="hint">${Math.abs(ot) < 5 ? 'Right on target.' : ot > 0 ? `${fmtDur(ot)} more than your ${fmtDur(inf.target)}.` : `${fmtDur(-ot)} short of your ${fmtDur(inf.target)}.`} Breaks took ${fmtDur(inf.actualMin)}.</p>
      ${isToday ? `<button class="link" data-act="resume">Checked out by mistake? Resume</button>` : ''}
    </div>`;
  }
  const pct = clamp(inf.worked / inf.target * 100, 0, 100);
  const chips = [
    ...inf.breaks.map(b => `<button class="chip" data-act="edit" data-id="${esc(b.e.id)}" style="--c:${esc(cat(b.e.cat).color)}"><i></i>${esc(breakName(b.e))} ${fmtDur(b.min)}${b.future ? ' · later' : b.e.end == null ? ' · now' : ''}</button>`),
    ...inf.plans.filter(pl => !pl.matched).map(pl => `<span class="chip planned" style="--c:${esc(cat(pl.cat).color)}"><i></i>${esc(planName(pl))} ${fmtDur(pl.dur)} · planned<button data-act="rmPlan" data-date="${esc(k)}" data-pid="${esc(pl.id)}" aria-label="Remove planned ${esc(planName(pl))}">${icon('x')}</button></span>`),
  ];
  return `<div class="card office live">
    <div class="card-h"><h2>Office</h2><span class="muted">in ${fmtClock(sh.in)}</span>${edit}</div>
    <div class="leave"><small>${inf.done ? 'Target done. You can leave' : 'Leave at'}</small><strong>${fmtClock(inf.done ? Math.min(inf.expectedOut, now) : inf.expectedOut)}</strong></div>
    <div class="meter" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct.toFixed(1)}%"></i></div>
    <p class="meta"><b>${fmtDur(inf.worked)}</b> worked · ${inf.done ? `${fmtDur(inf.overtime)} extra` : `${fmtDur(inf.target - inf.worked)} to go`} · breaks ${fmtDur(inf.breakTotal)}</p>
    <div class="chips">${chips.join('')}<button class="chip add" data-act="addBreak">${icon('plus')} Break</button></div>
    <button class="btn pri wide" data-act="checkout">${icon('out')}<span>Check out</span></button>
  </div>`;
}

function goalCard(k, sum, isToday, now) {
  const goal = S.settings.goalMin, g = sum.growth, pct = clamp(g / goal, 0, 1);
  const gcats = S.cats.filter(c => c.growth && !c.hidden), r = running();
  const ring = `<svg class="ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" class="rt"/><circle cx="32" cy="32" r="27" class="rv" stroke-dasharray="${(pct * 169.65).toFixed(1)} 200" transform="rotate(-90 32 32)"/><text x="32" y="33">${Math.round(pct * 100)}%</text></svg>`;
  const per = gcats.map(c => `${esc(c.name)} ${fmtDur(sum.byCat[c.id] || 0)}`).join(' · ') || 'Choose growth activities in Settings';
  let free = '', acts = '', sleepLine = '';
  if (isToday) {
    const fw = E.freeWindows(k, now), din = E.dinnerReserve(k, now);
    const evening = fw.windows.some(([, b]) => b > dayStart(k) + 18 * 60 * MIN);
    const usable = Math.max(0, fw.total - (evening ? din : 0)), rem = goal - g;
    const list = fw.windows.slice(0, 3).map(([a, b]) => `<li><b>${fmtClock(a)} – ${fmtClock(b)}</b><span>${fmtDur((b - a) / MIN)}</span></li>`).join('');
    let advice;
    if (rem <= 0) advice = 'Goal done for today. Anything more is a bonus.';
    else if (!fw.windows.length) advice = `No free window left before your ${fmtClock(fw.bed)} bedtime.`;
    else if (usable >= rem) advice = `Your remaining ${fmtDur(rem)} fits${evening && din ? `, even after ${fmtDur(din)} for dinner` : ''}. Block it in the first window.`;
    else advice = `About ${fmtDur(usable)} is really free${evening && din ? ' after dinner' : ''}. Aim for ${fmtDur(Math.max(15, Math.min(rem, usable)))} today.`;
    free = `<div class="free"><h3>Free time left today</h3>${list ? `<ul>${list}</ul>` : ''}<p>${advice}</p></div>`;
    const growthRunning = r && gcats.some(c => c.id === r.cat);
    if (gcats.length && (rem > 0 || growthRunning)) acts = `<div class="g-acts">${gcats.map(c => r && r.cat === c.id
      ? `<button class="btn on" data-act="stop" style="--c:${esc(c.color)}">${icon('stop')}<span>Stop ${esc(c.name)}</span></button>`
      : `<button class="btn tint" data-act="tap" data-cat="${esc(c.id)}" style="--c:${esc(c.color)}">${icon('play')}<span>${esc(c.name)}</span></button>`).join('')}</div>`;
    const sd = E.sleepDebt(k);
    sleepLine = `<p class="sleepline">${icon('moon')}<span>Sleep by <b>${fmtClock(fw.bed)}</b> for ${fmtDur(S.settings.sleepMin)}${sd.n && sd.debt > 20 ? ` · ${fmtDur(sd.debt)} sleep debt this week` : ''}</span></p>`;
  }
  return `<div class="card goal">
    <div class="g-top">${ring}<div><h2>Growth time</h2><p class="g-val"><b>${fmtDur(g)}</b> of ${fmtDur(goal)}</p><p class="muted">${per}</p></div></div>
    ${free}${acts}${sleepLine}
  </div>`;
}

function topAlert() {
  const wk = weekKey(todayKey());
  const W = E.weekStats(wk), P = E.weekStats(addDays(wk, -7));
  const a = E.alerts(W, P).find(x => x.tone === 'bad');
  if (!a) return '';
  return `<button class="alert bad slimalert" data-act="toWeek">${icon('bolt')}<div><b>${esc(a.title)}</b><p>${esc(a.text)}</p></div></button>`;
}

function quickGrid(r) {
  const os = S.shifts[todayKey()], atWork = os && !os.out, now = Date.now();
  const tiles = visibleCats().map(c => {
    let label = c.name;
    if (c.id === MEALS) label = E.mealLabel(now);
    if (c.id === OFFICE) label = !os ? 'Check in' : atWork ? (r ? 'Back to work' : 'At work') : c.name;
    const on = (r && r.cat === c.id) || (c.id === OFFICE && atWork && !r);
    return `<button class="tile${on ? ' on' : ''}" data-act="tap" data-cat="${esc(c.id)}" style="--c:${esc(c.color)}"><span class="ti">${icon(c.icon)}</span><span class="tl">${esc(label)}</span></button>`;
  }).join('');
  return `<section class="sec"><h2>Start an activity</h2><p class="hint">Tap to start now. Hold to log time you already spent.</p><div class="grid">${tiles}</div></section>`;
}
function routineRow() {
  if (!S.routines.length) return '';
  return `<div class="routines"><span>${icon('repeat')}Routines</span>${S.routines.map(r => `<button class="chip" data-act="applyRoutine" data-id="${esc(r.id)}">${esc(r.name)}</button>`).join('')}</div>`;
}
function timeline(p, isToday) {
  const rs = E.runs(p).filter(r => r.s !== -2 && !(r.s === -1 && r.b - r.a < 5));
  if (!rs.some(r => r.s >= 0)) return `<div class="empty">${icon('clock')}<p>${isToday ? 'Nothing logged yet today. Tap an activity above, or + to add time you already spent.' : 'Nothing logged on this day.'}</p>${btn('add', 'plus', 'Add time')}</div>`;
  const t = m => fmtClock(p.t0 + m * MIN);
  const rows = rs.map(r => {
    if (r.s === -1) return `<button class="tl gap" data-act="gap" data-a="${r.a}" data-b="${r.b}"><time>${t(r.a)}</time><span class="bar"></span><span class="tx"><b>Untracked</b><small>${t(r.a)} – ${t(r.b)}</small></span><span class="dur">${fmtDur(r.b - r.a)}<em>Log it</em></span></button>`;
    const src = p.sources[r.s], c = cat(src.cat);
    let name, sub, note = '';
    if (src.type === 'shift') { name = 'Office work'; sub = `checked in ${fmtClock(src.shift.in)}${src.shift.out ? ` · out ${fmtClock(src.shift.out)}` : ''}`; }
    else {
      const e = src.entry; name = E.entryName(e);
      const kOver = e.kind && e.kind !== c.kind && KINDS[e.kind] ? ` · counted as ${KINDS[e.kind].name.toLowerCase()}` : '';
      sub = `${fmtClock(e.start)} – ${e.end ? fmtClock(e.end) : 'now'}${kOver}`;
      if (e.note) note = `<small class="note">${esc(e.note)}</small>`;
    }
    const live = src.type === 'entry' && src.entry.end == null;
    return `<button class="tl${r.fut ? ' fut' : ''}${live ? ' live' : ''}" ${srcAttrs(src)} style="--c:${esc(c.color)}"><time>${t(r.a)}</time><span class="bar"></span><span class="tx"><b>${icon(c.icon)}${esc(name)}${r.fut ? '<em>planned</em>' : ''}${live ? '<em class="livetag">now</em>' : ''}</b><small>${sub}</small>${note}</span><span class="dur">${fmtDur(r.b - r.a)}</span></button>`;
  }).join('');
  const n = S.entries.filter(e => e.start >= p.t0 && e.start < p.t1 && e.end && e.cat !== SLEEP).length;
  return `<div class="tline">${rows}</div>${n >= 2 ? `<button class="link" data-act="saveRoutine">${icon('repeat')} Save this day as a routine</button>` : ''}`;
}

/* ================= INSIGHTS ================= */
function vInsights() {
  const seg = `<div class="seg" role="tablist">${['day', 'week'].map(x => `<button role="tab" data-act="insMode" data-m="${x}" aria-selected="${U.ins === x}">${x === 'day' ? 'Day' : 'Week'}</button>`).join('')}</div>`;
  return `<header class="ph"><h1>Insights</h1>${seg}</header>${U.ins === 'day' ? insDay() : insWeek()}`;
}
const navRow = (label, act, canNext) => `<div class="navrow"><button class="icon-btn" data-act="${act}" data-d="-1" aria-label="Previous">${icon('left')}</button><b>${esc(label)}</b><button class="icon-btn" data-act="${act}" data-d="1" aria-label="Next" ${canNext ? '' : 'disabled'}>${icon('right')}</button></div>`;
function hrow(name, color, v, base, ic = '') {
  return `<div class="hrow"><span class="hn">${ic || `<i class="dot" style="--c:${color}"></i>`}${name}</span><span class="hb"><i style="width:${Math.min(100, v / Math.max(1, base) * 100).toFixed(1)}%;--c:${color}"></i></span><span class="hv">${fmtDur(v)}</span></div>`;
}
function stripHTML(p) {
  const bars = E.runs(p).filter(r => r.s !== -2).map(r => `<i class="${r.s === -1 ? 'u' : ''}" style="left:${(r.a / 14.4).toFixed(3)}%;width:${((r.b - r.a) / 14.4).toFixed(3)}%;${r.s >= 0 ? `--c:${esc(cat(p.sources[r.s].cat).color)}` : ''}"></i>`).join('');
  return `<span class="strip">${bars}</span>`;
}
function insDay() {
  const k = U.insDay, d = E.dayStats(k), s = d.sum, goal = S.settings.goalMin, isToday = k === todayKey();
  let title;
  if (!d.has) title = 'Nothing logged on this day';
  else if (s.byKind.waste >= 60) title = `${fmtDur(s.byKind.waste)} went to waste`;
  else if (s.growth >= goal) title = `Growth goal hit with ${fmtDur(s.growth)}`;
  else if (s.untracked >= 180) title = `${fmtDur(s.untracked)} went unlogged`;
  else title = `${fmtDur(s.byKind.productive)} of productive time`;
  const sub = d.has ? `${fmtDur(s.tracked)} tracked${isToday ? ' so far' : ''} · growth ${fmtDur(s.growth)} of ${fmtDur(goal)} · waste ${fmtDur(s.byKind.waste)}` : 'Log time on the Today tab, or pick another day.';
  const label = relDay(k) === fmtDate(k) ? fmtDate(k, true) : `${relDay(k)} · ${fmtDate(k)}`;
  const kinds = KIND_ORDER.map(x => hrow(KINDS[x].name, KINDS[x].color, s.byKind[x], s.elapsed)).join('') + hrow('Untracked', 'var(--unt)', s.untracked, s.elapsed);
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]), max = cats[0]?.[1] || 1;
  const crows = cats.map(([id, v]) => { const c = cat(id); return hrow(esc(c.name), esc(c.color), v, max, `<span class="mi" style="--c:${esc(c.color)}">${icon(c.icon)}</span>`); }).join('');
  const facts = [];
  if (d.sleep) facts.push(['Sleep', fmtDur(d.sleep.min), `${fmtClock(d.sleep.bed)} – ${fmtClock(d.sleep.wake)} · target ${fmtDur(S.settings.sleepMin)}`]);
  if (d.shift) facts.push(['Office', fmtDur(d.inf.worked), `${fmtClock(d.shift.in)} – ${d.shift.out ? fmtClock(d.shift.out) : 'now'} · breaks ${fmtDur(d.inf.actualMin)}`]);
  facts.push(['Growth', fmtDur(s.growth), s.growth >= goal ? 'goal met' : `${fmtDur(goal - s.growth)} short of goal`]);
  return `${navRow(label, 'insDay', k < todayKey())}
  <section class="finding"><h2>${esc(title)}</h2><p>${sub}</p>${stripHTML(d.p)}<div class="strip-ax">${[0, 360, 720, 1080, 1440].map(m => `<span>${shortHour(m)}</span>`).join('')}</div></section>
  <div class="facts">${facts.map(([a, b, c]) => `<div><small>${a}</small><b>${b}</b><span>${c}</span></div>`).join('')}</div>
  <section class="sec"><h2>By type</h2>${kinds}</section>
  ${crows ? `<section class="sec"><h2>By activity</h2>${crows}</section>` : ''}
  <button class="link" data-act="openDay" data-k="${esc(k)}">${icon('today')} Open this day's timeline</button>`;
}
function insWeek() {
  const wk = U.insWeek, W = E.weekStats(wk), P = E.weekStats(addDays(wk, -7)), goal = S.settings.goalMin;
  const cur = wk === weekKey(todayKey());
  let title, sub;
  if (!W.dataDays) { title = 'Nothing logged this week'; sub = 'Once you log a few days, this page shows where the week went.'; }
  else {
    title = W.goalMet ? `Growth goal met on ${W.goalMet} of ${W.dataDays} day${W.dataDays > 1 ? 's' : ''}` : 'Growth goal not met yet this week';
    sub = `${fmtDur(W.T.growth / W.n)} a day on growth · ${fmtDur(W.T.byKind.waste)} of waste${cur ? ' so far' : ''}`;
  }
  const cols = W.days.map(d => {
    const lab = dayShort(d.k);
    if (!d.has) return `<button class="col" data-act="openInsDay" data-k="${d.k}" ${d.future ? 'disabled' : ''}><span class="stack"></span><span class="cl">${lab}</span><span class="cg"></span></button>`;
    const segs = [...KIND_ORDER.map(x => [d.sum.byKind[x], KINDS[x].color, '']), [d.sum.untracked, '', 'u']].filter(x => x[0] > 0)
      .map(([v, c, cls]) => `<i class="${cls}" style="height:${(v / 14.4).toFixed(2)}%;${c ? `--c:${c}` : ''}"></i>`).join('');
    const met = d.sum.growth >= goal;
    return `<button class="col" data-act="openInsDay" data-k="${d.k}" aria-label="${esc(fmtDate(d.k))}"><span class="stack">${segs}</span><span class="cl">${lab}</span><span class="cg${met ? ' met' : ''}">${shortDur(d.sum.growth)}</span></button>`;
  }).join('');
  const legend = [...KIND_ORDER.map(x => [KINDS[x].name, KINDS[x].color]), ['Untracked', 'var(--unt)']].map(([n, c]) => `<span><i style="--c:${c}"></i>${n}</span>`).join('');
  const al = E.alerts(W, P);
  const hasP = P.n >= 1;
  const delta = (a, b, upGood) => {
    if (!hasP) return '<span class="d">–</span>';
    const dd = a - b; if (Math.abs(dd) < 3) return '<span class="d">same</span>';
    const good = upGood == null ? '' : (dd > 0) === upGood ? 'good' : 'bad';
    return `<span class="d ${good}">${dd > 0 ? '+' : '−'}${fmtDur(Math.abs(dd))}</span>`;
  };
  const perW = v => W.n ? v / W.n : 0, perP = v => P.n ? v / P.n : 0;
  const upGood = { productive: true, necessary: null, leisure: null, waste: false };
  const krows = KIND_ORDER.map(x => `<tr><td><i class="dot" style="--c:${KINDS[x].color}"></i>${KINDS[x].name}</td><td>${fmtDur(W.T.byKind[x])}</td><td>${fmtDur(perW(W.T.byKind[x]))}</td><td>${delta(perW(W.T.byKind[x]), perP(P.T.byKind[x]), upGood[x])}</td></tr>`).join('')
    + `<tr><td><i class="dot" style="--c:var(--unt)"></i>Untracked</td><td>${fmtDur(W.T.untracked)}</td><td>${fmtDur(perW(W.T.untracked))}</td><td>${delta(perW(W.T.untracked), perP(P.T.untracked), false)}</td></tr>`;
  const ids = [...new Set([...Object.keys(W.T.byCat), ...Object.keys(P.T.byCat)])].sort((a, b) => (W.T.byCat[b] || 0) - (W.T.byCat[a] || 0));
  const crows = ids.map(id => { const c = cat(id), a = W.T.byCat[id] || 0, b = P.T.byCat[id] || 0; const ug = c.growth || c.kind === 'productive' ? true : c.kind === 'waste' ? false : null;
    return `<tr><td><span class="mi" style="--c:${esc(c.color)}">${icon(c.icon)}</span>${esc(c.name)}</td><td>${fmtDur(a)}</td><td>${fmtDur(perW(a))}</td><td>${delta(perW(a), perP(b), ug)}</td></tr>`; }).join('');
  const facts = [];
  if (W.sleepN) facts.push(['Sleep', fmtDur(W.sleepAvg), `a night · in bed ${fmtMinClock(W.bedAvg)}, up ${fmtMinClock(W.wakeAvg)}`]);
  if (W.shiftN) facts.push(['Office', fmtDur(W.workedAvg), `a day · in ${fmtMinClock(W.inAvg)}, out ${fmtMinClock(W.outAvg)}`]);
  facts.push(['Growth', fmtDur(W.n ? W.T.growth / W.n : 0), `a day · goal ${fmtDur(goal)}`]);
  facts.push(['Streak', `${E.goalStreak()}d`, 'days in a row at goal']);
  return `${navRow(cur ? `This week · ${fmtWeek(wk)}` : fmtWeek(wk), 'insWeek', !cur)}
  <section class="finding"><h2>${esc(title)}</h2><p>${sub}</p>
    <div class="cols" aria-label="Each day by type, growth minutes below">${cols}</div>
    <div class="legend">${legend}</div></section>
  <section class="sec"><h2>Time leaks and wins</h2>${al.length ? al.map(a => `<div class="alert ${a.tone}">${icon(a.tone === 'good' ? 'check' : a.tone === 'bad' ? 'bolt' : 'clock')}<div><b>${esc(a.title)}</b><p>${esc(a.text)}</p></div></div>`).join('') : '<p class="hint">Log a few days and Daybook will flag where your time leaks.</p>'}</section>
  <div class="facts">${facts.map(([a, b, c]) => `<div><small>${a}</small><b>${b}</b><span>${c}</span></div>`).join('')}</div>
  <section class="sec"><h2>By type</h2><div class="scroll"><table class="tbl"><thead><tr><th>Type</th><th>Week</th><th>Per day</th><th>vs last week</th></tr></thead><tbody>${krows}</tbody></table></div></section>
  ${crows ? `<section class="sec"><h2>By activity</h2><div class="scroll"><table class="tbl"><thead><tr><th>Activity</th><th>Week</th><th>Per day</th><th>vs last week</th></tr></thead><tbody>${crows}</tbody></table></div><p class="hint">Per day counts only days you logged. "vs last week" compares daily averages.</p></section>` : ''}`;
}

/* ================= JOURNAL ================= */
function vJournal() {
  return `<header class="ph"><h1>Journal</h1></header>
  <label class="search">${icon('search')}<input id="jq" type="search" placeholder="Search your notes" value="${esc(U.q)}" autocomplete="off" aria-label="Search notes"></label>
  <div id="jlist">${journalList()}</div>`;
}
function hl(t, q) {
  if (!q) return esc(t);
  const lo = t.toLowerCase(); let out = '', i = 0, j;
  while ((j = lo.indexOf(q, i)) >= 0) { out += esc(t.slice(i, j)) + '<mark>' + esc(t.slice(j, j + q.length)) + '</mark>'; i = j + q.length; }
  return out + esc(t.slice(i));
}
function excerpt(t, q, n = 180) {
  if (!q) return t.length > n ? t.slice(0, n) + '…' : t;
  const i = t.toLowerCase().indexOf(q); if (i < 0) return t.slice(0, n);
  const a = Math.max(0, i - 60); return (a ? '…' : '') + t.slice(a, a + n) + (a + n < t.length ? '…' : '');
}
function journalList() {
  const q = U.q.trim().toLowerCase(), today = todayKey();
  const byDay = new Map();
  for (const e of S.entries) { const k = dkey(e.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
  const set = new Set([...byDay.keys(), ...Object.keys(S.notes), ...Object.keys(S.shifts)]);
  let days = [...set].filter(k => k <= today).sort().reverse();
  if (q) days = days.filter(k => (S.notes[k]?.text || '').toLowerCase().includes(q) || (byDay.get(k) || []).some(e => e.note && e.note.toLowerCase().includes(q)));
  if (!days.length) return `<div class="empty">${icon('journal')}<p>${q ? 'No notes match that search.' : 'Your days show up here once you start logging.'}</p></div>`;
  const items = days.slice(0, U.jLimit).map(k => {
    const d = E.dayStats(k), s = d.sum, note = S.notes[k]?.text || '';
    const enotes = (byDay.get(k) || []).filter(e => e.note && (!q || e.note.toLowerCase().includes(q))).sort((a, b) => a.start - b.start);
    return `<button class="jday" data-act="openDay" data-k="${esc(k)}">
      <span class="jh"><b>${esc(relDay(k) === fmtDate(k) ? fmtDate(k, true) : `${relDay(k)} · ${fmtDate(k)}`)}</b><span class="muted">${s.tracked ? `${fmtDur(s.byKind.productive)} productive · ${fmtDur(s.growth)} growth · ${fmtDur(s.byKind.waste)} waste` : 'nothing tracked'}</span></span>
      ${stripHTML(d.p)}
      ${note && (!q || note.toLowerCase().includes(q)) ? `<span class="jnote">${hl(excerpt(note, q), q)}</span>` : ''}
      ${enotes.length ? `<span class="jen">${enotes.slice(0, 4).map(e => `<span><time>${fmtClock(e.start)}</time> ${esc(E.entryName(e))}: ${hl(excerpt(e.note, q, 120), q)}</span>`).join('')}</span>` : ''}
    </button>`;
  }).join('');
  return items + (days.length > U.jLimit ? `<button class="btn wide" data-act="jmore">Show older days</button>` : '');
}

/* ================= SETTINGS ================= */
function vSettings() {
  const st = S.settings;
  const durOpts = (from, to, step, val) => { let o = ''; for (let m = from; m <= to; m += step) o += `<option value="${m}" ${m === val ? 'selected' : ''}>${fmtDur(m)}</option>`; return o; };
  const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const wd = [1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip${st.workDays.includes(d) ? ' on' : ''}" data-act="wd" data-d="${d}" aria-pressed="${st.workDays.includes(d)}">${DN[d]}</button>`).join('');
  const lunch = [0, 15, 20, 30, 45, 60].map(m => `<option value="${m}" ${m === st.autoLunch ? 'selected' : ''}>${m ? m + 'm' : 'None'}</option>`).join('');
  return `<header class="ph"><h1>Settings</h1></header>
  <section class="set">
    <h2>${icon('briefcase')}Office</h2>
    <label class="srow"><span>Work hours a day<small>Time you actually work, breaks not included</small></span><select data-set="workMin" data-num>${durOpts(240, 720, 15, st.workMin)}</select></label>
    <label class="srow"><span>Breaks push leave time later<small>Turn off if your hours already include lunch</small></span>${toggle('breaksExtend', st.breaksExtend)}</label>
    <label class="srow"><span>Lunch added at check-in<small>Counts as planned until you log the real one</small></span><select data-set="autoLunch" data-num>${lunch}</select></label>
    <div class="srow stackrow"><span>Work days</span><div class="chips">${wd}</div></div>
  </section>
  <section class="set">
    <h2>${icon('book')}Goal and sleep</h2>
    <label class="srow"><span>Daily growth goal<small>New learning and freelance work</small></span><select data-set="goalMin" data-num>${durOpts(15, 480, 15, st.goalMin)}</select></label>
    <div class="srow stackrow"><span>Counts toward the goal</span><div class="chips">${S.cats.filter(c => c.id !== SLEEP && c.id !== OFFICE).map(c => `<button class="chip${c.growth ? ' on' : ''}" data-act="growthToggle" data-id="${esc(c.id)}" aria-pressed="${!!c.growth}">${esc(c.name)}</button>`).join('')}</div></div>
    <label class="srow"><span>Sleep target</span><select data-set="sleepMin" data-num>${durOpts(300, 600, 15, st.sleepMin)}</select></label>
    <label class="srow"><span>Usual wake-up<small>Used until you've logged a few mornings</small></span><input type="time" data-set="wakeTime" value="${esc(st.wakeTime)}"></label>
  </section>
  <section class="set">
    <h2>${icon('clock')}Display</h2>
    <div class="srow"><span>Time format</span><div class="seg sm">${['12', '24'].map(x => `<button data-act="clock" data-v="${x}" aria-selected="${st.clock === x}">${x}-hour</button>`).join('')}</div></div>
  </section>
  <section class="set">
    <div class="set-h"><h2>${icon('dot')}Activities</h2><button class="link" data-act="catNew">${icon('plus')} New</button></div>
    <p class="hint">The type decides how an activity counts in reports. Hidden activities stay in your history.</p>
    <div class="clist">${S.cats.map((c, i) => `<div class="crow${c.hidden ? ' hid' : ''}" style="--c:${esc(c.color)}"><span class="ti">${icon(c.icon)}</span><button class="cname" data-act="catEdit" data-id="${esc(c.id)}"><b>${esc(c.name)}</b><small>${KINDS[c.kind]?.name || ''}${c.growth ? ' · growth' : ''}${c.hidden ? ' · hidden' : ''}</small></button><button class="icon-btn sm" data-act="catMove" data-id="${esc(c.id)}" data-d="-1" aria-label="Move ${esc(c.name)} up" ${i === 0 ? 'disabled' : ''}>${icon('chevUp')}</button><button class="icon-btn sm" data-act="catMove" data-id="${esc(c.id)}" data-d="1" aria-label="Move ${esc(c.name)} down" ${i === S.cats.length - 1 ? 'disabled' : ''}>${icon('chevDown')}</button></div>`).join('')}</div>
  </section>
  <section class="set">
    <div class="set-h"><h2>${icon('repeat')}Routines</h2><button class="link" data-act="routineNew">${icon('plus')} New</button></div>
    ${S.routines.length ? S.routines.map(r => `<button class="srow btnrow" data-act="routineEdit" data-id="${esc(r.id)}"><span>${esc(r.name)}<small>${r.items.length} items · ${r.items.map(i => esc(cat(i.cat).name)).join(', ')}</small></span>${icon('right')}</button>`).join('') : '<p class="hint">Save a typical day from its timeline, or make one here.</p>'}
  </section>
  <section class="set">
    <h2>${icon('download')}Backup and export</h2>
    <p class="hint">Everything is stored only on this phone. Last backup: <b>${esc(ago(st.lastBackup))}</b>. <span id="persist"></span></p>
    <div class="btns">
      ${btn('shareBackup', 'share', 'Share backup', 'pri')}
      ${btn('backup', 'download', 'Download backup')}
      ${btn('csv', 'download', 'Entries CSV')}
      ${btn('csvDays', 'download', 'Daily summary CSV')}
      ${btn('restore', 'upload', 'Restore from backup')}
    </div>
    <p class="hint">Share sends the backup to Drive, WhatsApp or email. CSV files open in Excel or Google Sheets.</p>
    <input type="file" id="restoreFile" accept=".json,.txt,application/json,text/plain" hidden>
  </section>
  <section class="set">
    <h2>${icon('sliders')}App</h2>
    ${installPrompt && !isStandalone() ? btn('install', 'download', 'Install Daybook on this phone', 'pri wide') : ''}
    <p class="hint">Daybook ${VERSION}. Works offline. No account, no tracking: nothing leaves your phone unless you export it.</p>
    ${btn('erase', 'trash', 'Erase all data', 'danger wide')}
  </section>`;
}
async function showPersist() {
  const el = $('#persist'); if (!el) return;
  try { const ok = await navigator.storage?.persisted?.(); el.textContent = ok ? 'Storage is protected from automatic clean-up.' : 'Install the app so Chrome keeps your data safe from clean-up.'; } catch { /* ignore */ }
}
async function ensurePersist() { try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* ignore */ } }

/* ================= SHEETS ================= */
function openSheet(title, body) {
  sheet.innerHTML = `<div class="sh"><div class="sh-h"><h2>${esc(title)}</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">${icon('x')}</button></div><div class="sh-b">${body}</div></div>`;
  if (!sheet.open) sheet.showModal();
}
function closeSheet() { if (sheet.open) sheet.close(); SH = null; }
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
sheet.addEventListener('close', () => { SH = null; });
const sheetErr = msg => { const el = $('.sh-err', sheet); if (el) { el.textContent = msg; el.hidden = false; } return null; };
const catChips = (sel, act, list) => `<div class="cpick">${list.map(c => `<button type="button" class="cp${c.id === sel ? ' on' : ''}" data-act="${act}" data-cat="${esc(c.id)}" style="--c:${esc(c.color)}"><span class="ti">${icon(c.icon)}</span><span>${esc(c.name)}</span></button>`).join('')}</div>`;

// --- Add / edit entry ---
function defaultRange(k, now) {
  const isToday = k === todayKey();
  if (isToday || k < todayKey()) {
    const p = E.paint(k, now), gaps = E.runs(p).filter(r => r.s === -1 && r.b - r.a >= 5);
    const g = gaps[gaps.length - 1];
    // Today, only offer a gap that ended recently; an old morning gap is rarely what you're logging now.
    if (g && (!isToday || now - (p.t0 + g.b * MIN) <= 120 * MIN)) {
      const a = p.t0 + g.a * MIN, b = p.t0 + g.b * MIN;
      if (b - a <= 120 * MIN) return { start: a, end: b, anchor: isToday && now - b < 3 * MIN ? 'end' : 'start' };
      return { start: b - 30 * MIN, end: b, anchor: 'end' };
    }
  }
  if (isToday) return { start: now - 30 * MIN, end: now, anchor: 'end' };
  const s = atTime(k, '12:00'); return { start: s, end: s + 30 * MIN, anchor: 'start' };
}
function openEntry(o = {}) {
  const now = Date.now();
  let e, isNew = !o.id, anchor = 'start';
  if (o.id) { const x = S.entries.find(z => z.id === o.id); if (!x) return; e = { ...x }; }
  else {
    const k = o.k || U.day;
    const rng = o.start != null ? { start: o.start, end: o.end, anchor: 'start' } : defaultRange(k, now);
    e = { cat: o.cat || null, start: rng.start, end: rng.end, note: '', kind: null };
    anchor = rng.anchor;
  }
  SH = { type: 'entry', orig: isNew ? null : e, cat: e.cat, anchor };
  const k = dkey(e.start);
  const list = S.cats.filter(c => !c.hidden || c.id === e.cat);
  const kindOpts = `<option value="">Default${e.cat ? ` (${KINDS[cat(e.cat).kind]?.name})` : ''}</option>` + KIND_ORDER.map(x => `<option value="${x}" ${e.kind === x ? 'selected' : ''}>${KINDS[x].name}</option>`).join('');
  const isRun = !isNew && e.end == null;
  openSheet(isNew ? 'Add time' : 'Edit entry', `
    ${catChips(e.cat, 'pickCat', list)}
    <label class="tfield full"><span>Day</span><input type="date" id="fDate" value="${k}" max="${todayKey()}"></label>
    <div class="frow3 two">
      <label class="tfield"><span>Start</span><input type="time" id="fStart" value="${hm(e.start)}"></label>
      <label class="tfield"><span>End</span><input type="time" id="fEnd" value="${e.end ? hm(e.end) : hm(now)}" ${isRun ? 'disabled' : ''}></label>
    </div>
    ${isRun ? `<label class="srow inline"><span>Still running</span><span class="sw"><input type="checkbox" id="fRunning" checked><i></i></span></label>` : ''}
    <div class="chips durs">${[15, 30, 45, 60, 90, 120, 180].map(m => `<button type="button" class="chip" data-act="dur" data-m="${m}">${fmtDur(m)}</button>`).join('')}${k === todayKey() ? '<button type="button" class="chip" data-act="endNow">Ends now</button>' : ''}</div>
    <p class="durline" id="fDurL"></p>
    <label class="tfield full"><span>Note</span><textarea id="fNote" rows="2" placeholder="What exactly? e.g. React course, client logo, Instagram">${esc(e.note || '')}</textarea></label>
    <label class="tfield full"><span>Counts as</span><select id="fKind">${kindOpts}</select></label>
    <p class="sh-err" hidden></p>
    <div class="sh-acts">
      ${isNew ? '' : btn('delEntry', 'trash', 'Delete', 'danger')}
      ${isRun ? btn('stopEntry', 'stop', 'Stop now') : ''}
      ${btn('saveEntry', 'check', isNew ? 'Save' : 'Save changes', 'pri grow')}
    </div>`);
  updateEntryPreview();
}
function readEntryForm(silent) {
  const kd = $('#fDate', sheet).value || U.day;
  const s = $('#fStart', sheet).value, en = $('#fEnd', sheet).value, run = $('#fRunning', sheet)?.checked;
  const fail = m => silent ? null : sheetErr(m);
  if (!SH.cat) return fail('Pick an activity first.');
  if (!s) return fail('Set a start time.');
  const start = atTime(kd, s);
  let end = null;
  if (!run) {
    if (!en) return fail('Set an end time.');
    end = atTime(kd, en); if (end <= start) end = atTime(addDays(kd, 1), en);
    if (end - start > 20 * 3600000) return fail('That is longer than 20 hours. Check the times.');
  } else if (start > Date.now()) return fail("A running activity can't start in the future.");
  return { ...(SH.orig || {}), id: SH.orig?.id || uid(), cat: SH.cat, start, end, note: $('#fNote', sheet).value.trim(), kind: $('#fKind', sheet).value || null };
}
function updateEntryPreview() {
  const el = $('#fDurL', sheet); if (!el || !SH) return;
  const f = readEntryForm(true);
  if (!f) { el.textContent = SH.cat ? '' : 'Pick what you were doing.'; return; }
  const dur = ((f.end ?? Date.now()) - f.start) / MIN;
  const ops = E.overlapOps(f);
  const cross = f.end && dkey(f.end) !== dkey(f.start) ? ' · ends next day' : '';
  el.innerHTML = `<b>${fmtDur(dur)}</b>${cross}${ops.length ? ` · <span class="warnc">overlaps ${ops.map(o => esc(E.entryName(o.e))).join(', ')}, which will be ${ops.every(o => o.type === 'del') ? 'replaced' : 'trimmed'}</span>` : ''}`;
  $$('.durs .chip', sheet).forEach(c => c.classList.toggle('on', +c.dataset.m === Math.round(dur)));
}
async function applyOverlaps(f) {
  const ops = E.overlapOps(f);
  for (const op of ops) {
    if (op.type === 'del') await delEntry(op.e.id);
    else { const o = { ...op.e }; if (op.type === 'trimStart') o.start = op.to; else o.end = op.to; await putEntry(o); }
  }
  return ops.length;
}
async function saveEntry() {
  const f = readEntryForm(); if (!f) return;
  snapshot();
  const n = await applyOverlaps(f);
  await putEntry(f);
  closeSheet(); render(); ensurePersist();
  toast(n ? `Saved · ${n} overlapping entr${n > 1 ? 'ies' : 'y'} trimmed` : 'Saved', true);
}

// --- Office ---
async function checkIn(timeStr) {
  const k = todayKey(), now = Date.now();
  let t = timeStr ? atTime(k, timeStr) : now; if (t > now) t = now;
  snapshot();
  const plan = S.settings.autoLunch ? [{ id: uid(), cat: MEALS, dur: S.settings.autoLunch, label: 'Lunch' }] : [];
  await putShift({ date: k, in: t, out: null, plan, target: S.settings.workMin });
  const r = running();
  if (r && r.cat !== OFFICE && r.start < t) { r.end = t; await putEntry(r); }
  render(); ensurePersist();
  toast(`Checked in · leave at ${fmtClock(E.shiftInfo(S.shifts[k]).expectedOut)}`, true);
}
async function checkOut(t = Date.now()) {
  const sh = S.shifts[todayKey()] && !S.shifts[todayKey()].out ? S.shifts[todayKey()] : openShift();
  if (!sh) return;
  snapshot();
  const r = running();
  if (r && r.start >= sh.in && r.cat !== SLEEP) { r.end = t; await putEntry(r); }
  sh.out = Math.max(t, sh.in + MIN); await putShift(sh);
  const inf = E.shiftInfo(sh);
  render();
  const com = cat('commute');
  if (com.id === 'commute' && !com.hidden) toast(`Checked out · ${fmtDur(inf.worked)} worked`, { label: 'Start commute', fn: () => startLive('commute') });
  else toast(`Checked out · ${fmtDur(inf.worked)} worked`, true);
}
async function startLive(id) {
  const now = Date.now(), r = running(), k = todayKey(), sh = S.shifts[k];
  if (id === OFFICE) {
    const os = openShift();
    if (!sh && os) { scrollTo(0, 0); return toast(`Set ${relDay(os.date).toLowerCase()}'s check-out first`); }
    if (!sh) return checkIn();
    if (sh && !sh.out) { if (r) return stopRunning(); return toast(`You're at work · leave at ${fmtClock(E.shiftInfo(sh).expectedOut)}`); }
  }
  if (r && r.cat === id) return stopRunning();
  snapshot();
  if (r) {
    if (now - r.start < 60000) { r.cat = id; await putEntry(r); render(); return toast(`Switched to ${cat(id).name}`, true); }
    r.end = now; await putEntry(r);
  }
  await putEntry({ id: uid(), cat: id, start: now, end: null, note: '' });
  render(); ensurePersist();
  if (id === 'commute' && sh && !sh.out) return toast('Leaving the office?', { label: 'Check out', fn: () => checkOut(now) });
  toast(`${id === MEALS ? E.mealLabel(now) : cat(id).name} started`, true);
}
async function stopRunning() {
  const r = running(); if (!r) return;
  snapshot(); r.end = Date.now();
  if (r.end - r.start < 60000) { await delEntry(r.id); render(); return toast('Removed: it ran for under a minute', true); }
  await putEntry(r); render();
  toast(`${E.entryName(r)} · ${fmtDur((r.end - r.start) / MIN)}`, true);
}

function openBreak() {
  SH = { type: 'break', cat: MEALS, dur: 30, timed: false };
  const list = visibleCats().filter(c => c.id !== OFFICE && c.id !== SLEEP);
  openSheet('Add a break', `
    <p class="hint">Breaks push your leave time later. Add one without a time to plan it, or give it a time.</p>
    ${catChips(MEALS, 'bCat', list)}
    <h3 class="lbl">How long</h3>
    <div class="chips">${[10, 15, 20, 30, 45, 60].map(m => `<button type="button" class="chip${m === 30 ? ' on' : ''}" data-act="bDur" data-m="${m}">${m}m</button>`).join('')}</div>
    <h3 class="lbl">When</h3>
    <div class="seg"><button type="button" data-act="bTimed" data-v="0" aria-selected="true">No set time</button><button type="button" data-act="bTimed" data-v="1" aria-selected="false">At a time</button></div>
    <label class="tfield" id="bTimeWrap" hidden><span>Starts at</span><input type="time" id="bTime" value="13:00"></label>
    <div class="sh-acts">${btn('saveBreak', 'check', 'Add break', 'pri grow')}</div>`);
}
async function saveBreak() {
  const k = todayKey(), sh = S.shifts[k]; if (!sh) return closeSheet();
  snapshot();
  if (SH.timed) {
    const t = atTime(k, $('#bTime', sheet).value || '13:00');
    const e = { id: uid(), cat: SH.cat, start: t, end: t + SH.dur * MIN, note: '' };
    await applyOverlaps(e); await putEntry(e);
  } else {
    sh.plan = [...(sh.plan || []), { id: uid(), cat: SH.cat, dur: SH.dur, label: SH.cat === MEALS ? 'Lunch' : SH.cat === 'rest' ? 'Break' : '' }];
    await putShift(sh);
  }
  closeSheet(); render();
  toast(`Break added · leave at ${fmtClock(E.shiftInfo(S.shifts[k]).expectedOut)}`, true);
}

function openShiftSheet(date, isNew) {
  const sh = S.shifts[date] || { date, in: atTime(date, '09:00'), out: atTime(date, '18:00'), plan: [], target: S.settings.workMin };
  SH = { type: 'shift', date, plan: (sh.plan || []).map(p => ({ ...p })), isNew: isNew || !S.shifts[date], open: !sh.out };
  const isToday = date === todayKey();
  let opts = ''; for (let m = 240; m <= 720; m += 15) opts += `<option value="${m}" ${m === (sh.target ?? S.settings.workMin) ? 'selected' : ''}>${fmtDur(m)}</option>`;
  openSheet(`Office · ${relDay(date)}`, `
    <div class="frow3 two">
      <label class="tfield"><span>Checked in</span><input type="time" id="sIn" value="${hm(sh.in)}"></label>
      <label class="tfield"><span>Checked out</span><input type="time" id="sOut" value="${sh.out ? hm(sh.out) : ''}" ${SH.open ? 'disabled' : ''}></label>
    </div>
    ${isToday ? `<label class="srow inline"><span>Still at work</span><span class="sw"><input type="checkbox" id="sOpen" ${SH.open ? 'checked' : ''}><i></i></span></label>` : ''}
    <label class="tfield full"><span>Work target this day</span><select id="sTarget">${opts}</select></label>
    <h3 class="lbl">Planned breaks without a set time</h3>
    <div id="sPlans">${planList()}</div>
    <p class="sh-err" hidden></p>
    <div class="sh-acts">${SH.isNew ? '' : btn('delShift', 'trash', 'Delete', 'danger')}${btn('saveShift', 'check', 'Save', 'pri grow')}</div>`);
}
const planList = () => (SH.plan.length ? SH.plan.map(p => `<span class="chip planned" style="--c:${esc(cat(p.cat).color)}"><i></i>${esc(planName(p))} ${fmtDur(p.dur)}<button type="button" data-act="rmPlanS" data-pid="${esc(p.id)}" aria-label="Remove">${icon('x')}</button></span>`).join('') : '<span class="muted">None</span>') + ` <button type="button" class="chip add" data-act="addPlanS">${icon('plus')} Lunch 30m</button>`;
async function saveShift() {
  const d = SH.date, ins = $('#sIn', sheet).value, outs = $('#sOut', sheet).value, open = $('#sOpen', sheet)?.checked;
  if (!ins) return sheetErr('Set the check-in time.');
  const tin = atTime(d, ins);
  let tout = null;
  if (!open) { if (!outs) return sheetErr('Set the check-out time, or tick "Still at work".'); tout = atTime(d, outs); if (tout <= tin) tout = atTime(addDays(d, 1), outs); }
  else if (tin > Date.now()) return sheetErr("Check-in can't be in the future.");
  snapshot();
  const old = S.shifts[d] || {};
  await putShift({ ...old, date: d, in: tin, out: tout, plan: SH.plan, target: +$('#sTarget', sheet).value });
  closeSheet(); render(); toast('Office hours saved', true);
}

function openWake() {
  const r = running(), now = Date.now();
  if (r && r.cat === SLEEP) { snapshot(); r.end = now; putEntry(r).then(() => { render(); toast(`Good morning · you slept ${fmtDur((now - r.start) / MIN)}`, true); }); return; }
  const wake = hm(now), bed = minToHm(hmToMin(wake) - S.settings.sleepMin);
  SH = { type: 'wake' };
  openSheet('Log your sleep', `
    <div class="frow3 two">
      <label class="tfield"><span>Went to bed</span><input type="time" id="wBed" value="${bed}"></label>
      <label class="tfield"><span>Woke up</span><input type="time" id="wUp" value="${wake}"></label>
    </div>
    <p class="hint">Tip: tap "Going to sleep" at night and "I'm awake" in the morning, and this fills itself in.</p>
    <div class="sh-acts">${btn('saveWake', 'sun', 'Save', 'pri grow')}</div>`);
}
async function saveWake() {
  const k = todayKey(), up = $('#wUp', sheet).value, bed = $('#wBed', sheet).value;
  const end = atTime(k, up);
  let start = atTime(k, bed); if (start >= end) start = atTime(addDays(k, -1), bed);
  const e = { id: uid(), cat: SLEEP, start, end, note: '' };
  snapshot(); await applyOverlaps(e); await putEntry(e);
  closeSheet(); render(); ensurePersist();
  toast(`Good morning · ${fmtDur((end - start) / MIN)} of sleep logged`, true);
}

// --- Routines ---
function openApplyRoutine(id) {
  const r = S.routines.find(x => x.id === id); if (!r) return;
  const k = U.day, now = Date.now();
  SH = { type: 'apply', items: r.items.map(it => {
    const start = atTime(k, it.start), end = start + it.dur * MIN;
    const future = end > now, overlaps = S.entries.some(e => e.start < end && (e.end ?? now) > start);
    return { ...it, startMs: start, endMs: end, future, overlaps };
  }) };
  openSheet(`${r.name} · ${relDay(k)}`, `
    <div class="checks">${SH.items.map((it, i) => { const c = cat(it.cat); return `<label class="chk" style="--c:${esc(c.color)}"><input type="checkbox" data-i="${i}" ${!it.future && !it.overlaps ? 'checked' : ''}><span class="ti">${icon(c.icon)}</span><span><b>${esc(c.id === MEALS ? E.mealLabel(it.startMs) : c.name)}</b><small>${fmtClock(it.startMs)} · ${fmtDur(it.dur)}${it.future ? ' · later today' : ''}${it.overlaps ? ' · overlaps something logged' : ''}</small></span></label>`; }).join('')}</div>
    <p class="hint">Later items and ones that clash with what you've logged start unticked.</p>
    <div class="sh-acts">${btn('saveApply', 'check', 'Log ticked items', 'pri grow')}</div>`);
}
async function saveApply() {
  const picks = $$('.checks input:checked', sheet).map(i => SH.items[+i.dataset.i]);
  if (!picks.length) return closeSheet();
  snapshot();
  for (const it of picks) { const e = { id: uid(), cat: it.cat, start: it.startMs, end: it.endMs, note: '' }; await applyOverlaps(e); await putEntry(e); }
  closeSheet(); render(); toast(`Logged ${picks.length} item${picks.length > 1 ? 's' : ''}`, true);
}
function openSaveRoutine(k) {
  const t0 = dayStart(k), t1 = t0 + DAY;
  const items = S.entries.filter(e => e.start >= t0 && e.start < t1 && e.end && e.cat !== SLEEP).sort((a, b) => a.start - b.start)
    .map(e => ({ cat: e.cat, start: hm(e.start), dur: Math.round((e.end - e.start) / MIN) }));
  SH = { type: 'routine', id: null, items };
  openRoutineEditor(`${dayShort(k)} routine`);
}
function openRoutineEditor(name, del) {
  const rows = () => SH.items.map((it, i) => `<div class="ritem"><select data-ri="${i}" data-f="cat" aria-label="Activity">${S.cats.map(c => `<option value="${esc(c.id)}" ${c.id === it.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><input type="time" data-ri="${i}" data-f="start" value="${esc(it.start)}" aria-label="Start"><select data-ri="${i}" data-f="dur" aria-label="Duration">${[5, 10, 15, 20, 30, 40, 45, 60, 75, 90, 120, 180, 240].concat(it.dur).filter((v, j, a) => a.indexOf(v) === j).sort((a, b) => a - b).map(m => `<option value="${m}" ${m === it.dur ? 'selected' : ''}>${fmtDur(m)}</option>`).join('')}</select><button type="button" class="icon-btn sm" data-act="rRm" data-i="${i}" aria-label="Remove item">${icon('x')}</button></div>`).join('');
  SH.rows = rows;
  openSheet(SH.id ? 'Edit routine' : 'New routine', `
    <label class="tfield full"><span>Name</span><input id="rName" value="${esc(name)}" maxlength="40"></label>
    <div id="rItems">${rows()}</div>
    <button type="button" class="link" data-act="rAdd">${icon('plus')} Add item</button>
    <p class="sh-err" hidden></p>
    <div class="sh-acts">${del ? btn('rDel', 'trash', 'Delete', 'danger') : ''}${btn('rSave', 'check', 'Save routine', 'pri grow')}</div>`);
}
function readRoutineRows() {
  $$('[data-ri]', sheet).forEach(el => { const it = SH.items[+el.dataset.ri]; if (!it) return; it[el.dataset.f] = el.dataset.f === 'dur' ? +el.value : el.value; });
}

// --- Categories ---
function openCatEditor(id) {
  const c = id ? { ...cat(id) } : { id: null, name: '', icon: 'star', color: SWATCHES[0], kind: 'productive', growth: false, hidden: false };
  SH = { type: 'cat', c };
  const used = id && S.entries.some(e => e.cat === id);
  const builtIn = ['sleep', 'office', 'meals', 'commute'].includes(id);
  openSheet(id ? 'Edit activity' : 'New activity', `
    <label class="tfield full"><span>Name</span><input id="cName" value="${esc(c.name)}" maxlength="28" placeholder="e.g. Side project"></label>
    <h3 class="lbl">Counts as</h3>
    <div class="seg wrap">${KIND_ORDER.map(x => `<button type="button" data-act="ceKind" data-v="${x}" aria-selected="${c.kind === x}">${KINDS[x].name}</button>`).join('')}</div>
    <label class="srow inline"><span>Counts toward growth goal</span><span class="sw"><input type="checkbox" id="cGrowth" ${c.growth ? 'checked' : ''}><i></i></span></label>
    <h3 class="lbl">Colour</h3>
    <div class="swatches">${SWATCHES.map(s => `<button type="button" class="swc${s === c.color ? ' on' : ''}" data-act="ceColor" data-v="${s}" style="--c:${s}" aria-label="Colour ${s}"></button>`).join('')}</div>
    <h3 class="lbl">Icon</h3>
    <div class="icons">${CAT_ICONS.map(n => `<button type="button" class="ic${n === c.icon ? ' on' : ''}" data-act="ceIcon" data-v="${n}" aria-label="${n}">${icon(n)}</button>`).join('')}</div>
    <label class="srow inline"><span>Hide from the start buttons</span><span class="sw"><input type="checkbox" id="cHidden" ${c.hidden ? 'checked' : ''}><i></i></span></label>
    <p class="sh-err" hidden></p>
    <div class="sh-acts">${id && !used && !builtIn ? btn('ceDel', 'trash', 'Delete', 'danger') : ''}${btn('ceSave', 'check', 'Save', 'pri grow')}</div>`);
}

/* ================= BACKUP ================= */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function markBackup() { S.settings.lastBackup = Date.now(); await saveSettings(); render(); toast('Backup saved'); }
async function backup(share) {
  const json = JSON.stringify(exportData()), name = `daybook-backup-${todayKey()}`;
  if (share) {
    const file = new File([json], `${name}.txt`, { type: 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Daybook backup' }); return markBackup(); }
      catch (err) { if (err.name === 'AbortError') return; }
    }
    toast("Sharing isn't available here, so the backup was downloaded instead.");
  }
  download(`${name}.json`, json, 'application/json'); markBackup();
}
const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCSV = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
function entriesCSV() {
  const rows = [];
  for (const e of S.entries) { const c = cat(e.cat), end = e.end ?? Date.now(); rows.push([e.start, dkey(e.start), hm(e.start), e.end ? hm(e.end) : 'running', Math.round((end - e.start) / MIN), c.name, E.entryName(e), KINDS[e.kind || c.kind]?.name || '', c.growth ? 'yes' : '', e.note || '']); }
  for (const sh of Object.values(S.shifts)) rows.push([sh.in, sh.date, hm(sh.in), sh.out ? hm(sh.out) : 'open', Math.round(((sh.out ?? Date.now()) - sh.in) / MIN), 'Office shift (in to out)', 'Office', 'Productive', '', `work target ${fmtDur(sh.target ?? S.settings.workMin)}`]);
  rows.sort((a, b) => a[0] - b[0]);
  return toCSV([['date', 'start', 'end', 'minutes', 'activity', 'label', 'type', 'growth', 'note'], ...rows.map(r => r.slice(1))]);
}
function daysCSV() {
  const keys = [...new Set([...S.entries.map(e => dkey(e.start)), ...Object.keys(S.shifts)])].sort();
  if (!keys.length) return toCSV([['date']]);
  const head = ['date', 'weekday', 'tracked_min', 'productive_min', 'necessary_min', 'leisure_min', 'waste_min', 'untracked_min', 'growth_min', 'goal_met', 'sleep_min', 'bedtime', 'wake', 'office_in', 'office_out', 'office_worked_min', ...S.cats.map(c => c.name + '_min'), 'day_note'];
  const rows = [head];
  for (let k = keys[0]; k <= todayKey(); k = addDays(k, 1)) {
    const d = E.dayStats(k), s = d.sum;
    rows.push([k, dayShort(k), s.tracked, s.byKind.productive, s.byKind.necessary, s.byKind.leisure, s.byKind.waste, s.untracked, s.growth, s.growth >= S.settings.goalMin ? 'yes' : 'no',
      d.sleep?.min ?? '', d.sleep ? hm(d.sleep.bed) : '', d.sleep ? hm(d.sleep.wake) : '', d.shift ? hm(d.shift.in) : '', d.shift?.out ? hm(d.shift.out) : '', d.inf ? d.inf.worked : '',
      ...S.cats.map(c => s.byCat[c.id] || 0), S.notes[k]?.text || '']);
  }
  return toCSV(rows);
}
async function handleRestore(file) {
  if (!file) return;
  let o, info;
  try { o = JSON.parse(await file.text()); info = validateBackup(o); }
  catch (err) { toast(String(err.message).startsWith('This file') ? err.message : "Couldn't read that file. Pick a Daybook backup."); return; }
  finally { const inp = $('#restoreFile'); if (inp) inp.value = ''; }
  openSheet('Restore backup', `
    <p>This backup has <b>${info.entries}</b> entries, <b>${info.shifts}</b> office days and <b>${info.notes}</b> notes${o.exportedAt ? `, saved ${esc(new Date(o.exportedAt).toLocaleString())}` : ''}.</p>
    <div class="opt">${btn('restoreMerge', 'repeat', "Merge with what's here", 'pri wide')}<p class="hint">Keeps your current data and adds what's missing. Where both have the same entry, the newer edit wins.</p></div>
    <div class="opt">${btn('restoreReplace', 'upload', 'Replace everything', 'danger wide')}<p class="hint">Your current data and settings are swapped for the backup's.</p></div>`);
  SH = { type: 'restore', o };
}

/* ================= DIALOGS & TOAST ================= */
function ask(title, text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    const d = $('#confirm');
    d.innerHTML = `<div class="cf"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="sh-acts"><button class="btn grow" value="no">Cancel</button><button class="btn grow ${danger ? 'danger' : 'pri'}" value="ok">${esc(okLabel)}</button></div></div>`;
    d.onclick = e => { const b = e.target.closest('button'); if (b) { d.close(); res(b.value === 'ok'); } };
    d.oncancel = () => res(false);
    d.showModal();
  });
}
let toastT, toastFn = null;
function toast(msg, action) {
  const el = $('#toast');
  const a = action === true ? { label: 'Undo', fn: async () => { if (await undo()) { render(); toast('Undone'); } } } : action;
  el.innerHTML = `<span>${esc(msg)}</span>${a ? `<button data-act="toastAct">${esc(a.label)}</button>` : ''}`;
  toastFn = a?.fn || null; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), a ? (a.long ? 20000 : 6000) : 2800);
}

/* ================= ACTIONS ================= */
const A = {
  day: t => { U.day = addDays(U.day, +t.dataset.d); if (U.day > todayKey()) U.day = todayKey(); U.follow = U.day === todayKey(); render(); scrollTo(0, 0); },
  goToday: () => { U.day = todayKey(); U.follow = true; render(); scrollTo(0, 0); },
  tap: t => startLive(t.dataset.cat),
  stop: () => stopRunning(),
  wake: () => openWake(),
  sleep: () => startLive(SLEEP),
  edit: t => openEntry({ id: t.dataset.id }),
  add: () => openEntry({ k: U.tab === 'today' ? U.day : todayKey() }),
  gap: t => { const t0 = dayStart(U.day); openEntry({ k: U.day, start: t0 + +t.dataset.a * MIN, end: t0 + +t.dataset.b * MIN }); },
  shift: t => openShiftSheet(t.dataset.date),
  shiftNew: () => openShiftSheet(U.day, true),
  checkin: () => checkIn($('#ciTime')?.value),
  checkout: () => checkOut(),
  resume: async () => { const sh = S.shifts[todayKey()]; if (!sh) return; snapshot(); sh.out = null; await putShift(sh); render(); toast('Back at work', true); },
  closeStale: async t => { const sh = S.shifts[t.dataset.date], v = $('#staleOut')?.value; if (!sh || !v) return; snapshot(); let out = atTime(sh.date, v); if (out <= sh.in) out = atTime(addDays(sh.date, 1), v); sh.out = out; await putShift(sh); render(); toast('Check-out saved', true); },
  addBreak: () => openBreak(),
  rmPlan: async t => { const sh = S.shifts[t.dataset.date]; if (!sh) return; snapshot(); sh.plan = (sh.plan || []).filter(p => p.id !== t.dataset.pid); await putShift(sh); render(); toast('Planned break removed', true); },
  applyRoutine: t => openApplyRoutine(t.dataset.id),
  saveRoutine: () => openSaveRoutine(U.day),
  toWeek: () => { U.tab = 'insights'; U.ins = 'week'; U.insWeek = weekKey(todayKey()); render(); scrollTo(0, 0); },
  insMode: t => { U.ins = t.dataset.m; render(); },
  insDay: t => { U.insDay = addDays(U.insDay, +t.dataset.d); if (U.insDay > todayKey()) U.insDay = todayKey(); render(); },
  insWeek: t => { U.insWeek = addDays(U.insWeek, 7 * +t.dataset.d); render(); },
  openInsDay: t => { U.ins = 'day'; U.insDay = t.dataset.k; render(); scrollTo(0, 0); },
  openDay: t => { U.tab = 'today'; U.day = t.dataset.k; U.follow = U.day === todayKey(); render(); scrollTo(0, 0); },
  jmore: () => { U.jLimit += 30; $('#jlist').innerHTML = journalList(); },
  hideInstall: async () => { S.settings.hideInstall = 1; await saveSettings(); render(); },
  install: async () => { if (!installPrompt) return; installPrompt.prompt(); try { await installPrompt.userChoice; } catch { /* ignore */ } installPrompt = null; render(); },
  // settings
  wd: async t => { const d = +t.dataset.d, w = S.settings.workDays; S.settings.workDays = w.includes(d) ? w.filter(x => x !== d) : [...w, d]; await saveSettings(); render(); },
  growthToggle: async t => { const c = S.cats.find(x => x.id === t.dataset.id); if (!c) return; c.growth = !c.growth; await saveCats(); render(); },
  clock: async t => { S.settings.clock = t.dataset.v; await saveSettings(); render(); },
  catNew: () => openCatEditor(null),
  catEdit: t => openCatEditor(t.dataset.id),
  catMove: async t => { const i = S.cats.findIndex(c => c.id === t.dataset.id), j = i + +t.dataset.d; if (i < 0 || j < 0 || j >= S.cats.length) return; [S.cats[i], S.cats[j]] = [S.cats[j], S.cats[i]]; await saveCats(); render(); },
  routineNew: () => { SH = { type: 'routine', id: null, items: [{ cat: 'learning', start: '20:00', dur: 60 }] }; openRoutineEditor('Evening'); },
  routineEdit: t => { const r = S.routines.find(x => x.id === t.dataset.id); if (!r) return; SH = { type: 'routine', id: r.id, items: r.items.map(i => ({ ...i })) }; openRoutineEditor(r.name, true); },
  backup: () => backup(false),
  shareBackup: () => backup(true),
  csv: () => download(`daybook-entries-${todayKey()}.csv`, entriesCSV(), 'text/csv'),
  csvDays: () => download(`daybook-days-${todayKey()}.csv`, daysCSV(), 'text/csv'),
  restore: () => $('#restoreFile')?.click(),
  restoreMerge: async () => { await importData(SH.o, 'merge'); closeSheet(); render(); toast('Backup merged'); },
  restoreReplace: async () => { const o = SH.o; if (!await ask('Replace everything?', 'Your current entries, notes and settings will be replaced by the backup.', 'Replace', true)) return; await importData(o, 'replace'); closeSheet(); render(); toast('Backup restored'); },
  erase: async () => { if (!await ask('Erase all data?', 'Every entry, note and setting on this phone will be deleted. Download a backup first if you might want it back.', 'Erase everything', true)) return; await eraseAll(); U.day = todayKey(); render(); toast('All data erased'); },
  // sheets
  closeSheet: () => closeSheet(),
  toastAct: () => { const f = toastFn; toastFn = null; $('#toast').classList.remove('show'); f && f(); },
  pickCat: t => {
    SH.cat = t.dataset.cat; $$('.cpick .cp', sheet).forEach(b => b.classList.toggle('on', b === t));
    const ko = $('#fKind', sheet)?.options[0]; if (ko) ko.textContent = `Default (${KINDS[cat(SH.cat).kind]?.name})`;
    $('.sh-err', sheet).hidden = true; updateEntryPreview();
  },
  dur: t => {
    const m = +t.dataset.m, kd = $('#fDate', sheet).value, s = $('#fStart', sheet), e = $('#fEnd', sheet);
    if ($('#fRunning', sheet)?.checked) { $('#fRunning', sheet).checked = false; e.disabled = false; }
    if (SH.anchor === 'end' && e.value) { const end = atTime(kd, e.value); s.value = hm(end - m * MIN); }
    else { const st = atTime(kd, s.value || hm(Date.now())); e.value = hm(st + m * MIN); }
    updateEntryPreview();
  },
  endNow: () => { const e = $('#fEnd', sheet); e.disabled = false; const rr = $('#fRunning', sheet); if (rr) rr.checked = false; e.value = hm(Date.now()); SH.anchor = 'end'; updateEntryPreview(); },
  saveEntry: () => saveEntry(),
  delEntry: async () => { const id = SH.orig?.id; if (!id) return; snapshot(); await delEntry(id); closeSheet(); render(); toast('Entry deleted', true); },
  stopEntry: async () => { closeSheet(); await stopRunning(); },
  bCat: t => { SH.cat = t.dataset.cat; $$('.cpick .cp', sheet).forEach(b => b.classList.toggle('on', b === t)); },
  bDur: t => { SH.dur = +t.dataset.m; $$('[data-act=bDur]', sheet).forEach(b => b.classList.toggle('on', b === t)); },
  bTimed: t => { SH.timed = t.dataset.v === '1'; $$('[data-act=bTimed]', sheet).forEach(b => b.setAttribute('aria-selected', b === t)); $('#bTimeWrap', sheet).hidden = !SH.timed; },
  saveBreak: () => saveBreak(),
  saveShift: () => saveShift(),
  delShift: async () => { if (!await ask('Delete office hours?', `Check-in and check-out for ${relDay(SH.date)} will be removed. Other entries stay.`, 'Delete', true)) return; snapshot(); await delShift(SH.date); closeSheet(); render(); toast('Office hours deleted', true); },
  rmPlanS: t => { SH.plan = SH.plan.filter(p => p.id !== t.dataset.pid); $('#sPlans', sheet).innerHTML = planList(); },
  addPlanS: () => { SH.plan.push({ id: uid(), cat: MEALS, dur: 30, label: 'Lunch' }); $('#sPlans', sheet).innerHTML = planList(); },
  saveWake: () => saveWake(),
  saveApply: () => saveApply(),
  rAdd: () => { readRoutineRows(); const last = SH.items[SH.items.length - 1]; SH.items.push({ cat: last?.cat || 'learning', start: last ? minToHm(hmToMin(last.start) + last.dur) : '08:00', dur: 30 }); $('#rItems', sheet).innerHTML = SH.rows(); },
  rRm: t => { readRoutineRows(); SH.items.splice(+t.dataset.i, 1); $('#rItems', sheet).innerHTML = SH.rows(); },
  rSave: async () => {
    readRoutineRows();
    const name = $('#rName', sheet).value.trim(); if (!name) return sheetErr('Give the routine a name.');
    if (!SH.items.length) return sheetErr('Add at least one item.');
    const items = SH.items.map(i => ({ cat: i.cat, start: i.start || '08:00', dur: +i.dur || 30 })).sort((a, b) => hmToMin(a.start) - hmToMin(b.start));
    if (SH.id) { const r = S.routines.find(x => x.id === SH.id); r.name = name; r.items = items; } else S.routines.push({ id: uid(), name, items });
    await saveRoutines(); closeSheet(); render(); toast('Routine saved');
  },
  rDel: async () => { if (!await ask('Delete routine?', 'Entries you already logged with it stay.', 'Delete', true)) return; S.routines = S.routines.filter(r => r.id !== SH.id); await saveRoutines(); closeSheet(); render(); toast('Routine deleted'); },
  ceKind: t => { SH.c.kind = t.dataset.v; $$('[data-act=ceKind]', sheet).forEach(b => b.setAttribute('aria-selected', b === t)); },
  ceColor: t => { SH.c.color = t.dataset.v; $$('.swc', sheet).forEach(b => b.classList.toggle('on', b === t)); },
  ceIcon: t => { SH.c.icon = t.dataset.v; $$('.ic', sheet).forEach(b => b.classList.toggle('on', b === t)); },
  ceSave: async () => {
    const c = SH.c; c.name = $('#cName', sheet).value.trim(); if (!c.name) return sheetErr('Give the activity a name.');
    c.growth = $('#cGrowth', sheet).checked; c.hidden = $('#cHidden', sheet).checked;
    if (c.id) { const i = S.cats.findIndex(x => x.id === c.id); S.cats[i] = c; } else { c.id = 'c-' + uid(); S.cats.push(c); }
    await saveCats(); closeSheet(); render(); toast('Activity saved');
  },
  ceDel: async () => { S.cats = S.cats.filter(x => x.id !== SH.c.id); await saveCats(); closeSheet(); render(); toast('Activity deleted'); },
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const f = A[t.dataset.act];
  if (f) { e.preventDefault(); f(t, e); }
});
$$('.tabs button').forEach(b => b.addEventListener('click', () => {
  if (U.tab === b.dataset.tab && b.dataset.tab === 'today') { U.day = todayKey(); U.follow = true; }
  U.tab = b.dataset.tab; render(); scrollTo(0, 0);
}));

// Hold a tile to log past time instead of starting now.
let lp = null;
document.addEventListener('pointerdown', e => {
  const t = e.target.closest('.tile'); if (!t) return;
  lp = { x: e.clientX, y: e.clientY, fired: false };
  lp.timer = setTimeout(() => { lp.fired = true; navigator.vibrate?.(12); openEntry({ k: U.day, cat: t.dataset.cat }); }, 480);
});
const cancelLp = () => { if (lp && !lp.fired) { clearTimeout(lp.timer); lp = null; } };
document.addEventListener('pointermove', e => { if (lp && !lp.fired && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancelLp(); });
document.addEventListener('pointerup', cancelLp);
document.addEventListener('pointercancel', cancelLp);
document.addEventListener('click', e => { if (lp && lp.fired) { e.stopPropagation(); e.preventDefault(); lp = null; } }, true);
document.addEventListener('contextmenu', e => { if (e.target.closest('.tile')) e.preventDefault(); });

const saveNote = debounce((k, v) => putNote(k, v), 500);
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'dayNote') saveNote(U.day, t.value);
  else if (t.id === 'jq') { U.q = t.value; U.jLimit = 30; $('#jlist').innerHTML = journalList(); }
  else if (SH && SH.type === 'entry' && sheet.contains(t)) {
    if (t.id === 'fStart') SH.anchor = 'start';
    if (t.id === 'fEnd') SH.anchor = 'end';
    if (t.id === 'fRunning') $('#fEnd', sheet).disabled = t.checked;
    updateEntryPreview();
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.set) {
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if ('num' in t.dataset) v = +v;
    S.settings[t.dataset.set] = v; await saveSettings(); toast('Saved');
  } else if (t.id === 'restoreFile') handleRestore(t.files[0]);
  else if (SH && SH.type === 'shift' && t.id === 'sOpen') { const o = $('#sOut', sheet); o.disabled = t.checked; if (!t.checked && !o.value) o.value = hm(Date.now()); }
  else if (SH && SH.type === 'entry' && t.id === 'fRunning') { $('#fEnd', sheet).disabled = t.checked; updateEntryPreview(); }
});

/* ================= BOOT ================= */
setInterval(tick, 1000);
setInterval(() => {
  if (document.hidden || sheet.open || $('#confirm').open) return;
  const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  if (U.tab === 'today') render();
}, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !sheet.open && !$('#confirm').open) render(); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (!sheet.open) render(); });
window.addEventListener('appinstalled', () => { installPrompt = null; render(); toast('Daybook installed'); });

function handleUrlAction() {
  const p = new URLSearchParams(location.search), a = p.get('action');
  if (!a) return;
  history.replaceState(null, '', location.pathname);
  if (a === 'add') openEntry({ k: todayKey() });
  else if (a === 'checkin') { if (!S.shifts[todayKey()]) checkIn(); }
  else if (a === 'wake') openWake();
  else if (a === 'sleep') startLive(SLEEP);
}
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const ready = w => toast('A new version of Daybook is ready', { label: 'Update', long: true, fn: () => w.postMessage('skip') });
    if (reg.waiting && had) ready(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ready(w); }); });
  }).catch(() => {});
  let done = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!had || done) return; done = true; location.reload(); });
}

(async () => {
  try { await load(); }
  catch (err) { view.innerHTML = `<div class="empty"><p>Daybook couldn't open its storage on this browser. ${esc(err.message || '')}</p></div>`; return; }
  render();
  handleUrlAction();
  registerSW();
  if (S.entries.length) ensurePersist();
})();
