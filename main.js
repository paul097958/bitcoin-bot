const axios = require('axios');
require('dotenv').config()
const fs = require('fs');
const format = require('@fast-csv/format');
const WebSocket = require('ws');
const { USDMClient } = require('binance');


// 填入你的 API Key 與 Secret
const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;

const client = new USDMClient({
    api_key: apiKey,
    api_secret: apiSecret,
    // Connect to testnet environment
    testnet: true,
});

// 監聽的 20 個標的 (幣安合約 symbol 格式為大寫)
const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'SUIUSDT', 'LINKUSDT',
    'NEARUSDT', 'APTUSDT', 'FETUSDT', 'WIFUSDT',
    'ORDIUSDT', 'LDOUSDT', 'FILUSDT', 'LTCUSDT', 'BCHUSDT'
];

// 幣安 USDT 永續合約 REST API Endpoint (若改現貨則用 https://api.binance.com)
const BASE_URL = 'https://fapi.binance.com';

// 紀錄進行中的第三關任務
let activeMonitors = [];
let countPercent = [];
const currentSocketPrice = new Map(); // 用於存儲每個標的的最新價格
/**
 * 取得指定幣種近 N 根 1m K 線
 * 幣安 K 線陣列格式:
 * [ OpenTime, Open, High, Low, Close, Volume, CloseTime, QuoteVolume, TradesCount, ... ]
 */

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

// 1. 精準計算小數位數（支援 1e-7 等科學記號）
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

// 2. 將價格或數量「強制對齊」到 step/tickSize 的整數倍
function adjustToStep(value, step) {
    const precision = getExactDecimalPlaces(step);
    // 先算倍數四捨五入，再用 toFixed 強制保留位數
    const adjusted = Math.round(value / step) * step;
    return adjusted.toFixed(precision);
}

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

async function getActualPosition(symbol) {
    const positions = await client.getPositions({
        symbol: symbol
    });

    const position = positions.find(
        p => p.symbol === symbol
    );

    if (!position) {
        return {
            amount: 0,
            quantity: 0,
            side: null,
            position: null
        };
    }

    const amount = parseFloat(
        position.positionAmt || 0
    );

    return {
        amount: amount,
        quantity: Math.abs(amount),
        side: amount > 0
            ? 'SELL'   // 多單 → SELL 平倉
            : amount < 0
                ? 'BUY' // 空單 → BUY 平倉
                : null,
        position: position
    };
}


async function runTrading(symbol, price, quantity, direction) {
    try {
        const filters = getSymbolFilters(symbol);
        const isUp = direction === 'UP';

        // 精準對齊價格與數量
        const rawLimitPrice = price * (isUp ? 1.0002 : 0.9998);
        const rawTriggerPrice = price * (isUp ? 0.995 : 1.005);

        const limitPrice = adjustToStep(rawLimitPrice, filters.tickSize);
        const triggerPrice = adjustToStep(rawTriggerPrice, filters.tickSize);
        const finalQuantity = adjustToStep(quantity, filters.stepSize);

        await client.setLeverage({
            symbol: symbol,
            leverage: 10
        })
        // 1. 發送限價開倉單
        const buyOrder = await client.submitNewOrder({
            symbol: symbol,
            side: isUp ? 'BUY' : 'SELL',
            type: 'LIMIT',
            price: limitPrice,
            quantity: finalQuantity,
            timeInForce: 'GTC',
        });
        console.log(`[${symbol}] 開倉單發送成功：`, buyOrder);

        // 1 分鐘未成交自動撤單
        setTimeout(async () => {
            try {
                const currentOrder = await client.getOrder({ symbol, orderId: buyOrder.orderId });
                if (currentOrder.status === 'NEW' || currentOrder.status === 'PARTIALLY_FILLED') {
                    console.log(`[${symbol}] 1 分鐘未完全成交，準備撤單...`);
                    await client.cancelOrder({ symbol, orderId: buyOrder.orderId });
                }
            } catch (cancelErr) {
                console.error(`[${symbol}] 檢查或撤單失敗：`, cancelErr.message);
            }
        }, 60 * 1000);
        const stopLossOrderCondition = await getActualPosition(symbol)

        // 2. 掛條件止損單 (改用 quantity + reduceOnly 避免 GTE 無持倉報錯)
        const stopLossOrder = await client.submitNewAlgoOrder({
            symbol: symbol,
            side: isUp ? 'SELL' : 'BUY',
            type: 'STOP_MARKET',
            triggerPrice: triggerPrice,
            quantity: finalQuantity,     // ✅ 明確傳入數量
            reduceOnly: 'true',          // ✅ 用 reduceOnly 防呆，不會觸發強制 GTE
            timeInForce: 'GTC',          // ✅ 強制允許無持倉時先掛單
            workingType: 'MARK_PRICE',
            algoType: 'CONDITIONAL'
        });
        console.log(`[${symbol}] 止損單掛單成功：`, stopLossOrder);
        return limitPrice;

    } catch (err) {
        console.error(`[${symbol}] 交易執行失敗：`, err);
        return null;
    }
}

