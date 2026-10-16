import type { TradingSignal, MarketReportData } from './analyze.js';
import { saveSignalsAndReportsToFirestore, getLatestMarketReport, getOpenPositions } from './firestore.js';
// 1. 測試用的 TradingSignal 資料
const mockSignals: TradingSignal[] = [
    {
        symbol: "BTCUSDT",
        action: "OPEN_NEW",
        side: "BUY",
        strength: "強",
        bias: "偏多",
        supports: [62000, 60500],
        resistances: [65000, 67200],
        entryPrice: 63250,
        dcaPrice: 61500,
        stopLossPrice: 59800,
        takeProfitPrices: {
            tp1: 65500,
            tp2: 67000,
            tp3: 70000
        },
        reason: "突破近期盤整區間，且大戶多空比與資金費率維持健康偏多結構。"
    }
];

// 2. 測試用的 MarketReportData[] 資料
const mockReportsData: MarketReportData[] = [
    {
        targetSymbol: "BTCUSDT",
        currentPrice: 63250,
        keyLevels: {
            pdh: 64100,
            pdl: 62300,
            dailyOpen: 62800,
            weeklyOpen: 61500
        },
        orderBook: {
            bestBid: ["63249.8", "1.52"],
            bestAsk: ["63250.0", "0.85"]
        },
        klinesData: [
            {
                time: 1776384000000,
                open: 62800,
                high: 63500,
                low: 62600,
                close: 63250,
                volume: 1245.5,
                buyQuoteVolume: 700.2,
                sellQuoteVolume: 545.3
            }
        ],
        openInterests: [
            {
                timestamp: 1776384000000,
                sumOpenInterest: "45200.5",
                sumOpenInterestValue: "2858900000"
            }
        ],
        accountRatioData: [
            {
                symbol: "BTCUSDT",
                longAccount: 0.58,
                shortAccount: 0.42,
                longShortRatio: 1.38,
                timestamp: 1776384000000
            }
        ],
        fundingRates: [
            {
                fundingTime: 1776384000000,
                fundingRate: "0.0100"
            }
        ],
        cpiData: [
            {
                date: "2026-03-01",
                value: "3.1"
            }
        ],
        pceData: [
            {
                date: "2026-03-01",
                value: "2.5"
            }
        ],
        nfpData: [
            {
                date: "2026-03-01",
                value: "215"
            }
        ]
    }
];

// 1. 測試用的 TradingSignal 陣列 (包含 BTC 開倉與 ETH 平倉情境)
const mockSignals2: TradingSignal[] = [
    {
        symbol: "BTCUSDT",
        action: "OPEN_NEW",
        side: "BUY",
        strength: "強",
        bias: "偏多",
        supports: [62000, 60500],
        resistances: [65000, 67200],
        entryPrice: 63250,
        dcaPrice: 61500,
        stopLossPrice: 59800,
        takeProfitPrices: {
            tp1: 65500,
            tp2: 67000,
            tp3: 70000
        },
        reason: "突破近期盤整區間，大戶多空比與資金費率維持強勢多頭結構。"
    },
    {
        symbol: "ETHUSDT",
        action: "CLOSE_POSITION",
        side: "SELL",
        strength: "中",
        bias: "盤整",
        supports: [3100, 3000],
        resistances: [3350, 3500],
        entryPrice: 3250,
        dcaPrice: 3300,
        stopLossPrice: 3400,
        takeProfitPrices: {
            tp1: 3150,
            tp2: 3050,
            tp3: 2950
        },
        reason: "觸及關鍵壓力位且動能減弱，執行平倉出場。"
    }
];

// 2. 測試用的 MarketReportData[] 陣列
const mockReportsData2: MarketReportData[] = [
    {
        targetSymbol: "BTCUSDT",
        currentPrice: 63250,
        keyLevels: {
            pdh: 64100,
            pdl: 62300,
            dailyOpen: 62800,
            weeklyOpen: 61500
        },
        orderBook: {
            bestBid: ["63249.8", "1.52"],
            bestAsk: ["63250.0", "0.85"]
        },
        klinesData: [
            {
                time: 1776384000000,
                open: 62800,
                high: 63500,
                low: 62600,
                close: 63250,
                volume: 1245.5,
                buyQuoteVolume: 700.2,
                sellQuoteVolume: 545.3
            }
        ],
        openInterests: [
            {
                timestamp: 1776384000000,
                sumOpenInterest: "45200.5",
                sumOpenInterestValue: "2858900000"
            }
        ],
        accountRatioData: [
            {
                symbol: "BTCUSDT",
                longAccount: 0.58,
                shortAccount: 0.42,
                longShortRatio: 1.38,
                timestamp: 1776384000000
            }
        ],
        fundingRates: [
            {
                fundingTime: 1776384000000,
                fundingRate: "0.0100"
            }
        ],
        cpiData: [
            {
                date: "2026-03-01",
                value: "3.1"
            }
        ],
        pceData: [
            {
                date: "2026-03-01",
                value: "2.5"
            }
        ],
        nfpData: [
            {
                date: "2026-03-01",
                value: "215"
            }
        ]
    },
    {
        targetSymbol: "ETHUSDT",
        currentPrice: 3240,
        keyLevels: {
            pdh: 3320,
            pdl: 3180,
            dailyOpen: 3200,
            weeklyOpen: 3100
        },
        orderBook: {
            bestBid: ["3239.5", "12.4"],
            bestAsk: ["3240.0", "8.1"]
        },
        klinesData: [
            {
                time: 1776384000000,
                open: 3200,
                high: 3260,
                low: 3190,
                close: 3240,
                volume: 3450.2,
                buyQuoteVolume: 1700.1,
                sellQuoteVolume: 1750.1
            }
        ],
        openInterests: [
            {
                timestamp: 1776384000000,
                sumOpenInterest: "185200.0",
                sumOpenInterestValue: "599800000"
            }
        ],
        accountRatioData: [
            {
                symbol: "ETHUSDT",
                longAccount: 0.51,
                shortAccount: 0.49,
                longShortRatio: 1.04,
                timestamp: 1776384000000
            }
        ],
        fundingRates: [
            {
                fundingTime: 1776384000000,
                fundingRate: "0.0085"
            }
        ],
        cpiData: [],
        pceData: [],
        nfpData: []
    }
];

await saveSignalsAndReportsToFirestore(mockSignals2, mockReportsData2);

console.log(await getLatestMarketReport());
console.log(await getOpenPositions());