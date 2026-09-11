import { state, put, patch, setSettings } from '../store.js';
import { el, toast, openOverlay } from '../dom.js';
import { eventForm, daySummary } from './week.js';
import {
  DOW,
  BUFFER,
  DEFAULT_DURATION,
  today as todayStr,
  fmtDate,
  fmtTime,
  toMin,
  toHM,
  addDays,
  relativeDay,
  freeSlots,
  overdueItems,
  itemsForDay,
  activeHabits,
  habitDone,
  habitLogId,
  reflectionFor,
  eventsForDay,
  fixedForDay,
  overflowRange,
  dayBounds,
  validMin,
  todaysThree,
  dayProgress,
  weekDone,
  weekGoal,
  weekStart,
  suggestedTarget,
} from '../util.js';

const PX_PER_MIN = 1; // .hour is 60px tall

// --- the now line --------------------------------------------------------
// One timer for the life of the app rather than one per render, which would
// leak an interval every time the screen redraws. It moves the line in place
// instead of re-rendering, so it can't disturb anything being typed.
let nowLine = null;
let nowLineStart = 0;
let nowLineEnd = 0;

function placeNowLine() {
  // No isConnected check: the first placement happens while the element is
  // still being assembled, before it is in the document. A stale line from a
  // previous render is detached and harmless.
  if (!nowLine) return;
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  // Hidden outside the grid's range rather than clamped to an edge, which
  // would claim it is 7am at three in the morning.
  if (mins < nowLineStart || mins > nowLineEnd) {
    nowLine.hidden = true;
    return;
  }
  nowLine.hidden = false;
  nowLine.style.top = `${(mins - nowLineStart) * PX_PER_MIN}px`;
  nowLine.firstChild.textContent = fmtTime(toHM(mins));
}

setInterval(placeNowLine, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) placeNowLine();
});

// --- capture -------------------------------------------------------------
// One field, no dropdowns, no required anything. Enter saves it to the Inbox
// and the field stays focused so a second thought costs nothing.
// The input is created once and re-used across renders. Saving re-renders the
// screen, and a brand new input each time would drop the keyboard on a phone
// after every single capture.
const captureInput = el('input', {
  type: 'text',
  placeholder: "What's on your mind?",
  enterkeyhint: 'done',
  autocomplete: 'off',
  autocapitalize: 'sentences',
});

function capture() {
  const submit = (e) => {
    e.preventDefault();
    const text = captureInput.value.trim();
    if (!text) return;
    put('items', { text, createdAt: Date.now(), status: 'inbox' });
    captureInput.value = '';
    captureInput.focus();
    toast('In your inbox');
  };
  return el(
    'form',
    { class: 'capture', onsubmit: submit },
    captureInput,
    el('button', { type: 'submit', 'aria-label': 'Save to inbox' }, '↑')
  );
}

// --- progress ------------------------------------------------------------
function progress() {
  const { pct, done, total } = dayProgress();
  return el(
    'section',
    {},
    el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${pct}%` })),
    el(
      'p',
      { class: 'muted' },
      total
        ? `${done} of ${total} done — planning the day already counted.`
        : 'Planning the day already counted.'
    )
  );
}

function goalEditor(close) {
  const ws = weekStart();
  const suggested = suggestedTarget();
  const input = el('input', { type: 'number', min: '1', max: '40', value: String(weekGoal()) });
  const note = el('p', { class: 'muted' }, '');
  const check = () => {
    const n = Number(input.value);
    note.textContent =
      n > suggested * 1.5
        ? `That's a big jump from your recent pace of about ${suggested}. Moderate goals are the ones people are still keeping a year later.`
        : n < Math.max(3, suggested * 0.5)
          ? `You can aim higher than that — around ${suggested} looks like your pace.`
          : `About right for your recent pace (${suggested}).`;
  };
  input.addEventListener('input', check);
  check();
  return el(
    'div',
    { class: 'sheet' },
    el('h1', {}, 'Weekly goal'),
    el('p', { class: 'muted' }, 'How many tasks do you want to finish this week?'),
    el('label', {}, 'Tasks'),
    input,
    note,
    el(
      'div',
      { class: 'row', style: 'margin-top:1.2rem' },
      el('button', { class: 'ghost', onclick: close }, 'Cancel'),
      el(
        'button',
        {
          class: 'primary',
          onclick: () => {
            put('weeklyGoals', { id: ws, target: Math.max(1, Number(input.value) || suggested) });
            close();
          },
        },
        'Save'
      )
    )
  );
}