async function immediateStopLoss(symbol, direction) {
    try {
        const stopLossCondition= await getActualPosition(symbol)

        const result = await client.submitNewOrder({
            symbol: symbol,
            side: direction === 'UP' ? 'SELL' : 'BUY',
            type: 'MARKET',
            quantity: stopLossCondition.quantity,
            reduceOnly: 'true',
        });

        console.log(`[${symbol}] 已執行市價平倉：`, result);
        return result;
    } catch (err) {
        console.error(`[${symbol}] 市價平倉失敗：`, err.message);
    }
}

// 限價平倉/止盈 (逾時未成交自動轉市價)
async function limitClose(
    symbol,
    targetPrice,
    quantity,
    direction,
    isStopLoss = false,
    basePrice,
    index
) {
    try {
        const filters = getSymbolFilters(symbol);

        const isUp = direction === 'UP';
        const isChanged = isStopLoss ? !isUp : isUp;

        // =========================================================
        // 1. 取得目前實際持倉
        // =========================================================
        const positions = await client.getPositions({
            symbol: symbol
        });

        const position = positions.find(p => p.symbol === symbol);

        if (!position) {
            console.log(`[${symbol}] 找不到持倉資料，取消平倉`);
            return null;
        }

        const positionAmt = parseFloat(position.positionAmt || 0);

        // 已經沒有持倉
        if (positionAmt === 0) {
            console.log(`[${symbol}] 目前沒有持倉，不需要平倉`);
            return null;
        }

        // =========================================================
        // 2. 根據實際 positionAmt 決定平倉方向
        //
        // positionAmt > 0 = 多單 → SELL
        // positionAmt < 0 = 空單 → BUY
        // =========================================================
        const side = positionAmt > 0 ? 'SELL' : 'BUY';

        const actualPositionQty = Math.abs(positionAmt);


        const finalQty = adjustToStep(
            actualPositionQty,
            filters.stepSize
        );

        if (finalQty <= 0) {
            console.log(
                `[${symbol}] 平倉數量不足，` +
                `要求=${quantity}，實際持倉=${actualPositionQty}`
            );
            return null;
        }

        // =========================================================
        // 3. 計算限價
        // =========================================================
        const rawTargetPrice =
            targetPrice * (isChanged ? 1.0002 : 0.9998);

        const finalPrice = adjustToStep(
            rawTargetPrice,
            filters.tickSize
        );

        console.log(
            `[${symbol}] 準備限價平倉 | ` +
            `side=${side} | ` +
            `position=${actualPositionQty} | ` +
            `request=${quantity} | ` +
            `close=${finalQty} | ` +
            `price=${finalPrice}`
        );

        // =========================================================
        // 4. 取消這個 symbol 的其他掛單
        // =========================================================
        await client.cancelAllOpenOrders({
            symbol: symbol
        });

        // =========================================================
        // 5. 再次確認持倉
        //
        // cancelAllOpenOrders 後重新取得一次，
        // 避免取消訂單的過程中持倉發生變化。
        // =========================================================
        const positionsBeforeOrder = await client.getPositions({
            symbol: symbol
        });

        const positionBeforeOrder =
            positionsBeforeOrder.find(p => p.symbol === symbol);

        const positionAmtBeforeOrder =
            parseFloat(positionBeforeOrder?.positionAmt || 0);

        if (positionAmtBeforeOrder === 0) {
            console.log(
                `[${symbol}] 下單前持倉已變成 0，不需要平倉`
            );
            return null;
        }

        const latestPositionQty =
            Math.abs(positionAmtBeforeOrder);

        const latestCloseQty = Math.min(
            finalQty,
            latestPositionQty
        );

        const finalOrderQty = adjustToStep(
            latestCloseQty,
            filters.stepSize
        );

        if (finalOrderQty <= 0) {
            console.log(`[${symbol}] 最終平倉數量為 0`);
            return null;
        }

        // 根據最新持倉重新確認 side
        const finalSide =
            positionAmtBeforeOrder > 0 ? 'SELL' : 'BUY';

        // =========================================================
        // 6. 發送 LIMIT reduceOnly
        // =========================================================
        const result = await client.submitNewOrder({
            symbol: symbol,
            side: finalSide,
            type: 'LIMIT',
            price: finalPrice,
            quantity: finalOrderQty,
            timeInForce: 'GTC',
            reduceOnly: 'true',
        });

        console.log(
            `[${symbol}] 限價平倉單已掛出，` +
            `單號=${result.orderId}，` +
            `方向=${finalSide}，` +
            `數量=${finalOrderQty}，` +
            `價格=${finalPrice}`
        );

        // =========================================================
        // 7. 30 秒後檢查訂單
        // =========================================================
        setTimeout(async () => {
            try {
                const currentOrder = await client.getOrder({
                    symbol: symbol,
                    orderId: result.orderId,
                });

                console.log(
                    `[${symbol}] 30 秒檢查，` +
                    `訂單狀態=${currentOrder.status}`
                );

                // =====================================================
                // 訂單尚未完全成交
                // =====================================================
                if (
                    currentOrder.status === 'NEW' ||
                    currentOrder.status === 'PARTIALLY_FILLED'
                ) {
                    console.log(
                        `[${symbol}] 限價單未完全成交，準備撤單`
                    );

                    // -------------------------------------------------
                    // 1. 撤銷 LIMIT
                    // -------------------------------------------------
                    try {
                        await client.cancelOrder({
                            symbol: symbol,
                            orderId: result.orderId,
                        });
                    } catch (cancelError) {
                        console.error(
                            `[${symbol}] 撤銷限價單失敗：`,
                            cancelError.message
                        );
                    }

                    // -------------------------------------------------
                    // 2. 重新取得「目前實際持倉」
                    //
                    // ★ 不再使用：
                    // quantity - executedQty
                    //
                    // 而是直接看 Binance 現在還剩多少。
                    // -------------------------------------------------
                    const latestPositions =
                        await client.getPositions({
                            symbol: symbol
                        });

                    const latestPosition =
                        latestPositions.find(
                            p => p.symbol === symbol
                        );

                    const latestPositionAmt =
                        parseFloat(
                            latestPosition?.positionAmt || 0
                        );

                    const remainingQty =
                        Math.abs(latestPositionAmt);

                    // -------------------------------------------------
                    // 3. 已經沒有持倉
                    // -------------------------------------------------
                    if (remainingQty <= 0) {
                        console.log(
                            `[${symbol}] 限價單成交後已無持倉，不需要市價平倉`
                        );
                    } else {
                        // -------------------------------------------------
                        // 4. 對齊 stepSize
                        // -------------------------------------------------
                        const marketQty = adjustToStep(
                            remainingQty,
                            filters.stepSize
                        );

                        if (marketQty > 0) {
                            console.log(
                                `[${symbol}] 剩餘實際持倉 ` +
                                `${remainingQty}，` +
                                `補發市價平倉 ${marketQty}`
                            );

                            await immediateStopLoss(
                                symbol,
                                direction
                            );
                        } else {
                            console.log(
                                `[${symbol}] 剩餘持倉小於最小 stepSize`
                            );
                        }
                    }
                } else {
                    console.log(
                        `[${symbol}] 30 秒到期，` +
                        `訂單狀態=${currentOrder.status}，無需處理`
                    );
                }

                // =====================================================
                // 5. 移除監控
                // =====================================================
                if (
                    index >= 0 &&
                    index < activeMonitors.length
                ) {
                    activeMonitors.splice(index, 1);
                }

                // =====================================================
                // 6. 計算報酬
                // =====================================================
                countPercent.push([
                    symbol,
                    direction,
                    (isUp ? 1 : -1) *
                    (finalPrice - basePrice) /
                    basePrice *
                    100,
                    basePrice,
                    finalPrice,
                    Date.now()
                ]);

            } catch (monitorErr) {
                console.error(
                    `[${symbol}] 檢查或撤單時發生錯誤：`,
                    monitorErr.message
                );
            }
        }, 30 * 1000);

        return finalPrice;

    } catch (err) {
        console.error(
            `[${symbol}] 限價平倉失敗：`,
            err.message
        );
        return null;
    }
}

