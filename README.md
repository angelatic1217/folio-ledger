# FolioLedger — 個人量化投資組合與水下風控系統

以 **Next.js (App Router) + TypeScript + Tailwind CSS + Recharts + Lucide Icons** 打造的純靜態個人投資組合與風控分析平台，專為 **GitHub Pages 免費託管** 與 **Local-First 零隱私外洩** 設計。

## 核心架構特色

- **100% 純 GitHub 生態（零外部後端）**
  - **公開行情層**：由 `.github/workflows/deploy.yml` 每天台美股收盤後自動排程（或手動觸發）執行 `scripts/fetch-market-data.mjs`，從 Yahoo Finance 抓取 `config/tickers.json` 的歷史收盤價、含息還原價（`adjClose`）、歷史拆股事件（例如 0050 1 拆 4）與 USD/TWD 匯率，打包成公開的 `public/data/market-data.json`。
  - **私人帳本層**：你的試算表 ID、交易紀錄與資產金額**不會寫入 GitHub Repo**，而是透過瀏覽器內建的 **Google Identity Services (GIS) OAuth 2.0** 直接以唯讀權限讀取非公開 Google Sheet，並儲存在本機瀏覽器的 `IndexedDB` 中。
- **純函數量化引擎（`src/lib/quant/`）**
  - 精確日加權 **Modified Dietz** 報酬率
  - 逐日連乘 **Daily TWR**（採用期初入金 / 期末出金 GIPS 慣例，排除出入金扭曲）
  - 基於 TWR 淨值指數的 **全資產 MDD 與每日水下深度圖（Underwater Area Chart）**
  - 基於 `Adj Close` 的 **個別標的即時 MDD 監控矩陣**（支援自訂警示門檻與列鑽取）
  - **動態區間查詢與美股匯率歸因**（拆解原幣報酬、台幣換算報酬與 FX Impact）
  - **歷年績效彙總與市場基準 Alpha 對比**

---

## 本機開發與測試

```bash
# 安裝依賴
npm install

# 更新公開歷史行情 (public/data/market-data.json)
npm run fetch:market

# 執行純函數量化引擎單元測試 (Vitest)
npm test

# 啟動本機開發伺服器 (http://localhost:3000)
npm run dev

# 產生 GitHub Pages 靜態檔案 (./out)
npm run build
```

---

## 部署至 GitHub Pages（3 步驟）

1. 將此專案推送至你的 GitHub Repository（預設分支 `main`）。
2. 前往 GitHub Repo 的 **Settings → Pages → Build and deployment → Source**，選擇 **GitHub Actions**。
3. 推送後（或至 **Actions** 頁面點擊 `Fetch Market Data & Deploy to GitHub Pages` → **Run workflow**），即會自動抓取最新收盤行情、跑完單元測試並部署至 `https://angelatic1217.github.io/folio-ledger/`。

> **新增追蹤或觀察標的**：只要在 `config/tickers.json` 加入代碼並 push（或手動執行一次 Workflow），系統就會自動納入該標的的歷史價格與拆股紀錄。

---

## 串接你的非公開 Google Sheet（GIS OAuth 設定）

1. 在 Google Sheets 建立一張私人試算表（權限維持「受限制 / 非公開」），參考 `templates/` 資料夾匯入以下分頁：
   - `transactions`（必填：交易紀錄，支援 `BUY / SELL / DIVIDEND / DRIP` 或中文類別）
   - `assets`（必填：標的設定與 `monitor_mdd` 開關）
   - `cash_snapshots`（選填：帳戶現金盤點快照）
   - `benchmarks`（選填：基準對照表）
2. 前往 [Google Cloud Console](https://console.cloud.google.com/) 建立免費專案：
   - 啟用 **Google Sheets API**。
   - 前往 **APIs & Services → OAuth consent screen**：選擇 External（測試模式即可），在 **Test users** 加入你自己的 Gmail。
   - 前往 **Credentials → Create Credentials → OAuth client ID**（類型選 **Web application**）：
     - **Authorized JavaScript origins** 加入：
       - `https://angelatic1217.github.io`
       - `http://localhost:3000`（若需本機測試）
   - 複製產生的 **Client ID**（`xxxxx.apps.googleusercontent.com`）。
3. 打開部署好的 FolioLedger 網站，在首頁或「設定」貼上 **Client ID** 與你的私人試算表網址，按下「**以 Google 帳號授權並同步**」即可。

> **免設 GCP 的快速方式**：你也可以直接在網頁中選擇「匯入本地 CSV」，將試算表的 `transactions.csv` 匯入瀏覽器本地快取，完全離線計算。
