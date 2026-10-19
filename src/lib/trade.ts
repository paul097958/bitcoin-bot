import { USDMClient } from 'binance';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getOpenPositions } from './firestore.js';
import type { TradingSignal } from './analyze.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface SymbolFilter {
    tickSize: number;
    stepSize: number;
}

export class TradingBotManager {
    private client: USDMClient;
    private monitorInterval: NodeJS.Timeout | null = null;

    constructor() {
        const apiKey = process.env.ENVIRONMENT === 'production' ? process.env.API_KEY : process.env.TEST_API_KEY;
        const apiSecret = process.env.ENVIRONMENT === 'production' ? process.env.API_SECRET : process.env.TEST_API_SECRET;
        
        this.client = new USDMClient({
            api_key: apiKey as string,
            api_secret: apiSecret as string,
            testnet: process.env.ENVIRONMENT === 'production' ? false : true
        });

        // 需求：建構之後就要啟動 startActivePositionsMonitor
        this.startActivePositionsMonitor();
    }

    private getSymbolFilters(symbol: string): SymbolFilter {
        switch (symbol) {
            case 'BTCUSDT': return { tickSize: 0.1, stepSize: 0.001 };
            case 'ETHUSDT': return { tickSize: 0.01, stepSize: 0.001 };
            case 'SOLUSDT': return { tickSize: 0.01, stepSize: 0.01 };
            case 'BNBUSDT': return { tickSize: 0.01, stepSize: 0.01 };
            case 'XRPUSDT': return { tickSize: 0.0001, stepSize: 0.1 };
            case 'DOGEUSDT': return { tickSize: 0.00001, stepSize: 1 };
            case 'TAOUSDT': return { tickSize: 0.001, stepSize: 0.01 };
            case 'ZECUSDT': return { tickSize: 0.001, stepSize: 0.01 };
            case 'UNIUSDT': return { tickSize: 0.001, stepSize: 1 };
            default:
                throw new Error(`未知的交易對: ${symbol}`);
        }
    }

    private getExactDecimalPlaces(num: number): number {
        const numStr = num.toString();
        if (numStr.includes('e') || numStr.includes('E')) {
            const parts = numStr.toLowerCase().split('e');
            const base = parts[0];
            const exponent = parts[1];

            if (!exponent || !base) {
                throw new Error(`無法解析科學記號: ${numStr}`);
            }

            const exp = Math.abs(parseInt(exponent, 10));
            const baseDecimals = base.includes('.') ? base.split('.')[1]!.length : 0;
            return exp + baseDecimals;
        }
        return numStr.includes('.') ? numStr.split('.')[1]!.length : 0;
    }

    private adjustToStep(value: number, step: number): number {
        const precision = this.getExactDecimalPlaces(step);
        const adjusted = Math.round(value / step) * step;
        return parseFloat(adjusted.toFixed(precision));
    }

    public async getAllOpenOrders() {
        try {
            const response = await this.client.getAllOpenOrders();
            return response;
        } catch (error: any) {
            console.error('❌ 取得全市場未成交掛單失敗：', error.message || error);
            return [];
        }
    }

    public async getCurrentPositions(symbol?: string) {
        try {
            const response: any = await this.client.getPositionsV3(
                symbol === undefined ? {} : { symbol }
            );

            if (Array.isArray(response)) {
                const activePositions = response.filter((pos: any) => {
                    const amt = parseFloat(pos.positionAmt || pos.notional || '0');
                    return amt !== 0;
                });
                return activePositions;
            }

            return response;
        } catch (error: any) {
            console.error(`❌ 取得目前持倉失敗：`, error.message || error);
            return [];
        }
    }

    public async checkSymbolActiveSLTP(symbol: string) {
        try {
            const openOrders: any = await this.client.getAllAlgoOrders({ symbol });

            if (!Array.isArray(openOrders)) return { hasSL: false, hasTP: false, orders: [] };

            const sltpOrders = openOrders.filter((order: any) => {
                const isNew = order.algoStatus === 'NEW';
                const orderType = order.orderType;
                
                const isSlTpType = (
                    orderType === 'STOP' || 
                    orderType === 'STOP_MARKET' || 
                    orderType === 'TAKE_PROFIT' || 
                    orderType === 'TAKE_PROFIT_MARKET'
                );

                return isNew && isSlTpType;
            });

            const hasSL = sltpOrders.some((o: any) => o.orderType.includes('STOP'));
            const hasTP = sltpOrders.some((o: any) => o.orderType.includes('TAKE_PROFIT'));

            console.log(`📊 [${symbol}] 現有風控單狀態：`, { hasSL, hasTP, count: sltpOrders.length });

            return {
                hasSL,
                hasTP,
                orders: sltpOrders
            };
        } catch (error: any) {
            console.error(`❌ 查詢 ${symbol} 的止盈止損單失敗：`, error.message || error);
            return { hasSL: false, hasTP: false, orders: [] };
        }
    }

