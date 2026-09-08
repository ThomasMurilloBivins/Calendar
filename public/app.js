import * as store from './store.js';
import { el, isOverlayOpen } from './dom.js';
import { inboxItems } from './util.js';
import today from './screens/today.js';
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
  root.replaceChildren(syncDot(), el('main', { class: `screen screen-${name}` }, SCREENS[name]()), nav());
}

window.addEventListener('hashchange', render);
window.addEventListener('app-render', render);
store.onChange(() => {
  // Don't rebuild the page underneath an open overlay (triage, forms) — it
  // would blow away what the user is part-way through typing.
  if (!isOverlayOpen()) render();
});

const config = await store.init();
if (config?.authRequired && store.getSyncState() === 'locked') unlocked = false;
render();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
