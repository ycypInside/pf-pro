# 個人財務與投資績效 — 資料規格（整理版）

狀態：依 v0.1 整理，去掉本機路徑。日期以台北時間為準。這份文件描述試算表與 Apps Script 的契約，前端不得直接寫入試算表。

## 已鎖定決策

| 項目 | 決定 |
|---|---|
| 報表幣別 | TWD。交易同時保留原幣與台幣 |
| 成本法 | 預設移動平均；交易逐筆保留，日後可切 FIFO |
| 報價 | 能抓就抓，否則手動。歷史價格只新增不覆寫，保留 `as_of` 與 `is_stale`。債券顯示最後估值日 |
| 技術 | Google Sheets ＋ Apps Script ＋ GitHub Pages |
| 寫入 | 一律走 `doPost`：驗權杖、檢查 `request_id`、驗證、寫入、記 Audit |

## 通用規則

- 分層：`fact` 只能新增與軟刪除；`market` 只能新增；`computed` 可由腳本整表重算；`config` 是設定。
- ID：`前綴-YYYYMMDD-6位隨機碼`。寫入後不改。
- 日期：`YYYY-MM-DD`。時間：ISO 8601，時區 `+08:00`。
- 金額以帳戶角度，流入為正、流出為負。原幣最多 4 位小數，台幣 2 位。
- `fx_rate` 是 1 單位原幣兌台幣。台幣交易的匯率是 1。`amount_twd = round(amount × fx_rate, 2)`。
- 修改一筆事實＝作廢舊筆＋新增新筆，`replaces_id` 指向舊筆。轉帳要整組作廢。投資交易的現金腿與交易一起作廢。
- 前端產生 UUID `request_id`。相同 id 且內容相同：回原結果、不重寫。內容不同：拒絕。

## 工作表

| 表 | 層 | 主鍵 |
|---|---|---|
| Accounts | config | account_id |
| Transactions | fact | txn_id |
| Investment_Trades | fact | trade_id |
| Assets | config | asset_id |
| Holdings | computed | account_id, asset_id, as_of, cost_method |
| Prices_FX | market | symbol, date, source |
| Cashflows | computed | cf_id |
| Liabilities | fact | liability_id |
| Snapshots | computed | snapshot_date |
| Benchmarks | market | benchmark_id, date |
| Settings | config | key |
| Audit_Log | fact | audit_id |
| Idempotency | 系統 | request_id |

欄位與列舉以 `apps-script/schema.json` 和 `apps-script/Schema.gs` 為準，表頭必須一致。

### 帳戶

`type`：`bank_cash` `bank_fx` `brokerage` `fund_platform` `credit_card` `loan` `cash_wallet` `other`。一帳戶一幣別。`is_investment` 決定是否納入投資部位。備註不放完整帳號。

### 收支與轉帳

`txn_type` 含 income、expense、transfer_out、transfer_in、fx_out、fx_in、dividend、interest、fee、tax、貸款相關、adjustment、opening。

轉帳與換匯由 `add_transfer` 一次寫入成對兩筆，共用 `transfer_group_id`。同幣別兩邊金額合計為 0；換匯的台幣差額若超過容忍值且沒有手續費列，每日檢查會警示。轉帳與換匯不計入收支。

`flow_class`：`external` `internal` `investment_income` `investment_cost`。投資帳戶的入金不可空白。

投資交易的現金腿使用 `adjustment`、分類「投資交易」、`flow_class=internal`，並帶 `trade_id`，因此不會進收支報表，也不會和持倉市值重複計算。

### 投資交易

`side`：`buy` `sell` `dividend_reinvest` `split` `transfer_in` `transfer_out` `maturity`。

- 買進與股息再投入：現金 = −(成交金額 + 手續費 + 稅)
- 賣出與到期：現金 = 成交金額 − 手續費 − 稅
- 分割、轉入、轉出：現金只計手續費與稅。分割的數量是增加的股數
- 買方前手息使現金更負，賣方前手息使現金增加；前手息不進成本

持倉由腳本以移動平均重算，不可手改。賣出與轉出不可超過持有數量。

### 價格

`kind`：`price` `nav` `bond_valuation` `fx`。同一 `symbol + date + source` 不可覆寫。過期門檻預設：市價與匯率 3 天、淨值 7 天、債券估值 45 天，可在 Settings 調整。讀取時依日期重算 `is_stale`，不依賴當初寫入的旗標。

### 淨資產

非負債帳戶的現金餘額換成台幣，加上持倉市值，再減去貸款與信用卡餘額的絕對值。缺少匯率的帳戶不計入，並在總覽標出。負債餘額以絕對值計，與每日快照同一套規則。

### 驗證

寫入前拒絕缺欄、非法列舉、幣別不符、台幣匯率不是 1、台幣金額對不上、帳戶未啟用、交易日早於開帳日、轉帳不成對、投資帳戶入金未標資金分類、重複而內容不同的 `request_id`。作廢只能作用中的列。每日檢查轉帳組、換匯差額、負餘額，結果由 `q=checks` 給前端。

## 讀寫介面

權杖放在指令碼屬性 `API_TOKEN`，不進版本庫。

- GET `?q=health|accounts|balances|income_expense|checks&token=...`。`incomeexpense` 與 `income_expense` 相同。收支可帶 `from`、`to`。
- GET 另支援 `transactions`、`trades`、`assets`、`prices`、`holdings`、`settings`。
- POST 本文為 JSON，標頭用 `text/plain`。內容含 `token`、`request_id`、`action`、`data`。
- 動作：`create_account`、`close_account`、`add_transaction`、`add_transfer`、`void_transaction`、`replace_transaction`、`add_liability`、`reconcile`、`set_setting`、`create_asset`、`add_trade`、`void_trade`、`add_price`。

`add_transfer` 的 `data` 形狀：`{ date, from, to, flow_class, description?, fee? }`。`from.amount` 為負、`to.amount` 為正。

重送同一個 `request_id` 且內容相同時，回應帶 `replay: true`，不會再寫一筆。

## 績效與配置

事實表不因績效重算而改寫。持倉用移動平均，賣出按均價釋放成本。台幣損益拆成價格效果與匯率效果：價格效果用期末匯率，匯率效果用成本上的匯率，兩者加總等於台幣損益。

外部本金（`flow_class=external` 且不是交易現金腿）不計入報酬。股息、利息、費用另列。內部轉帳在投資組合層互相抵消，帳戶層仍算資金進出。

- 時間加權：快照淨值逐日連結；兩點之間超過一天時用 Modified Dietz，現金流在期末的權重為 0。快照不足則改由交易與報價推算。
- 金錢加權：XIRR，實際天數除以 365。組合、帳戶、持倉都算。
- 最大回撤取成長指數的峰谷。
- 指標寫入 `Benchmarks`，只新增不覆寫。預設 `0050.TW`、`^TWII`、`SPY`，可用 Settings `benchmarks` 改。`fetchBenchmarks` 會抓公開報價；Yahoo 失敗時，台股代碼改走證交所月報。
- 配置比對 Settings `target_allocation`（例如 `{"stock":0.6,"bond":0.2,"cash":0.2}`）與 `rebalance_band_pct`（預設 5，單位是百分點）。基金與 ETF 若目標沒有單獨鍵，併入股票。

讀取：

- `q=performance&period=MTD|YTD|1Y|ALL`，可加 `benchmark=`。
- `q=allocation`
- `q=holdings` 另含價格／匯率拆解與報價狀態。

`action=refresh_benchmarks` 補指標價格。交易與收支寫入後會重算 `Cashflows`，不改原始交易。
