import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.mjs';

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'em', 'del',
  'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'colspan', 'rowspan'];

let active = null;

function lockLinks(node) {
  if (!node || String(node.tagName).toUpperCase() !== 'A') return;
  const href = node.getAttribute('href') || '';
  if (!/^https?:\/\//i.test(href)) node.removeAttribute('href');
  else {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
}

function engine() {
  if (active && active.isSupported) return active;
  const root = typeof window !== 'undefined' ? window : null;
  const created = DOMPurify.isSupported ? DOMPurify : (root ? DOMPurify(root) : null);
  if (!created || !created.isSupported) return null;
  created.addHook('afterSanitizeAttributes', lockLinks);
  active = created;
  return created;
}

export function renderMarkdown(md) {
  const purify = engine();
  const parsed = marked.parse(String(md ?? ''), { async: false });
  const raw = typeof parsed === 'string' ? parsed : '';
  if (!purify) return '';
  const clean = String(purify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style'],
  }));
  return clean.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => `<div class="md-table">${table}</div>`);
}
