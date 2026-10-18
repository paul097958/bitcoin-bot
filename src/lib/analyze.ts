import { USDMClient } from 'binance';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import SYMBOLS from '../data/symbols.json' with { type: 'json' };
import { GoogleGenAI, Type } from '@google/genai';
import type { PositionDocument, LatestMarketReportResult } from './firestore.js';
import { getOpenPositions, getLatestMarketReport } from './firestore.js';
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

export interface TradingSignal {
    symbol: string;
    action: 'NO_ACTION' | 'OPEN_NEW' | 'CLOSE_POSITION' | 'UPDATE_SL_TP';
    side: 'BUY' | 'SELL' | 'NONE';
    strength: '強' | '中' | '弱';
    bias: '偏多' | '偏空' | '盤整';
    supports: number[];
    resistances: number[];
    entryPrice: number;
    dcaPrice: number;       // 補倉價位
    stopLossPrice: number;
    takeProfitPrices: {
        tp1: number; // 70%
        tp2: number; // 30%
        tp3: number; // 10%
    };
    reason: string;
}

export interface MarketReportData {
    targetSymbol: string;
    currentPrice: number | null;
    keyLevels: { pdh: any; pdl: any; dailyOpen: any; weeklyOpen: any } | null;
    orderBook: { bestBid: [string, string] | null; bestAsk: [string, string] | null };
    klines4hData: KlineData[];
    klines1hData: KlineData[];
    openInterests: any[];
    accountRatioData: TopAccountRatioData[];
    fundingRates: any[];
    cpiData: any[];
    pceData: any[];
    nfpData: any[];
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

export async function fetchCurrentPrice(symbol: string = 'BTCUSDT'): Promise<number | null> {
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
async function mergeMarketData(targetSymbol: string): Promise<MarketReportData> {
    // 平行或依序取得各項資料
    const fundingRates = await fetchCurrentFundingRate(targetSymbol);
    const openInterests = await fetchOpenInterestHistory(targetSymbol);
    const orderBook = await fetchOrderBook(targetSymbol);
    const keyLevels = await fetchKeyLevels(targetSymbol);
    const klines4hData = await getKlines(targetSymbol, '4h', 50);
    const klines1hData = await getKlines(targetSymbol, '1h', 10);

    // 總經資料僅針對 BTCUSDT 抓取
    const cpiData = targetSymbol === 'BTCUSDT' ? await getFredHistory('CPIAUCSL', 5) : [];
    const pceData = targetSymbol === 'BTCUSDT' ? await getFredHistory('PCEPI', 5) : [];
    const nfpData = targetSymbol === 'BTCUSDT' ? await getFredHistory('PAYEMS', 5) : [];

    const accountRatioData = await fetchTopLongShortAccountRatio(targetSymbol, '4h', 5);
    const currentPrice = await fetchCurrentPrice(targetSymbol);

    // 處理訂單簿的最佳買賣價
    let bestBid: [string, string] | null = null;
    let bestAsk: [string, string] | null = null;

    if (orderBook && orderBook.bids && orderBook.asks) {
        const rawBid = orderBook.bids[0];
        const rawAsk = orderBook.asks[0];

        if (rawBid) {
            bestBid = [String(rawBid[0]), String(rawBid[1])];
        }
        if (rawAsk) {
            bestAsk = [String(rawAsk[0]), String(rawAsk[1])];
        }
    }

    // 回傳結構化物件
    return {
        targetSymbol,
        currentPrice,
        keyLevels,
        orderBook: { bestBid, bestAsk },
        klines4hData,
        klines1hData,
        openInterests: Array.isArray(openInterests) ? openInterests : [],
        accountRatioData,
        fundingRates: Array.isArray(fundingRates) ? fundingRates : [],
        cpiData,
        pceData,
        nfpData
    };
}

function buildMarketReportText(data: MarketReportData): string {
    const lines: string[] = [];
    // 若為 BTCUSDT，加入總體市場指數與報告
    if (data.targetSymbol === 'BTCUSDT') {
        lines.push(`==================================================`);
        lines.push(`總體市場指數與報告`);
        lines.push(`==================================================\n`);
        // CPI
        lines.push(`📌 【 美國消費者物價指數 (CPI) 近期走勢 】`);
        if (data.cpiData.length > 0) {
            data.cpiData.forEach(item => {
                lines.push(`   • 日期: ${item.date} | 數值: ${item.value}`);
            });
        } else {
            lines.push(`   (無法取得 CPI 資料)`);
        }
        lines.push(`--------------------------------------------------\n`);
        // PCE
        lines.push(`📌 【 個人消費支出物價指數 (PCE) 近期走勢 】`);
        if (data.pceData.length > 0) {
            data.pceData.forEach(item => {
                lines.push(`   • 日期: ${item.date} | 數值: ${item.value}`);
            });
        } else {
            lines.push(`   (無法取得 PCE 資料)`);
        }
        lines.push(`--------------------------------------------------\n`);
        // NFP
        lines.push(`📌 【 非農就業總人數 (NFP) 近期走勢 】`);
        if (data.nfpData.length > 0) {
            data.nfpData.forEach(item => {
                lines.push(`   • 日期: ${item.date} | 數值: ${item.value} 千人`);
            });
        } else {
            lines.push(`   (無法取得 NFP 資料)`);
        }
        lines.push(`--------------------------------------------------\n`);
    }
    lines.push(`==================================================`);
    lines.push(`🚀 ${data.targetSymbol} 市場與總經數據報告`);
    lines.push(`==================================================\n`);
    // 1. 關鍵價位
    lines.push(`📌 【 ${data.targetSymbol} 關鍵技術價位 】`);
    if (data.keyLevels) {
        lines.push(`   • 前一日最高價 (PDH) : ${data.keyLevels.pdh}`);
        lines.push(`   • 前一日最低價 (PDL) : ${data.keyLevels.pdl}`);
        lines.push(`   • 當日開盤價 (DO)    : ${data.keyLevels.dailyOpen}`);
        lines.push(`   • 當週開盤價 (WO)    : ${data.keyLevels.weeklyOpen}`);
    } else {
        lines.push(`   (無法取得關鍵價位)`);
    }
    lines.push(`--------------------------------------------------\n`);
    // 2. 訂單簿摘要
    lines.push(`📌 【 ${data.targetSymbol} 訂單簿快照摘要 】`);
    if (data.orderBook.bestBid && data.orderBook.bestAsk) {
        lines.push(`   • 最高委買價 (Best Bid) : 價格 ${data.orderBook.bestBid[0]} / 數量 ${data.orderBook.bestBid[1]}`);
        lines.push(`   • 最低委賣價 (Best Ask) : 價格 ${data.orderBook.bestAsk[0]} / 數量 ${data.orderBook.bestAsk[1]}`);
    } else {
        lines.push(`   (訂單簿資料不完整或無法取得)`);
    }
    lines.push(`--------------------------------------------------\n`);
    // 3. K 線資料
    lines.push(`📌 【 ${data.targetSymbol} 近期 K 線資料 (4h 週期，最近 50 筆) 】`);
    if (Array.isArray(data.klines4hData) && data.klines4hData.length > 0) {
        data.klines4hData.forEach((k) => {
            const timeStr = new Date(k.time).toLocaleString();
            lines.push(`   • 時間: ${timeStr} | 開: ${k.open} | 高: ${k.high} | 低: ${k.low} | 收: ${k.close} | 成交量: ${k.volume}`);
        });
    } else {
        lines.push(`   (無法取得 K 線資料)`);
    }
    // 4. K 線資料
    lines.push(`📌 【 ${data.targetSymbol} 近期 K 線資料 (1h 週期，最近 10 筆) 】`);
    if (Array.isArray(data.klines1hData) && data.klines1hData.length > 0) {
        data.klines1hData.forEach((k) => {
            const timeStr = new Date(k.time).toLocaleString();
            lines.push(`   • 時間: ${timeStr} | 開: ${k.open} | 高: ${k.high} | 低: ${k.low} | 收: ${k.close} | 成交量: ${k.volume}`);
        });
    } else {
        lines.push(`   (無法取得 K 線資料)`);
    }
    lines.push(`--------------------------------------------------\n`);
    // 4. 當前合約現價
    lines.push(`📌 【 ${data.targetSymbol} 當前合約現價 】`);
    if (data.currentPrice !== null) {
        lines.push(`   • 當前價格: $${data.currentPrice.toLocaleString()}`);
    } else {
        lines.push(`   (無法取得現價)`);
    }
    lines.push(`--------------------------------------------------\n`);
    // 5. 歷史持倉量
    lines.push(`📌 【 ${data.targetSymbol} 歷史持倉量 (最近 5 筆 / 4h 週期) 】`);
    if (Array.isArray(data.openInterests) && data.openInterests.length > 0) {
        data.openInterests.forEach((item: any) => {
            const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleString() : 'N/A';
            lines.push(`   • 時間: ${timeStr} | 持倉量 (OI): ${item.sumOpenInterest} | 持倉額 (USDT): ${item.sumOpenInterestValue}`);
        });
    } else {
        lines.push(`   (無法取得歷史持倉量資料)`);
    }
    lines.push(`--------------------------------------------------\n`);
    // 6. 大戶多空人數比
    lines.push(`📌 【 ${data.targetSymbol} 大戶多空人數比 (最近 5 筆 / 4h) 】`);
    if (Array.isArray(data.accountRatioData) && data.accountRatioData.length > 0) {
        data.accountRatioData.forEach((item) => {
            const timeStr = new Date(item.timestamp).toLocaleString();
            const longAcc = (item.longAccount * 100).toFixed(2);
            const shortAcc = (item.shortAccount * 100).toFixed(2);
            lines.push(`   • 時間: ${timeStr} | 多空比: ${item.longShortRatio} | 多頭佔比: ${longAcc}% | 空頭佔比: ${shortAcc}%`);
        });
    } else {
        lines.push(`   (無法取得大戶多空人數比資料)`);
    }
    lines.push(`--------------------------------------------------\n`);
    // 7. 資金費率
    lines.push(`📌 【 ${data.targetSymbol} 近期資金費率 (最近 5 筆) 】`);
    if (Array.isArray(data.fundingRates)) {
        data.fundingRates.slice(-5).forEach((item: any) => {
            const timeStr = item.fundingTime ? new Date(item.fundingTime).toLocaleString() : 'N/A';
            lines.push(`   • 時間: ${timeStr} | 費率: ${item.fundingRate}`);
        });
    } else {
        lines.push(`   (無法取得資金費率資料)`);
    }
    lines.push(`==================================================\n`);
    return lines.join('\n');
}


function formatLatestMarketReportToText(reportResult: LatestMarketReportResult | null): string {
    if (!reportResult || !reportResult.data) {
        return "目前沒有找到最新的市場報告資料。";
    }

    const { docId, data } = reportResult;
    const lines: string[] = [];

    // 將 Firestore Timestamp 轉為本地時間字串
    const createdAtStr = data.createdAt && typeof data.createdAt.toDate === 'function'
        ? data.createdAt.toDate().toLocaleString()
        : 'N/A';

    lines.push(`==================================================`);
    lines.push(`📈 最新市場分析與交易訊號報告`);
    lines.push(`==================================================`);
    lines.push(`• 報告檔案 ID : ${docId}`);
    lines.push(`• 建立時間    : ${createdAtStr}`);
    lines.push(`• 分析幣種數量: ${data.totalCoinsAnalyzed} 個`);
    lines.push(`--------------------------------------------------\n`);

    // 1. 顯示 AI 產出的交易訊號 (Trading Signals)
    lines.push(`🤖 【 交易訊號摘要 (Trading Signals) 】`);
    if (Array.isArray(data.signals) && data.signals.length > 0) {
        // 明確指定參數 sig 的型別為 TradingSignal
        data.signals.forEach((sig: TradingSignal, index: number) => {
            lines.push(`  🔹 [${index + 1}]${sig.symbol} | 動作: ${sig.action} \vert{} 方向: ${sig.side}`);
            lines.push(`     • 強度: ${sig.strength} \vert{} 多空傾向: ${sig.bias}`);
            lines.push(`     • 進場價: $${sig.entryPrice} | 補倉價: $${sig.dcaPrice} \vert{} 停損價: $${sig.stopLossPrice}`);
            lines.push(`     • 止盈價: TP1: $${sig.takeProfitPrices.tp1} | TP2: $${sig.takeProfitPrices.tp2} \vert{} TP3:$${sig.takeProfitPrices.tp3}`);
            lines.push(`     • 支撐位: [${sig.supports.join(', ')}] \vert{} 壓力位: [${sig.resistances.join(', ')}]`);
            lines.push(`     • 研判理由: ${sig.reason}`);
            lines.push(``);
        });
    } else {
        lines.push(`  (無交易訊號資料)`);
    }
    lines.push(`--------------------------------------------------\n`);

    // 2. 顯示各幣種結構化市場數據摘要 (Market Reports)
    lines.push(`📊 【 幣種市場與總經數據摘要 (Market Reports) 】`);
    if (Array.isArray(data.reports) && data.reports.length > 0) {
        // 明確指定參數 rep 的型別為 MarketReportData
        data.reports.forEach((rep: MarketReportData) => {
            lines.push(`  📌 幣種: ${rep.targetSymbol} \vert{} 現價: $${rep.currentPrice !== null ? rep.currentPrice.toLocaleString() : 'N/A'}`);
            if (rep.keyLevels) {
                lines.push(`     • 關鍵價位 -> PDH: ${rep.keyLevels.pdh} \vert{} PDL:${rep.keyLevels.pdl} | DO: ${rep.keyLevels.dailyOpen} \vert{} WO:${rep.keyLevels.weeklyOpen}`);
            }
            if (rep.orderBook && rep.orderBook.bestBid && rep.orderBook.bestAsk) {
                lines.push(`     • 最佳買賣 -> Bid: ${rep.orderBook.bestBid[0]} (${rep.orderBook.bestBid[1]}) / Ask: ${rep.orderBook.bestAsk[0]} (${rep.orderBook.bestAsk[1]})`);
            }
            lines.push(``);
        });
    } else {
        lines.push(`  (無詳細市場報告資料)`);
    }

    lines.push(`==================================================`);

    return lines.join('\n');
}

async function analyzeCoinsWithGemini(marketReportsText: string, openPositionText: string, latestMarketReportText: string): Promise<TradingSignal[]> {
    const prompt = `
你是一位專業的加密貨幣量化交易與技術分析專家。
以下是多個幣種的市場即時數據（包含合約現價、關鍵價位、訂單簿、K線、大戶多空比、持倉量、資金費率）以及總經背景。
請使用費波那契回撤，來評估各幣種的支撐與阻力位，並分析多空趨勢。

請針對每一個輸入的幣種進行專業分析，當有非常明確的多空行情時，並且目前沒有持倉可以使用 OPEN_NEW 建倉，盈虧比控制在 1:1.5 到 1:2.5，建倉的價格 entryPrice 要考慮是否能夠掛到單，其餘沒有非常明確訊號或目前正在持倉可給予 NO_ACTION。請勿在沒有非常明確訊號的情況下建倉。
以下為之前已建倉資料(如果有特殊的行情改變，可以提前平倉，切記不要盈虧一點點就平倉，重要的是行情改變)：
${openPositionText}

以下為上一次分析的資料：
${latestMarketReportText}

請嚴格依照下方的 JSON Schema 格式回傳一個陣列（Array），包含所有分析的幣種資料。

以下是原始市場數據（時間都是 UTC+8）：
現在時間為：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}

${marketReportsText}
`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.ARRAY,
                    description: '多個幣種的市場分析與量化交易訊號清單',
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            symbol: { type: Type.STRING, description: '幣種代號，例如 BTCUSDT' },
                            action: {
                                type: Type.STRING,
                                enum: ['NO_ACTION', 'OPEN_NEW', 'CLOSE_POSITION', 'UPDATE_SL_TP'],
                                description: '交易動作指令，NO_ACTION 表示暫不操作，OPEN_NEW 表示建倉，CLOSE_POSITION 表示平倉，UPDATE_SL_TP 表示更改停損和止盈價格。'
                            },
                            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NONE'], description: '買入(多)或賣出(空)，只有 OPEN_NEW 時才要填入。' },
                            strength: { type: Type.STRING, enum: ['強', '中', '弱'] },
                            bias: { type: Type.STRING, enum: ['偏多', '偏空', '盤整'] },
                            supports: {
                                type: Type.ARRAY,
                                items: { type: Type.NUMBER },
                                description: '三個主要支撐位'
                            },
                            resistances: {
                                type: Type.ARRAY,
                                items: { type: Type.NUMBER },
                                description: '三個主要阻力位'
                            },
                            entryPrice: { type: Type.NUMBER, description: '建議進場價位，若無則填 0' },
                            dcaPrice: { type: Type.NUMBER, description: '建議補倉價位，若無則填 0' },
                            stopLossPrice: { type: Type.NUMBER, description: '止損價位，若無則填 0' },
                            takeProfitPrices: {
                                type: Type.OBJECT,
                                properties: {
                                    tp1: { type: Type.NUMBER, description: 'TP1 (70%機率達到)' },
                                    tp2: { type: Type.NUMBER, description: 'TP2 (30%機率達到)' },
                                    tp3: { type: Type.NUMBER, description: 'TP3 (10%機率達到)' }
                                },
                                required: ['tp1', 'tp2', 'tp3']
                            },
                            reason: { type: Type.STRING, description: '分析行情，字數限制在 500 字以內，必須提示需觀察的價位，例如，跌不破80000將會再次拉漲。BTCUSDT的建議須包含全盤的分析' }
                        },
                        required: [
                            'symbol', 'action', 'side', 'strength', 'bias',
                            'supports', 'resistances', 'entryPrice', 'dcaPrice',
                            'stopLossPrice', 'takeProfitPrices', 'reason'
                        ]
                    }
                }
            }
        });

        const rawText = response.text || '[]';
        const signals: TradingSignal[] = JSON.parse(rawText);
        return signals;
    } catch (error: any) {
        console.error('❌ Gemini 分析失敗或 JSON 解析錯誤：', error.message || error);
        return [];
    }
}