// Progress monitoring only helps when it's frequent and in view, so the week
// sits on the home screen rather than behind a tab.
function weeklyGoal() {
  const done = weekDone();
  const target = weekGoal();
  const pct = Math.min(100, Math.round((done / target) * 100));
  return el(
    'button',
    { class: 'card', style: 'width:100%;text-align:left', onclick: () => openOverlay(goalEditor) },
    el(
      'div',
      { style: 'display:flex;justify-content:space-between;align-items:baseline' },
      el('strong', { style: 'font-size:.9rem' }, 'This week'),
      el('span', { class: 'muted' }, `${done} of ${target}`)
    ),
    el(
      'div',
      { class: 'bar bar-small', style: 'margin-top:.5rem' },
      el('div', { class: 'bar-fill', style: `width:${pct}%` })
    )
  );
}

// --- today's three -------------------------------------------------------
function taskRow(item) {
  const done = item.status === 'done';
  const meta = [item.time && fmtTime(item.time), item.where].filter(Boolean).join(' · ');
  return el(
    'div',
    { class: `card task${done ? ' done' : ''}` },
    el(
      'button',
      {
        class: `task-check${done ? ' on' : ''}`,
        'aria-label': done ? 'Mark not done' : 'Mark done',
        onclick: () =>
          patch('items', item.id, {
            status: done ? 'planned' : 'done',
            completedOn: done ? null : todayStr(),
          }),
      },
      done ? '✓' : ''
    ),
    el(
      'div',
      {},
      el('div', { class: 'task-text' }, item.text),
      meta ? el('div', { class: 'meta' }, meta) : el('div', { class: 'meta' }, 'No time or place yet')
    )
  );
}

function three() {
  const list = todaysThree();
  const day = todayStr();
  // Scheduled for today but not one of the three — offered as a swap rather
  // than silently ignored.
  const alsoToday = itemsForDay(day).filter((i) => i.top3For !== day && i.status !== 'done');
  return el(
    'section',
    {},
    el('h2', {}, "Today's three"),
    list.map((item) =>
      el(
        'div',
        { style: 'position:relative' },
        taskRow(item),
        el(
          'button',
          {
            class: 'danger',
            style: 'position:absolute;top:.5rem;right:.5rem;min-height:0;padding:.15rem .5rem;font-size:.75rem',
            title: 'Take it out of the three',
            onclick: () => patch('items', item.id, { top3For: null }),
          },
          '−'
        )
      )
    ),
    list.length < 3 && alsoToday.length
      ? alsoToday.slice(0, 3).map((item) =>
          el(
            'button',
            {
              class: 'card muted',
              style: 'width:100%;text-align:left',
              onclick: () => patch('items', item.id, { top3For: day }),
            },
            `+ ${item.text}`
          )
        )
      : null,
    list.length < 3 && !alsoToday.length
      ? el(
          'a',
          { class: 'card muted', href: '#inbox', style: 'display:block;text-decoration:none' },
          list.length === 0 ? 'Pick your three from the inbox →' : 'Add another from the inbox →'
        )
      : null
  );
}

// --- overdue -------------------------------------------------------------
function nextFree(fromDay, duration) {
  for (let n = 0; n < 7; n++) {
    const d = addDays(fromDay, n);
    const slot = freeSlots(d, duration)[0];
    if (slot) return { day: d, time: slot };
  }
  return null;
}

