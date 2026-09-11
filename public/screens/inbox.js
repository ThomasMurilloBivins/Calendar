import { put, patch } from '../store.js';
import { el, fill, toast, openOverlay } from '../dom.js';
import { timeSelect } from '../timeselect.js';
import {
  DEFAULT_DURATION,
  today as todayStr,
  addDays,
  relativeDay,
  fmtTime,
  toMin,
  freeSlots,
  inboxItems,
  todaysThree,
  places,
} from '../util.js';

// Times on the hour and half hour only. A wall of 15-minute options is a
// decision, and triage is meant to be fast.
const slotChoices = (day, duration) =>
  freeSlots(day, duration)
    .filter((s) => toMin(s) % 30 === 0)
    .slice(0, 12);

function dayChoices() {
  const t = todayStr();
  return [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(t, n));
}

// Pre-committed fallbacks are the point: "if I miss it, then I'll do it here"
// roughly doubles follow-through compared with intending to do it at all.
// Encoded as "day|time" strings so a chip stays selected across redraws —
// object identity changes every time the choices are recomputed.
function fallbackChoices(day, duration) {
  const out = [];
  for (const n of [1, 2, 3]) {
    const d = addDays(day, n);
    for (const s of slotChoices(d, duration).slice(0, 2)) out.push(`${d}|${s}`);
  }
  return out.slice(0, 6);
}

function chipRow(options, selected, onPick, label = (v) => v) {
  const row = el('div', { class: 'chips' });
  for (const opt of options) {
    row.append(
      el(
        'button',
        {
          class: `chip${opt.value === selected ? ' on' : ''}`,
          onclick: () => onPick(opt.value),
        },
        label(opt)
      )
    );
  }
  return row;
}