function formatSignalsToMarkdown(signals: TradingSignal[]): string[] {
    const messages: string[] = [];
    const lines: string[] = [];

    // 1. 標題區塊（獨立成第一則訊息，或作為開頭）
    lines.push(`\n\n🚀 **加密貨幣量化與 AI 智能盤勢分析報告**`);
    lines.push(`⏰ \`${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}\``);
    lines.push(`\n\n`); // 空行留白

    messages.push(lines.join('\n'));

    // 2. 每個幣種獨立一個卡片（自成一個訊息，完美解決 2000 字元限制）
    signals.forEach((sig) => {
        const coinLines: string[] = [];
        const emoji = sig.bias === '偏多' ? '🟢' : sig.bias === '偏空' ? '🔴' : '⚪';

        coinLines.push(`\n\n### ${sig.symbol} ${emoji}${sig.bias}  |  力度：**${sig.strength}**`);
        coinLines.push(`🛡️ 支撐：\`${sig.supports.join(' / ')}\``);
        coinLines.push(`⚔️ 阻力：\`${sig.resistances.join(' / ')}\``);
        coinLines.push(``);
        coinLines.push(`> 📝 **盤勢解讀**：${sig.reason}`);
        coinLines.push(``);

        if (sig.action === 'OPEN_NEW') {
            coinLines.push(`🎯 **建議建倉與風控**`);
            coinLines.push(`• 方向：**${sig.side === 'BUY' ? '🟢 多 (BUY)' : '🔴 空 (SELL)'}**`);
            coinLines.push(`• 進場價：\`${sig.entryPrice}\``);
            coinLines.push(`• 補倉價：\`${sig.dcaPrice}\``);
            coinLines.push(`• 止損價：\`${sig.stopLossPrice}\``);
            coinLines.push(`• 止盈目標：TP1 \`${sig.takeProfitPrices.tp1}\` | TP2 \`${sig.takeProfitPrices.tp2}\` | TP3 \`${sig.takeProfitPrices.tp3}\``);
        } else {
            coinLines.push(`📌 建議：*無明確行情，暫時觀望 (NO_ACTION)*`);
        }

        messages.push(coinLines.join('\n'));
    });

    return messages; // 回傳 string[] 陣列
}

