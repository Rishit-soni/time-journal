// Turns entries and office shifts into minute-by-minute days, then into stats and suggestions.
import { S, cat, KINDS, OFFICE, SLEEP, MEALS } from './store.js';
import { MIN, DAY, dayStart, dayEnd, addDays, todayKey, minOfDay, hmToMin, median, avg, weekday, fmtDur, fmtMinClock } from './util.js';

export const kindOf = src => { const k = (src.entry && src.entry.kind) || cat(src.cat).kind; return KINDS[k] ? k : 'necessary'; };
export const isWorkDay = k => S.settings.workDays.includes(weekday(k));
export function mealLabel(ms) { const m = minOfDay(ms); return m < 660 ? 'Breakfast' : m < 960 ? 'Lunch' : m < 1140 ? 'Snack' : 'Dinner'; }
export const entryName = e => e.cat === MEALS ? mealLabel(e.start) : cat(e.cat).name;

// Paint one calendar day: each minute points at the source (entry or shift) that covers it.
// Office shifts are the bottom layer; entries go on top, later starts winning.
export function paint(k, now = Date.now()) {
  const t0 = dayStart(k), t1 = dayEnd(k), N = Math.round((t1 - t0) / MIN);
  const src = new Int32Array(N).fill(-1), sources = [];
  const toMin = t => Math.max(0, Math.min(N, Math.round((t - t0) / MIN)));
  const fill = (a, b, i) => { const x = toMin(a), y = toMin(b); for (let m = x; m < y; m++) src[m] = i; };
  for (const d of [addDays(k, -1), k]) {
    const sh = S.shifts[d]; if (!sh || !sh.in) continue;
    const end = sh.out ?? Math.max(now, sh.in);
    if (sh.in < t1 && end > t0) { sources.push({ type: 'shift', shift: sh, cat: OFFICE }); fill(sh.in, end, sources.length - 1); }
  }
  const es = S.entries.filter(e => e.start < t1 && (e.end ?? now) > t0).sort((a, b) => a.start - b.start || (a.created || 0) - (b.created || 0));
  for (const e of es) { sources.push({ type: 'entry', entry: e, cat: e.cat }); fill(e.start, e.end ?? Math.max(now, e.start), sources.length - 1); }
  const nowMin = now <= t0 ? 0 : now >= t1 ? N : Math.floor((now - t0) / MIN);
  return { k, t0, t1, N, src, sources, nowMin };
}

// Contiguous blocks. s = source index, -1 untracked (past), -2 not yet happened.
export function runs(p) {
  const out = []; let i = 0;
  while (i < p.N) {
    const s = p.src[i]; let j = i + 1;
    while (j < p.N && p.src[j] === s) j++;
    if (s === -1) {
      if (i < p.nowMin) out.push({ s: -1, a: i, b: Math.min(j, p.nowMin) });
      if (j > p.nowMin) out.push({ s: -2, a: Math.max(i, p.nowMin), b: j });
    } else out.push({ s, a: i, b: j, fut: i >= p.nowMin });
    i = j;
  }
  return out;
}

export function summarize(p) {
  const byCat = {}, byKind = { productive: 0, necessary: 0, leisure: 0, waste: 0 };
  let untracked = 0, growth = 0, tracked = 0;
  for (let m = 0; m < p.nowMin; m++) {
    const s = p.src[m]; if (s < 0) { untracked++; continue; }
    const src = p.sources[s];
    byCat[src.cat] = (byCat[src.cat] || 0) + 1;
    byKind[kindOf(src)]++;
    if (cat(src.cat).growth) growth++;
    tracked++;
  }
  return { byCat, byKind, untracked, growth, tracked, elapsed: p.nowMin };
}

function matchPlans(plan, list) {
  const claimed = new Set(); let plannedMin = 0; const plans = [];
  for (const pl of plan || []) {
    const m = list.find(b => b.e.cat === pl.cat && !claimed.has(b.e.id));
    if (m) { claimed.add(m.e.id); plans.push({ ...pl, matched: m.e }); } else { plannedMin += pl.dur; plans.push({ ...pl }); }
  }
  return { plannedMin, plans };
}