// --- triage --------------------------------------------------------------
function triage(close) {
  const box = el('div', { class: 'sheet triage' });
  const queue = inboxItems();
  let idx = 0;

  const finish = () => {
    fill(
      box,
      el('div', { class: 'triage-text' }, 'Inbox clear.'),
      el('button', { class: 'primary', onclick: close }, 'Done')
    );
  };

  const advance = () => {
    idx += 1;
    draw();
  };

  function drop(item) {
    patch('items', item.id, { status: 'dropped' });
    // No confirmation dialog and no apology. Dropping things is how the list
    // stays honest instead of accumulating shame.
    toast('Dropped.', { label: 'Undo', run: () => patch('items', item.id, { status: 'inbox' }) });
    advance();
  }

  function schedule(item) {
    let day = todayStr();
    let duration = DEFAULT_DURATION;
    let fallback = null;
    let where = item.where || '';

    const body = el('div', {});

    const commit = (parts) => {
      if (parts.length === 1) {
        put('items', { ...item, ...parts[0] });
      } else {
        for (const p of parts) put('items', p);
        patch('items', item.id, { status: 'dropped' }); // replaced by its split parts
      }
      advance();
    };

    // Spaced practice beats one long sitting, so a block over 90 minutes gets
    // broken across days by default. Keeping it whole stays possible, but it
    // takes a deliberate second tap.
    function splitPlan() {
      const count = Math.ceil(duration / 90);
      const each = Math.round(duration / count / 15) * 15;
      const parts = [];
      for (let n = 0; n < count && parts.length < count; n++) {
        const d = addDays(day, n);
        const slot = slotChoices(d, each)[0];
        if (slot) parts.push({ day: d, time: slot, durationMin: each });
      }
      return { count, each, parts };
    }

    let isLong = false;
    let atCapNow = false;

    // The button is built once and only its disabled state changes, so the
    // reason for a refusal is visible rather than the button being mysteriously
    // dead. A hard overlap is the only thing that blocks; buffers and the
    // overflow hour warn in the picker and still save.
    const saveButton = el(
      'button',
      {
        class: 'primary',
        style: 'width:100%;margin-top:1.2rem',
        onclick: () =>
          commit([
            {
              status: 'planned',
              day,
              time: picker.value(),
              durationMin: duration,
              where,
              fallbackDay: fallback ? fallback.split('|')[0] : null,
              fallbackTime: fallback ? fallback.split('|')[1] : null,
              // Choosing to do it today is the moment you choose your three.
              top3For: day === todayStr() && !atCapNow ? day : null,
            },
          ]),
      },
      'Plan it'
    );

    function syncSave() {
      const stop = !picker.value() || picker.blocked() || isLong;
      saveButton.disabled = stop;
      saveButton.textContent = picker.blocked() ? 'Pick a time that is free' : 'Plan it';
    }

    // One picker instance for the life of the form: rebuilding it on every
    // redraw would close the dropdown mid-choice.
    const picker = timeSelect({
      day,
      durationMin: duration,
      value: slotChoices(day, DEFAULT_DURATION)[0] || null,
      onChange: () => syncSave(),
    });

    function draw() {
      const fbs = fallbackChoices(day, duration);
      if (!fallback && fbs.length) fallback = fbs[0];

      const whereInput = el('input', {
        type: 'text',
        placeholder: 'Where? (library, dorm, Nesbitt…)',
        value: where,
        oninput: (e) => (where = e.target.value),
      });

      const long = duration > 90;
      const plan = long ? splitPlan() : null;
      const atCap = day === todayStr() && todaysThree().length >= 3;

      fill(
        body,
        el('label', {}, 'Which day'),
        chipRow(
          dayChoices().map((d) => ({ value: d })),
          day,
          (v) => {
            day = v;
            fallback = null;
            picker.update({ day: v, value: slotChoices(v, duration)[0] || null });
            draw();
          },
          (o) => relativeDay(o.value)
        ),

        el('label', {}, 'How long'),
        chipRow(
          [15, 30, 60, 90, 120, 180].map((v) => ({ value: v })),
          duration,
          (v) => {
            duration = v;
            picker.update({ durationMin: v });
            draw();
          },
          (o) => (o.value < 60 ? `${o.value}m` : `${o.value / 60}h`)
        ),

        long
          ? el(
              'div',
              { class: 'card' },
              el('p', {}, `${duration / 60} hours in one sitting is the version that gets abandoned.`),
              el(
                'p',
                { class: 'muted' },
                plan.parts.length
                  ? `Split into ${plan.parts.length} blocks of ${plan.each} minutes: ` +
                      plan.parts.map((p) => `${relativeDay(p.day)} ${fmtTime(p.time)}`).join(', ')
                  : 'No open slots across the next few days for a split.'
              ),
              el(
                'div',
                { class: 'row', style: 'margin-top:.7rem' },
                el(
                  'button',
                  {
                    class: 'primary',
                    disabled: !plan.parts.length,
                    onclick: () =>
                      commit(
                        plan.parts.map((p, n) => ({
                          text: `${item.text} (${n + 1} of ${plan.parts.length})`,
                          createdAt: item.createdAt,
                          status: 'planned',
                          where,
                          ...p,
                          top3For:
                            p.day === todayStr() && todaysThree().length < 3 ? p.day : null,
                        }))
                      ),
                  },
                  `Split into ${plan.parts.length}`
                ),
                el(
                  'button',
                  {
                    class: 'ghost',
                    onclick: () => {
                      duration = 90;
                      draw();
                    },
                  },
                  'Keep as one block'
                )
              )
            )
          : null,

        el('label', {}, 'What time'),
        picker.node,

        el('label', {}, 'Where'),
        whereInput,
        places().length
          ? el(
              'div',
              { class: 'chips', style: 'margin-top:.4rem' },
              places().map((p) =>
                el(
                  'button',
                  {
                    class: 'chip',
                    onclick: () => {
                      where = p;
                      whereInput.value = p;
                    },
                  },
                  p
                )
              )
            )
          : null,

        el('label', {}, 'If you miss it, then…'),
        fbs.length
          ? chipRow(
              fbs.map((f) => ({ value: f })),
              fallback,
              (v) => {
                fallback = v;
                draw();
              },
              (o) => `${relativeDay(o.value.split('|')[0])} ${fmtTime(o.value.split('|')[1])}`
            )
          : el('p', { class: 'muted' }, 'No fallback slot open — that is fine.'),

        atCap
          ? el(
              'p',
              { class: 'muted', style: 'margin-top:1rem' },
              "Today's three are already chosen. This still goes on your day — it just isn't one of the three."
            )
          : null,

        saveButton
      );
      // `long` gates saving too, so the state has to be recomputed after a redraw.
      isLong = long;
      atCapNow = atCap;
      syncSave();
    }

    draw();
    fill(
      box,
      el('div', { class: 'triage-count' }, `${queue.length - idx} left`),
      el('div', { class: 'triage-text', style: 'margin-bottom:1rem' }, item.text),
      body,
      el('button', { class: 'danger', style: 'width:100%;margin-top:.6rem', onclick: () => drop(item) }, 'Drop it')
    );
  }

  function draw() {
    const item = queue[idx];
    if (!item) return finish();
    fill(
      box,
      el(
        'div',
        { style: 'display:flex;justify-content:space-between;align-items:center' },
        el('div', { class: 'triage-count' }, `${queue.length - idx} left`),
        el('button', { class: 'danger', style: 'flex:none;min-height:0;padding:.3rem .7rem', onclick: close }, 'Close')
      ),
      el('div', { class: 'triage-text' }, item.text),
      el(
        'div',
        { class: 'row', style: 'margin-bottom:.5rem' },
        el('button', { class: 'danger', onclick: () => drop(item) }, 'Drop'),
        el('button', { class: 'primary', onclick: () => schedule(item) }, 'Schedule')
      )
    );
  }

  draw();
  return box;
}

// --- inbox ---------------------------------------------------------------
export default function inbox() {
  const items = inboxItems();
  if (!items.length) {
    return [
      el('h1', { style: 'margin-top:2.5rem' }, 'Inbox'),
      el('p', { class: 'muted' }, 'Empty. Capture anything on Today and it lands here.'),
    ];
  }
  return [
    el('h1', { style: 'margin-top:2.5rem' }, 'Inbox'),
    el('p', { class: 'muted' }, `${items.length} captured. Sort them when you have the headspace, not before.`),
    el(
      'button',
      { class: 'primary', style: 'width:100%;margin:.8rem 0 1.2rem', onclick: () => openOverlay(triage) },
      'Triage'
    ),
    items.map((i) => el('div', { class: 'card' }, i.text)),
  ];
}

export { triage };
