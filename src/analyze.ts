import { USDMClient } from 'binance';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import SYMBOLS from './data/symbols.json' with { type: 'json' };
import { GoogleGenAI } from '@google/genai';

// 初始化 Gemini Client (確保你的 .env 有 GEMINI_API_KEY)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;
const FRED_API_KEY = process.env.FRED_API_KEY as string;
const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

const client = new USDMClient({
    api_key: apiKey as string,
    api_secret: apiSecret as string,
});

// --- 型別定義 ---
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

interface FredObservation {
    realtime_start: string;
    realtime_end: string;
    date: string;
    value: string;
}

interface FredResponse {
    observations: FredObservation[];
}

interface TopAccountRatioData {
    symbol: string;
    longAccount: number;   // 多頭帳戶比例
    shortAccount: number;  // 空頭帳戶比例
    longShortRatio: number; // 多空人數比 (Long/Short Ratio)
    timestamp: number;     // 時間戳記
}

// --- 1. 取得資金費率 ---
async function fetchCurrentFundingRate(symbol: string = 'BTCUSDT') {
    try {
        const response = await client.getFundingRateHistory({ symbol, limit: 5 });
        return response;
    } catch (error: any) {
        console.error('❌ 取得資金費率失敗：', error.message || error);
        return null;
    }
}

// --- 2. 取得歷史持倉量 ---
async function fetchOpenInterestHistory(symbol: string = 'BTCUSDT') {
    try {
        const response = await client.getOpenInterestStatistics({
            symbol,
            period: '4h',
            limit: 5,
        });
        return response;
    } catch (error: any) {
        console.error('❌ 取得歷史持倉量失敗：', error.message || error);
        return null;
    }
}

// --- 3. 取得訂單簿 ---
async function fetchOrderBook(symbol: string = 'BTCUSDT') {
    try {
        const response = await client.getOrderBook({ symbol, limit: 20 });
        return response;
    } catch (error: any) {
        console.error('❌ 取得訂單簿失敗：', error.message || error);
        return null;
    }
}

// --- 4. 取得關鍵價位 (PDH, PDL, DO, WO) ---
async function fetchKeyLevels(symbol: string = 'BTCUSDT') {
    try {
        const dailyKlines = await client.getKlines({ symbol, interval: '1d', limit: 3 });
        const weeklyKlines = await client.getKlines({ symbol, interval: '1w', limit: 2 });

        let pdh = null, pdl = null, dailyOpen = null, weeklyOpen = null;

        if (Array.isArray(dailyKlines) && dailyKlines.length >= 2) {
            const yesterdayKline = dailyKlines[dailyKlines.length - 2];
            const todayKline = dailyKlines[dailyKlines.length - 1];
            if (yesterdayKline && todayKline) {
                pdh = yesterdayKline[2];
                pdl = yesterdayKline[3];
                dailyOpen = todayKline[1];
            }
        }

        if (Array.isArray(weeklyKlines) && weeklyKlines.length >= 1) {
            const currentWeekKline = weeklyKlines[weeklyKlines.length - 1];
            if (currentWeekKline) {
                weeklyOpen = currentWeekKline[1];
            }
        }

        return { pdh, pdl, dailyOpen, weeklyOpen };
    } catch (error: any) {
        console.error('❌ 取得關鍵數據失敗：', error.message || error);
        return null;
    }
}

async function fetchTopLongShortAccountRatio(symbol: string = 'BTCUSDT', period: string = '4h', limit: number = 5): Promise<TopAccountRatioData[]> {
    try {
        // 註：依據你使用的實際 binance SDK 版本，方法名稱可能是 getTopLongShortAccountRatio 或類似名稱
        const response = await client.getTopTradersLongShortAccountRatio({
            symbol: symbol,
            period: period as any,
            limit: limit
        });

        if (Array.isArray(response) && response.length > 0) {
            return response.map((item: any) => ({
                symbol: item.symbol || symbol,
                longAccount: parseFloat(item.longAccount),   // 多頭人數佔比 (例如 0.55 代表 55%)
                shortAccount: parseFloat(item.shortAccount), // 空頭人數佔比
                longShortRatio: parseFloat(item.longShortRatio), // 多空比數值 (>1 代表多頭較多，<1 代表空頭較多)
                timestamp: item.timestamp
            }));
        }
        return [];
    } catch (err: any) {
        console.error(`❌ [${symbol}] 抓取大戶多空人數比失敗:`, err.message || err);
        return [];
    }
}

