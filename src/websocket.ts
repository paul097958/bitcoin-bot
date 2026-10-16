import WebSocket from 'ws';

export class PriceManager {
    // 使用 Map 儲存幣價，key 是 symbol (例如 'BTCUSDT')，value 是價位資料
    private priceMap: Map<string, { bidPrice: number; askPrice: number; lastPrice: number; updateTime: number }> = new Map();
    private ws: WebSocket | null = null;
    private symbols: string[];

    constructor(symbols: string[]) {
        // 轉為小寫以符合幣安 WebSocket 要求
        this.symbols = symbols.map(s => s.toLowerCase());
    }

    public connect() {
        // 修正 1：加上 /public/stream 完整路徑
        const streams = this.symbols.map(s => `${s}@ticker`).join('/');
        const wsUrl = `wss://dstream.binance.com/stream?streams=${streams}`;

        console.log(`🔌 正在啟動價格即時更新服務...`);
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            console.log(`✅ WebSocket 已連線，開始接收 ${this.symbols.length} 個幣種的即時報價`);
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const message = JSON.parse(data.toString());
                
                // 修正 2：確保 message.data 存在且格式正確
                if (message && message.data) {
                    const ticker = message.data;
                    const symbol = ticker.s; // 幣種大寫，例如 BTCUSDT
                    const price = parseFloat(ticker.c); // 最新成交價 (Ticker 才有 c)
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
            console.warn(`⚠️ WebSocket 斷線，5秒後自動重連...`);
            setTimeout(() => this.connect(), 5000);
        });

        this.ws.on('error', (err) => {
            console.error(`❌ WebSocket 錯誤:`, err);
        });
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