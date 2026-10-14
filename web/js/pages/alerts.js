import { h } from '../dom.js';
import { ALERT_LABELS, alertLevel } from '../p1.js';

const DISCLAIMER = '依持股卡規則與公開價格自動比對；僅為檢討提醒，不是操作單。';

export function alertsBlock(result) {
  const data = result && result.ok ? result.data : null;
  const alerts = (data && data.alerts) || [];
  const disclaimer = (data && data.disclaimer) || DISCLAIMER;
  return h('div', {},
    h('p', { class: 'hint' }, disclaimer),
    !result || !result.ok ? h('p', { class: 'muted' }, '讀不到檢討提醒。') : null,
    result && result.ok && !alerts.length ? h('p', { class: 'muted' }, '目前沒有提醒。') : null,
    alerts.map((alert) => {
      const level = alertLevel(alert.level);
      return h('article', { class: `alert alert-${level}` },
        h('div', { class: 'row spread' },
          h('strong', {}, alert.name || '提醒'),
          h('span', { class: `tag alert-tag alert-${level}` }, ALERT_LABELS[level])),
        alert.action ? h('p', {}, alert.action) : null,
        alert.reason ? h('p', { class: 'muted' }, alert.reason) : null,
        alert.detail ? h('p', { class: 'hint' }, alert.detail) : null);
    }));
}
