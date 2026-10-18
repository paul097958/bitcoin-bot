import WebSocket from 'ws';
import { getOpenPositions, db } from './firestore.js';
import { Timestamp } from 'firebase-admin/firestore';

export class PriceManager {
    // 使用 Map 儲存幣價，key 是 symbol (例如 'BTCUSDT')，value 是價位資料
    private priceMap: Map<string, { bidPrice: number; askPrice: number; lastPrice: number; updateTime: number }> = new Map();
    private ws: WebSocket | null = null;
    private symbols: string[];
    
    // 快取目前的未平倉位與定時器指標
    private cachedOpenPositions: Array<{ id: string; data: any }> = [];
    private syncInterval: NodeJS.Timeout | null = null;
    private monitorInterval: NodeJS.Timeout | null = null;
    private connectedStatus: boolean = false;

    constructor(symbols: string[]) {
        // 轉為小寫以符合幣安 WebSocket 要求
        this.symbols = symbols.map(s => s.toLowerCase());
    }

    public connect() {
        const streams = this.symbols.map(s => `${s}@ticker`).join('/');
        const wsUrl = `wss://dstream.binance.com/stream?streams=${streams}`;

        console.log(`🔌 正在啟動價格即時更新與風控監控服務...`);
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            console.log(`✅ WebSocket 已連線，開始接收 ${this.symbols.length} 個幣種的即時報價`);
            this.connectedStatus = true;
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const message = JSON.parse(data.toString());
                
                if (message && message.data) {
                    const ticker = message.data;
                    const symbol = ticker.s; // 幣種大寫，例如 BTCUSDT
                    const price = parseFloat(ticker.c); // 最新成交價
                    const bid = parseFloat(ticker.b);   // 買一價
                    const ask = parseFloat(ticker.a);   // 賣一價

                    // 更新至 Map 中
                    this.priceMap.set(symbol, {
                        lastPrice: price,
                        bidPrice: bid,
                        askPrice: ask,
                        updateTime: Date.now()
                    });
                }
            } catch (err) {
                console.error(`❌ 解析價格訊息失敗:`, err);
            }
        });

        this.ws.on('close', () => {
            console.warn(`⚠️ WebSocket 斷線，停止風控排程並於 5 秒後自動重連...`);
            this.stopMonitoringServices();
            setTimeout(() => this.connect(), 5000);
        });

        this.ws.on('error', (err) => {
            console.error(`❌ WebSocket 錯誤:`, err);
        });
    }

    /**
     * 啟動 Firestore 同步與每秒價格風控檢查
     */
    public startMonitoringServices() {
        // 立即執行一次同步
        this.syncOpenPositionsFromDb();

        // 每 10 分鐘（600,000 毫秒）從 Firestore 同步一次未平倉資料
        this.syncInterval = setInterval(() => {
            this.syncOpenPositionsFromDb();
        }, 10 * 60 * 1000);

        // 每秒執行一次現價比對（讀取記憶體，效能極高）
        this.monitorInterval = setInterval(() => {
            this.monitorOpenPositions();
        }, 1000);
    }

    /**
     * 停止排程（避免斷線重連時短暫有多個 Timer 同時執行）
     */
    public stopMonitoringServices() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        if (this.monitorInterval) clearInterval(this.monitorInterval);
    }

    /**
     * 從 Firestore 同步未平倉資料
     */
    private async syncOpenPositionsFromDb() {
        try {
            console.log('🔄 [背景同步] 正在從 Firestore 更新未平倉位快取...');
            this.cachedOpenPositions = await getOpenPositions();
        } catch (error: any) {
            console.error('❌ [背景同步] 取得未平倉資料失敗：', error.message || error);
        }
    }

    /**
     * 檢查所有未平倉位的 TP1 與 SL 觸發狀況
     */
    private monitorOpenPositions() {
        try {
            if(!this.connectedStatus){
                console.log('請先執行connect才可使用此方法。')
            }
            if (this.cachedOpenPositions.length === 0) return;

            for (const position of this.cachedOpenPositions) {
                const { id, data } = position;
                const { symbol, side, entryPrice, stopLossPrice, takeProfitPrices } = data;

                // 從記憶體取得即時現價
                const currentPrice = this.getPrice(symbol);
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
                    this.closePositionInDb(id, symbol, currentPrice, closeReason);
                }
            }
        } catch (error: any) {
            console.error('❌ [監控持倉] 執行檢查時發生錯誤：', error.message || error);
        }
    }

    /**
     * 執行資料庫平倉更新並更新記憶體快取
     */
    private async closePositionInDb(docId: string, symbol: string, closePrice: number, reason: string) {
        try {
            const docRef = db.collection('trade_positions').doc(docId);
            
            await docRef.update({
                status: 'CLOSED',
                closedAt: Timestamp.now(),
                closePrice: closePrice,
                closeReason: reason
            });

            console.log(`✅ [Firestore] 成功平倉紀錄：${symbol}，平倉價: $${closePrice}`);

            // 從記憶體快取中移除已平倉的項目
            this.cachedOpenPositions = this.cachedOpenPositions.filter(p => p.id !== docId);
        } catch (error: any) {
            console.error(`❌ [Firestore] 更新平倉單失敗 (${symbol})：`, error.message || error);
        }
    }

    /**
     * 外部隨時呼叫此方法取得特定幣種的現價
     */
    public getPrice(symbol: string): number | undefined {
        return this.priceMap.get(symbol)?.lastPrice;
    }

    /**
     * 取得整個 Map (適合傳給網頁前端或批次處理)
     */
    public getAllPrices(): Map<string, any> {
        return this.priceMap;
    }
}