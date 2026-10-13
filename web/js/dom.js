export function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (val == null || val === false) continue;
      if (key === 'class') node.className = val;
      else if (key === 'dataset') Object.assign(node.dataset, val);
      else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2).toLowerCase(), val);
      else if (key === 'value' && 'value' in node) node.value = val;
      else if (key === 'checked' || key === 'disabled' || key === 'readOnly') node[key] = Boolean(val);
      else node.setAttribute(key, val === true ? '' : String(val));
    }
  }
  for (const kid of kids) append(node, kid);
  return node;
}

function append(node, kid) {
  if (kid == null || kid === false) return;
  if (Array.isArray(kid)) {
    kid.forEach((item) => append(node, item));
    return;
  }
  node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
}

export function clear(node) {
  node.replaceChildren();
}

export function field(label, control, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'hint' }, hint) : null);
}

export function select(name, options, selected) {
  const node = h('select', { name });
  for (const option of options) {
    const [value, label] = Array.isArray(option) ? option : [option, option];
    const el = h('option', { value }, label);
    if (value === selected) el.selected = true;
    node.append(el);
  }
  return node;
}

export function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.8');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}
