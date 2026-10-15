import { PriceManager } from './websocket.js';
import SYMBOLS from './data/symbols.json' with { type: 'json' };

const priceManager = new PriceManager(SYMBOLS);

// 2. 啟動背景即時監聽
priceManager.connect();

// 3. 模擬你在其他業務邏輯中隨時取用現價
function checkTradingOpportunity(symbol: string) {
    const currentPrice = priceManager.getPrice(symbol);
    
    if (currentPrice) {
        console.log(`📊 [檢查行情] ${symbol} 當前最新價: $${currentPrice}`);
    } else {
        console.log(`⏳ [檢查行情] ${symbol} 價格資料尚未載入或連線中...`);
    }
}

// 隔 3 秒測試抓取一次
setInterval(() => {
    checkTradingOpportunity('BTCUSDT');
}, 3000);