import { apiPost } from './api.js';
import { h } from './dom.js';
import { explainError, nextRequest } from './money.js';

export function createPoster(action) {
  let pending = null;
  return {
    reset() {
      pending = null;
    },
    async send(payload) {
      if (payload === undefined) {
        if (!pending) {
          return { res: { ok: false, error: '沒有可重試的內容' }, requestId: '', network: false };
        }
      } else {
        pending = nextRequest(pending, { action, data: payload });
      }
      const requestId = pending.id;
      try {
        const res = await apiPost(action, pending.payload.data, requestId);
        if (res && res.ok) pending = null;
        return { res, requestId, network: false };
      } catch (error) {
        return { res: null, requestId, network: true, error };
      }
    },
  };
}

export function outcomeView(outcome, onRetry) {
  if (!outcome) return null;
  const idLine = outcome.requestId
    ? h('p', { class: 'mono' }, `request_id ${outcome.requestId}`)
    : null;
  const retry = outcome.network && onRetry
    ? h('button', { type: 'button', class: 'btn ghost', onClick: onRetry }, '重試同一個 request')
    : null;
  if (outcome.network) {
    const offline = outcome.error && outcome.error.offline;
    return h('div', { class: 'banner err', role: 'alert' },
      h('strong', {}, offline ? '沒有網路' : '連線失敗'),
      h('p', {}, offline
        ? '目前沒有網路。恢復後重試會沿用同一個 request_id，避免重複入帳。'
        : `${explainError((outcome.error && outcome.error.message) || '連線失敗')} 重試會沿用同一個 request_id，避免重複入帳。`),
      idLine,
      retry);
  }
  const res = outcome.res || {};
  if (res.replay && res.ok) {
    return h('div', { class: 'banner dup', role: 'status' },
      h('strong', {}, '重複送出'),
      h('p', {}, `這筆之前已經寫入，沒有再記一次。${res.result_ref ? `參考 ${res.result_ref}` : ''}`),
      idLine);
  }
  if (res.replay && !res.ok) {
    return h('div', { class: 'banner dup', role: 'status' },
      h('strong', {}, '重複送出'),
      h('p', {}, `同一個 request 先前已被拒絕，沒有再寫一次。${explainError(res.error || '', res.reason)}`),
      idLine);
  }
  if (res.ok) {
    const ids = (res.result && res.result.ids) || [];
    const warnings = (res.result && res.result.warnings) || [];
    return h('div', { class: 'banner ok', role: 'status' },
      h('strong', {}, '已寫入'),
      ids.length ? h('p', {}, `單號 ${ids.join('、')}`) : h('p', {}, '完成'),
      warnings.length ? h('p', { class: 'warn-line' }, warnings.join('；')) : null,
      idLine);
  }
  return h('div', { class: 'banner err', role: 'alert' },
    h('strong', {}, '未寫入'),
    h('p', {}, explainError(res.error || '失敗', res.reason)),
    idLine);
}
