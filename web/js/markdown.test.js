import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import test from 'node:test';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { renderMarkdown } = await import('./markdown.js');

function mount(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

test('markdown keeps safe links and drops active content', () => {
  const html = renderMarkdown([
    '# 週報',
    '',
    '<script>alert(1)</script>',
    '<style>body{color:red}</style>',
    '<iframe src="https://example.com/frame"></iframe>',
    '<p onclick="alert(1)" style="color:red">段落</p>',
    '',
    '[壞](javascript:alert(1))',
    '',
    '[好](https://example.com/note)',
    '',
    '| 欄 | 值 |',
    '| --- | --- |',
    '| 甲 | 乙 |',
  ].join('\n'));
  const host = mount(html);
  assert.equal(host.querySelector('script'), null);
  assert.equal(host.querySelector('style'), null);
  assert.equal(host.querySelector('iframe'), null);
  assert.equal(host.querySelector('[onclick]'), null);
  assert.equal(host.querySelector('[style]'), null);
  assert.equal(html.includes('javascript:'), false);
  assert.equal(host.querySelector('a[href^="javascript:"]'), null);
  const link = host.querySelector('a[href="https://example.com/note"]');
  assert.equal(link.getAttribute('href'), 'https://example.com/note');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  const table = host.querySelector('.md-table');
  assert.ok(table);
  assert.ok(table.querySelector('table'));
  assert.equal(host.querySelector('h1').textContent, '週報');
});

test('markdown accepts a long research note', () => {
  const body = `${'研究段落 '.repeat(4500)}\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n`;
  assert.ok(body.length > 21000);
  const html = renderMarkdown(body);
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 21000);
  assert.ok(html.includes('md-table'));
  assert.equal(html.includes('<script'), false);
});
