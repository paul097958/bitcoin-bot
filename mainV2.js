import { GoogleGenAI, Type } from '@google/genai';
import { USDMClient } from 'binance';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import { Bot, InlineKeyboardBuilder } from "node-telegram-bot-api";
import { run } from "node-telegram-bot-api/node"; // managed runner: wires Ctrl-C to bot.stop()
dotenv.config();
const bot = new Bot(process.env.BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;
const client = new USDMClient({
    api_key: apiKey,
    api_secret: apiSecret,
    // Connect to testnet environment
    testnet: true,
});
const BASE_URL = 'https://fapi.binance.com';

const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'SUIUSDT', 'LINKUSDT',
    'NEARUSDT', 'APTUSDT', 'FETUSDT', 'WIFUSDT',
    'ORDIUSDT', 'LDOUSDT', 'FILUSDT', 'LTCUSDT', 'BCHUSDT'
];
const currentSocketPrice = new Map();
const currentWatchPrices = new Map();
const isAnalyzing = new Map();         // 防刷鎖
function getSymbolFilters(symbol) {
    switch (symbol) {
        case 'BTCUSDT': return { tickSize: 0.1, stepSize: 0.001 };
        case 'ETHUSDT': return { tickSize: 0.01, stepSize: 0.001 };
        case 'SOLUSDT': return { tickSize: 0.01, stepSize: 0.01 };
        case 'BNBUSDT': return { tickSize: 0.01, stepSize: 0.01 };
        case 'XRPUSDT': return { tickSize: 0.0001, stepSize: 0.1 };
        case 'DOGEUSDT': return { tickSize: 0.00001, stepSize: 1 };
        case 'ADAUSDT': return { tickSize: 0.0001, stepSize: 1 };
        case 'AVAXUSDT': return { tickSize: 0.001, stepSize: 1 };
        case 'SUIUSDT': return { tickSize: 0.0001, stepSize: 0.1 };
        case 'LINKUSDT': return { tickSize: 0.001, stepSize: 0.01 };
        case 'NEARUSDT': return { tickSize: 0.001, stepSize: 1 };
        case 'APTUSDT': return { tickSize: 0.001, stepSize: 0.1 };
        case 'FETUSDT': return { tickSize: 0.0001, stepSize: 1 };
        case 'WIFUSDT': return { tickSize: 0.0001, stepSize: 1 };
        case 'ORDIUSDT': return { tickSize: 0.001, stepSize: 0.1 };
        case 'LDOUSDT': return { tickSize: 0.001, stepSize: 1 };
        case 'FILUSDT': return { tickSize: 0.001, stepSize: 0.1 };
        case 'LTCUSDT': return { tickSize: 0.01, stepSize: 0.001 };
        case 'BCHUSDT': return { tickSize: 0.01, stepSize: 0.001 };
        default:
            throw new Error(`未知的交易對: ${symbol}`);
    }
}


function onPriceUpdateFromWebSocket(symbol, currentPrice) {
    const watchData = currentWatchPrices.get(symbol);

    // 若未設定觀察價、觀察價為 0 或正在分析中，直接跳過
    if (!watchData || !watchData.targetPrice || watchData.targetPrice === 0 || isAnalyzing.get(symbol)) {
        return;
    }

    const targetPrice = watchData.targetPrice;
    const initialPrice = watchData.initialPrice; // 當時設定 AI 觀察價時的現價

    let isCrossed = false;

    // 向上突破：原先在觀察價下方，現在突破觀察價
    if (initialPrice < targetPrice && currentPrice >= targetPrice) {
        isCrossed = true;
    }
    // 向下滑落：原先在觀察價上方，現在跌破觀察價
    else if (initialPrice > targetPrice && currentPrice <= targetPrice) {
        isCrossed = true;
    }

    if (isCrossed) {
        console.log(`⚡ [${symbol}] 價格觸及/穿過 AI 觀察價！(現價: ${currentPrice} | 觀察價: ${targetPrice})`);

        // 上鎖：避免短時間重複呼叫 AI
        isAnalyzing.set(symbol, true);
        currentWatchPrices.set(symbol, { targetPrice: 0, initialPrice: 0 }); // 重置觀察價，等待下一次 AI 設定
        // 觸發重新分析 (呼叫您原本的分析工作流)
        runBotTask(symbol).finally(() => {
            // 建議設置 2~3 分鐘冷卻期，避免價格在目標價附近盤整時連續觸發
            setTimeout(() => {
                isAnalyzing.set(symbol, false);
            }, 3 * 60 * 1000);
        });
    }
}

