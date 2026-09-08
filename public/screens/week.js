import { state, put, patch } from '../store.js';
import { el, openOverlay, refresh, toast } from '../dom.js';
import {
  DOW,
  today as todayStr,
  ymd,
  parseYmd,
  addDays,
  relativeDay,
  fmtTime,
  eventsForDay,
  itemsForDay,
} from '../util.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const KINDS = [
  ['deadline', 'Deadline'],
  ['competition', 'Competition'],
  ['meeting', 'Mentor meeting'],
];
const kindLabel = (k) => (KINDS.find(([id]) => id === k) || [, 'Event'])[1];

// Kept at module scope so paging the month survives a re-render.
let cursor = null;
let selected = null;

function monthStart(day) {
  const d = parseYmd(day);
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
}

// --- add / edit an event -------------------------------------------------
// Events are dated facts, not tasks: they never enter the Inbox, never go
// overdue, and never count against the three.
export function eventForm(prefill = {}) {
  return (close) => {
    const existing = prefill.id ? state.events[prefill.id] : null;
    let kind = existing?.kind || prefill.kind || 'deadline';
    const title = el('input', { type: 'text', placeholder: 'Research paper draft', value: existing?.title || '' });
    const date = el('input', { type: 'date', value: existing?.date || prefill.date || todayStr() });
    const time = el('input', { type: 'time', value: existing?.time || prefill.time || '' });
    const where = el('input', { type: 'text', placeholder: 'Optional', value: existing?.where || '' });

    const kindChips = el(
      'div',
      { class: 'chips' },
      KINDS.map(([id, label]) =>
        el(
          'button',
          {
            class: `chip${id === kind ? ' on' : ''}`,
            onclick: (e) => {
              kind = id;
              for (const c of kindChips.children) c.classList.remove('on');
              e.currentTarget.classList.add('on');
            },
          },
          label
        )
      )
    );

    setTimeout(() => title.focus(), 50);

    return el(
      'div',
      { class: 'sheet' },
      el('h1', {}, existing ? 'Edit' : 'Add to the calendar'),
      el('label', {}, 'What'),
      title,
      el('label', {}, 'Kind'),
      kindChips,
      el('label', {}, 'When'),
      el('div', { class: 'row' }, date, time),
      el('p', { class: 'muted' }, 'Leave the time blank if it just has to happen that day.'),
      el('label', {}, 'Where'),
      where,
      el(
        'div',
        { class: 'row', style: 'margin-top:1.2rem' },
        el('button', { class: 'ghost', onclick: close }, 'Cancel'),
        el(
          'button',
          {
            class: 'primary',
            onclick: () => {
              if (!title.value.trim()) return;
              put('events', {
                ...(existing || {}),
                title: title.value.trim(),
                date: date.value,
                time: time.value || null,
                kind,
                where: where.value.trim(),
              });
              selected = date.value;
              close();
            },
          },
          'Save'
        )
      ),
      existing
        ? el(
            'button',
            {
              class: 'danger',
              style: 'width:100%;margin-top:.6rem',
              onclick: () => {
                patch('events', existing.id, { deleted: true });
                toast('Removed.', {
                  label: 'Undo',
                  run: () => patch('events', existing.id, { deleted: false }),
                });
                close();
              },
            },
            'Remove'
          )
        : null
    );
  };
}