// Office maths: work done, breaks, and the suggested out-time.
export function shiftInfo(sh, now = Date.now()) {
  const target = sh.target ?? S.settings.workMin;
  const end = sh.out ?? Math.max(now, sh.in);
  const span = Math.max(0, Math.round((end - sh.in) / MIN));
  const mask = new Uint8Array(span), breaks = [];
  const others = S.entries.filter(e => e.cat !== OFFICE);
  for (const e of others) {
    const ee = e.end ?? now;
    const a = Math.max(0, Math.round((e.start - sh.in) / MIN)), b = Math.min(span, Math.round((ee - sh.in) / MIN));
    if (b > a) { for (let m = a; m < b; m++) mask[m] = 1; breaks.push({ e, min: b - a }); }
  }
  let actualMin = 0; for (const v of mask) actualMin += v;
  const extend = S.settings.breaksExtend;
  const outFor = brk => sh.in + (target + (extend ? brk : 0)) * MIN;
  // Breaks already logged for later today (e.g. lunch at 1 PM) count too, if they fall before the out-time.
  const later = sh.out ? [] : others.filter(e => e.end && e.start >= end).sort((a, b) => a.start - b.start);
  let fut = [], futMin = 0, res = matchPlans(sh.plan, breaks), out = outFor(actualMin + res.plannedMin);
  for (let i = 0; i < 4 && later.length; i++) {
    const nf = later.filter(e => e.start < out);
    if (nf.length === fut.length) break;
    fut = nf.map(e => ({ e, min: Math.round((e.end - e.start) / MIN), future: true }));
    futMin = fut.reduce((s, b) => s + b.min, 0);
    res = matchPlans(sh.plan, [...breaks, ...fut]);
    out = outFor(actualMin + futMin + res.plannedMin);
  }
  const worked = Math.max(0, span - actualMin);
  return { target, worked, actualMin, futMin, plannedMin: res.plannedMin, breakTotal: actualMin + futMin + res.plannedMin, breaks: [...breaks, ...fut], plans: res.plans, expectedOut: out, done: worked >= target, overtime: worked - target };
}

// Main sleep that ended on the morning of day k.
export function sleepOf(k) {
  const lo = dayStart(k) + 3 * 60 * MIN, hi = dayStart(k) + 14 * 60 * MIN;
  const es = S.entries.filter(e => e.cat === SLEEP && e.end && e.end > lo && e.end <= hi && e.end - e.start >= 90 * MIN);
  if (!es.length) return null;
  return { bed: Math.min(...es.map(e => e.start)), wake: Math.max(...es.map(e => e.end)), min: Math.round(es.reduce((s, e) => s + (e.end - e.start) / MIN, 0)) };
}
export function usualWakeMin(ref = todayKey()) {
  const xs = [];
  for (let i = 0; i < 14; i++) { const s = sleepOf(addDays(ref, -i)); if (s) xs.push(minOfDay(s.wake)); }
  return xs.length >= 2 ? Math.round(median(xs)) : hmToMin(S.settings.wakeTime);
}
export const bedtimeFor = k => dayStart(addDays(k, 1)) + (usualWakeMin(k) - S.settings.sleepMin) * MIN;
export function sleepDebt(k = todayKey()) {
  const wk = weekKeyOf(k); let debt = 0, n = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(wk, i); if (d > k) break; const s = sleepOf(d); if (s) { debt += S.settings.sleepMin - s.min; n++; } }
  return { debt, n };
}
function weekKeyOf(k) { const wd = (weekday(k) + 6) % 7; return addDays(k, -wd); }

export function avgCommute() {
  const since = Date.now() - 21 * DAY;
  const xs = S.entries.filter(e => e.cat === 'commute' && e.end && e.start > since).map(e => (e.end - e.start) / MIN);
  return xs.length ? Math.round(median(xs)) : 0;
}
export function usualShift() {
  const list = Object.values(S.shifts).filter(s => s.in && s.out).sort((a, b) => b.in - a.in).slice(0, 15);
  if (list.length >= 2) return { inMin: Math.round(median(list.map(s => minOfDay(s.in)))), outMin: Math.round(median(list.map(s => minOfDay(s.out)))), real: true };
  const inMin = 9 * 60;
  return { inMin, outMin: inMin + S.settings.workMin + (S.settings.breaksExtend ? S.settings.autoLunch : 0), real: false };
}
export function dinnerReserve(k, now = Date.now()) {
  const after = dayStart(k) + 17 * 60 * MIN;
  if (S.entries.some(e => e.cat === MEALS && e.start >= after && e.start < dayEnd(k))) return 0;
  const since = now - 21 * DAY;
  const xs = S.entries.filter(e => e.cat === MEALS && e.end && e.start > since && minOfDay(e.start) >= 1110).map(e => (e.end - e.start) / MIN);
  return xs.length ? Math.round(median(xs)) : 30;
}