// --- 5. 取得 K 線資料 ---
async function getKlines(symbol: string, interval: string = '1m', limit: number = 10): Promise<KlineData[]> {
    try {
        const data = await client.getKlines({
            symbol: symbol,
            interval: interval as any,
            limit: limit
        });

        if (Array.isArray(data) && data.length > 0) {
            return data.map((k: any) => {
                const totalQuoteVolume = parseFloat(k[7]);
                const buyQuoteVolume = parseFloat(k[10]);
                const sellQuoteVolume = totalQuoteVolume - buyQuoteVolume;

                return {
                    time: k[0],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5]),
                    buyQuoteVolume,
                    sellQuoteVolume
                };
            });
        }
        return [];
    } catch (err: any) {
        console.error(`❌ [${symbol}] 抓取 K 線失敗:`, err.message || err);
        return [];
    }
}

async function fetchCurrentPrice(symbol: string = 'BTCUSDT'): Promise<number | null> {
    try {
        // 取得單一合約的最新價格 (Ticker Price)
        const response: any = await client.getSymbolPriceTicker({
            symbol: symbol
        });

        if (response && response.price) {
            return parseFloat(response.price);
        }

        // 如果回傳的是陣列（部分 SDK 版本特性）
        if (Array.isArray(response)) {
            const item = response.find((i: any) => i.symbol === symbol);
            if (item && item.price) {
                return parseFloat(item.price);
            }
        }

        return null;
    } catch (err: any) {
        console.error(`❌ [${symbol}] 取得合約現價失敗:`, err.message || err);
        return null;
    }
}

// --- 6. 取得 FRED 總經資料輔助函式 ---
async function getFredHistory(seriesId: string, limit: number = 5) {
    try {
        const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
        const response = await axios.get<FredResponse>(url);
        if (response.data && response.data.observations) {
            return response.data.observations;
        }
        return [];
    } catch (error: any) {
        console.error(`❌ 抓取 FRED 資料失敗 [${seriesId}]:`, error.message);
        return [];
    }
}


