# 🤖 Crypto AI Quantitative Trading Bot (加密貨幣 AI 自動化量化交易機器人)

本專案是一個基於 **TypeScript** 與 **Google Gemini AI** 所打造的加密貨幣自動化量化交易與盤勢分析系統。系統能定時透過 Binance USDM 永續合約 API 抓取多維度市場數據、大戶多空比、歷史持倉量（OI）、資金費率、訂單簿，並結合美國聯準會（FRED）總經數據（CPI、PCE、非農就業人口）交由 Google Gemini AI 進行深度量化分析。

系統產出交易訊號後會自動推送到 **Discord** 頻道，同時將報告與部位狀態同步至 **Firebase Firestore** 進行雲端管理。此外，內建 **WebSocket 即時價格管理器** 與 **自動化風控持倉監控中心**，能以極高效能進行 24 小時無間斷的止盈（TP）與止損（SL）全自動風控。

---

## 🛠 專案模組架構與核心邏輯

專案採用高內聚、低耦合的設計，各模組職責劃分如下：

### 1. `analyze.ts` (資料擷取、結構化處理與 AI 分析核心)

* **資料擷取 (`mergeMarketData`)**：平行或依序呼叫 Binance SDK 取得 K 線（預設 4h）、現價、訂單簿、資金費率、持倉量與大戶多空比；針對 `BTCUSDT` 額外呼叫 FRED API 獲取總經指標。
* **職責分離（資料與視圖解耦）**：`main` 函式（或 `mergeMarketData`）專門負責抓取並回傳純粹的結構化物件 (`MarketReportData`)。
* **字串合成函式 (`buildMarketReportText`)**：將結構化資料動態拼裝成格式化報告文字。
* **歷史報告解析 (`formatLatestMarketReportToText`)**：將 Firestore 中最新快取的市場報告與訊號資料轉換為易讀的排版文字。
* **AI 智慧決策 (`analyzeCoinsWithGemini`)**：將市場報告與歷史持倉結合，透過 `gemini-2.5-flash` 與指定的 JSON Schema 回傳結構化交易訊號 (`TradingSignal[]`)，包含 `OPEN_NEW`（建倉）、`CLOSE_POSITION`（平倉）或 `NO_ACTION`（觀望）。

### 2. `discord.ts` (多時段定時排程與通知)

* 使用 `node-cron` 建立全天候自動排程（涵蓋早盤、午盤、歐盤及美盤黃金時段）。
* 自動呼叫分析管線，將過長的訊息自動切割成多個區塊（Chunk），突破 Discord 2000 字元限制，以優美的 Markdown 卡片發送。

### 3. `firestore.ts` (雲端資料庫與持倉生命週期追蹤)

* **市場報告紀錄 (`market_reports`)**：依據時間戳記建立唯一文件 ID（例如 `2026-10-15_03-01-00`），完整保存每次分析的 AI 訊號與原始市場數據。
* **智能部位追蹤 (`trade_positions`)**：
* **`OPEN_NEW` 邏輯**：系統會自動檢查該幣種是否已有狀態為 `OPEN` 的持倉，防止重複開倉；若無則建立新紀錄。
* **`CLOSE_POSITION` 邏輯**：當收到平倉訊號時，自動尋找對應幣種的 `OPEN` 紀錄，更新其狀態為 `CLOSED`，並寫入平倉時間與平倉理由。



### 4. `websocket.ts` (即時價格管理器 `PriceManager`)

* **訂閱機制**：接收自訂的幣種清單（如 `SYMBOLS`），自動轉為小寫並透過 Binance USDM WebSocket 端點（`wss://[dstream.binance.com/stream](https://dstream.binance.com/stream)`）進行多幣種 `@ticker` 串流訂線。
* **記憶體儲存 (`Map`)**：將每個幣種的最新成交價（`lastPrice`）、買一價（`bidPrice`）、賣一價（`askPrice`）與更新時間戳記快取在記憶體的 `Map` 中。
* **自動重連**：內建斷線重連機制（5秒後自動重新連線）。

