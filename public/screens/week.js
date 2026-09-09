import { state, put, patch } from '../store.js';
import { el, fill, openOverlay, refresh, toast } from '../dom.js';
import {
  DOW,
  today as todayStr,
  ymd,
  parseYmd,
  addDays,
  relativeDay,
  fmtDate,
  fmtTime,
  eventsForDay,
  itemsForDay,
  activeProjects,
  projectWeek,
  activeHabits,
  habitRolling,
  habitAge,
  toHours,
  hrs,
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

// --- projects ------------------------------------------------------------
// Loose progress, visible, with no day attached to it. "Research: 3 of 5 hours"
// says where you are without implying you were supposed to do it on Tuesday.
function projectsThisWeek() {
  const list = activeProjects();
  if (!list.length) return null;
  return el(
    'section',
    {},
    el('h2', {}, 'Projects this week'),
    list.map((p) => {
      const { minutes, pct } = projectWeek(p);
      return el(
        'a',
        { class: 'card', href: '#projects', style: 'display:block;text-decoration:none;color:inherit' },
        el('div', { style: 'font-size:.9rem' }, `${p.name}: ${toHours(minutes)} of ${hrs(p.weeklyTargetHours)}`),
        el(
          'div',
          { class: 'bar bar-small', style: 'margin-top:.5rem' },
          el('div', { class: 'bar-fill', style: `width:${pct}%` })
        )
      );
    })
  );
}


// --- habits --------------------------------------------------------------
// Rolling percentages over a 30-day window, never streaks. Missing a day moves
// one number slightly and resets nothing, because a broken streak is the thing
// that makes people delete the app.
function habitForm(id) {
  return (close) => {
    const existing = id ? state.habits[id] : null;
    const name = el('input', { type: 'text', placeholder: 'Read 10 pages', value: existing?.name || '' });
    const cue = el('input', {
      type: 'text',
      placeholder: 'after I get back to my dorm',
      value: existing?.cue || '',
    });
    if (!existing) setTimeout(() => name.focus(), 50);

    return el(
      'div',
      { class: 'sheet' },
      el('h1', {}, existing ? 'Edit habit' : 'New habit'),
      el(
        'p',
        { class: 'muted' },
        'Anchor it to something you already do. A cue you already have beats a time you have to remember.'
      ),
      el('label', {}, 'The habit'),
      name,
      el('label', {}, 'Right after'),
      cue,
      el(
        'div',
        { class: 'row', style: 'margin-top:1.2rem' },
        el('button', { class: 'ghost', onclick: close }, 'Cancel'),
        el(
          'button',
          {
            class: 'primary',
            onclick: () => {
              if (!name.value.trim()) return;
              put('habits', {
                ...(existing || { startedOn: todayStr() }),
                name: name.value.trim(),
                cue: cue.value.trim(),
              });
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
                patch('habits', existing.id, { archived: true });
                toast('Archived.', {
                  label: 'Undo',
                  run: () => patch('habits', existing.id, { archived: false }),
                });
                close();
              },
            },
            'Archive it'
          )
        : null
    );
  };
}

function habitsSection() {
  const list = activeHabits();
  return el(
    'section',
    {},
    el('h2', {}, 'Habits'),
    list.map((h) => {
      const { done, window, pct } = habitRolling(h);
      const age = habitAge(h);
      return el(
        'button',
        { class: 'card', style: 'width:100%;text-align:left', onclick: () => openOverlay(habitForm(h.id)) },
        el('strong', {}, h.name),
        h.cue ? el('div', { style: 'font-size:.9rem' }, h.cue) : null,
        el(
          'div',
          { class: 'bar bar-small', style: 'margin:.6rem 0 .4rem' },
          el('div', { class: 'bar-fill', style: `width:${pct}%` })
        ),
        el('div', { class: 'meta' }, `${done} of the last ${window} ${window === 1 ? 'day' : 'days'} · ${pct}%`),
        age <= 66 ? el('div', { class: 'meta' }, `day ${age} of about 66`) : null
      );
    }),
    el(
      'button',
      { class: 'ghost', style: 'width:100%;margin-top:.4rem', onclick: () => openOverlay(habitForm(null)) },
      list.length ? 'Add a habit' : 'Add your first habit'
    )
  );
}

// --- syllabus paste-in ---------------------------------------------------
// There is no API key and no server-side model, so the extraction happens in
// whatever chat he likes and the answer comes back through here.
const SYLLABUS_PROMPT = `Pull every date out of the syllabus below. Reply with one line per date and nothing else, in exactly this format:

YYYY-MM-DD | what it is | deadline

Use "competition" or "meeting" in place of "deadline" where they fit better. Here is the syllabus:`;

const pad = (n) => String(n).padStart(2, '0');

function normalizeDate(raw) {
  const t = String(raw || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    // No year given. Assume this academic year, unless that would put the date
    // well in the past — a spring due date pasted in the autumn.
    const year = parseYmd(todayStr()).getFullYear();
    const guess = `${year}-${pad(m[1])}-${pad(m[2])}`;
    return guess < addDays(todayStr(), -180) ? `${year + 1}-${pad(m[1])}-${pad(m[2])}` : guess;
  }
  return null;
}

const normalizeKind = (raw) => {
  const t = String(raw || '').toLowerCase();
  if (t.includes('compet')) return 'competition';
  if (t.includes('meet')) return 'meeting';
  return 'deadline';
};

function parseLine(line) {
  const raw = line.trim().replace(/^[-*•]\s*/, '');
  if (!raw) return null;
  const parts = raw.split('|').map((p) => p.trim());
  if (parts.length >= 2) {
    const date = normalizeDate(parts[0]);
    return date && parts[1] ? { date, title: parts[1], kind: normalizeKind(parts[2]) } : null;
  }
  const m = raw.match(/^(\S+)\s+(.+)$/);
  if (!m) return null;
  const date = normalizeDate(m[1]);
  return date ? { date, title: m[2].trim(), kind: 'deadline' } : null;
}

export function parseSyllabus(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
        .map((r) => ({
          date: normalizeDate(r.date),
          title: String(r.title || '').trim(),
          kind: normalizeKind(r.kind),
        }))
        .filter((r) => r.date && r.title);
    } catch {
      // Not valid JSON after all — fall through and read it as lines.
    }
  }
  return trimmed.split('\n').map(parseLine).filter(Boolean);
}

