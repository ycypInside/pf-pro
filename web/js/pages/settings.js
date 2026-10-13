import { apiGet, clearConfig, loadConfig, saveConfig } from '../api.js';
import { h } from '../dom.js';
import { explainError, validateEndpoint } from '../money.js';

export function renderSettings(main, ctx) {
  const saved = loadConfig();
  const url = h('input', {
    name: 'apiUrl',
    type: 'url',
    inputmode: 'url',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: '貼上部署後的網頁應用程式網址',
    value: saved.apiUrl,
    required: true,
  });
  const token = h('input', {
    name: 'token',
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: '貼上 API 權杖',
    value: saved.token,
    required: true,
  });
  const status = h('div', { class: 'stack' });
  const form = h('form', { class: 'stack', onSubmit: (event) => event.preventDefault() },
    h('label', { class: 'field' },
      h('span', { class: 'field-label' }, 'API 網址'),
      url,
      h('span', { class: 'hint' }, '只存在這台瀏覽器，不會寫進網站程式。')),
    h('label', { class: 'field' },
      h('span', { class: 'field-label' }, '權杖'),
      token,
      h('span', { class: 'hint' }, '每次請求才送到你填的網址。')),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onClick: save }, '儲存'),
      h('button', { type: 'button', class: 'btn primary', onClick: test }, '測試連線'),
      h('button', { type: 'button', class: 'btn ghost', onClick: wipe }, '清除')));
  main.append(
    h('p', { class: 'lede' }, '先貼上 Apps Script 網頁應用程式的網址與權杖。測試連線只打 health，確認權杖與版本。'),
    form,
    status);

  function current() {
    return { apiUrl: url.value.trim(), token: token.value.trim() };
  }

  function show(node) {
    status.replaceChildren(node);
  }

  function save() {
    const config = current();
    const problem = validateEndpoint(config.apiUrl, config.token);
    if (problem) {
      show(h('div', { class: 'banner err', role: 'alert' }, h('strong', {}, '尚未儲存'), h('p', {}, problem)));
      return;
    }
    saveConfig(config.apiUrl, config.token);
    show(h('div', { class: 'banner ok', role: 'status' },
      h('strong', {}, '已存在這台瀏覽器'),
      h('p', {}, '權杖沒有寫進這個公開網站。')));
  }

  async function test() {
    const config = current();
    const problem = validateEndpoint(config.apiUrl, config.token);
    if (problem) {
      show(h('div', { class: 'banner err', role: 'alert' }, h('strong', {}, '無法測試'), h('p', {}, problem)));
      return;
    }
    show(h('p', { class: 'muted' }, '連線中…'));
    try {
      const data = await apiGet('health', {}, config);
      if (!ctx.alive()) return;
      saveConfig(config.apiUrl, config.token);
      show(h('div', { class: 'banner ok', role: 'status' },
        h('strong', {}, '連線成功'),
        h('p', {}, `schema ${data.schema_version || '—'} · ${data.at || ''}`),
        h('p', {}, '網址與權杖已存到這台瀏覽器。')));
    } catch (error) {
      if (!ctx.alive()) return;
      show(h('div', { class: 'banner err', role: 'alert' },
        h('strong', {}, '連線失敗'),
        h('p', {}, explainError(error.message))));
    }
  }

  function wipe() {
    clearConfig();
    url.value = '';
    token.value = '';
    show(h('div', { class: 'banner dup', role: 'status' },
      h('strong', {}, '已清除'),
      h('p', {}, '這台瀏覽器不再保留網址與權杖。')));
  }
}