export function formatOpenPositionsToText(positions: PositionDocument[]): string {
    if (!positions || positions.length === 0) {
        return "目前沒有任何未平倉的部位。";
    }

    const lines: string[] = [];
    lines.push(`==================================================`);
    lines.push(`📊 目前未平倉部位清單 (共 ${positions.length} 筆)`);
    lines.push(`==================================================\n`);

    positions.forEach((pos, index) => {
        const data = pos.data;
        // 將 Firestore Timestamp 轉為本地時間字串
        const openedAtStr = data.openedAt && typeof data.openedAt.toDate === 'function'
            ? data.openedAt.toDate().toLocaleString()
            : 'N/A';

        lines.push(`📌 【${index + 1}】 ${data.symbol} (${data.side})`);
        lines.push(`   • 開倉狀態 : ${data.status}`);
        lines.push(`   • 進場價格 : $${data.entryPrice.toLocaleString()}`);
        lines.push(`   • 停損價格 : $${data.stopLossPrice.toLocaleString()}`);
        lines.push(`   • 止盈目標 : TP1: $${data.takeProfitPrices.tp1} | TP2: $${data.takeProfitPrices.tp2} | TP3: $${data.takeProfitPrices.tp3}`);
        lines.push(`   • 開倉時間 : ${openedAtStr}`);
        lines.push(`   • 開倉理由 : ${data.reason}`);
        lines.push(`--------------------------------------------------\n`);
    });

    return lines.join('\n');
}

