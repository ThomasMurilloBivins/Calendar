// Dates, times, free-slot maths, and derived values.
// Nothing here is cached or precomputed: the free tier has no background jobs,
// so every value a screen shows is a pure function of `state` and `now`.

import { state } from './store.js';

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DEFAULT_DURATION = 30;
export const BUFFER = 15;

// --- dates ---------------------------------------------------------------
export function ymd(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const today = () => ymd();
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export const weekdayOf = (s) => parseYmd(s).getDay();
export function weekStart(s = today()) {
  return addDays(s, -weekdayOf(s));
}
export function fmtDate(s) {
  const d = parseYmd(s);
  return `${DOW[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
export function relativeDay(s) {
  if (s === today()) return 'Today';
  if (s === addDays(today(), 1)) return 'Tomorrow';
  if (s === addDays(today(), -1)) return 'Yesterday';
  return fmtDate(s);
}

// --- times ---------------------------------------------------------------
export function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}
export function toHM(min) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(min / 60))}:${p(min % 60)}`;
}
export function fmtTime(hhmm) {
  const m = toMin(hhmm);
  const h = Math.floor(m / 60);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m % 60 ? `${h12}:${String(m % 60).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}
export function fmtDuration(min) {
  if (min < 60) return `${min}m`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h}h` : `${Math.floor(h)}h ${min % 60}m`;
}

// --- the day's shape -----------------------------------------------------
export const activeItems = () => Object.values(state.items).filter((i) => i.status !== 'dropped');

export function itemsForDay(day) {
  return activeItems()
    .filter((i) => i.day === day && i.status !== 'inbox')
    .sort((a, b) => toMin(a.time || '23:59') - toMin(b.time || '23:59'));
}

export function eventsForDay(day) {
  return Object.values(state.events)
    .filter((e) => !e.deleted && e.date === day)
    .sort((a, b) => toMin(a.time || '00:00') - toMin(b.time || '00:00'));
}

export function fixedForDay(day) {
  const dow = weekdayOf(day);
  return Object.values(state.fixedBlocks)
    .filter((b) => !b.deleted && b.weekday === dow)
    .sort((a, b) => toMin(a.start) - toMin(b.start));
}

export function overflowRange() {
  const start = toMin(state.settings.overflowHour);
  return { start, end: start + 60 };
}

// Everything occupying time on `day`, as {start, end} minute ranges.
// `padded` expands fixed commitments by the 15-minute buffers so nothing gets
// scheduled flush against a class you have to walk to.
export function busyRanges(day, { padded = false } = {}) {
  const ranges = [];
  for (const b of fixedForDay(day)) {
    ranges.push({
      start: toMin(b.start) - (padded ? BUFFER : 0),
      end: toMin(b.end) + (padded ? BUFFER : 0),
      kind: 'fixed',
      ref: b,
    });
  }
  for (const i of itemsForDay(day)) {
    if (!i.time) continue;
    const start = toMin(i.time);
    ranges.push({ start, end: start + (i.durationMin || DEFAULT_DURATION), kind: 'task', ref: i });
  }
  for (const e of eventsForDay(day)) {
    if (!e.time) continue;
    const start = toMin(e.time);
    ranges.push({ start, end: start + (e.durationMin || DEFAULT_DURATION), kind: 'event', ref: e });
  }
  const of = overflowRange();
  ranges.push({ start: of.start, end: of.end, kind: 'overflow' });
  return ranges.sort((a, b) => a.start - b.start);
}

// Candidate start times on a 15-minute grid. The overflow hour is excluded on
// purpose — it is the catch-up slot, and it only works if it stays empty.
export function freeSlots(day, durationMin = DEFAULT_DURATION) {
  const dayStart = toMin(state.settings.dayStart);
  const dayEnd = toMin(state.settings.dayEnd);
  const busy = busyRanges(day, { padded: true });
  const now = new Date();
  const earliest = day === today() ? now.getHours() * 60 + now.getMinutes() : -1;
  const slots = [];
  for (let s = dayStart; s + durationMin <= dayEnd; s += BUFFER) {
    if (s < earliest) continue;
    if (busy.some((r) => s < r.end && s + durationMin > r.start)) continue;
    slots.push(toHM(s));
  }
  return slots;
}

// --- derived values ------------------------------------------------------
export const inboxItems = () =>
  activeItems()
    .filter((i) => i.status === 'inbox')
    .sort((a, b) => b.createdAt - a.createdAt);

export const todaysThree = (day = today()) =>
  activeItems()
    .filter((i) => i.top3For === day)
    .sort((a, b) => toMin(a.time || '23:59') - toMin(b.time || '23:59'));

// A task is overdue when its day has passed and it was never finished. It is
// never highlighted red or counted against anything — it just gets offered the
// three choices: reschedule, shrink, drop.
export const overdueItems = () =>
  activeItems().filter((i) => i.status === 'planned' && i.day && i.day < today());

// Endowed progress: the bar starts at 20% because planning the day was itself
// work. Completing tasks fills the remaining 80%.
export function dayProgress(day = today()) {
  const three = todaysThree(day);
  const done = three.filter((i) => i.status === 'done').length;
  const pct = three.length ? 20 + (80 * done) / three.length : 20;
  return { pct: Math.round(pct), done, total: three.length };
}

export function weekDone(ws = weekStart()) {
  const end = addDays(ws, 7);
  return activeItems().filter(
    (i) => i.status === 'done' && i.completedOn && i.completedOn >= ws && i.completedOn < end
  ).length;
}

// Moderately challenging beats easy or heroic: aim just above the recent
// average rather than at an aspirational number.
export function suggestedTarget() {
  const past = [1, 2, 3, 4].map((n) => weekDone(addDays(weekStart(), -7 * n)));
  const seen = past.filter((n) => n > 0);
  if (!seen.length) return 10;
  const avg = seen.reduce((a, b) => a + b, 0) / seen.length;
  return Math.min(20, Math.max(5, Math.round(avg * 1.1)));
}

export function weekGoal(ws = weekStart()) {
  return state.weeklyGoals[ws]?.target || suggestedTarget();
}

export const places = () =>
  [...new Set(activeItems().map((i) => i.where).filter(Boolean))].slice(0, 6);
