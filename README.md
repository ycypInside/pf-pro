# 帳簿 pf-pro

個人財務與投資績效。試算表是帳本，Apps Script 負責驗證與寫入，這個目錄的 `web/` 是手機優先的繁體中文靜態前端。基礎幣別是台幣。

## 使用

1. 部署 `apps-script/`（見該目錄的 README），存取權設為「任何人」，並設定 `API_TOKEN`。
2. 開啟 GitHub Pages 上的網站。
3. 到「設定」貼上網頁應用程式網址與權杖，按「測試連線」。兩者只存在這台瀏覽器的 localStorage，沒有寫進這個 repo。

頁面：

- **總覽**：淨資產、帳戶餘額（原幣與台幣）、本月收支分類、過期報價、債券最後估值日、資料檢查。
- **記帳**：支出／收入、成對轉帳、投資交易、手動報價。每次送出產生 UUID `request_id`；連線失敗時重試沿用同一個 id。成功、重複送出、拒絕會分開顯示。
- **明細**：最近紀錄。一般收支的「修正」會作廢舊筆並寫入新筆；轉帳整組作廢；投資交易連同現金腿一起作廢。
- **設定**：網址、權杖、測試連線（`q=health`）。

前端對 Apps Script 的 POST 使用 `Content-Type: text/plain`，並跟隨預設的 redirect。

## 頁面網址

預期網址：<https://ycypinside.github.io/pf-pro/>

GitHub Actions（`.github/workflows/pages.yml`）會在 `main` 上把 `web/` 發佈到 Pages。若頁面還沒開啟，到 GitHub 倉庫 **Settings → Pages → Build and deployment → Source**，選 **GitHub Actions**。工作流程也會試著把來源設成 Actions；權限不足時那一步會略過，不影響測試。

## 後端

`apps-script/` 是已部署腳本的版本。第 2 階段若要讓記帳頁的投資交易、手動報價，以及總覽的報價／持倉可用，需要把下列檔案 `clasp push` 後重新部署：

- `Code.gs`
- `Market.gs`（新檔）
- `Util.gs`
- `Schema.gs`
- `Jobs.gs`

既有的 `q=health|accounts|balances|income_expense|checks` 仍可用。`incomeexpense` 是 `income_expense` 的別名。`balances` 多了台幣金額與 `net_worth`。
