const axios = require('axios');
const fs = require('fs');
const format = require('@fast-csv/format');
const WebSocket = require('ws');


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
    const isStage1Passed = (currentMinute.volume >= lastMinute.volume * 2.5) && (lastMinute.volume > average);

    // 測驗漲跌幅大增
    const startPrice = lastMinute.open;
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

    if (Math.abs(changePercent) >= 0.2) {
        if (direction === 'UP') {
            if (currentMinute.open > currentMinute.close) {
                return;
            }
            if (lastMinute.open > lastMinute.close) {
                return;
            }
            if (lastTwoMinute.open > lastTwoMinute.close) {
                return;
            }
            if ((currentMinute.close - lastTwoMinute.open) / lastTwoMinute.open < 0.005) {
                return;
            }
        } else {
            if (currentMinute.open < currentMinute.close) {
                return;
            }
            if (lastMinute.open < lastMinute.close) {
                return;
            }
            if (lastTwoMinute.open < lastTwoMinute.close) {
                return;
            }
            if ((currentMinute.open - lastTwoMinute.open) / lastTwoMinute.open > -0.005) {
                return;
            }
        }
        // 檢查是否已經針對該時段觸發過，避免重複監控
        const taskId = `${symbol}_${currentMinute.time}`;
        if (activeMonitors.some(m => m.id === taskId)) return;

        console.log(`\n🚨 [${symbol}] 通過第一關與第二關！`);
        console.log(`   時間範圍: ${new Date(lastMinute.time).toLocaleTimeString()} ~ ${new Date(currentMinute.time).toLocaleTimeString()}`);
        console.log(`   方向: ${direction} | 兩分鐘幅: ${changePercent.toFixed(10)}%`);
        console.log(`   成交量變化: [${first98[0].volume.toFixed(10)}] -> [${lastMinute.volume.toFixed(10)}] -> [${currentMinute.volume.toFixed(10)}]`);

        // 加入第三關監控任務
        activeMonitors.push({
            id: taskId,
            symbol: symbol,
            startTime: Date.now(),
            direction: direction,
            basePrice: endPrice,
            lastThritySecondsPrice: endPrice,
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
        const targetInterval = (task.checkedIntervals + 1) * 0.5 * 60000; // 30秒、1分鐘

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
                activeMonitors.splice(i, 1);
                countPercent.push([task.symbol, task.direction, (task.direction === 'UP' ? 1 : -1) * pctBase.toFixed(10), task.basePrice, currentPrice, currentKlines.time]);
                continue;
            }

            if (!isSuccess) {
                task.stayCount += 1;
                console.log(`⚠️ [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒未達標 0.2%，累計未達標次數: ${task.stayCount}`);
            } else {
                if (task.direction === 'UP') {
                    if (pct >= 3.0 && pctBase >= 2.0) {
                        console.log(`🎯 [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒成功遠超達標 0.2%！累計漲幅: ${pctBase.toFixed(10)}%`);
                    } else if (pctBase >= 0.5) {
                        console.log(`🎯 [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒成功遠超達標，準備平倉！累計漲幅: ${pctBase.toFixed(10)}%`);
                        activeMonitors.splice(i, 1);
                        countPercent.push([task.symbol, task.direction, (task.direction === 'UP' ? 1 : -1) * pctBase.toFixed(10), task.basePrice, currentPrice, currentKlines.time]);

                    }
                } else {
                    if (pct <= -3.0 && pctBase <= -2.0) {
                        console.log(`🎯 [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒成功達標 0.2%！累計跌幅: ${pctBase.toFixed(10)}%`);
                    } else if (pctBase <= -0.5) {
                        console.log(`🎯 [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒成功遠超達標，準備平倉！累計跌幅: ${pctBase.toFixed(10)}%`);
                        activeMonitors.splice(i, 1);
                        countPercent.push([task.symbol, task.direction, (task.direction === 'UP' ? 1 : -1) * pctBase.toFixed(10), task.basePrice, currentPrice, currentKlines.time]);
                    }
                }
                task.stayCount++;
                console.log(`✅ [${task.symbol}] 第 ${task.checkedIntervals} 個 30 秒成功達標 0.2%！`);
            }



            if (task.direction === 'UP') {
                if (pctBase >= 1.0) {
                    console.log(`🎯 [${task.symbol}] 累計漲跌幅已達 1%，任務完成，準備平倉！`);
                    activeMonitors.splice(i, 1);
                    countPercent.push([task.symbol, task.direction, (task.direction === 'UP' ? 1 : -1) * pctBase.toFixed(10), task.basePrice, currentPrice, currentKlines.time]);
                    continue;
                } else if (pct > pctBase) {
                    console.log(`⚠️ [${task.symbol}] 當前漲幅 ${pct.toFixed(10)}% 準備開始反向 ${pctBase.toFixed(10)}%，準備平倉！`);
                    activeMonitors.splice(i, 1);
                    countPercent.push([task.symbol, task.direction, (task.direction === 'UP' ? 1 : -1) * pctBase.toFixed(10), task.basePrice, currentPrice, currentKlines.time]);
                    continue;
                }
            } else {
                if (pctBase <= -1.0) {
                    console.log(`🎯 [${task.symbol}] 累計漲跌幅已達 -1%，任務完成，準備平倉！`);
                    activeMonitors.splice(i, 1);
                    countPercent.push([task.symbol, task.direction, (task.direction === 'UP' ? 1 : -1) * pctBase.toFixed(10), task.basePrice, currentPrice, currentKlines.time]);
                    continue;
                } else if (pct < pctBase) {
                    console.log(`⚠️ [${task.symbol}] 當前跌幅 ${pct.toFixed(10)}% 準備開始反向 ${pctBase.toFixed(10)}%，準備平倉！`);
                    activeMonitors.splice(i, 1);
                    countPercent.push([task.symbol, task.direction, (task.direction === 'UP' ? 1 : -1) * pctBase.toFixed(10), task.basePrice, currentPrice, currentKlines.time]);
                    continue;
                }
            }



            if (task.checkedIntervals > 10) {
                if (pctBase < 1.0 && pctBase > -1.0) {
                    console.log(`❌ [${task.symbol}] 未達標，準備平！累計漲跌幅: ${pctBase.toFixed(10)}%`);
                } else {
                    console.log(`🎉 [${task.symbol}] 任務完成，準備平倉！`);
                }
                activeMonitors.splice(i, 1);
                countPercent.push([task.symbol, task.direction, (task.direction === 'UP' ? 1 : -1) * pctBase.toFixed(10), task.basePrice, currentPrice, currentKlines.time]);
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
    let delay = (60 - seconds) % 60 * 1000 - millis;
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