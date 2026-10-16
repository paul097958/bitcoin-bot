import type { MarketReportData } from './analyze.js';
import type { TradingSignal } from './analyze.js';
import { cert, initializeApp } from 'firebase-admin/app';
import serviceAccount from '../services.json' with { type: 'json' };
initializeApp({
    credential: cert(serviceAccount as any),
});
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
const db = getFirestore();

export interface TradePosition {
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrices: {
        tp1: number;
        tp2: number;
        tp3: number;
    };
    reason: string;
    status: 'OPEN' | 'CLOSED';
    openedAt: Timestamp;
    closedAt: Timestamp | null;
    closeReason?: string;
}

export interface PositionDocument {
    id: string;
    data: TradePosition;
}

export interface MarketReportDocument {
    createdAt: Timestamp;
    totalCoinsAnalyzed: number;
    signals: TradingSignal[];
    reports: MarketReportData[];
}

export interface LatestMarketReportResult {
    docId: string;
    data: MarketReportDocument;
}

export async function saveSignalsAndReportsToFirestore(signals: TradingSignal[], reportsData: MarketReportData[]) {
    try {
        const batchTimestamp = new Date();

        // 格式化日期與時間，例如 "2026-10-15" 與 "03-10-00"
        const year = batchTimestamp.getFullYear();
        const month = String(batchTimestamp.getMonth() + 1).padStart(2, '0');
        const day = String(batchTimestamp.getDate()).padStart(2, '0');

        const hours = String(batchTimestamp.getHours()).padStart(2, '0');
        const minutes = String(batchTimestamp.getMinutes()).padStart(2, '0');
        const seconds = String(batchTimestamp.getSeconds()).padStart(2, '0');

        const dateString = `${year}-${month}-${day}`;
        const timeString = `${hours}-${minutes}-${seconds}`;
        const docId = `${dateString}_${timeString}`; // 例如：2026-10-15_03-01-00

        // 1. 原本的 market_reports 記錄批次報告
        const docRef = db.collection('market_reports').doc(docId);
        await docRef.set({
            createdAt: Timestamp.fromDate(batchTimestamp),
            totalCoinsAnalyzed: signals.length,
            signals: signals,
            reports: reportsData
        });

        console.log(`✅ [Firestore] 成功儲存市場報告！文件 ID: ${docId}`);

        // 2. 處理 OPEN_NEW 與 CLOSE_POSITION 的持倉追蹤集合
        const positionsCollection = db.collection('trade_positions');

        for (const signal of signals) {
            if (signal.action === 'OPEN_NEW') {
                // 1. 先檢查該幣種是否已經有 status 為 'OPEN' 的持倉
                const existingOpenQuery = await positionsCollection
                    .where('symbol', '==', signal.symbol)
                    .where('status', '==', 'OPEN')
                    .get();

                if (!existingOpenQuery.empty) {
                    console.log(`⚠️ [持倉追蹤] 略過開倉：${signal.symbol} 目前已經有未平倉（OPEN）的紀錄，不重複建立。`);
                    continue; // 直接跳過當前迴圈，忽略此訊號
                }

                // 2. 如果不存在，才建立一筆新的開倉記錄
                const newPositionRef = positionsCollection.doc();
                await newPositionRef.set({
                    symbol: signal.symbol,
                    side: signal.side,
                    entryPrice: signal.entryPrice,
                    stopLossPrice: signal.stopLossPrice,
                    takeProfitPrices: signal.takeProfitPrices,
                    reason: signal.reason,
                    status: 'OPEN', // 標記目前為持倉中
                    openedAt: Timestamp.fromDate(batchTimestamp),
                    closedAt: null
                });
                console.log(`📈 [持倉追蹤] 記錄新開倉單：${signal.symbol} (${signal.side})`);

            } else if (signal.action === 'CLOSE_POSITION') {
                // 尋找該幣種目前狀態為 'OPEN' 的開倉紀錄
                const querySnapshot = await positionsCollection
                    .where('symbol', '==', signal.symbol)
                    .where('status', '==', 'OPEN')
                    .get();

                // 確保真的有找到文件才進行操作
                if (!querySnapshot.empty && querySnapshot.docs[0]) {
                    const openDoc = querySnapshot.docs[0];
                    await openDoc.ref.update({
                        status: 'CLOSED',
                        closedAt: Timestamp.fromDate(batchTimestamp),
                        closeReason: signal.reason
                    });
                    console.log(`📉 [持倉追蹤] 成功更新平倉單：${signal.symbol}，已填入平倉時間`);
                } else {
                    console.warn(`⚠️ [持倉追蹤] 收到 ${signal.symbol} 的平倉訊號，但在資料庫中找不到對應的 OPEN 紀錄。`);
                }
            }
        }

    } catch (error: any) {
        console.error('❌ [Firestore] 寫入或更新持倉失敗：', error.message || error);
    }
}


export async function getLatestMarketReport(): Promise<LatestMarketReportResult | null> {
    try {
        // 查詢 market_reports 集合，依照建立時間 (createdAt) 降冪排序，只取第一筆 (limit(1))
        const snapshot = await db.collection('market_reports')
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        // 確保 snapshot 不為空，且確實存在第一筆文件
        if (snapshot.empty || !snapshot.docs[0]) {
            console.log('⚠️ [Firestore] 目前找不到任何市場報告紀錄。');
            return null;
        }

        const latestDoc = snapshot.docs[0];
        const docId = latestDoc.id;
        const data = latestDoc.data() as MarketReportDocument;

        console.log(`✅ [Firestore] 成功獲取最新市場報告，文件 ID: ${docId}`);

        return {
            docId,
            data
        };

    } catch (error: any) {
        console.error('❌ [Firestore] 獲取最新市場報告失敗：', error.message || error);
        return null;
    }
}


export async function getOpenPositions(): Promise<Array<{ id: string; data: TradePosition }>> {
    try {
        // 查詢 trade_positions 集合中 status 為 OPEN 的所有文件
        const snapshot = await db.collection('trade_positions')
            .where('status', '==', 'OPEN')
            .get();

        if (snapshot.empty) {
            console.log('⚠️ [Firestore] 目前沒有任何未平倉的持倉紀錄。');
            return [];
        }

        const openPositions = snapshot.docs.map(doc => ({
            id: doc.id,
            data: doc.data() as TradePosition
        }));

        console.log(`✅ [Firestore] 成功獲取所有未平倉資料，共 ${openPositions.length} 筆`);

        return openPositions;

    } catch (error: any) {
        console.error('❌ [Firestore] 獲取未平倉資料失敗：', error.message || error);
        return [];
    }
}