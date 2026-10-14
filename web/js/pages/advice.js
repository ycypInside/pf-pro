import { h } from '../dom.js';
import { adviceTone, visibleAdvice } from '../groups.js';

export const ADVICE_DISCLAIMER = '以上內容由規則依你的資料與公開市場數據自動產生，只是參考方向，不構成投資建議，也不是買賣指示。';

export function adviceCard(payload, failed) {
  const items = visibleAdvice(payload && payload.items);
  const disclaimer = (payload && payload.disclaimer) || ADVICE_DISCLAIMER;
  return h('section', { class: 'card' },
    h('h2', {}, 'AI 專家建議'),
    failed
      ? h('p', { class: 'muted' }, '暫時讀不到建議。')
      : items.length
        ? h('div', { class: 'stack' }, items.map((item) => h('div', {
          class: adviceTone(item) === 'warn' ? 'banner err' : 'banner info',
          role: 'status',
        },
        h('strong', {}, item.title || ''),
        item.body ? h('p', {}, item.body) : null)))
        : h('p', { class: 'muted' }, '目前沒有額外建議。'),
    h('p', { class: 'hint' }, disclaimer));
}
