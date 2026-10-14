# 🤖 Gemini AI Crypto Trading Bot

這是一個基於 **Node.js (TypeScript)** 與 **Google GenAI (Gemini SDK)** 的加密貨幣合約自動交易機器人。它結合了 Binance USD-M (USDT 本位合約) 的市場數據與 Gemini 的強大推理能力，依據多週期 K 線數據（4H、1H、1M）來自動化執行市場分析、風控管理與掛單決策。

---

## 🌟 主要功能特色

* **多週期智慧分析**：同時抓取 **4小時 (4H)**、**1小時 (1H)** 與 **1分鐘 (1M)** 的 K 線數據，交由 Gemini AI 進行綜合趨勢與關鍵位階判斷。
* **紀律化交易風格**：內建冷酷紀律型人格 Prompt 設定，嚴格執行右側確認、關鍵支撐/阻力位守候，杜絕 FOMO 與情緒化操作。
* **自動化訂單與風控執行**：
* 支援限價開倉 (`LIMIT`)、市價平倉 (`MARKET`)。
* 自動綁定止損 (`STOP_MARKET`) 與止盈 (`TAKE_PROFIT_MARKET`) 條件單。


* **精準數值校正**：內建 Binance 交易對精度（`tickSize` 與 `stepSize`）自動校正機制，防止因小數點位數錯誤導致的 API 拒絕。
* **定期排程監控**：支援定時循環任務，自動對多個指定交易對進行輪詢監控與動態管理。

---

## 🛠️ 專案架構與依賴

### 核心依賴

* `@google/genai`：Google 官方最新的 Gemini API SDK。
* `binance`：Binance API 客戶端（使用 `USDMClient` 處理合約操作）。
* `dotenv`：環境變數管理。

### 支援的交易對

程式碼內建預設監控陣列與精度過濾對照表，目前示範設定包含 `UNIUSDT`、`BATUSDT` 等多種主流及潛力幣種。

---

## ⚙️ 環境變數設定 (`.env`)

在專案根目錄下建立一個 `.env` 檔案，並填入以下金鑰：

```env
# Google Gemini API Key
GEMINI_API_KEY=your_gemini_api_key_here

# Binance API Credentials (建議先使用 Testnet 測試網)
API_KEY=your_binance_api_key_here
API_SECRET=your_binance_api_secret_here

```

---

## 🚀 快速開始

### 1. 安裝相依套件

```bash
npm install

```

### 2. 編譯與執行

確保已正確設定 `tsconfig.json` 與相關 ES Modules 支援，透過 TypeScript 執行：

```bash
# 開發模式執行
npx tsx src/bot.ts

```

---

## 🧠 AI 決策架構說明

機器人每次執行 `runBotTask` 時，會經歷以下流程：

1. **資料蒐集**：平行抓取指定幣種的 K 線、當前倉位（`Positions`）與現存掛單（`OpenOrders`）。
2. **AI 推理**：將資料送往 `gemini-2.5-flash` 模型，並透過 `responseSchema` 強制回傳結構化的 JSON 決策（`AIDecision`）。
3. **指令解析與執行**：
* `NO_ACTION`：維持現狀。
* `CANCEL_ORDERS`：取消所有未成交掛單與條件單。
* `CLOSE_POSITION`：市價平倉所有現有部位。
* `UPDATE_SL_TP`：動態更新止損與止盈價位。
* `OPEN_NEW`：先平掉反向倉位，並掛出新的限價單與對應的風控止盈止損單。