import { GoogleGenAI, Type } from '@google/genai';
import { USDMClient } from 'binance';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import SYMBOLS from './data/symbols.json' with { type: 'json' };
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
// 初始化 Google GenAI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;

const client = new USDMClient({
    api_key: apiKey as string,
    api_secret: apiSecret as string,
    testnet: true,
});

const BASE_URL = 'https://fapi.binance.com';

type SymbolType = typeof SYMBOLS[number];

// --- 型別定義 (Interfaces & Types) ---

interface SymbolFilter {
    tickSize: number;
    stepSize: number;
}

interface KlineData {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    buyQuoteVolume: number;
    sellQuoteVolume: number;
}

interface Position {
    symbol: string;
    positionAmt: number;
    entryPrice: number;
    markPrice: number;
    unrealizedProfit: number;
    leverage: number;
}

interface LimitOrder {
    orderId: number;
    side: string;
    type: string;
    price: number;
    origQty: number;
    executedQty: number;
}

interface AlgoOrder {
    algoId: number;
    side: string;
    type: string;
    triggerPrice: number;
}

interface OpenOrdersResult {
    limitOrders: LimitOrder[];
    algoOrders: AlgoOrder[];
}

interface AIDecision {
    action: 'NO_ACTION' | 'CANCEL_ORDERS' | 'CLOSE_POSITION' | 'UPDATE_SL_TP' | 'OPEN_NEW';
    side?: 'BUY' | 'SELL' | 'NONE';
    entryPrice?: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    reason: string;
}

// --- 輔助函式 ---

function getSymbolFilters(symbol: string): SymbolFilter {
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

function getExactDecimalPlaces(num: number): number {
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

function adjustToStep(value: number, step: number): number {
    const precision = getExactDecimalPlaces(step);
    const adjusted = Math.round(value / step) * step;
    return parseFloat(adjusted.toFixed(precision));
}

async function getKlines(symbol: string, interval: string = '1m', limit: number = 100): Promise<KlineData[]> {
    try {
        const res = await fetch(`${BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        const data: any = await res.json();
        if (res.status === 200 && Array.isArray(data) && res.ok) {
            return data.map((k: any) => {
                const totalQuoteVolume = parseFloat(k[7]);   // 總成交額 (USDT)
                const buyQuoteVolume = parseFloat(k[10]);   // 主動買入額 (USDT)
                const sellQuoteVolume = totalQuoteVolume - buyQuoteVolume; // 主動賣出額 (USDT)
                return {
                    time: k[0],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5]),           // 總成交量 (顆數)
                    buyQuoteVolume: buyQuoteVolume,      // 主動買入額 (USDT)
                    sellQuoteVolume: sellQuoteVolume     // 主動賣出額 (USDT)
                };
            });
        } else {
            return [];
        }
    } catch (err: any) {
        console.error(`❌ [${symbol}] 抓取 K 線失敗:`, err.message);
        return [];
    }
}

// 獲取當前合約持倉
async function getPositions(symbol: string): Promise<Position[]> {
    try {
        const positions: any = await client.getPositionsV3({ symbol });
        return positions
            .filter((p: any) => parseFloat(p.positionAmt) !== 0)
            .map((p: any) => ({
                symbol: p.symbol,
                positionAmt: parseFloat(p.positionAmt),
                entryPrice: parseFloat(p.entryPrice),
                markPrice: parseFloat(p.markPrice),
                unrealizedProfit: parseFloat(p.unRealizedProfit),
                leverage: parseInt(p.leverage, 10)
            }));
    } catch (err: any) {
        console.error(`獲取 [${symbol}] 倉位失敗:`, err.message);
        return [];
    }
}

// 獲取當前未成交掛單
async function getOpenOrders(symbol: string): Promise<OpenOrdersResult> {
    try {
        const openOrders: any = await client.getAllOpenOrders({ symbol });
        const openAlgoOrders: any = await client.getOpenAlgoOrders({ symbol }) || [];

        const limitOrders: LimitOrder[] = openOrders.map((o: any) => ({
            orderId: o.orderId,
            side: o.side,
            type: o.type,
            price: parseFloat(o.price),
            origQty: parseFloat(o.origQty),
            executedQty: parseFloat(o.executedQty)
        }));

        const rawAlgoList = openAlgoOrders.algoOrders || openAlgoOrders || [];
        const algoOrders: AlgoOrder[] = rawAlgoList.map((a: any) => ({
            algoId: a.algoId,
            side: a.side,
            type: a.algoType || a.type,
            triggerPrice: parseFloat(a.triggerPrice)
        }));

        return { limitOrders, algoOrders };
    } catch (err: any) {
        console.error(`獲取 [${symbol}] 掛單失敗:`, err.message);
        return { limitOrders: [], algoOrders: [] };
    }
}

async function analyzeAndManagePosition(
    symbol: string,
    klines4h: KlineData[],
    klines1h: KlineData[],
    klines1m: KlineData[],
    positions: Position[],
    openOrders: OpenOrdersResult
): Promise<AIDecision | null> {
    try {
        const prompt = `
你是一位專業的加密貨幣自動交易機器人。請根據 ${symbol} 的 4小時 K線（中期趨勢）、1小時 K線（中期進場點）、1分鐘 K線（短期進場點）、當前持倉狀態與當前掛單，做出現階段最合適的交易決策。

當前持倉數據：${JSON.stringify(positions)}
當前未成交掛單：${JSON.stringify(openOrders)}

角色與任務設定：
請擔任我的「冷酷紀律型加密貨幣交易助手」。你需要幫我分析 BTC（比特幣） 與 ETH（以太坊） 的 1小時線（1H）級別 關鍵位階。
心態與行為規範（極重要）：
心態絕對穩定：忽略所有盤中的隨機噪音與微小波動。絕不能因為一時的急漲或急跌就衝動建議進場（嚴格禁止 FOMO 與恐懼操作）。
嚴格右側確認 / 關鍵位等候：只在價格「明確到達關鍵區間」且出現「轉折確認訊號」時才考慮進場。

交易策略邏輯：
做空（Short）：必須等到價格來到1小時級別強阻力位（Resistance），且出現受阻回落、準備向下的訊號時才建議做空。
做多（Long）：必須等到價格來到1小時級別強支撐位（Support），且出現止跌止穩、準備反彈的訊號時才建議做多。
觀望（Wait）：只要價格處於中間震盪區、或尚未出現明確轉折訊號，一律給予「觀望，耐心等待位階」的指令。
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { text: prompt },
                { text: `4小時 K線數據：\n${JSON.stringify(klines4h)}` },
                { text: `1小時 K線數據：\n${JSON.stringify(klines1h)}` },
                { text: `1分鐘 K線數據：\n${JSON.stringify(klines1m)}` }
            ],
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        action: {
                            type: Type.STRING,
                            enum: ['NO_ACTION', 'CANCEL_ORDERS', 'CLOSE_POSITION', 'UPDATE_SL_TP', 'OPEN_NEW']
                        },
                        side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NONE'] },
                        entryPrice: { type: Type.NUMBER },
                        takeProfitPrice: { type: Type.NUMBER },
                        stopLossPrice: { type: Type.NUMBER },
                        reason: { type: Type.STRING }
                    },
                    required: ['action', 'reason']
                }
            }
        });

        if (!response.text) return null;
        const decision: AIDecision = JSON.parse(response.text);
        console.log(`[${symbol}] AI 決策結果 [${decision.action}]：${decision.reason}`);

        return decision;
    } catch (err: any) {
        console.error(`❌ [${symbol}] AI 分析與決策失敗:`, err.message);
        return null;
    }
}