// --- month grid ----------------------------------------------------------
function monthGrid() {
  const first = parseYmd(cursor);
  const year = first.getFullYear();
  const month = first.getMonth();
  const gridStart = addDays(cursor, -first.getDay());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((first.getDay() + daysInMonth) / 7) * 7;

  const cells = [];
  for (let n = 0; n < cellCount; n++) {
    const day = addDays(gridStart, n);
    const d = parseYmd(day);
    const events = eventsForDay(day);
    const tasks = itemsForDay(day).filter((i) => i.status !== 'done');
    const classes = [
      'mcell',
      d.getMonth() !== month ? 'dim' : '',
      day === todayStr() ? 'today' : '',
      day === selected ? 'on' : '',
    ]
      .filter(Boolean)
      .join(' ');
    cells.push(
      el(
        'button',
        {
          class: classes,
          onclick: () => {
            selected = day;
            refresh();
          },
        },
        String(d.getDate()),
        el(
          'span',
          { class: 'dots' },
          events.slice(0, 3).map(() => el('span', { class: 'dot event' })),
          tasks.slice(0, 3 - Math.min(3, events.length)).map(() => el('span', { class: 'dot' }))
        )
      )
    );
  }

  const step = (delta) => {
    const d = parseYmd(cursor);
    cursor = ymd(new Date(d.getFullYear(), d.getMonth() + delta, 1));
    refresh();
  };

  return el(
    'section',
    {},
    el(
      'div',
      { class: 'month-nav' },
      el('button', { onclick: () => step(-1), 'aria-label': 'Previous month' }, '‹'),
      el('strong', {}, `${MONTH_NAMES[month]} ${year}`),
      el('button', { onclick: () => step(1), 'aria-label': 'Next month' }, '›')
    ),
    el(
      'div',
      { class: 'month' },
      DOW.map((d) => el('div', { class: 'month-head' }, d[0])),
      cells
    )
  );
}

// --- selected day --------------------------------------------------------
function dayPanel() {
  const day = selected;
  const events = eventsForDay(day);
  const tasks = itemsForDay(day);
  return el(
    'section',
    {},
    el('h2', {}, relativeDay(day)),
    events.map((e) =>
      el(
        'button',
        { class: 'card', style: 'width:100%;text-align:left', onclick: () => openOverlay(eventForm({ id: e.id })) },
        el('div', {}, e.title),
        el(
          'div',
          { class: 'meta' },
          [kindLabel(e.kind), e.time && fmtTime(e.time), e.where].filter(Boolean).join(' · ')
        )
      )
    ),
    tasks.map((t) =>
      el(
        'div',
        { class: 'card' },
        el('div', { class: t.status === 'done' ? 'muted' : '' }, t.text),
        el('div', { class: 'meta' }, [t.time && fmtTime(t.time), t.where].filter(Boolean).join(' · ') || 'Task')
      )
    ),
    !events.length && !tasks.length ? el('p', { class: 'muted' }, 'Nothing on this day.') : null,
    el(
      'button',
      {
        class: 'primary',
        style: 'width:100%;margin-top:.5rem',
        onclick: () => openOverlay(eventForm({ date: day })),
      },
      'Add to this day'
    )
  );
}

// --- the next seven days -------------------------------------------------
// So "what's this week" costs no taps at all.
function agenda() {
  const rows = [];
  for (let n = 0; n < 7; n++) {
    const day = addDays(todayStr(), n);
    const events = eventsForDay(day);
    const tasks = itemsForDay(day).filter((i) => i.status !== 'done');
    if (!events.length && !tasks.length) continue;
    rows.push(
      el(
        'div',
        { class: 'card' },
        el('strong', { style: 'font-size:.85rem' }, relativeDay(day)),
        events.map((e) =>
          el('div', { class: 'meta' }, `${kindLabel(e.kind)}: ${e.title}${e.time ? ` · ${fmtTime(e.time)}` : ''}`)
        ),
        tasks.map((t) => el('div', { class: 'meta' }, `${t.time ? `${fmtTime(t.time)} · ` : ''}${t.text}`))
      )
    );
  }
  return el(
    'section',
    {},
    el('h2', {}, 'Next seven days'),
    rows.length ? rows : el('p', { class: 'muted' }, 'Clear. Genuinely nothing scheduled.')
  );
}

export default function week() {
  if (!cursor) cursor = monthStart(todayStr());
  if (!selected) selected = todayStr();
  return [
    el('h1', { style: 'margin-top:2.5rem' }, 'Calendar'),
    monthGrid(),
    dayPanel(),
    agenda(),
  ];
}