function getExactDecimalPlaces(num) {
    const numStr = num.toString();
    if (numStr.includes('e') || numStr.includes('E')) {
        const [base, exponent] = numStr.toLowerCase().split('e');
        const exp = Math.abs(parseInt(exponent, 10));
        const baseDecimals = base.includes('.') ? base.split('.')[1].length : 0;
        return exp + baseDecimals;
    }
    return numStr.includes('.') ? numStr.split('.')[1].length : 0;
}

function adjustToStep(value, step) {
    const precision = getExactDecimalPlaces(step);
    // 先算倍數四捨五入，再用 toFixed 強制保留位數
    const adjusted = Math.round(value / step) * step;
    return adjusted.toFixed(precision);
}

async function getKlines(symbol, interval = '1m', limit = 100) {
    try {
        const res = await fetch(`${BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        const data = await res.json();
        if (res.status === 200 && Array.isArray(data) && res.ok) {
            return data.map(k => {
                const totalQuoteVolume = parseFloat(k[7]);   // 總成交額 (USDT)
                const buyQuoteVolume = parseFloat(k[10]);   // 主動買入額 (USDT)
                const sellQuoteVolume = totalQuoteVolume - buyQuoteVolume; // 主動賣出額 (USDT)
                return {
                    time: k[0],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5]),            // 總成交量 (顆數)
                    buyQuoteVolume: buyQuoteVolume,      // 主動買入額 (USDT)
                    sellQuoteVolume: sellQuoteVolume     // 主動賣出額 (USDT)
                };
            });
        } else {
            return [];
        }

    } catch (err) {
        console.error(`❌ [${symbol}] 抓取 K 線失敗:`, err.message);
        return null;
    }
}

// 獲取當前合約持倉
async function getPositions(symbol) {
    try {
        const positions = await client.getPositions({ symbol });
        // 篩選出持倉數量不為 0 的倉位
        return positions.filter(p => parseFloat(p.positionAmt) !== 0).map(p => ({
            symbol: p.symbol,
            positionAmt: parseFloat(p.positionAmt), // 正數為多單，負數為空單
            entryPrice: parseFloat(p.entryPrice),
            markPrice: parseFloat(p.markPrice),
            unrealizedProfit: parseFloat(p.unRealizedProfit),
            leverage: parseInt(p.leverage)
        }));
    } catch (err) {
        console.error(`獲取 [${symbol}] 倉位失敗:`, err.message);
        return [];
    }
}

// 獲取當前未成交掛單 (普通限價單 + 條件單/止盈止損單)
async function getOpenOrders(symbol) {
    try {
        const openOrders = await client.getAllOpenOrders({ symbol });
        // 若有使用 Algo Order (止盈止損條件單)，也一併抓取
        const openAlgoOrders = await client.getOpenAlgoOrders({ symbol }) || [];

        return {
            limitOrders: openOrders.map(o => ({
                orderId: o.orderId,
                side: o.side,
                type: o.type,
                price: parseFloat(o.price),
                origQty: parseFloat(o.origQty),
                executedQty: parseFloat(o.executedQty)
            })),
            algoOrders: (openAlgoOrders.algoOrders || openAlgoOrders || []).map(a => ({
                algoId: a.algoId,
                side: a.side,
                type: a.algoType || a.type,
                triggerPrice: parseFloat(a.triggerPrice)
            }))
        };
    } catch (err) {
        console.error(`獲取 [${symbol}] 掛單失敗:`, err.message);
        return { limitOrders: [], algoOrders: [] };
    }
}

async function analyzeAndManagePosition(symbol, klines4h, klines15m, positions, openOrders) {
    try {
        const currentPrice = currentSocketPrice.get(symbol)?.price || '未知';

        const prompt = `
你是一位專業的加密貨幣自動交易機器人。請根據 ${symbol} 的 4小時 K線（中期趨勢）、15分鐘 K線（短期進場點）、當前持倉狀態與當前掛單，做出現階段最合適的交易決策。

當前持倉數據：${JSON.stringify(positions)}
當前未成交掛單：${JSON.stringify(openOrders)}
目前即時行情價格：${currentPrice}

角色與任務設定：
請擔任我的「冷酷紀律型加密貨幣交易助手」。你需要幫我分析 BTC（比特幣） 與 ETH（以太坊） 的 1小時線（1H）級別 關鍵位階。
心態與行為規範（極重要）：
心態絕對穩定：忽略所有盤中的隨機噪音與微小波動。絕不能因為一時的急漲或急跌就衝動建議進場（嚴格禁止 FOMO 與恐懼操作）。
嚴格右側確認 / 關鍵位等候：只在價格「明確到達關鍵區間」且出現「轉折確認訊號」時才考慮進場。

交易策略邏輯：
做空（Short）：必須等到價格來到1小時級別強阻力位（Resistance），且出現受阻回落、準備向下的訊號時才建議做空。
做多（Long）：必須等到價格來到1小時級別強支撐位（Support），且出現止跌止穩、準備反彈的訊號時才建議做多。
觀望（Wait）：只要價格處於中間震盪區、或尚未出現明確轉折訊號，一律給予「觀望，耐心等待位階」的指令。

每次輸出的格式要求：
每次我提供即時價格時，請依照以下問題思考：

【當前行情判斷】：標示當前 1H 的趨勢與當前價格處於哪個區間。

【關鍵點位】：
1H 上方關鍵阻力區：[價格範圍]
1H 下方關鍵支撐區：[價格範圍]

【操作建議】（選擇：做多 / 做空 / 觀望）：
建議理由（簡述轉折或觀望原因）
建議進場點（觸發條件）
止損點（Stop Loss）
止盈點（Take Profit）

【動作選擇 (action)】：
- "NO_ACTION": 現有狀態良好，不需做任何調整。
- "CANCEL_ORDERS": 當前行情已變化，取消所有未成交的限價單或止盈止損單。
- "CLOSE_POSITION": 行情逆轉或達到提前止盈/止損條件，立刻市價平倉現有持倉並取消所有掛單。
- "UPDATE_SL_TP": 保留現有持倉，但更新/調整止盈 (takeProfitPrice) 與止損 (stopLossPrice) 價格。
- "OPEN_NEW": 行情出現明朗機會，發送新的限價單 (entryPrice) 並設定止盈 (takeProfitPrice) 與止損 (stopLossPrice)。

【回呼監測價 (watchTriggerPrice) 設定規則】：
請為系統提供一個關鍵觀察價格 (watchTriggerPrice)。當即時價格穿過此價位時，系統會立即回呼你重新評估行情：
- 若目前無持倉：請設定關鍵突破位或潛在買/賣點支撐位（離現價保持合理距離，避免頻繁觸發）。
- 若目前有持倉：請設定行情可能轉向的預警價或關鍵反轉點。
- 若無特殊觀察點，可回傳 0。
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { text: prompt },
                { text: `4小時 K線數據：\n${JSON.stringify(klines4h)}` },
                { text: `15分鐘 K線數據：\n${JSON.stringify(klines15m)}` }
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
                        watchTriggerPrice: {
                            type: Type.NUMBER,
                            description: '當行情達到此價格時，觸發程式重新喚醒 AI 進行分析的關鍵價位'
                        },
                        reason: { type: Type.STRING }
                    },
                    required: ['action', 'reason', 'watchTriggerPrice']
                }
            }
        });

        const decision = JSON.parse(response.text);
        console.log(`[${symbol}] AI 決策結果 [${decision.action}]：${decision.reason}`);
        console.log(`[${symbol}] 當前價：${currentPrice} | AI 設置回呼觀察價：${decision.watchTriggerPrice || '無'}`);

        return decision;

    } catch (err) {
        console.error(`❌ [${symbol}] AI 分析與決策失敗:`, err.message);
        return null;
    }
}