async function cancelAllOrdersAndAlgo(symbol: string): Promise<void> {
    try {
        await client.cancelAllOpenOrders({ symbol });
        await client.cancelAllAlgoOpenOrders({ symbol });
        console.log(`[${symbol}] 已成功撤銷所有普通掛單與止盈止損條件單！`);
    } catch (err: any) {
        console.error(`❌ [${symbol}] 撤銷掛單/條件單失敗:`, err.message);
    }
}

async function executeDecision(symbol: string, decision: AIDecision | null, defaultQuantity: number): Promise<void> {
    if (!decision) return;

    const filters = getSymbolFilters(symbol);
    const positions = await getPositions(symbol);

    switch (decision.action) {
        case 'NO_ACTION':
            console.log(`[${symbol}] AI 建議保持現狀。`);
            break;

        case 'CANCEL_ORDERS':
            console.log(`[${symbol}] AI 建議取消所有掛單...`);
            await cancelAllOrdersAndAlgo(symbol);
            break;

        case 'CLOSE_POSITION':
            console.log(`[${symbol}] AI 建議提前市價平倉！`);
            await cancelAllOrdersAndAlgo(symbol);

            for (const pos of positions) {
                const amt = Math.abs(pos.positionAmt);
                if (amt > 0) {
                    const closeSide = pos.positionAmt > 0 ? 'SELL' : 'BUY';
                    await client.submitNewOrder({
                        symbol: symbol,
                        side: closeSide,
                        type: 'MARKET',
                        quantity: adjustToStep(amt, filters.stepSize),
                        reduceOnly: 'true'
                    });
                    console.log(`[${symbol}] 已執行市價平倉：${closeSide} ${amt}`);
                }
            }
            break;

        case 'UPDATE_SL_TP':
            console.log(`[${symbol}] AI 建議調整止盈/止損價位...`);
            await cancelAllOrdersAndAlgo(symbol);

            if (decision.stopLossPrice && decision.stopLossPrice > 0) {
                const currentPositions = await getPositions(symbol);
                const currentPos = currentPositions[0];
                if (currentPos) {
                    const isLong = currentPos.positionAmt > 0;
                    await client.submitNewAlgoOrder({
                        symbol: symbol,
                        side: isLong ? 'SELL' : 'BUY',
                        type: 'STOP_MARKET',
                        triggerPrice: adjustToStep(decision.stopLossPrice, filters.tickSize),
                        closePosition: 'true',
                        workingType: 'MARK_PRICE',
                        algoType: 'CONDITIONAL'
                    });
                }
            }

            if (decision.takeProfitPrice && decision.takeProfitPrice > 0) {
                const currentPositions = await getPositions(symbol);
                const currentPos = currentPositions[0];
                if (currentPos) {
                    const isLong = currentPos.positionAmt > 0;
                    await client.submitNewAlgoOrder({
                        symbol: symbol,
                        side: isLong ? 'SELL' : 'BUY',
                        type: 'TAKE_PROFIT_MARKET',
                        triggerPrice: adjustToStep(decision.takeProfitPrice, filters.tickSize),
                        closePosition: 'true',
                        workingType: 'MARK_PRICE',
                        algoType: 'CONDITIONAL'
                    });
                }
            }
            break;

        case 'OPEN_NEW':
            console.log(`[${symbol}] AI 發起新開倉建議：${decision.side} @ ${decision.entryPrice}`);
            await cancelAllOrdersAndAlgo(symbol);

            for (const pos of positions) {
                const amt = Math.abs(pos.positionAmt);
                if (amt > 0) {
                    const closeSide = pos.positionAmt > 0 ? 'SELL' : 'BUY';
                    await client.submitNewOrder({
                        symbol: symbol,
                        side: closeSide,
                        type: 'MARKET',
                        quantity: adjustToStep(amt, filters.stepSize),
                        reduceOnly: 'true'
                    });
                    console.log(`[${symbol}] 已執行市價平倉：${closeSide} ${amt}`);
                }
            }

            if (!decision.entryPrice) break;
            const isBuy = decision.side === 'BUY';
            const limitPrice = adjustToStep(decision.entryPrice, filters.tickSize);
            const finalQty = adjustToStep(defaultQuantity, filters.stepSize);

            await client.submitNewOrder({
                symbol: symbol,
                side: isBuy ? 'BUY' : 'SELL',
                type: 'LIMIT',
                price: limitPrice,
                quantity: finalQty,
                timeInForce: 'GTC'
            });

            if (decision.stopLossPrice && decision.stopLossPrice > 0) {
                await client.submitNewAlgoOrder({
                    symbol: symbol,
                    side: isBuy ? 'SELL' : 'BUY',
                    type: 'STOP_MARKET',
                    triggerPrice: adjustToStep(decision.stopLossPrice, filters.tickSize),
                    quantity: finalQty,
                    reduceOnly: 'true',
                    workingType: 'MARK_PRICE',
                    algoType: 'CONDITIONAL'
                });
            }

            if (decision.takeProfitPrice && decision.takeProfitPrice > 0) {
                await client.submitNewAlgoOrder({
                    symbol: symbol,
                    side: isBuy ? 'SELL' : 'BUY',
                    type: 'TAKE_PROFIT_MARKET',
                    triggerPrice: adjustToStep(decision.takeProfitPrice, filters.tickSize),
                    quantity: finalQty,
                    reduceOnly: 'true',
                    workingType: 'MARK_PRICE',
                    algoType: 'CONDITIONAL'
                });
            }
            break;
    }
}

async function runBotTask(symbol: string, quantity: number): Promise<void> {
    console.log(`\n=== 開始執行 [${symbol}] 策略監控 ===`);

    const [klines4h, klines1h, klines1m, positions, openOrders] = await Promise.all([
        getKlines(symbol, '4h', 60),
        getKlines(symbol, '1h', 50),
        getKlines(symbol, '1m', 50),
        getPositions(symbol),
        getOpenOrders(symbol)
    ]);

    const decision = await analyzeAndManagePosition(symbol, klines4h, klines1h, klines1m, positions, openOrders);

    await executeDecision(symbol, decision, quantity);
}

// 定期執行監控
setTimeout(() => {
    runBotTask('UNIUSDT', 1000);
    runBotTask('BATUSDT', 10000);
}, 10000);

setInterval(() => {
    runBotTask('UNIUSDT', 1000);
    runBotTask('BATUSDT', 10000);
}, 15 * 60 * 1000);