// --- 7. 統整並美化輸出主程式 ---
async function main(targetSymbol: string): Promise<string> {
    // 平行或依序取得各項資料
    const fundingRates = await fetchCurrentFundingRate(targetSymbol);
    const openInterests = await fetchOpenInterestHistory(targetSymbol);
    const orderBook = await fetchOrderBook(targetSymbol);
    const keyLevels = await fetchKeyLevels(targetSymbol);
    const klinesData = await getKlines(targetSymbol, '4h', 50);
    const cpiData = await getFredHistory('CPIAUCSL', 5);
    const pceData = await getFredHistory('PCEPI', 5);
    const nfpData = await getFredHistory('PAYEMS', 5);
    const accountRatioData = await fetchTopLongShortAccountRatio(targetSymbol, '4h', 5);
    const currentPrice = await fetchCurrentPrice(targetSymbol);

    // 使用陣列收集所有格式化文字，最後用 join 組合成一個大字串
    const lines: string[] = [];

    if (targetSymbol === 'BTCUSDT') {
        lines.push(`==================================================`);
        lines.push(`總體市場指數與報告`);
        lines.push(`==================================================\n`);

        // 8. 總經數據 (CPI)
        lines.push(`📌 【 美國消費者物價指數 (CPI) 近期走勢 】`);
        if (cpiData.length > 0) {
            cpiData.forEach(item => {
                lines.push(`   • 日期: ${item.date} | 數值: ${item.value}`);
            });
        } else {
            lines.push(`   (無法取得 CPI 資料)`);
        }
        lines.push(`--------------------------------------------------\n`);

        // 9. 總經數據 (PCE)
        lines.push(`📌 【 個人消費支出物價指數 (PCE) 近期走勢 】`);
        if (pceData.length > 0) {
            pceData.forEach(item => {
                lines.push(`   • 日期: ${item.date} | 數值: ${item.value}`);
            });
        } else {
            lines.push(`   (無法取得 PCE 資料)`);
        }
        lines.push(`--------------------------------------------------\n`);

        // 9. 總經數據 (NFP)
        lines.push(`📌 【 非農就業總人數 (NFP) 近期走勢 】`);
        if (nfpData.length > 0) {
            nfpData.forEach(item => {
                lines.push(`   • 日期: ${item.date} | 數值: ${item.value} 千人`);
            });
        } else {
            lines.push(`   (無法取得 NFP 資料)`);
        }

        lines.push(`--------------------------------------------------\n`);
    }

    lines.push(`==================================================`);
    lines.push(`🚀 ${targetSymbol} 市場與總經數據報告`);
    lines.push(`==================================================\n`);

    // 1. 關鍵價位
    lines.push(`📌 【 ${targetSymbol} 關鍵技術價位 】`);
    if (keyLevels) {
        lines.push(`   • 前一日最高價 (PDH) : ${keyLevels.pdh}`);
        lines.push(`   • 前一日最低價 (PDL) : ${keyLevels.pdl}`);
        lines.push(`   • 當日開盤價 (DO)    : ${keyLevels.dailyOpen}`);
        lines.push(`   • 當週開盤價 (WO)    : ${keyLevels.weeklyOpen}`);
    } else {
        lines.push(`   (無法取得關鍵價位)`);
    }
    lines.push(`--------------------------------------------------\n`);

    // 2. 訂單簿摘要
    lines.push(`📌 【 ${targetSymbol} 訂單簿快照摘要 】`);
    if (orderBook && orderBook.bids && orderBook.asks) {
        const bestBid = orderBook.bids[0];
        const bestAsk = orderBook.asks[0];
        if (!bestBid || !bestAsk) {
            lines.push(`   (訂單簿資料不完整)`);
        } else {
            lines.push(`   • 最高委買價 (Best Bid) : 價格 ${bestBid[0]} / 數量 ${bestBid[1]}`);
            lines.push(`   • 最低委賣價 (Best Ask) : 價格 ${bestAsk[0]} / 數量 ${bestAsk[1]}`);
        }
    } else {
        lines.push(`   (無法取得訂單簿資料)`);
    }
    lines.push(`--------------------------------------------------\n`);

    // 3. K 線資料
    lines.push(`📌 【 ${targetSymbol} 近期 K 線資料 (1h 週期，最近 5 筆) 】`);
    if (Array.isArray(klinesData) && klinesData.length > 0) {
        klinesData.forEach((k) => {
            const timeStr = new Date(k.time).toLocaleString();
            lines.push(`   • 時間: ${timeStr} | 開: ${k.open} | 高: ${k.high} | 低: ${k.low} | 收: ${k.close} | 成交量: ${k.volume}`);
        });
    } else {
        lines.push(`   (無法取得 K 線資料)`);
    }
    lines.push(`--------------------------------------------------\n`);

    // 4. 當前合約現價
    lines.push(`📌 【 ${targetSymbol} 當前合約現價 】`);
    if (currentPrice !== null) {
        lines.push(`   • 當前價格: $${currentPrice.toLocaleString()}`);
    } else {
        lines.push(`   (無法取得現價)`);
    }
    lines.push(`--------------------------------------------------\n`);

    // 5. 歷史持倉量
    lines.push(`📌 【 ${targetSymbol} 歷史持倉量 (最近 5 筆 / 4h 週期) 】`);
    if (Array.isArray(openInterests) && openInterests.length > 0) {
        openInterests.forEach((item: any) => {
            const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleString() : 'N/A';
            lines.push(`   • 時間: ${timeStr} | 持倉量 (OI): ${item.sumOpenInterest} | 持倉額 (USDT): ${item.sumOpenInterestValue}`);
        });
    } else {
        lines.push(`   (無法取得歷史持倉量資料)`);
    }
    lines.push(`--------------------------------------------------\n`);
    // 6. 大戶多空人數比
    lines.push(`📌 【 ${targetSymbol} 大戶多空人數比 (最近 5 筆 / 4h) 】`);
    if (Array.isArray(accountRatioData) && accountRatioData.length > 0) {
        accountRatioData.forEach((item) => {
            const timeStr = new Date(item.timestamp).toLocaleString();
            lines.push(`   • 時間: ${timeStr} | 多空比: ${item.longShortRatio} | 多頭佔比: ${(item.longAccount * 100).toFixed(2)}% | 空頭佔比: ${(item.shortAccount * 100).toFixed(2)}%`);
        });
    } else {
        lines.push(`   (無法取得大戶多空人數比資料)`);
    }
    lines.push(`--------------------------------------------------\n`);

    // 7. 資金費率
    lines.push(`📌 【 ${targetSymbol} 近期資金費率 (最近 5 筆) 】`);
    if (Array.isArray(fundingRates)) {
        fundingRates.slice(-5).forEach((item: any) => {
            const timeStr = item.fundingTime ? new Date(item.fundingTime).toLocaleString() : 'N/A';
            lines.push(`   • 時間: ${timeStr} | 費率: ${item.fundingRate}`);
        });
    } else {
        lines.push(`   (無法取得資金費率資料)`);
    }

    lines.push(`==================================================`);

    // 將所有行組合回傳
    return lines.join('\n');
}