### 5. `price.ts` (自動化風控與部位監控中心)

* **雙層快取與低成本設計**：
* **行情來源**：每秒直接從 `PriceManager` 記憶體中讀取最新價格（**零延遲、不消耗資料庫資源**）。
* **部位同步**：透過背景排程（每 10 分鐘）從 Firebase Firestore 抓取一次未平倉部位（`OPEN`），快取至記憶體中。


* **多空雙向風控引擎**：
* **多單 (`BUY`)**：當現價 $\ge$ `tp1` 觸發止盈 (`TP_HIT`)；當現價 $\le$ `stopLossPrice` 觸發停損 (`SL_HIT`)。
* **空單 (`SELL`)**：當現價 $\le$ `tp1` 觸發止盈 (`TP_HIT`)；當現價 $\ge$ `stopLossPrice` 觸發停損 (`SL_HIT`)。


* **即時生命週期回寫**：一旦條件觸發，立即呼叫 Firestore 更新該筆訂單狀態為 `CLOSED`，寫入平倉價與平倉理由，並**同步從記憶體快取中移除**，確保不重複觸發。

---

## ⚙️ 環境變數設定 (`.env`)

請在專案根目錄建立 `.env` 檔案，並填入以下設定：

```env
# Binance API (USDM 永續合約)
API_KEY=你的_binance_api_key
API_SECRET=你的_binance_api_secret

# Google Gemini AI
GEMINI_API_KEY=你的_gemini_api_key

# FRED API (美國總經數據)
FRED_API_KEY=你的_fred_api_key

# Discord Bot
BOT_TOKEN=你的_discord_bot_token

```

> 💡 **注意**：請確保根目錄已放置 Firebase 服務帳戶金鑰檔案：`services.json`。

---

## 📦 安裝與環境準備

確保電腦已安裝 **Node.js**，接著在專案根目錄執行以下指令安裝相依套件：

```bash
npm install

```

---

## 👨‍🏫 教學：如何編譯與執行 TypeScript 專案

由於 Node.js 無法直接辨識原生 TypeScript 檔案 (`.ts`)，我們需要透過編譯器將其轉譯為 JavaScript (`.js`)，或是透過現代工具即時執行。

### 1. 初始化與設定 `tsconfig.json`

如果專案尚未建立設定檔，可以執行以下指令自動產生：

```bash
npx tsc --init

```

建議檢查 `tsconfig.json` 中的關鍵設定（配合 ESM 模組與專案架構）：

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}

```

### 2. 開發模式（推薦：自動監控並即時重啟）

在開發機器人時，若每次修改都要手動編譯會非常耗時。推薦安裝 `tsx` 來進行即時監控：

```bash
npm install tsx --save-dev

```

在 `package.json` 的 `scripts` 中加入：

```json
"scripts": {
  "dev": "tsx watch src/discord.ts",
  "build": "tsc",
  "start": "node dist/discord.js"
}

```

日常開發只需輸入：

```bash
npm run dev

```

### 3. 生產環境手動編譯與執行

如果你需要手動打包部署：

* **步驟一：執行編譯**（將 `src/` 底下的 `.ts` 轉譯為 `.js` 並輸出至 `dist/`）：

```bash
npx tsc

```


* **步驟二：啟動編譯後的程式**：

```bash
node dist/discord.js

```



---

## 📊 交易訊號與風控摘要

* **多空指令過濾**：AI 依據盤面與費波那契回撤分析給予明確的 `OPEN_NEW`、`CLOSE_POSITION` 或 `NO_ACTION` 指令，未達條件一律維持觀望。
* **風險報酬比控制**：建倉建議將盈虧比嚴格控制在 `1:1.5` 到 `1:2.5` 之間，並配置明確的進場價、補倉價（DCA）、止損價以及三檔止盈目標（TP1、TP2、TP3）。
* **高效能風控**：透過 WebSocket 結合記憶體快取每秒監控現價，將資料庫讀寫成本降低 99%，並確保觸及停利損時毫秒級自動平倉。