async function cancelAllOrdersAndAlgo(symbol) {
    try {
        // 1. 取消所有普通掛單 (LIMIT 單)
        await client.cancelAllOpenOrders({ symbol });
        // 2. 取消所有策略/條件單 (止盈止損單 STOP_MARKET / TAKE_PROFIT_MARKET)
        // 幣安 U本位合約條件單取消 Endpoint: DELETE /fapi/v1/algo/allOpenOrders

        await client.cancelAllAlgoOpenOrders({ symbol });

        console.log(`[${symbol}] 已成功撤銷所有普通掛單與止盈止損條件單！`);
    } catch (err) {
        console.error(`❌ [${symbol}] 撤銷掛單/條件單失敗:`, err.message);
    }
}

async function executeDecision(symbol, decision, defaultQuantity) {
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

            // 1. 率先清除所有普通單與止盈止損條件單
            await cancelAllOrdersAndAlgo(symbol);

            // 2. 執行市價全平
            
            for (const pos of positions) {
                const amt = Math.abs(pos.positionAmt);
                if (amt > 0) {
                    const closeSide = pos.positionAmt > 0 ? 'SELL' : 'BUY';
                    await client.submitNewOrder({
                        symbol: symbol,
                        side: closeSide,
                        type: 'MARKET',
                        quantity: adjustToStep(amt, filters.stepSize),
                        reduceOnly: 'true' // 確保只會平倉，不會額外開倉
                    });
                    console.log(`[${symbol}] 已執行市價平倉：${closeSide} ${amt}`);
                }
            }
            break;

        case 'UPDATE_SL_TP':
            console.log(`[${symbol}] AI 建議調整止盈/止損價位...`);
            await cancelAllOrdersAndAlgo(symbol);

            // 重新掛新的止損單
            if (decision.stopLossPrice > 0) {
                const positions = await getPositions(symbol);
                const currentPos = positions[0];
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
            // 重新掛新的止盈單
            if (decision.takeProfitPrice > 0) {
                const positions = await getPositions(symbol);
                const currentPos = positions[0];
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
            // 先清理舊掛單再掛新單
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
                        reduceOnly: 'true' // 確保只會平倉，不會額外開倉
                    });
                    console.log(`[${symbol}] 已執行市價平倉：${closeSide} ${amt}`);
                }
            }

            const isBuy = decision.side === 'BUY';
            const limitPrice = adjustToStep(decision.entryPrice, filters.tickSize);
            const finalQty = adjustToStep(defaultQuantity, filters.stepSize);

            // 1. 發送限價單
            await client.submitNewOrder({
                symbol: symbol,
                side: isBuy ? 'BUY' : 'SELL',
                type: 'LIMIT',
                price: limitPrice,
                quantity: finalQty,
                timeInForce: 'GTC'
            });

            // 2. 掛條件止損單
            if (decision.stopLossPrice > 0) {
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

            if(decision.takeProfitPrice > 0) {
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

async function runBotTask(symbol, quantity) {
    console.log(`\n=== 開始執行 [${symbol}] 策略監控 ===`);

    // 1. 平行抓取所有所需數據
    const [klines4h, klines15m, positions, openOrders] = await Promise.all([
        getKlines(symbol, '4h', 60),
        getKlines(symbol, '15m', 100),
        getPositions(symbol),
        getOpenOrders(symbol)
    ]);

    // 2. 傳給 Gemini 分析
    const decision = await analyzeAndManagePosition(symbol, klines4h, klines15m, positions, openOrders);

    // 3. 執行 Gemini 的指令
    await executeDecision(symbol, decision, quantity);
    currentWatchPrices.set(symbol, { targetPrice: decision.watchTriggerPrice, initialPrice: decision.entryPrice });
}

// 範例：定期執行監控
setTimeout(() => {
    runBotTask('BTCUSDT', 0.1);
    runBotTask('ETHUSDT', 4);
},  10000);
setInterval(() => {
    runBotTask('BTCUSDT', 0.1);
    runBotTask('ETHUSDT', 4);
}, 15 * 60 * 1000); // 每 15 分鐘運行一次
webSocket();

async function webSocket() {
    // 提示：若為合約交易，建議使用 fstream.binance.com，若為現貨則使用 stream.binance.com
    const url =  'wss://stream.binance.com:9443/stream?streams=' + SYMBOLS.map(symbol => symbol.toLowerCase() + '@aggTrade').join('/');
    const ws = new WebSocket(url);

    ws.on('open', () => {
        console.log('Successfully connected to Binance WebSocket!');
    });

    ws.on('message', (data) => {
        try {
            const parsedData = JSON.parse(data);
            const tradeData = parsedData.data;

            const symbol = tradeData.s;            // 例如 'BTCUSDT'
            const currentPrice = parseFloat(tradeData.p); // 當前最新成交價
            const tradeTime = tradeData.T;

            // 2. 更新最新價格 Map
            currentSocketPrice.set(symbol, { price: currentPrice, time: tradeTime });

            // 3. 觸發價格穿過檢查邏輯
            onPriceUpdateFromWebSocket(symbol, currentPrice);

        } catch (error) {
            console.error('Error parsing JSON:', error);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket Error:', error);
    });

    ws.on('close', (code, reason) => {
        console.log(`WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
        // 斷線自動重連機制
        setTimeout(() => webSocket(), 5000);
    });
}

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ 警告：捕捉到未處理的 Promise Rejection！');
    console.error('原因 (Reason):', reason);
});

