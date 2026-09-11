// A plain dropdown listing every time of day. Nothing is removed and no hour is
// off limits — the conflict is described instead, and the caller disables its
// own save button when the overlap is real.
//
// Conflicts are written into the option text, not just coloured: option styling
// is unreliable on mobile browsers (iOS Safari ignores it entirely), so colour
// is a bonus and the words are the actual signal.

import { el, fill } from './dom.js';
import { BUFFER, DEFAULT_DURATION, fmtTime, toHM, toMin, conflictsAt, freeSlots } from './util.js';

const STEP = BUFFER; // 15 minutes, matching the day grid

export function timeSelect({
  day,
  durationMin = DEFAULT_DURATION,
  value = null,
  ignoreId = null,
  allowNone = false,
  noneLabel = 'No particular time',
  onChange = () => {},
}) {
  const select = el('select', { class: 'timeselect' });
  const status = el('p', { class: 'conflict' }, '');
  const quick = el('div', { class: 'chips', style: 'margin-bottom:.5rem' });
  const node = el('div', {}, quick, select, status);

  let current = value;
  let blocked = false;
  // onChange fires only after construction. Callers routinely reference the
  // picker from inside their own handler, and firing during the constructor
  // would reach that binding before it exists.
  let live = false;

  function describe(time) {
    if (!time) return { blocked: false, tone: 'free', text: allowNone ? 'No time set — it just has to happen that day.' : '' };
    const { hard, soft } = conflictsAt(day, toMin(time), durationMin, ignoreId);
    if (hard.length) {
      const c = hard[0];
      return {
        blocked: true,
        tone: 'clash',
        text: `Overlaps ${c.label}, ${fmtTime(toHM(c.start))}–${fmtTime(toHM(c.end))}.`,
      };
    }
    if (soft.length) {
      return {
        blocked: false,
        tone: 'warn',
        text: `That's in ${soft[0].label}. You can still save it.`,
      };
    }
    return { blocked: false, tone: 'free', text: 'Nothing else is there.' };
  }

  function paint() {
    const state = describe(current);
    blocked = state.blocked;
    status.className = `conflict conflict-${state.tone}`;
    status.textContent = state.text;
    if (live) onChange();
  }

  function build() {
    fill(select);
    if (allowNone) select.append(el('option', { value: '' }, noneLabel));

    for (let m = 0; m < 24 * 60; m += STEP) {
      const time = toHM(m);
      const { hard, soft } = conflictsAt(day, m, durationMin, ignoreId);
      // The label carries the reason, so it survives any browser's option styling.
      const suffix = hard.length ? ` — ${hard[0].label}` : soft.length ? ' — buffer' : '';
      select.append(
        el(
          'option',
          {
            value: time,
            class: hard.length ? 'opt-clash' : soft.length ? 'opt-warn' : '',
          },
          `${fmtTime(time)}${suffix}`
        )
      );
    }
    select.value = current ?? '';

    // The common case still costs one tap.
    const free = freeSlots(day, durationMin).filter((s) => toMin(s) % 30 === 0).slice(0, 3);
    fill(
      quick,
      free.map((s) =>
        el(
          'button',
          {
            class: `chip${s === current ? ' on' : ''}`,
            onclick: () => {
              current = s;
              select.value = s;
              build();
            },
          },
          fmtTime(s)
        )
      )
    );
    paint();
  }

  select.addEventListener('change', () => {
    current = select.value || null;
    build();
  });

  build();
  live = true;

  return {
    node,
    value: () => current,
    blocked: () => blocked,
    // Duration and day both change while the form is open.
    update(next = {}) {
      if (next.day !== undefined) day = next.day;
      if (next.durationMin !== undefined) durationMin = next.durationMin;
      if (next.value !== undefined) current = next.value;
      build();
    },
  };
}