// Free windows left today between now and bedtime, skipping office hours and planned entries.
export function freeWindows(k, now = Date.now()) {
  const bed = bedtimeFor(k);
  if (k !== todayKey()) return { windows: [], bed, total: 0 };
  const r = S.entries.find(e => e.end == null);
  if (r && r.cat === SLEEP) return { windows: [], bed, total: 0 };
  const busy = [], commute = avgCommute(), sh = S.shifts[k];
  if (sh && !sh.out) busy.push([sh.in, shiftInfo(sh, now).expectedOut + commute * MIN]);
  else if (!sh && isWorkDay(k)) { const u = usualShift(); busy.push([dayStart(k) + (u.inMin - commute) * MIN, dayStart(k) + (u.outMin + commute) * MIN]); }
  for (const e of S.entries) if (e.end && e.end > now && e.start < bed) busy.push([e.start, e.end]);
  busy.sort((a, b) => a[0] - b[0]);
  const windows = []; let cur = now;
  for (const [a, b] of busy) {
    if (cur >= bed) break;
    if (a > cur) windows.push([cur, Math.min(a, bed)]);
    cur = Math.max(cur, b);
  }
  if (cur < bed) windows.push([cur, bed]);
  const w = windows.filter(([a, b]) => b - a >= 20 * MIN);
  return { windows: w, bed, total: Math.round(w.reduce((s, [a, b]) => s + (b - a) / MIN, 0)) };
}

// When a new or edited entry overlaps others, trim or remove the others so the newest wins.
export function overlapOps(ne, now = Date.now()) {
  const ops = [], nEnd = ne.end ?? now;
  for (const o of S.entries) {
    if (o.id === ne.id) continue;
    const oEnd = o.end ?? now;
    if (o.start >= nEnd || oEnd <= ne.start) continue;
    if (o.start >= ne.start && oEnd <= nEnd) ops.push({ type: 'del', e: o });
    else if (o.start >= ne.start) ops.push({ type: 'trimStart', e: o, to: nEnd });
    else if (oEnd <= nEnd) ops.push({ type: 'trimEnd', e: o, to: ne.start });
  }
  return ops;
}

export function dayStats(k, now = Date.now()) {
  const p = paint(k, now), sum = summarize(p), sh = S.shifts[k];
  return { k, p, sum, sleep: sleepOf(k), shift: sh || null, inf: sh ? shiftInfo(sh, now) : null, has: sum.tracked > 0 };
}
const normBed = m => m < 12 * 60 ? m + 1440 : m;
export function weekStats(wk, now = Date.now()) {
  const today = todayKey(), days = [];
  for (let i = 0; i < 7; i++) { const k = addDays(wk, i); days.push(k > today ? { k, future: true, has: false } : dayStats(k, now)); }
  const T = { byCat: {}, byKind: { productive: 0, necessary: 0, leisure: 0, waste: 0 }, untracked: 0, growth: 0, tracked: 0 };
  const dd = days.filter(d => d.has);
  let n = 0;
  for (const d of dd) {
    for (const [c, v] of Object.entries(d.sum.byCat)) T.byCat[c] = (T.byCat[c] || 0) + v;
    for (const kd in d.sum.byKind) T.byKind[kd] += d.sum.byKind[kd];
    T.untracked += d.sum.untracked; T.growth += d.sum.growth; T.tracked += d.sum.tracked;
    n += d.sum.elapsed / 1440;
  }
  const sleeps = days.filter(d => d.sleep).map(d => d.sleep);
  const shifts = days.filter(d => d.shift && d.shift.out);
  return {
    wk, days, T, n, dataDays: dd.length,
    goalMet: dd.filter(d => d.sum.growth >= S.settings.goalMin).length,
    sleepN: sleeps.length, sleepAvg: avg(sleeps.map(s => s.min)),
    bedAvg: sleeps.length ? avg(sleeps.map(s => normBed(minOfDay(s.bed)))) : null,
    wakeAvg: avg(sleeps.map(s => minOfDay(s.wake))),
    lateNights: sleeps.filter(s => normBed(minOfDay(s.bed)) > 1440 + 30).length,
    shiftN: shifts.length, inAvg: avg(shifts.map(d => minOfDay(d.shift.in))), outAvg: avg(shifts.map(d => minOfDay(d.shift.out))),
    workedAvg: avg(shifts.map(d => d.inf.worked)), overtimeAvg: avg(shifts.map(d => d.inf.overtime)),
  };
}
export function goalStreak() {
  const met = k => summarize(paint(k)).growth >= S.settings.goalMin;
  let k = todayKey(), n = met(k) ? 1 : 0;
  k = addDays(k, -1);
  while (n < 400 && met(k)) { n++; k = addDays(k, -1); }
  return n;
}

