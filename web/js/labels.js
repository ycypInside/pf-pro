export const ACCOUNT_TYPE = {
  bank_cash: '台幣存款',
  bank_fx: '外幣存款',
  brokerage: '證券',
  fund_platform: '基金',
  credit_card: '信用卡',
  loan: '貸款',
  cash_wallet: '現金',
  other: '其他',
};

export const TXN_LABEL = {
  income: '收入',
  expense: '支出',
  transfer_out: '轉出',
  transfer_in: '轉入',
  fx_out: '換出',
  fx_in: '換入',
  dividend: '股息',
  interest: '利息',
  fee: '費用',
  tax: '稅',
  loan_draw: '撥款',
  loan_repay_principal: '還本',
  loan_interest: '貸款利息',
  adjustment: '調整',
  opening: '開帳',
};

export const FLOW = [
  ['external', '外部（薪資、生活、入金）'],
  ['internal', '內部移轉'],
  ['investment_income', '投資收入'],
  ['investment_cost', '投資成本'],
];

export const FX_SOURCE = [
  ['actual', '實際成交'],
  ['market', '市場報價'],
  ['manual', '手動'],
];

export const SIDES = [
  ['buy', '買進'],
  ['sell', '賣出'],
  ['dividend_reinvest', '股息再投入'],
  ['split', '分割（填增加的股數）'],
  ['transfer_in', '轉入'],
  ['transfer_out', '轉出'],
  ['maturity', '到期'],
];

export const ASSET_CLASS = [
  ['stock', '股票'],
  ['etf', 'ETF'],
  ['fund', '基金'],
  ['bond', '債券'],
  ['cash_equiv', '約當現金'],
  ['other', '其他'],
];

export const PRICE_SOURCE = [
  ['manual', '手動'],
  ['auto_twse', '台股自動'],
  ['auto_us', '美股自動'],
  ['auto_fund', '基金自動'],
];

export const PRICE_KIND = [
  ['price', '市價'],
  ['nav', '淨值'],
  ['bond_valuation', '債券估值'],
  ['fx', '匯率'],
];

export const MARKET_SOURCE = [
  ['manual', '手動'],
  ['bank', '銀行'],
  ['twse', '證交所'],
  ['yahoo', 'Yahoo'],
  ['fund', '基金'],
];

export const KIND_LABEL = Object.fromEntries(PRICE_KIND);

export const DEFAULT_EXPENSE = ['餐飲', '交通', '居住', '生活', '娛樂', '醫療', '教育', '其他支出'];
export const DEFAULT_INCOME = ['薪資', '獎金', '股息', '利息', '其他收入'];

export function kindLabel(kind) {
  return KIND_LABEL[kind] || kind || '';
}