// ===== 關卡判斷邏輯 =====

async function checkSymbolStrategy(symbol) {
    // 抓取最新的 4 根 1m K 線 (index 0: T-3, 1: T-2, 2: T-1, 3: 當前未完結 K 線)
    const klines = await getKlines(symbol);
    if (!klines || klines.length < 100) return;

    const first98 = klines.slice(0, 98);

    // 2. 計算平均值（若陣列長度不足 98 項，會自動以實際長度計算）
    // const average = first98.length > 0
    //     ? first98.reduce((sum, item) => sum + item.volume, 0) / first98.length
    //     : 0;
    // 1. 先複製一份陣列並針對 volume 進行升冪排序 (避免修改到原始 first98 陣列)
    const sorted = first98.map(item => item.volume).sort((a, b) => a - b);

    // 2. 計算中位數
    const len = sorted.length;
    const average = len > 0
        ? (len % 2 === 1
            ? sorted[Math.floor(len / 2)] // 奇數個：直接取正中間那一項
            : (sorted[len / 2 - 1] + sorted[len / 2]) / 2) // 偶數個：取中間兩項的平均值
        : 0;
    const lastTwoMinute = klines[97];
    const lastMinute = klines[98];
    const currentMinute = klines[99];
    // 🎯 第一關：1分鐘內成交量翻倍 (k1 >= k0 * 2) 且 第 2 分鐘成交量高於第 1 分鐘 (k2 > k1)
    const isStage1Passed = (currentMinute.volume >= lastMinute.volume * 2.5) && (lastMinute.volume > lastTwoMinute.volume);

    // 測驗漲跌幅大增
    const startPrice = lastTwoMinute.open;
    const endPrice = currentMinute.close;
    const changePercent = ((endPrice - startPrice) / startPrice) * 100;
    const isPriceChangeSignificant = Math.abs(changePercent) >= 0.5;

    // 🎯 追加條件：前十分鐘內漲幅不超過 0.5%

    // 取前 10 分鐘起點的價格 (以第 90 根 K 線 klines[90] 為基準)

    const tenMinutesAgoKline = klines[90];
    const basePrice = tenMinutesAgoKline.close; // 10 分鐘前收盤價

    // 寫法 A (建議)：計算這 10 分鐘內「最高價」相較於起點的最高漲幅
    const last10Klines = klines.slice(90, 100);
    const maxHighIn10m = Math.max(...last10Klines.map(k => k.high));
    const maxGainRatioIn10m = (maxHighIn10m - basePrice) / basePrice;

    // 寫法 B：單純看當前價格相較於 10 分鐘前起點的漲幅
    // const currentGainRatio = (currentMinute.close - basePrice) / basePrice;

    // 漲幅門檻 (0.5% = 0.005)

    const isPriceStable = maxGainRatioIn10m <= 0.01 && maxGainRatioIn10m >= -0.01;

    if (!isStage1Passed && !isPriceChangeSignificant) return;
    // 🎯 第二關：前兩分鐘內 (k1.open 到 k2.close) 漲跌幅 >= 0.2%
    console.log(`\n${new Date(currentMinute.time).toLocaleTimeString()} [${symbol}] 價格：${currentMinute.close.toFixed(10)} 第一關檢測: k1.volume=${lastMinute.volume.toFixed(10)} | k2.volume=${currentMinute.volume.toFixed(10)}  \n前一分鐘買入額=${lastMinute.buyQuoteVolume.toFixed(10)} | 現在買入額=${currentMinute.buyQuoteVolume.toFixed(10)} 前一分鐘比例${lastMinute.buyQuoteVolume / lastMinute.sellQuoteVolume} \n前一分鐘賣出額=${lastMinute.sellQuoteVolume.toFixed(10)} | 現在賣出額=${currentMinute.sellQuoteVolume.toFixed(10)} 現在比例${currentMinute.buyQuoteVolume / currentMinute.sellQuoteVolume} \n平均量=${average.toFixed(10)} | 是否通過: ${isStage1Passed ? '✅' : '❌'} |  是否通過大幅: ${isPriceChangeSignificant ? '✅' : '❌'}`);


    const direction = changePercent > 0 ? 'UP' : 'DOWN';

    if (Math.abs(changePercent) >= 0.02) {
        // 檢查是否已經針對該時段觸發過，避免重複監控
        const taskId = `${symbol}_${currentMinute.time}`;
        if (activeMonitors.some(m => m.id === taskId)) return;

        console.log(`\n🚨 [${symbol}] 通過第一關與第二關！`);
        console.log(`   時間範圍: ${new Date(lastMinute.time).toLocaleTimeString()} ~ ${new Date(currentMinute.time).toLocaleTimeString()}`);
        console.log(`   方向: ${direction} | 兩分鐘幅: ${changePercent.toFixed(10)}%`);
        console.log(`   成交量變化: [${first98[0].volume.toFixed(10)}] -> [${lastMinute.volume.toFixed(10)}] -> [${currentMinute.volume.toFixed(10)}]`);
        const quantity = 10000 / currentSocketPrice.get(symbol).price;
        const finalPrice = await runTrading(symbol, currentSocketPrice.get(symbol).price, quantity, direction);
        if (finalPrice === null) {
            throw new Error("強制中止程式！");
            return;
        }
        // 加入第三關監控任務
        activeMonitors.push({
            id: taskId,
            symbol: symbol,
            startTime: Date.now(),
            direction: direction,
            basePrice: finalPrice,
            quantity: quantity,
            lastThritySecondsPrice: finalPrice,
            stayCount: 0,
            checkedIntervals: 0
        });
    }


}