    private async auditAllPositionsSLTP() {
        console.log('🔍 [定期風控稽核] 開始檢查所有持倉的止盈止損狀態...');
        
        try {
            const binancePositions: any = await this.getCurrentPositions();
            
            if (!Array.isArray(binancePositions) || binancePositions.length === 0) {
                console.log('✅ [定期風控稽核] 目前沒有任何幣安持倉，跳過檢查。');
                return;
            }

            const dbOpenPositions = await getOpenPositions();

            console.log(`📊 [定期風控稽核] 發現幣安有 ${binancePositions.length} 個持倉，Firestore 有 ${dbOpenPositions.length} 筆紀錄。`);

            for (const pos of binancePositions) {
                const symbol = pos.symbol;
                const positionAmt = parseFloat(pos.positionAmt);
                const isLong = positionAmt > 0;
                const absQty = Math.abs(positionAmt).toString();
                const side = isLong ? 'LONG (多單)' : 'SHORT (空單)';

                console.log(`--------------------------------------------------`);
                console.log(`📌 檢查幣種: ${symbol} | 方向: ${side} | 數量: ${absQty}`);

                const sltpStatus = await this.checkSymbolActiveSLTP(symbol);
                const matchingDbRecord = dbOpenPositions.find(p => p.data.symbol === symbol && p.data.status === 'OPEN');

                if (!matchingDbRecord) {
                    console.warn(`⚠️ [警告] 幣安有 ${symbol} 持倉，但在 Firestore 中找不到對應的 OPEN 紀錄，無法自動補單！`);
                    continue;
                }

                const { stopLossPrice, takeProfitPrices } = matchingDbRecord.data;
                const filters = this.getSymbolFilters(symbol);

                // --- 檢查與補掛 止損 (SL) ---
                if (sltpStatus.hasSL) {
                    console.log(`   ✅ 止損 (SL): 交易所已掛單`);
                } else {
                    console.warn(`   🚨 ${symbol} 缺少止損單，正在從 Firestore 讀取 (SL: ${stopLossPrice}) 自動補掛...`);
                    if (stopLossPrice && stopLossPrice > 0) {
                        try {
                            await this.client.submitNewAlgoOrder({
                                symbol: symbol,
                                side: isLong ? 'SELL' : 'BUY',
                                type: 'STOP_MARKET',
                                triggerPrice: this.adjustToStep(stopLossPrice, filters.tickSize),
                                quantity: absQty,
                                reduceOnly: 'true',
                                workingType: 'MARK_PRICE',
                                algoType: 'CONDITIONAL'
                            });
                            console.log(`   ✅ [自動補單成功] ${symbol} 止損單已掛上，觸發價: ${stopLossPrice}`);
                        } catch (err: any) {
                            console.error(`   ❌ [自動補單失敗] ${symbol} 補掛止損單失敗:`, err.message);
                        }
                    }
                }

                // --- 檢查與補掛 止盈 (TP) ---
                if (sltpStatus.hasTP) {
                    console.log(`   ✅ 止盈 (TP): 交易所已掛單`);
                } else {
                    const targetTp = takeProfitPrices?.tp1;
                    console.warn(`   🚨 ${symbol} 缺少止盈單，正在從 Firestore 讀取 (TP1: ${targetTp}) 自動補掛...`);
                    if (targetTp && targetTp > 0) {
                        try {
                            await this.client.submitNewAlgoOrder({
                                symbol: symbol,
                                side: isLong ? 'SELL' : 'BUY',
                                type: 'TAKE_PROFIT_MARKET',
                                triggerPrice: this.adjustToStep(targetTp, filters.tickSize),
                                quantity: absQty,
                                reduceOnly: 'true',
                                workingType: 'MARK_PRICE',
                                algoType: 'CONDITIONAL'
                            });
                            console.log(`   ✅ [自動補單成功] ${symbol} 止盈單 (TP1) 已掛上，觸發價: ${targetTp}`);
                        } catch (err: any) {
                            console.error(`   ❌ [自動補單失敗] ${symbol} 補掛止盈單失敗:`, err.message);
                        }
                    }
                }
            }
            console.log(`--------------------------------------------------`);
            console.log('✨ [定期風控稽核與自動補單] 本次執行完成。');

        } catch (error: any) {
            console.error('❌ [定期風控稽核] 執行稽核時發生錯誤：', error.message || error);
        }
    }

