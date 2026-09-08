import { el } from '../dom.js';

export default function today() {
  return el('p', { class: 'muted' }, 'Today — coming next.');
}
