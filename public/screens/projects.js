import { state, put, patch } from '../store.js';
import { el, openOverlay, toast } from '../dom.js';
import {
  today as todayStr,
  activeProjects,
  projectWeek,
  projectTotal,
  toHours,
  hrs,
} from '../util.js';

const INCREMENTS = [
  [15, '+15m'],
  [30, '+30m'],
  [60, '+1h'],
];

// --- add / edit ----------------------------------------------------------
function projectForm(id) {
  return (close) => {
    const existing = id ? state.projects[id] : null;
    const name = el('input', {
      type: 'text',
      placeholder: 'Honors contract research',
      value: existing?.name || '',
    });
    const target = el('input', {
      type: 'number',
      min: '1',
      max: '40',
      value: String(existing?.weeklyTargetHours || 5),
    });

    if (!existing) setTimeout(() => name.focus(), 50);

    return el(
      'div',
      { class: 'sheet' },
      el('h1', {}, existing ? 'Edit project' : 'New project'),
      el(
        'p',
        { class: 'muted' },
        'Ongoing work that never belonged on a to-do list. Hours a week, no fixed days.'
      ),
      el('label', {}, 'What is it'),
      name,
      el('label', {}, 'Hours a week'),
      target,
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
              put('projects', {
                ...(existing || { notes: '' }),
                name: name.value.trim(),
                weeklyTargetHours: Math.max(1, Number(target.value) || 1),
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
                patch('projects', existing.id, { archived: true });
                toast('Archived.', {
                  label: 'Undo',
                  run: () => patch('projects', existing.id, { archived: false }),
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

// --- one card per project ------------------------------------------------
function card(project) {
  const { minutes, pct } = projectWeek(project);
  const total = projectTotal(project.id);

  // Logging is the intervention, not the bookkeeping: watching your own hours
  // is what changes the behaviour, so it has to cost exactly one tap.
  const log = (mins) => {
    const entry = put('hourLogs', { projectId: project.id, date: todayStr(), minutes: mins });
    toast(`Logged ${mins < 60 ? `${mins} minutes` : '1 hour'}.`, {
      label: 'Undo',
      run: () => patch('hourLogs', entry.id, { deleted: true }),
    });
  };

  // Saved on blur, deliberately not on every keystroke: a save re-renders the
  // screen, which would rebuild this textarea and drop the cursor mid-sentence.
  const notes = el('textarea', {
    placeholder: 'Anything you want to remember about this — where you left off, what to ask.',
    onchange: (e) => patch('projects', project.id, { notes: e.target.value }),
  });
  notes.value = project.notes || '';

  return el(
    'div',
    { class: 'card' },
    el(
      'button',
      {
        style: 'all:unset;display:block;width:100%;cursor:pointer',
        onclick: () => openOverlay(projectForm(project.id)),
      },
      el('strong', {}, project.name),
      el(
        'div',
        { class: 'meta' },
        `${toHours(minutes)} of ${hrs(project.weeklyTargetHours)} this week` +
          (total ? ` · ${hrs(toHours(total))} total` : '')
      )
    ),
    el(
      'div',
      { class: 'bar bar-small', style: 'margin:.6rem 0 .8rem' },
      el('div', { class: 'bar-fill', style: `width:${pct}%` })
    ),
    el(
      'div',
      { class: 'chips' },
      INCREMENTS.map(([mins, label]) =>
        el('button', { class: 'chip', onclick: () => log(mins) }, label)
      )
    ),
    notes
  );
}

export default function projects() {
  const list = activeProjects();
  return [
    el('h1', { style: 'margin-top:2.5rem' }, 'Projects'),
    list.length
      ? el(
          'p',
          { class: 'muted', style: 'margin-bottom:1rem' },
          'Loose commitment. Hours a week, whichever days they happen on.'
        )
      : el(
          'p',
          { class: 'muted', style: 'margin-bottom:1rem' },
          'For ongoing work like your research — the kind of thing that is never one task.'
        ),
    list.map(card),
    el(
      'button',
      {
        class: 'primary',
        style: 'width:100%;margin-top:.6rem',
        onclick: () => openOverlay(projectForm(null)),
      },
      'Add a project'
    ),
  ];
}