    public startActivePositionsMonitor() {
        const INTERVAL_TIME = 5 * 60 * 1000; // 5 分鐘 (毫秒)

        console.log('🚀 [風控監控服務] 已成功啟動，將每 5 分鐘自動稽核所有持倉的 SL/TP 狀態。');

        // 啟動時先立即執行一次
        this.auditAllPositionsSLTP();

        // 設定定時器，每 5 分鐘執行一次
        this.monitorInterval = setInterval(() => {
            this.auditAllPositionsSLTP();
        }, INTERVAL_TIME);
    }

    public stopPositionsMonitor(){
        if(!this.monitorInterval) return;
        clearInterval(this.monitorInterval);
    }

    public startOpenOrdersTimeoutMonitor(onOrderTimeout: (symbol: string, entryPrice: number, side: 'BUY' | 'SELL') => void) {
        const INTERVAL_TIME = 10 * 60 * 1000; // 每 10 分鐘執行一次檢查
        const TIMEOUT_LIMIT = 20 * 60 * 1000;  // 20 分鐘的毫秒數

        console.log('⏳ [訂單逾時監控] 已啟動，將每 10 分鐘檢查是否有掛單超過 20 分鐘未成交。');

        setInterval(async () => {
            try {
                const openOrders: any = await this.getAllOpenOrders();
                if (!Array.isArray(openOrders) || openOrders.length === 0) return;

                const now = Date.now();

                for (const order of openOrders) {
                    const createTime = order.time || order.createTime || 0;
                    const elapsed = now - createTime;

                    // 如果超過 20 分鐘
                    if (createTime > 0 && elapsed > TIMEOUT_LIMIT) {
                        const elapsedMins = Math.floor(elapsed / (1000 * 60));
                        const symbol = order.symbol;
                        const entryPrice = parseFloat(order.price || order.stopPrice || '0');
                        const side = order.side; // 'BUY' 或 'SELL'

                        console.warn(`⚠️ [訂單逾時] 訂單 ID: ${order.orderId} (${symbol} - ${side} @ ${entryPrice}) 已掛單 ${elapsedMins} 分鐘未成交！`);
                        
                        // 觸發傳入的 callback 並回傳 symbol, entryPrice, side
                        if (typeof onOrderTimeout === 'function') {
                            onOrderTimeout(symbol, entryPrice, side);
                        }
                    }
                }
            } catch (error: any) {
                console.error('❌ [訂單逾時監控] 檢查未成交訂單時發生錯誤：', error.message || error);
            }
        }, INTERVAL_TIME);
    }

    public async cancelAllOrdersAndAlgo(symbol: string): Promise<void> {
        try {
            await this.client.cancelAllOpenOrders({ symbol });
            await this.client.cancelAllAlgoOpenOrders({ symbol });
            console.log(`[${symbol}] 已成功撤銷所有普通掛單與止盈止損條件單！`);
        } catch (err: any) {
            console.error(`❌ [${symbol}] 撤銷掛單/條件單失敗:`, err.message);
        }
    }