// An overdue task never just sits there glowing red. It asks one question with
// three answers, and dropping is a real answer — offered first-class, not as a
// failure.
function overdue() {
  const items = overdueItems();
  if (!items.length) return null;
  return el(
    'section',
    {},
    items.slice(0, 3).map((item) => {
      const duration = item.durationMin || DEFAULT_DURATION;
      const fallbackUsable =
        item.fallbackDay && item.fallbackTime && item.fallbackDay >= todayStr()
          ? { day: item.fallbackDay, time: item.fallbackTime }
          : null;
      const move = fallbackUsable || nextFree(todayStr(), duration);
      const smaller = Math.max(15, Math.round(duration / 2 / 15) * 15);
      const shrinkTo = nextFree(todayStr(), smaller);
      return el(
        'div',
        { class: 'card' },
        el('div', {}, `${relativeDay(item.day)} didn't happen: ${item.text}`),
        el('div', { class: 'meta', style: 'margin-bottom:.6rem' }, 'No harm done. What now?'),
        el(
          'div',
          { class: 'row' },
          move
            ? el(
                'button',
                {
                  class: 'primary',
                  style: 'font-size:.8rem;padding:.6rem .4rem',
                  onclick: () => patch('items', item.id, { day: move.day, time: move.time }),
                },
                `${fallbackUsable ? 'Fallback' : 'Move'}: ${relativeDay(move.day)} ${fmtTime(move.time)}`
              )
            : null,
          shrinkTo
            ? el(
                'button',
                {
                  class: 'ghost',
                  style: 'font-size:.8rem;padding:.6rem .4rem',
                  onclick: () => {
                    patch('items', item.id, {
                      durationMin: smaller,
                      day: shrinkTo.day,
                      time: shrinkTo.time,
                    });
                    toast(`Shrunk to ${smaller} minutes.`);
                  },
                },
                `Shrink to ${smaller}m`
              )
            : null,
          el(
            'button',
            {
              class: 'danger',
              style: 'font-size:.8rem;padding:.6rem .4rem',
              onclick: () => {
                patch('items', item.id, { status: 'dropped' });
                toast('Dropped.', {
                  label: 'Undo',
                  run: () => patch('items', item.id, { status: 'planned' }),
                });
              },
            },
            'Drop'
          )
        )
      );
    })
  );
}

// --- the day -------------------------------------------------------------
function block(cls, startMin, endMin, dayStart, ...content) {
  return el(
    'div',
    {
      class: `block ${cls}`,
      style: `top:${(startMin - dayStart) * PX_PER_MIN}px;height:${(endMin - startMin) * PX_PER_MIN - 2}px`,
    },
    ...content
  );
}

function dayView() {
  const day = todayStr();
  const { start: dayStart, end: dayEnd } = dayBounds(day);
  const hours = [];
  for (let m = dayStart; m < dayEnd; m += 60) {
    hours.push(el('div', { class: 'hour' }, el('span', { class: 'hour-label' }, fmtTime(toHM(m)))));
  }

  const blocks = [];
  const of = overflowRange();
  blocks.push(
    block('block-overflow', of.start, of.end, dayStart, 'Overflow — keep this one free')
  );

  for (const b of fixedForDay(day)) {
    const s = toMin(b.start);
    const e = toMin(b.end);
    // 15-minute buffers so nothing is scheduled flush against a commitment you
    // have to physically get to.
    blocks.push(block('block-buffer', Math.max(dayStart, s - BUFFER), s, dayStart));
    blocks.push(block('block-buffer', e, Math.min(dayEnd, e + BUFFER), dayStart));
    blocks.push(
      block('block-fixed', s, e, dayStart, el('b', {}, b.title), b.where ? ` · ${b.where}` : '')
    );
  }

  for (const i of itemsForDay(day)) {
    if (!i.time) continue;
    const s = toMin(i.time);
    blocks.push(
      block('block-task', s, s + (i.durationMin || DEFAULT_DURATION), dayStart, el('b', {}, i.text))
    );
  }

  for (const ev of eventsForDay(day)) {
    if (!ev.time) continue;
    const s = toMin(ev.time);
    blocks.push(
      block('block-event', s, s + (ev.durationMin || DEFAULT_DURATION), dayStart, el('b', {}, ev.title))
    );
  }

  const allDay = eventsForDay(day).filter((e) => !e.time);

  nowLine = el('div', { class: 'now-line' }, el('span', { class: 'now-label' }, ''));
  nowLineStart = dayStart;
  nowLineEnd = dayEnd;
  placeNowLine();

  const grid = el(
    'div',
    {
      class: 'day',
      onclick: (e) => {
        if (e.target.closest('.block')) return;
        const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
        const at = dayStart + Math.round(y / PX_PER_MIN / 15) * 15;
        openOverlay(eventForm({ date: day, time: toHM(Math.min(Math.max(at, dayStart), dayEnd - 15)) }));
      },
    },
    hours,
    el('div', { class: 'blocks' }, blocks),
    nowLine
  );

  return el(
    'section',
    {},
    el('h2', {}, 'Your day'),
    allDay.map((e) => el('div', { class: 'card meta' }, `${e.kind}: ${e.title}`)),
    el('p', { class: 'muted', style: 'margin-bottom:.6rem' }, 'Tap an empty hour to put something on the calendar.'),
    grid
  );
}

