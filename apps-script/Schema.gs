/** PF Pro v0.1 — sheet headers (must match spreadsheet row 1 exactly). */
var SCHEMA = {
  "Accounts": [
    "account_id",
    "name",
    "type",
    "currency",
    "institution",
    "parent_account_id",
    "is_investment",
    "opening_balance",
    "opening_date",
    "status",
    "note"
  ],
  "Transactions": [
    "txn_id",
    "date",
    "account_id",
    "txn_type",
    "category",
    "amount",
    "currency",
    "fx_rate",
    "amount_twd",
    "fx_source",
    "transfer_group_id",
    "counterparty_account_id",
    "asset_id",
    "trade_id",
    "flow_class",
    "description",
    "status",
    "void_reason",
    "voided_at",
    "replaces_id",
    "created_at",
    "created_by",
    "request_id",
    "updated_at"
  ],
  "Investment_Trades": [
    "trade_id",
    "trade_date",
    "settle_date",
    "account_id",
    "asset_id",
    "side",
    "quantity",
    "price",
    "currency",
    "gross_amount",
    "fee",
    "tax",
    "net_amount",
    "fx_rate",
    "net_amount_twd",
    "accrued_interest",
    "lot_match_ref",
    "cash_txn_id",
    "status",
    "void_reason",
    "voided_at",
    "replaces_id",
    "created_at",
    "created_by",
    "request_id",
    "updated_at"
  ],
  "Assets": [
    "asset_id",
    "name",
    "asset_class",
    "symbol",
    "isin",
    "exchange",
    "currency",
    "price_source",
    "tags",
    "bond_coupon",
    "bond_maturity",
    "status"
  ],
  "Holdings": [
    "account_id",
    "asset_id",
    "as_of",
    "quantity",
    "avg_cost",
    "cost_basis",
    "cost_basis_twd",
    "last_price",
    "price_date",
    "is_stale",
    "market_value",
    "market_value_twd",
    "unrealized_pl_twd",
    "cost_method"
  ],
  "Prices_FX": [
    "symbol",
    "kind",
    "date",
    "value",
    "currency",
    "source",
    "fetched_at",
    "is_stale",
    "note"
  ],
  "Cashflows": [
    "cf_id",
    "date",
    "scope",
    "account_id",
    "direction",
    "amount_twd",
    "amount",
    "currency",
    "fx_rate",
    "cf_class",
    "source_txn_id"
  ],
  "Liabilities": [
    "liability_id",
    "account_id",
    "name",
    "liability_type",
    "currency",
    "principal_original",
    "balance",
    "balance_as_of",
    "interest_rate",
    "rate_type",
    "start_date",
    "maturity_date",
    "payment_day",
    "status",
    "void_reason",
    "voided_at",
    "replaces_id",
    "created_at",
    "created_by",
    "request_id",
    "updated_at"
  ],
  "Snapshots": [
    "snapshot_date",
    "total_assets_twd",
    "total_liabilities_twd",
    "net_worth_twd",
    "cash_twd",
    "investments_twd",
    "fx_usdtwd",
    "month_income_twd",
    "month_expense_twd",
    "savings_rate",
    "external_flow_twd",
    "stale_price_count",
    "calc_version",
    "created_at"
  ],
  "Benchmarks": [
    "benchmark_id",
    "date",
    "index_value",
    "currency",
    "total_return",
    "daily_return",
    "source",
    "fetched_at"
  ],
  "Settings": [
    "key",
    "value",
    "note"
  ],
  "Audit_Log": [
    "audit_id",
    "at",
    "actor",
    "action",
    "sheet",
    "record_id",
    "before_json",
    "after_json",
    "request_id",
    "client"
  ],
  "Idempotency": [
    "request_id",
    "received_at",
    "endpoint",
    "payload_hash",
    "result_status",
    "result_ref"
  ]
};

var ENUMS = {
  "account_type": [
    "bank_cash",
    "bank_fx",
    "brokerage",
    "fund_platform",
    "credit_card",
    "loan",
    "cash_wallet",
    "other"
  ],
  "currency": [
    "TWD",
    "USD",
    "JPY",
    "EUR",
    "CNY",
    "HKD",
    "AUD",
    "GBP"
  ],
  "account_status": [
    "active",
    "closed"
  ],
  "txn_type": [
    "income",
    "expense",
    "transfer_out",
    "transfer_in",
    "fx_out",
    "fx_in",
    "dividend",
    "interest",
    "fee",
    "tax",
    "loan_draw",
    "loan_repay_principal",
    "loan_interest",
    "adjustment",
    "opening"
  ],
  "fx_source": [
    "actual",
    "market",
    "manual"
  ],
  "flow_class": [
    "external",
    "internal",
    "investment_income",
    "investment_cost"
  ],
  "liability_type": [
    "mortgage",
    "personal_loan",
    "credit_card",
    "margin",
    "other"
  ],
  "rate_type": [
    "fixed",
    "floating"
  ],
  "asset_class": [
    "stock",
    "etf",
    "fund",
    "bond",
    "cash_equiv",
    "other"
  ],
  "price_source": [
    "auto_twse",
    "auto_us",
    "auto_fund",
    "manual"
  ],
  "trade_side": [
    "buy",
    "sell",
    "dividend_reinvest",
    "split",
    "transfer_in",
    "transfer_out",
    "maturity"
  ],
  "price_kind": [
    "price",
    "nav",
    "bond_valuation",
    "fx"
  ],
  "market_source": [
    "twse",
    "yahoo",
    "bank",
    "manual",
    "fund"
  ]
};

// P1 sheets (see P1.js; created by ensure_p1_sheets).
SCHEMA.Plan = ['plan_id', 'track', 'label', 'year', 'target_date', 'target_twd', 'baseline_date', 'baseline_twd', 'monthly_twd', 'cagr', 'status', 'note', 'updated_at'];
SCHEMA.DCA = ['dca_id', 'asset_id', 'symbol', 'name', 'account_id', 'currency', 'amount', 'debit_day', 'start_date', 'status', 'last_debit_date', 'core', 'note', 'updated_at'];
SCHEMA.Holding_Rules = ['rule_key', 'card_key', 'card_name', 'card_class', 'asset_ids', 'card_status', 'rule_id', 'type', 'level', 'pct', 'date', 'confirm_days', 'grp', 'tier', 'info', 'action', 'reason', 'seed_peak', 'events', 'card_note', 'status', 'updated_at'];
SCHEMA.Paper_Daily = ['row_id', 'date', 'sleeve', 'kind', 'label', 'capital_twd', 'equity_twd', 'cash_twd', 'return_pct', 'drawdown_pct', 'max_dd_pct', 'trading_days', 'cash_pct', 'n_positions', 'vs_0050_pp', 'vs_00631L_pp', 'gate_target_pct', 'gate_json', 'flags', 'positions_json', 'status', 'updated_at'];