// Time-leak alerts and wins, this week against last week, per day.
export function alerts(W, P) {
  const out = [], goal = S.settings.goalMin;
  if (W.n < 0.3) return out;
  const per = (X, c) => X.n ? (X.T.byCat[c] || 0) / X.n : 0;
  const hasPrev = P.n >= 1;
  for (const c of S.cats) {
    if (c.kind !== 'waste' && c.kind !== 'leisure') continue;
    const a = per(W, c.id), b = per(P, c.id);
    if (hasPrev && b >= 10 && a >= 20 && a >= b * 1.25) out.push({ tone: 'bad', title: `${c.name} up ${Math.round((a / b - 1) * 100)}%`, text: `${fmtDur(a)} a day this week, up from ${fmtDur(b)} a day last week.`, score: a - b + 30 });
    else if (c.kind === 'waste' && a >= 45 && !(hasPrev && b >= 10)) out.push({ tone: 'bad', title: `${c.name}: ${fmtDur(a)} a day`, text: `At this pace that's ${fmtDur(a * 7)} a week.`, score: a });
    else if (hasPrev && b >= 20 && a <= b * 0.75) out.push({ tone: 'good', title: `${c.name} down ${Math.round((1 - a / b) * 100)}%`, text: `${fmtDur(a)} a day, down from ${fmtDur(b)}.`, score: b - a });
  }
  const waste = W.T.byKind.waste / W.n, g = W.T.growth / W.n;
  if (waste >= 45) {
    const short = goal - g;
    out.push({ tone: 'bad', title: `${fmtDur(waste)} a day goes to waste`, text: short > 0 ? `Moving half of it to learning or freelance would add ${fmtDur(waste / 2)} a day. You're ${fmtDur(short)} a day short of your goal.` : `That's ${fmtDur(waste * 7)} over a full week.`, score: waste });
  }
  const unt = W.T.untracked / W.n;
  if (unt >= 120) out.push({ tone: 'info', title: `${fmtDur(unt)} a day is untracked`, text: 'Unlogged time is usually where time leaks. Tap the dashed gaps on Today to fill them in.', score: unt / 2 });
  if (W.sleepN >= 2 && W.sleepAvg < S.settings.sleepMin - 30) out.push({ tone: 'bad', title: `Sleeping ${fmtDur(W.sleepAvg)} a night`, text: `${fmtDur(S.settings.sleepMin - W.sleepAvg)} under your ${fmtDur(S.settings.sleepMin)} target.`, score: 50 });
  if (W.lateNights >= 3) out.push({ tone: 'bad', title: `In bed after ${fmtMinClock(30)} on ${W.lateNights} nights`, text: 'Late nights shrink the next evening too.', score: 40 });
  if (W.shiftN >= 2 && W.overtimeAvg >= 30) out.push({ tone: 'info', title: `Staying ${fmtDur(W.overtimeAvg)} past your hours`, text: `That's ${fmtDur(W.overtimeAvg * W.shiftN)} this week beyond ${fmtDur(S.settings.workMin)} a day.`, score: 30 });
  const pg = hasPrev ? P.T.growth / P.n : 0;
  if (hasPrev && g >= pg + 15) out.push({ tone: 'good', title: `Growth time up ${fmtDur(g - pg)} a day`, text: `${fmtDur(g)} a day on learning and freelance, up from ${fmtDur(pg)}.`, score: 25 });
  if (W.goalMet) out.push({ tone: 'good', title: `Goal met on ${W.goalMet} day${W.goalMet > 1 ? 's' : ''}`, text: `${fmtDur(goal)} or more of learning and freelance.`, score: 20 });
  const rank = t => t === 'bad' ? 0 : t === 'info' ? 1 : 2;
  return out.sort((a, b) => rank(a.tone) - rank(b.tone) || b.score - a.score);
}