// A full day is the thing that fails by mid-morning, so say so before it does.
function overloadNudge() {
  const day = todayStr();
  const items = itemsForDay(day).filter((i) => i.status !== 'done');
  const minutes = items.reduce((sum, i) => sum + (i.durationMin || DEFAULT_DURATION), 0);
  if (items.length <= 3 && minutes <= 300) return null;
  return el(
    'div',
    { class: 'card muted' },
    `That's ${items.length} things and about ${Math.round(minutes / 60)} hours today. Anything here that could just as well be tomorrow?`
  );
}

// A cleared time field would otherwise be stored as an empty string and break
// every calculation downstream, so it snaps back to what was there before.
function timeSetting(key) {
  const input = el('input', { type: 'time', value: state.settings[key] });
  input.addEventListener('change', () => {
    if (validMin(input.value, null) === null) {
      input.value = state.settings[key];
      toast('That needs a time.');
      return;
    }
    setSettings({ [key]: input.value });
  });
  return input;
}

// --- schedule editor -----------------------------------------------------
// Classes and shifts repeat weekly; the buffers and free-slot maths need them,
// so they live here rather than in a settings screen.
function scheduleEditor(close) {
  const blocks = Object.values(state.fixedBlocks)
    .filter((b) => !b.deleted)
    .sort((a, b) => a.weekday - b.weekday || toMin(a.start) - toMin(b.start));

  // Multi-select: a class that meets Mon/Wed/Fri is entered once, not three times.
  const weekdays = new Set([new Date().getDay()]);
  const title = el('input', { type: 'text', placeholder: 'ENGL 1101' });
  const where = el('input', { type: 'text', placeholder: 'Where (optional)' });
  const start = el('input', { type: 'time', value: '10:00' });
  const end = el('input', { type: 'time', value: '11:15' });
  const dayChips = el(
    'div',
    { class: 'chips' },
    DOW.map((d, i) =>
      el(
        'button',
        {
          class: `chip${weekdays.has(i) ? ' on' : ''}`,
          onclick: (e) => {
            if (weekdays.has(i)) weekdays.delete(i);
            else weekdays.add(i);
            e.currentTarget.classList.toggle('on', weekdays.has(i));
          },
        },
        d
      )
    )
  );

  const rerender = () => {
    close();
    openOverlay(scheduleEditor);
  };

  return el(
    'div',
    { class: 'sheet' },
    el('h1', {}, 'Classes & shifts'),
    el('p', { class: 'muted' }, 'Anything that repeats weekly. Tap every day it meets — buffers are added around each one automatically.'),
    blocks.map((b) =>
      el(
        'div',
        { class: 'card', style: 'display:flex;justify-content:space-between;gap:.5rem' },
        el(
          'div',
          {},
          el('div', {}, b.title),
          el('div', { class: 'meta' }, `${DOW[b.weekday]} ${fmtTime(b.start)}–${fmtTime(b.end)}${b.where ? ` · ${b.where}` : ''}`)
        ),
        el(
          'button',
          {
            class: 'danger',
            style: 'flex:none;padding:.4rem .7rem;min-height:0',
            onclick: () => {
              patch('fixedBlocks', b.id, { deleted: true });
              rerender();
            },
          },
          'Remove'
        )
      )
    ),
    el('h2', {}, 'Add one'),
    dayChips,
    el('label', {}, 'What'),
    title,
    el('label', {}, 'From / to'),
    el('div', { class: 'row' }, start, end),
    el('label', {}, 'Where'),
    where,
    el(
      'div',
      { class: 'row', style: 'margin-top:1rem' },
      el('button', { class: 'ghost', onclick: close }, 'Done'),
      el(
        'button',
        {
          class: 'primary',
          onclick: () => {
            if (!title.value.trim()) return toast('Give it a name first.');
            if (!weekdays.size) return toast('Pick at least one day.');
            // One block per day it meets, so each day can be edited or dropped
            // on its own later.
            for (const weekday of weekdays) {
              put('fixedBlocks', {
                weekday,
                title: title.value.trim(),
                where: where.value.trim(),
                start: start.value,
                end: end.value,
              });
            }
            rerender();
          },
        },
        'Add'
      )
    ),
    el('h2', {}, 'Day shape'),
    el('label', {}, 'Day runs from / to'),
    el(
      'div',
      { class: 'row' },
      timeSetting('dayStart'),
      timeSetting('dayEnd')
    ),
    el('label', {}, 'Overflow hour — kept free for whatever slips'),
    timeSetting('overflowHour')
  );
}