export async function runMarketAnalysisPipeline(): Promise<{ marketDataReports: MarketReportData[]; messageChunks: string[]; signals: TradingSignal[] }> {
    let allReports = '';
    const marketDataReports: MarketReportData[] = [];

    for (const symbol of SYMBOLS) {
        console.log(`正在抓取 ${symbol}...`);
        const data: MarketReportData = await mergeMarketData(symbol); // 取得結構化物件

        // 呼叫新拆出的合成文字函式
        const singleReportText = buildMarketReportText(data);

        // 累積到總報告字串中
        allReports += singleReportText + '\n\n';
        marketDataReports.push(data);
    }
    const formattedOpenPositionsText = formatOpenPositionsToText(await getOpenPositions());
    const formattedLatestMarketReportText = formatLatestMarketReportToText(await getLatestMarketReport());

    console.log('🤖 數據收集完畢，正在傳送給 Gemini AI 進行結構化分析...\n');
    
    // 1. 取得結構化 JSON 訊號
    const signals: TradingSignal[] = await analyzeCoinsWithGemini(allReports, formattedOpenPositionsText, formattedLatestMarketReportText);

    // 2. 將 JSON 轉譯成 Discord 專用的美觀 Markdown 報告
    const messageChunks = formatSignalsToMarkdown(signals);

    // 回傳物件
    return {
        marketDataReports,
        messageChunks,
        signals
    };
}