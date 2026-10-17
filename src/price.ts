import { PriceManager } from './websocket.js';
import { getOpenPositions, db } from './firestore.js';
import { Timestamp } from 'firebase-admin/firestore';
import SYMBOLS from './data/symbols.json' with { type: 'json' };

// 初始化 PriceManager
const priceManager = new PriceManager(SYMBOLS);
priceManager.connect();

// 在記憶體中快取目前的未平倉位，避免每秒頻繁查詢 Firestore
let cachedOpenPositions: Array<{ id: string; data: any }> = [];

/**
 * 1. 每 10 分鐘從 Firestore 同步一次未平倉資料
 */
async function syncOpenPositionsFromDb() {
    console.log('🔄 [背景同步] 正在從 Firestore 更新未平倉位快取...');
    cachedOpenPositions = await getOpenPositions();
}

// 啟動時先執行一次，之後每 10 分鐘（600,000 毫秒）執行一次
syncOpenPositionsFromDb();
setInterval(syncOpenPositionsFromDb, 10 * 60 * 1000);

/**
 * 2. 每秒鐘使用記憶體中的持倉資料快速比對現價
 */
function monitorOpenPositions() {
    try {
        if (cachedOpenPositions.length === 0) return;

        for (const position of cachedOpenPositions) {
            const { id, data } = position;
            const { symbol, side, entryPrice, stopLossPrice, takeProfitPrices } = data;

            // 從記憶體的 PriceManager 取得即時現價（零延遲、不耗費 DB 資源）
            const currentPrice = priceManager.getPrice(symbol);
            if (!currentPrice) continue;

            let triggeredAction: 'TP_HIT' | 'SL_HIT' | null = null;
            let closeReason = '';

            // 多空風控判斷
            if (side === 'BUY') {
                if (takeProfitPrices?.tp1 && currentPrice >= takeProfitPrices.tp1) {
                    triggeredAction = 'TP_HIT';
                    closeReason = `觸及多單止盈目標 TP1 ($${takeProfitPrices.tp1})，當前價: $${currentPrice}`;
                } else if (stopLossPrice && currentPrice <= stopLossPrice) {
                    triggeredAction = 'SL_HIT';
                    closeReason = `觸及多單停損價 ($${stopLossPrice})，當前價: $${currentPrice}`;
                }
            } else if (side === 'SELL') {
                if (takeProfitPrices?.tp1 && currentPrice <= takeProfitPrices.tp1) {
                    triggeredAction = 'TP_HIT';
                    closeReason = `觸及空單止盈目標 TP1 ($${takeProfitPrices.tp1})，當前價: $${currentPrice}`;
                } else if (stopLossPrice && currentPrice >= stopLossPrice) {
                    triggeredAction = 'SL_HIT';
                    closeReason = `觸及空單停損價 ($${stopLossPrice})，當前價: $${currentPrice}`;
                }
            }

            // 觸發平倉
            if (triggeredAction) {
                console.log(`🚨 [風險控管] ${symbol} ${closeReason}`);
                closePositionInDb(id, symbol, currentPrice, closeReason);
            }
        }
    } catch (error: any) {
        console.error('❌ [監控持倉] 執行檢查時發生錯誤：', error.message || error);
    }
}

/**
 * 執行資料庫平倉更新，並同時更新記憶體快取以即時反映
 */
async function closePositionInDb(docId: string, symbol: string, closePrice: number, reason: string) {
    try {
        const docRef = db.collection('trade_positions').doc(docId);
        
        await docRef.update({
            status: 'CLOSED',
            closedAt: Timestamp.now(),
            closePrice: closePrice,
            closeReason: reason
        });

        console.log(`✅ [Firestore] 成功平倉紀錄：${symbol}，平倉價: $${closePrice}`);

        // 從記憶體快取中移除已平倉的項目，不需要等到下一個 10 分鐘
        cachedOpenPositions = cachedOpenPositions.filter(p => p.id !== docId);
        
    } catch (error: any) {
        console.error(`❌ [Firestore] 更新平倉單失敗 (${symbol})：`, error.message || error);
    }
}

// 每秒執行一次現價比對（讀取記憶體，效能極高）
setInterval(() => {
    monitorOpenPositions();
}, 1000);