// --- habits --------------------------------------------------------------
// Ticking is the only interaction here: no percentage, no counter, nothing that
// can be broken by missing yesterday. The number lives on Week.
function habitRow() {
  const list = activeHabits();
  if (!list.length) return null;
  const day = todayStr();
  return el(
    'section',
    {},
    el('h2', {}, 'Habits'),
    list.map((h) => {
      const done = habitDone(h.id, day);
      return el(
        'div',
        { class: `card task${done ? ' done' : ''}` },
        el(
          'button',
          {
            class: `task-check${done ? ' on' : ''}`,
            'aria-label': `${done ? 'Undo' : 'Did'} ${h.name}`,
            onclick: () =>
              put('habitLogs', {
                id: habitLogId(h.id, day),
                habitId: h.id,
                date: day,
                done: !done,
              }),
          },
          done ? '\u2713' : ''
        ),
        el(
          'div',
          {},
          el('div', { class: 'task-text' }, h.name),
          h.cue ? el('div', { class: 'meta' }, h.cue) : null
        )
      );
    })
  );
}

// --- reflection ----------------------------------------------------------
// Two minutes, three boxes, in the evening only. Skipping it leaves no mark of
// any kind: nothing counts it, nothing asks about it tomorrow.
function reflection() {
  if (new Date().getHours() < 18) return null;
  const day = todayStr();
  const saved = reflectionFor(day) || {};
  const field = (key, label, placeholder) => {
    const input = el('input', {
      type: 'text',
      placeholder,
      // Saved on blur. Saving per keystroke re-renders the screen and would
      // take the cursor with it.
      onchange: (e) =>
        put('reflections', { ...(reflectionFor(day) || {}), id: day, [key]: e.target.value }),
    });
    input.value = saved[key] || '';
    return [el('label', {}, label), input];
  };
  return el(
    'section',
    {},
    el('h2', {}, 'Two minutes on today'),
    el(
      'div',
      { class: 'card' },
      field('worked', 'What worked', 'anything at all'),
      field('didnt', "What didn't", 'no need to be fair to yourself'),
      field('oneLine', 'One line', 'the day in a sentence'),
      el('p', { class: 'muted', style: 'margin-top:.7rem' }, 'Skip it whenever. Nothing is counting.')
    )
  );
}

export default function today() {
  return [
    capture(),
    el('h1', {}, fmtDate(todayStr())),
    overdue(),
    progress(),
    weeklyGoal(),
    three(),
    habitRow(),
    overloadNudge(),
    dayView(),
    reflection(),
    el(
      'button',
      { class: 'ghost', style: 'width:100%;margin-top:1rem', onclick: () => openOverlay(daySummary(todayStr())) },
      'Day summary'
    ),
    el(
      'button',
      { class: 'ghost', style: 'width:100%;margin-top:.5rem', onclick: () => openOverlay(scheduleEditor) },
      'Classes & shifts'
    ),
  ];
}
