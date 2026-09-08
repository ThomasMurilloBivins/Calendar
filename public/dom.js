// Replaces a node's children, dropping null/false so `cond ? node : null`
// works everywhere. Plain replaceChildren would render the literal "null".
export function fill(node, ...kids) {
  node.replaceChildren();
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  return fill(node, ...kids);
}

let toastTimer = null;

export function toast(message, action) {
  const box = document.getElementById('toast');
  fill(
    box,
    el('span', {}, message),
    action &&
      el(
        'button',
        {
          class: 'toast-action',
          onclick: () => {
            action.run();
            box.hidden = true;
          },
        },
        action.label
      )
  );
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), action ? 6000 : 2200);
}

// Full-screen layer. Triage uses it so a single item is genuinely the only
// thing on screen; the small forms use it so nothing shifts underneath.
export function openOverlay(build) {
  const layer = document.getElementById('overlay');
  const close = () => {
    layer.hidden = true;
    layer.replaceChildren();
    // The screen underneath skipped its re-renders while this was open.
    window.dispatchEvent(new Event('overlay-closed'));
  };
  layer.replaceChildren(build(close));
  layer.hidden = false;
  return close;
}

export function isOverlayOpen() {
  return !document.getElementById('overlay').hidden;
}
