# PF Pro v0.1 — Apps Script 後端（第一階段）

試算表：PF Pro v0.1 — https://docs.google.com/spreadsheets/d/1Y16veC-FiV8z0ea5ZzKiTX-ujhWangebhR-NpXFiE6o/edit
規格：../docs/spec.md（13 張表；表頭必須與 `Schema.gs` 完全一致）

## 檔案
| 檔案 | 內容 |
|---|---|
| Code.gs | `doPost`（token → request_id 冪等 → 鎖 → 驗證 → 寫入 → Audit）與唯讀 `doGet`；動作：create_account、close_account、add_transaction、add_transfer（一次寫兩筆＋可選 fee）、void_transaction（轉帳整組作廢；若有 trade_id 連同投資交易作廢）、replace_transaction（作廢舊筆＋新增，replaces_id；轉帳與投資交易現金腿不可走這條）、add_liability、reconcile、set_setting、create_asset、add_trade、void_trade、add_price |
| Market.gs | 第 2 階段：報價（只新增）、持倉移動平均重算、餘額含台幣與淨資產、交易與標的寫入。`q=balances` 在原欄位外多回 `balance_twd` 與 `net_worth` |
| Validation.gs | V1–V12 寫入前／每日檢查、V5 收支報表排除轉帳、V6 對帳 |
| Idempotency.gs | V9：同 request_id 同 hash → 回原結果；hash 不同 → 拒絕；保留 90 天 |
| Audit.gs | Audit_Log 只新增 |
| Jobs.gs | 每日快照（V11、V13）、台銀即期中價抓取 `fetchBotFx`（只新增，失敗不寫）、觸發器安裝 |
| Backup.gs | 每週 Drive 備份、`restoreTest(backupId)` 還原測試、`verifySchema()` 表頭檢查 |
| Schema.gs / Config.gs / Util.gs | 表頭、enum、共用函式 |

## 部署步驟
1. 開啟試算表 → 擴充功能 → Apps Script（綁定專案），或到 script.google.com 新建專案。
2. 專案設定 → 勾選「在編輯器中顯示 appsscript.json」，把本資料夾的 `appsscript.json` 與所有 `.gs` 貼上（檔名相同）。
   或用 clasp：`npm i -g @google/clasp && clasp login && clasp create --type standalone --title "PF Pro API"`，複製檔案後 `clasp push`。
3. 專案設定 → 指令碼屬性：
   - `SPREADSHEET_ID` = `1Y16veC-FiV8z0ea5ZzKiTX-ujhWangebhR-NpXFiE6o`
   - `API_TOKEN` = 自己產生的長亂數（例如 32 字元以上），不要提交到 GitHub
   - `BACKUP_FOLDER_ID` = （選填）備份資料夾 id
4. 編輯器執行 `verifySchema` 一次（會要求授權），Log 應顯示 `All 13 headers match`。
5. 執行 `installTriggers`：每日 23:00 快照、03:00 清冪等、週日 04:00 備份。
6. 部署 → 新增部署 → 網頁應用程式：執行身分「我」。存取權：
   - 只自己用：「只有我」（最安全，前端需登入 Google）
   - 給 GitHub Pages 前端：「任何人」＋ API_TOKEN 驗證（token 只存在使用者瀏覽器，不寫進 repo）
7. 還原測試：執行 `weeklyBackup` 取得備份 id，再執行 `restoreTest('<id>')`，確認每張表 header ok。
8. 台銀匯率：先手動執行 `fetchBotFx`，核對 Prices_FX 的 USDTWD 與台銀網站即期買入／賣出的平均一致（CSV 欄位位置若變動要修正 `r[3]`、`r[13]`），確認後再加排程。

## 呼叫範例
```bash
curl -L -X POST "$WEBAPP_URL" -H 'Content-Type: text/plain' -d '{
 "token":"<API_TOKEN>","request_id":"<uuid>","action":"add_transaction",
 "data":{"date":"2026-10-15","account_id":"ACC-FUBON-TWD","txn_type":"expense","category":"餐飲",
         "amount":-150,"currency":"TWD","fx_rate":1,"fx_source":"actual","flow_class":"external"}}'
```
換匯：`action:"add_transfer"`，`data:{date, from:{account_id,amount(-),currency,fx_rate,fx_source}, to:{...(+)}, fee?:{account_id,amount,currency,fx_rate,fx_source}}`。
重送同一個 request_id → 回傳 `replay:true`，不會重複寫入。

第 2 階段新增（部署後才可用）：
- 讀取：`q=transactions|trades|assets|prices|holdings|settings`（`transactions` / `trades` 可加 `limit`，預設 50、最多 200）。`q=balances` 每列多 `balance_twd`、`fx_rate`，並附 `net_worth`。`q=incomeexpense` 與 `income_expense` 相同。
- `action:"create_asset"`，`data:{asset_id,name,asset_class,currency,price_source,symbol?}`。
- `action:"add_trade"`，`data:{trade_date,account_id,asset_id,side,quantity,price,fee?,tax?,fx_rate,fx_source,settle_date?,accrued_interest?,description?}`。買進現金腿為 `-(成交金額+手續費+稅)`，賣出為 `成交金額-手續費-稅`；現金腿 `txn_type=adjustment`、`flow_class=internal`，不進收支報表。分割／轉入轉出只動手續費。
- `action:"void_trade"`，`data:{trade_id,void_reason}`，連同現金腿作廢。
- `action:"add_price"`，`data:{symbol,kind,date,value,currency,source?,note?}`。同一 `symbol+date+source` 已存在會拒絕（只新增）。

## 已知限制
- 開帳（10/14）資料尚未匯入；Accounts 只有清單，opening_balance 留空待匯入。
- Holdings 會在交易、報價、作廢後以移動平均整表重算。Cashflows、TWR／XIRR 仍屬第 3 階段。
- Sheet 保護：Audit_Log 與 Idempotency 目前是「警告」模式，部署後可改為鎖定只允許擁有者。
- 讀表採整表讀取，資料量達數萬筆後再改為索引／快取。
