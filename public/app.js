import * as store from './store.js';
import { el, isOverlayOpen, openOverlay } from './dom.js';
import { inboxItems } from './util.js';
import today, { scheduleEditor } from './screens/today.js';
import inbox from './screens/inbox.js';
import week from './screens/week.js';
import projects from './screens/projects.js';

const SCREENS = { today, inbox, week, projects };
const TABS = [
  ['today', 'Today'],
  ['inbox', 'Inbox'],
  ['week', 'Week'],
  ['projects', 'Projects'],
];

const root = document.getElementById('app');
let unlocked = true;

function current() {
  const name = location.hash.slice(1);
  return SCREENS[name] ? name : 'today';
}

export function go(name) {
  location.hash = name;
}

function syncDot() {
  const s = store.getSyncState();
  const label = {
    synced: 'Backed up',
    syncing: 'Saving…',
    offline: 'Offline — saved on this device',
    local: 'This device only',
    locked: 'Not backed up',
    idle: '',
  }[s];
  return el('div', { class: `sync sync-${s}`, title: label }, label);
}

function nav() {
  const name = current();
  const count = inboxItems().length;
  return el(
    'nav',
    { class: 'tabs' },
    TABS.map(([id, label]) =>
      el(
        'a',
        { class: `tab${id === name ? ' on' : ''}`, href: `#${id}` },
        label,
        id === 'inbox' && count ? el('span', { class: 'badge' }, count) : null
      )
    )
  );
}

function unlockScreen() {
  const input = el('input', {
    type: 'password',
    placeholder: 'Passcode',
    autocomplete: 'current-password',
  });
  const error = el('p', { class: 'muted' }, '');
  const submit = async () => {
    if (await store.unlock(input.value)) {
      unlocked = true;
      render();
    } else {
      error.textContent = "That passcode didn't match.";
    }
  };
  return el(
    'form',
    {
      class: 'unlock',
      onsubmit: (e) => {
        e.preventDefault();
        submit();
      },
    },
    el('h1', {}, 'Planner'),
    el('p', { class: 'muted' }, 'Enter your passcode to back up and sync this device.'),
    input,
    el('button', { class: 'primary', type: 'submit' }, 'Unlock'),
    error
  );
}

export function render() {
  if (!unlocked) {
    root.replaceChildren(unlockScreen());
    return;
  }
  const name = current();
  root.replaceChildren(
    syncDot(),
    // Settings are not part of today. One gear, out of the way, off the page.
    el(
      'button',
      { class: 'gear', 'aria-label': 'Classes, shifts and day shape', onclick: () => openOverlay(scheduleEditor) },
      '\u2699'
    ),
    el('main', { class: `screen screen-${name}` }, SCREENS[name]()),
    nav()
  );
}

window.addEventListener('hashchange', render);
window.addEventListener('app-render', render);
store.onChange(() => {
  // Don't rebuild the page underneath an open overlay (triage, forms) — it
  // would blow away what the user is part-way through typing.
  if (!isOverlayOpen()) render();
});

// Registered before this module awaits its first sync: the worker posts the
// stale-code notice within the first moments of a load, and a listener added
// after an await simply never receives it — startMessages() does not flush a
// message that was posted before the listener existed.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});

  // One reload, once, when the running code is known to be stale. The
  // timestamp guard means a genuinely broken deploy can't put the page in a
  // reload loop.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'shell-updated') return;
    const last = Number(sessionStorage.getItem('reloadedAt') || 0);
    if (Date.now() - last < 30000) return;
    sessionStorage.setItem('reloadedAt', String(Date.now()));
    location.reload();
  });
  // Required when the listener is added with addEventListener rather than
  // onmessage: delivery stays queued until this is called, and this module
  // registers late because it awaits the first sync.
  navigator.serviceWorker.startMessages();
}

// Laptop shortcuts. Ignored while typing, so "/" in a task title is a slash.
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (e.key === 'Escape') {
    const layer = document.getElementById('overlay');
    if (!layer.hidden) {
      layer.hidden = true;
      layer.replaceChildren();
      render();
    }
    return;
  }
  if (e.key === '/' && !typing) {
    e.preventDefault();
    go('today');
    // hashchange (and the render it triggers) fires after this handler, so the
    // capture box doesn't exist yet when coming from another screen.
    setTimeout(() => document.querySelector('.capture input')?.focus(), 0);
  }
});

const config = await store.init();
if (config?.authRequired && store.getSyncState() === 'locked') unlocked = false;
render();