// 🎯 第三關檢測任務（定時檢查）
async function checkStageThreeTasks() {
    const now = Date.now();

    for (let i = activeMonitors.length - 1; i >= 0; i--) {
        const task = activeMonitors[i];
        const elapsedTime = now - task.startTime;
        const targetInterval = (task.checkedIntervals + 1) * 1 * 10000; // 30秒、1分鐘

        if (elapsedTime >= targetInterval) {
            task.checkedIntervals += 1;

            // 抓取當前最新價格
            const currentKlines = await currentSocketPrice.get(task.symbol);
            if (!currentKlines) continue;

            const currentPrice = currentKlines.price;
            const pct = ((currentPrice - task.lastThritySecondsPrice) / task.lastThritySecondsPrice) * 100;
            const pctBase = ((currentPrice - task.basePrice) / task.basePrice) * 100;

            let isSuccess = false;
            let isReverse = false;

            if (task.direction === 'UP') {
                if (pct >= 0.2) isSuccess = true;
                if (pct < 0) isReverse = true;
            } else {
                if (pct <= -0.2) isSuccess = true;
                if (pct > 0) isReverse = true;
            }

            console.log(`🔍 [${task.symbol} 第三關] 第 ${task.checkedIntervals} 個 30 秒 | 當前漲跌幅: ${pctBase.toFixed(10)}%`);

            if (isReverse) {
                console.log(`❌ [${task.symbol}] 嚴重未達標 (觸發反向行情 ${pct.toFixed(10)}%)`);
                if (pctBase >= 0.5 || pctBase <= -0.5) {
                    console.log(`⚠️ [${task.symbol}] 嚴重未達標 (累計漲跌幅 ${pctBase.toFixed(10)}%)，準備止損！`);
                }
                await limitClose(task.symbol, currentPrice, task.quantity, task.direction, true, task.basePrice, i);
                continue;
            }

            if (!isSuccess) {
                task.stayCount += 1;
                console.log(`⚠️ [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒未達標 0.2%，累計未達標次數: ${task.stayCount}`);
            } else {
                if (task.direction === 'UP') {
                    if (pctBase >= 2.0) {
                        console.log(`🎯 [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒成功遠超達標，準備平倉！累計漲幅: ${pctBase.toFixed(10)}%`);
                        await limitClose(task.symbol, currentPrice, task.quantity, task.direction, false, task.basePrice, i);
                        continue;
                    } else {
                        console.log(`🎯 [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒成功遠超達標 0.2%！累計漲幅: ${pctBase.toFixed(10)}%`);
                    }
                } else {
                    if (pctBase <= -2.0) {
                        console.log(`🎯 [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒成功遠超達標，準備平倉！累計跌幅: ${pctBase.toFixed(10)}%`);
                        await limitClose(task.symbol, currentPrice, task.quantity, task.direction, false, task.basePrice, i);
                        continue;
                    } else {
                        console.log(`🎯 [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒成功達標 0.2%！累計跌幅: ${pctBase.toFixed(10)}%`);
                    }
                }
                task.stayCount++;
                console.log(`✅ [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒成功達標 0.2%！`);
            }



            if (task.direction === 'UP') {
                if (pctBase >= 1.0 && task.stayCount >= 4) {
                    console.log(`🎯 [${task.symbol}] 累計漲跌幅已達 1%，任務完成，準備平倉！`);
                    await limitClose(task.symbol, currentPrice, task.quantity, task.direction, false, task.basePrice, i);
                    continue;
                } else if (pct > pctBase) {
                    console.log(`⚠️ [${task.symbol}] 當前漲幅 ${pct.toFixed(10)}% 準備開始反向 ${pctBase.toFixed(10)}%，準備平倉！`);
                    await limitClose(task.symbol, currentPrice, task.quantity, task.direction, true, task.basePrice, i);
                    continue;
                }
            } else {
                if (pctBase <= -1.0 && task.stayCount >= 4) {
                    console.log(`🎯 [${task.symbol}] 累計漲跌幅已達 -1%，任務完成，準備平倉！`);
                    await limitClose(task.symbol, currentPrice, task.quantity, task.direction, false, task.basePrice, i);
                    continue;
                } else if (pct < pctBase) {
                    console.log(`⚠️ [${task.symbol}] 當前跌幅 ${pct.toFixed(10)}% 準備開始反向 ${pctBase.toFixed(10)}%，準備平倉！`);
                    await limitClose(task.symbol, currentPrice, task.quantity, task.direction, true, task.basePrice, i);
                    continue;
                }
            }



            if (task.checkedIntervals > 30) {
                if (pctBase <= 1.0 && pctBase >= -1.0) {
                    console.log(`❌ [${task.symbol}] 未達標，準備平！累計漲跌幅: ${pctBase.toFixed(10)}%`);
                } else {
                    console.log(`🎉 [${task.symbol}] 任務完成，準備平倉！`);
                }
                await limitClose(task.symbol, currentPrice, task.quantity, task.direction, false, task.basePrice, i);
                continue;
            }
            task.lastThritySecondsPrice = currentPrice; // 更新上一次的價格
        }
    }
}