function syllabusSheet(close) {
  const box = el('div', { class: 'sheet' });
  const input = el('textarea', { placeholder: 'Paste what the chat gave you', style: 'min-height:9rem' });

  // Nothing is written until he has seen the rows and agreed to them.
  const confirm = () => {
    const rows = parseSyllabus(input.value);
    if (!rows.length) {
      toast("Couldn't find any dates in that.");
      return;
    }
    const checks = rows.map(() => el('input', { type: 'checkbox', checked: true, style: 'width:auto;flex:none' }));
    fill(
      box,
      el('h1', {}, 'Look them over'),
      el('p', { class: 'muted' }, 'Nothing is added until you say so. Untick anything that is wrong.'),
      rows.map((r, i) =>
        el(
          'label',
          {
            class: 'card',
            style: 'display:flex;gap:.7rem;align-items:center;margin:.5rem 0 0;font-size:1rem;color:inherit',
          },
          checks[i],
          el('div', {}, el('div', {}, r.title), el('div', { class: 'meta' }, `${fmtDate(r.date)} · ${kindLabel(r.kind)}`))
        )
      ),
      el(
        'div',
        { class: 'row', style: 'margin-top:1.2rem' },
        el('button', { class: 'ghost', onclick: close }, 'Cancel'),
        el(
          'button',
          {
            class: 'primary',
            onclick: () => {
              let added = 0;
              rows.forEach((r, i) => {
                if (!checks[i].checked) return;
                put('events', { title: r.title, date: r.date, kind: r.kind, time: null, where: '' });
                added += 1;
              });
              toast(`${added} added to your calendar.`);
              close();
            },
          },
          'Add them'
        )
      )
    );
  };

  fill(
    box,
    el('h1', {}, 'Syllabus dates'),
    el(
      'p',
      { class: 'muted' },
      'No AI runs inside this app. Copy the prompt into any free chat along with your syllabus, then paste the answer back here.'
    ),
    el('textarea', { readonly: true, style: 'min-height:7rem', onclick: (e) => e.target.select() }, SYLLABUS_PROMPT),
    el(
      'button',
      {
        class: 'ghost',
        style: 'width:100%;margin:.4rem 0 1rem',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(SYLLABUS_PROMPT);
            toast('Prompt copied.');
          } catch {
            toast('Tap the box and copy it manually.');
          }
        },
      },
      'Copy the prompt'
    ),
    el('label', {}, 'Paste the answer'),
    input,
    el(
      'div',
      { class: 'row', style: 'margin-top:1rem' },
      el('button', { class: 'ghost', onclick: close }, 'Cancel'),
      el('button', { class: 'primary', onclick: confirm }, 'Read them')
    )
  );
  return box;
}

export default function week() {
  if (!cursor) cursor = monthStart(todayStr());
  if (!selected) selected = todayStr();
  return [
    el('h1', { style: 'margin-top:2.5rem' }, 'Calendar'),
    monthGrid(),
    dayPanel(),
    agenda(),
    habitsSection(),
    projectsThisWeek(),
    el(
      'button',
      { class: 'ghost', style: 'width:100%;margin-top:1.2rem', onclick: () => openOverlay(syllabusSheet) },
      'Paste syllabus dates'
    ),
  ];
}