    public async executeDecision(symbol: string, decision: TradingSignal | null, defaultQuantity: number): Promise<void> {
        if (!decision) return;

        try {
            await this.client.setLeverage({
                symbol,
                leverage: 20
            })
            const filters = this.getSymbolFilters(symbol);
            const positions = await this.getCurrentPositions(symbol);

            switch (decision.action) {
                case 'NO_ACTION':
                    console.log(`[${symbol}] AI 建議保持現狀。`);
                    break;

                case 'CLOSE_POSITION':
                    console.log(`[${symbol}] AI 建議提前市價平倉！`);
                    await this.cancelAllOrdersAndAlgo(symbol);

                    for (const pos of positions) {
                        const amt = Math.abs(parseFloat(pos.positionAmt));
                        if (amt > 0) {
                            const closeSide = parseFloat(pos.positionAmt) > 0 ? 'SELL' : 'BUY';
                            await this.client.submitNewOrder({
                                symbol: symbol,
                                side: closeSide,
                                type: 'MARKET',
                                quantity: this.adjustToStep(amt, filters.stepSize),
                                reduceOnly: 'true'
                            });
                            console.log(`[${symbol}] 已執行市價平倉：${closeSide} ${amt}`);
                        }
                    }
                    break;

                case 'UPDATE_SL_TP':
                    console.log(`[${symbol}] AI 建議調整止盈/止損價位...`);
                    await this.cancelAllOrdersAndAlgo(symbol);

                    if (decision.stopLossPrice && decision.stopLossPrice > 0) {
                        const currentPositions = await this.getCurrentPositions(symbol);
                        const currentPos = currentPositions[0];
                        if (currentPos) {
                            const isLong = parseFloat(currentPos.positionAmt) > 0;
                            await this.client.submitNewAlgoOrder({
                                symbol: symbol,
                                side: isLong ? 'SELL' : 'BUY',
                                type: 'STOP_MARKET',
                                triggerPrice: this.adjustToStep(decision.stopLossPrice, filters.tickSize),
                                closePosition: 'true',
                                workingType: 'MARK_PRICE',
                                algoType: 'CONDITIONAL'
                            });
                            console.log(`[${symbol}] 已更新止損單 (SL): ${decision.stopLossPrice}`);
                        }
                    }

                    if (decision.takeProfitPrices && decision.takeProfitPrices.tp1 > 0) {
                        const currentPositions = await this.getCurrentPositions(symbol);
                        const currentPos = currentPositions[0];
                        if (currentPos) {
                            const isLong = parseFloat(currentPos.positionAmt) > 0;
                            await this.client.submitNewAlgoOrder({
                                symbol: symbol,
                                side: isLong ? 'SELL' : 'BUY',
                                type: 'TAKE_PROFIT_MARKET',
                                triggerPrice: this.adjustToStep(decision.takeProfitPrices.tp1, filters.tickSize),
                                closePosition: 'true',
                                workingType: 'MARK_PRICE',
                                algoType: 'CONDITIONAL'
                            });
                            console.log(`[${symbol}] 已更新止盈單 (TP1): ${decision.takeProfitPrices.tp1}`);
                        }
                    }
                    break;

                case 'OPEN_NEW':
                    console.log(`[${symbol}] AI 發起新開倉建議：${decision.side} @ ${decision.entryPrice}`);
                    await this.cancelAllOrdersAndAlgo(symbol);

                    for (const pos of positions) {
                        const amt = Math.abs(parseFloat(pos.positionAmt));
                        if (amt > 0) {
                            const closeSide = parseFloat(pos.positionAmt) > 0 ? 'SELL' : 'BUY';
                            await this.client.submitNewOrder({
                                symbol: symbol,
                                side: closeSide,
                                type: 'MARKET',
                                quantity: this.adjustToStep(amt, filters.stepSize),
                                reduceOnly: 'true'
                            });
                            console.log(`[${symbol}] 已執行市價平倉：${closeSide} ${amt}`);
                        }
                    }

                    if (!decision.entryPrice) break;
                    const isBuy = decision.side === 'BUY';
                    const limitPrice = this.adjustToStep(decision.entryPrice, filters.tickSize);
                    const finalQty = this.adjustToStep(defaultQuantity, filters.stepSize);

                    await this.client.submitNewOrder({
                        symbol: symbol,
                        side: isBuy ? 'BUY' : 'SELL',
                        type: 'LIMIT',
                        price: limitPrice,
                        quantity: finalQty,
                        timeInForce: 'GTC'
                    });
                    console.log(`[${symbol}] 已送出新開倉限價單：${decision.side} 價格 ${limitPrice} 數量 ${finalQty}`);
                    break;
            }
        } catch (error: any) {
            console.error(`❌ [${symbol}] 執行 AI 決策動作 (${decision.action}) 時發生錯誤：`, error.message || error);
        }
    }
}