// 核心精準對時排程器
function startPrecisionScheduler() {
    const now = new Date();
    const seconds = now.getSeconds();
    const millis = now.getMilliseconds();

    // 計算距離「下一個 00 秒」還有多少毫秒
    let delay = (62 - seconds) % 60 * 1000 - millis;
    if (delay <= 0) delay += 60000;

    const nextTriggerTime = new Date(Date.now() + delay).toLocaleTimeString();
    console.log(`🚀 機器人啟動完成！將在 ${nextTriggerTime} (第 00 秒) 首次執行對時任務...`);
    const url = 'wss://stream.binance.com:9443/stream?streams=' + SYMBOLS.map(symbol => symbol.toLowerCase() + '@aggTrade').join('/');
    const ws = new WebSocket(url);
    ws.on('open', () => {
        console.log('Successfully connected to Binance WebSocket!');
    });
    // 接收到 Binance 傳來的訊息時觸發
    ws.on('message', (data) => {
        try {
            const parsedData = JSON.parse(data);

            // Combined Stream 的資料格式外層會包含 "stream" 與 "data"
            const streamName = parsedData.stream;
            const tradeData = parsedData.data;

            // 更新最新價格
            currentSocketPrice.set(tradeData.s, { price: parseFloat(tradeData.p), time: tradeData.T });
        } catch (error) {
            console.error('Error parsing JSON:', error);
        }
    });

    // 發生錯誤時觸發
    ws.on('error', (error) => {
        console.error('WebSocket Error:', error);
    });

    // 連線關閉時觸發
    ws.on('close', (code, reason) => {
        console.log(`WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
    });
    // 先延遲到第一秒對準點
    setTimeout(async () => {
        await Promise.all(SYMBOLS.map(symbol => checkSymbolStrategy(symbol)));
        let count = 1;
        // 對準後，改為每 60 秒 (60000ms) 循環一次
        setInterval(async () => {
            await Promise.all(SYMBOLS.map(symbol => checkSymbolStrategy(symbol)));
            const total = countPercent.reduce((acc, curr) => acc + curr[2], 0);
            console.log('目前賺' + total)
            count += 1;
        }, 60000);
        setInterval(async () => {
            await checkStageThreeTasks();
        }, 10000);
    }, delay);

    setInterval(async () => {
        const writeStream = fs.createWriteStream('output_stream.csv');

        // 寫入 BOM 避免亂碼
        writeStream.write('\ufeff');

        const csvStream = format.format({ headers: false });
        csvStream.pipe(writeStream);
        let total = 0;
        countPercent.forEach(row => {
            total += row[2]
            csvStream.write(row)
        });
        csvStream.end();

        console.log('Stream 匯出成功！' + `\n總計漲跌幅: ${total.toFixed(10)}%`);
    }, delay + 120000);
}

startPrecisionScheduler();

// async function test() {
//     const url = 'wss://stream.binance.com:9443/stream?streams=btcusdt@aggTrade';
//     const ws = new WebSocket(url);
//     ws.on('open', () => {
//         console.log('Successfully connected to Binance WebSocket!');
//     });
//     // 接收到 Binance 傳來的訊息時觸發
//     ws.on('message', (data) => {
//         try {
//             const parsedData = JSON.parse(data);

//             // Combined Stream 的資料格式外層會包含 "stream" 與 "data"
//             const streamName = parsedData.stream;
//             const tradeData = parsedData.data;

//             // 更新最新價格
//             currentSocketPrice.set(tradeData.s, { price: parseFloat(tradeData.p), time: tradeData.T });
//         } catch (error) {
//             console.error('Error parsing JSON:', error);
//         }
//     });

//     // 發生錯誤時觸發
//     ws.on('error', (error) => {
//         console.error('WebSocket Error:', error);
//     });

//     // 連線關閉時觸發
//     ws.on('close', (code, reason) => {
//         console.log(`WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
//     });

//     setTimeout(async () => {
//         console.log(currentSocketPrice.get('BTCUSDT'))
//         const finalPrice = await runTrading('BTCUSDT', currentSocketPrice.get('BTCUSDT').price, 0.001, 'UP');
//         setTimeout(async () => {
//             const limitClosePrice = await limitClose('BTCUSDT', currentSocketPrice.get('BTCUSDT').price, 0.001, 'UP');
//         }, 120000)
//     }, 10000)

// }

// test()