async function analyzeCoinsWithGemini(marketReportsText: string): Promise<string> {
    const prompt = `
你是一位專業的加密貨幣量化交易與技術分析專家。
以下是多個幣種的市場即時數據（包含關鍵價位、訂單簿、K線、持倉量、資金費率）以及總經背景。

請針對每一個幣種進行專業分析，並**嚴格依照**以下的固定格式來輸出每一個幣種的分析結果。如果某個幣種沒有明確行情，請在建議建倉位置填寫「無明確行情不需」，請使用markdown語法美化。

【 輸出格式範本  】

總結：說明整體市場的方向與重大事件。

--------------------------------------------------
[幣種名稱] 🔴偏空 / 🟢偏多 / ⚪盤整 | 力度 強 / 中 / 弱
支撐 [支撐位1] [支撐位2] [支撐位3]
阻力 [阻力位1] [阻力位2] [阻力位3]

簡短說明：[請用簡短精鍊的文字分析當前盤勢、多空力量與資金費率/持倉量變化]

建議建倉位置 (如果沒有明確行情請填寫「無明確行情不需」)
方向：[多 / 空]
位置：[進場價位]
補倉：[補倉價位]
止損：[止損價位]
止盈：TP1(xx%會達到) [價位] | TP2(xx%會達到) [價位] | TP3(xx%會達到) [價位]
--------------------------------------------------

--------------------------------------------------
[幣種名稱] 🔴偏空 / 🟢偏多 / ⚪盤整 | 力度 強 / 中 / 弱
支撐 [支撐位1] [支撐位2] [支撐位3]
阻力 [阻力位1] [阻力位2] [阻力位3]

簡短說明：[請用簡短精鍊的文字分析當前盤勢、多空力量與資金費率/持倉量變化]

建議建倉位置 (如果沒有明確行情請填寫「無明確行情不需」)
方向：[多 / 空]
位置：[進場價位]
補倉：[補倉價位]
止損：[止損價位]
止盈：TP1(xx%會達到) [價位] | TP2(xx%會達到) [價位] | TP3(xx%會達到) [價位]
--------------------------------------------------

最優投資組合(風險最低、方向最明確)：最多選兩個


以下是原始市場數據(時間都是UTC+8)：
現在時間為：${new Date().toLocaleString()}
${marketReportsText}
`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash', // 速度快且適合長文本分析的模型
            contents: prompt,
        });

        return response.text || '無法取得 AI 分析結果';
    } catch (error: any) {
        console.error('❌ Gemini 分析失敗：', error.message || error);
        return '分析過程發生錯誤';
    }
}

export default async function runMarketAnalysisPipeline() {
    let allReports = '';

    console.log('🚀 開始收集各幣種市場數據...');
    for (const symbol of SYMBOLS) {
        console.log(`正在抓取 ${symbol}...`);
        const reportText = await main(symbol);
        allReports += reportText + '\n\n';
    }
    console.log('🤖 數據收集完畢，正在傳送給 Gemini AI 進行專業分析...\n');
    const finalAiAnalysis = await analyzeCoinsWithGemini(allReports);

    return finalAiAnalysis;
}

