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

// A blank or malformed time setting must never reach the layout maths: it
// becomes NaN, which collapses the day grid and lets blocks position themselves
// against nothing.
export function validMin(hhmm, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''));
  if (!m) return fallback;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) && mins >= 0 && mins <= 1440 ? mins : fallback;
}

export function overflowRange() {
  const start = validMin(state.settings.overflowHour, 20 * 60);
  return { start, end: start + 60 };
}

// The grid is always a real range, and always wide enough to contain everything
// scheduled that day — including a task set later than the day is meant to end.
// Anything outside it would render past the container and float over the rest
// of the screen.
export function dayBounds(day) {
  let start = validMin(state.settings.dayStart, 7 * 60);
  let end = validMin(state.settings.dayEnd, 23 * 60);
  if (end <= start) {
    start = 7 * 60;
    end = 23 * 60;
  }
  for (const r of busyRanges(day)) {
    if (Number.isFinite(r.start)) start = Math.min(start, Math.floor(r.start / 60) * 60);
    if (Number.isFinite(r.end)) end = Math.max(end, Math.ceil(r.end / 60) * 60);
  }
  return { start, end: Math.max(end, start + 60) };
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
  const { start: dayStart, end: dayEnd } = dayBounds(day);
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

// --- projects ------------------------------------------------------------
// Ongoing work, not tasks. Loose commitment: hours per week, never a time slot,
// so there's no particular day to have failed on.
export const activeProjects = () =>
  Object.values(state.projects)
    .filter((p) => !p.archived)
    .sort((a, b) => a.name.localeCompare(b.name));

const logsFor = (projectId) =>
  Object.values(state.hourLogs).filter((l) => !l.deleted && l.projectId === projectId);

export const projectMinutes = (projectId, from, to) =>
  logsFor(projectId)
    .filter((l) => l.date >= from && l.date < to)
    .reduce((sum, l) => sum + l.minutes, 0);

export const projectTotal = (projectId) =>
  logsFor(projectId).reduce((sum, l) => sum + l.minutes, 0);

export function projectWeek(project, ws = weekStart()) {
  const minutes = projectMinutes(project.id, ws, addDays(ws, 7));
  const targetMinutes = (project.weeklyTargetHours || 0) * 60;
  return {
    minutes,
    targetMinutes,
    pct: targetMinutes ? Math.min(100, Math.round((minutes / targetMinutes) * 100)) : 0,
  };
}

// "3" rather than "3.0", "1.5" rather than "1.50".
export const toHours = (minutes) => Math.round((minutes / 60) * 10) / 10;
export const hrs = (hours) => `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

// --- habits --------------------------------------------------------------
export const activeHabits = () =>
  Object.values(state.habits)
    .filter((h) => !h.archived)
    .sort((a, b) => (a.startedOn || '').localeCompare(b.startedOn || ''));

// One record per habit per day, with a deterministic id, so the phone and the
// laptop ticking the same habit on the same day converge to one record.
export const habitLogId = (habitId, date) => `${habitId}:${date}`;
export const habitDone = (habitId, date) => Boolean(state.habitLogs[habitLogId(habitId, date)]?.done);

export const daysSince = (dateStr) =>
  Math.round((parseYmd(today()) - parseYmd(dateStr)) / 86400000);

// A rolling window, never a streak. Missing a day nudges a percentage down and
// resets nothing — there is deliberately no consecutive-day counter anywhere in
// this file, because breaking a long streak is what makes people quit outright.
// The window is capped by the habit's own age so a habit started three days ago
// isn't scored out of thirty.
export function habitRolling(habit) {
  const window = Math.max(1, Math.min(30, daysSince(habit.startedOn) + 1));
  let done = 0;
  for (let n = 0; n < window; n++) {
    if (habitDone(habit.id, addDays(today(), -n))) done++;
  }
  return { done, window, pct: Math.round((done / window) * 100) };
}

// Habits take about 66 days on average to become automatic. Shown quietly, and
// only while it is still ahead of you.
export const habitAge = (habit) => daysSince(habit.startedOn) + 1;

// --- reflection ----------------------------------------------------------
export const reflectionFor = (date = today()) => state.reflections[date] || null;

// --- conflicts -----------------------------------------------------------
// Every time is offered; the app just won't let you double-book by accident.
// Hard = a real overlap with a class, event, or another task, and that blocks
// saving. Soft = a 15-minute buffer or the overflow hour, which warns and lets
// you through — those are guardrails, not facts about your day.
function labelFor(range) {
  if (range.kind === 'fixed') return range.ref.title;
  if (range.kind === 'event') return range.ref.title;
  if (range.kind === 'task') return range.ref.text;
  return 'something';
}

export function conflictsAt(day, startMin, durationMin, ignoreId) {
  const end = startMin + durationMin;
  const hits = (a, b) => startMin < b && end > a;
  const hard = [];
  const soft = [];

  for (const r of busyRanges(day)) {
    if (ignoreId && r.ref && r.ref.id === ignoreId) continue;
    if (!hits(r.start, r.end)) continue;
    if (r.kind === 'overflow') soft.push({ label: 'your overflow hour', start: r.start, end: r.end });
    else hard.push({ label: labelFor(r), start: r.start, end: r.end });
  }

  // The buffers either side of a fixed commitment, which are walking time
  // rather than something already in the diary.
  for (const b of fixedForDay(day)) {
    if (ignoreId && b.id === ignoreId) continue;
    const s = toMin(b.start);
    const e = toMin(b.end);
    if (hits(s - BUFFER, s)) soft.push({ label: `the buffer before ${b.title}`, start: s - BUFFER, end: s });
    if (hits(e, e + BUFFER)) soft.push({ label: `the buffer after ${b.title}`, start: e, end: e + BUFFER });
  }

  return { hard, soft };
}

// Merged busy time subtracted from the day, for "free 2:00–4:00pm" when
// someone is standing in front of you asking when you can meet.
export function openGaps(day, minMinutes = 30) {
  const { start, end } = dayBounds(day);
  const busy = busyRanges(day)
    .filter((r) => r.kind !== 'overflow')
    .map((r) => ({ start: Math.max(r.start, start), end: Math.min(r.end, end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const r of busy) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }

  const gaps = [];
  let cursor = start;
  for (const r of merged) {
    if (r.start - cursor >= minMinutes) gaps.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (end - cursor >= minMinutes) gaps.push({ start: cursor, end });
  return gaps;
}
