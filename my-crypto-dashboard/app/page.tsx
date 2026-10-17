import React from 'react';
import { adminDb } from '../lib/firebase-admin';
import PositionCard from './components/PositionCard';
import MarketReportsSection from './components/MarketReportsSection';
import ClosedPositionsSection from './components/ClosedPositionsSection'; // 新增獨立的已平倉互動元件

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    let openPositions: any[] = [];
    let closedPositions: any[] = [];
    let reports: any[] = [];

    try {
        const posSnapshot = await adminDb.collection('trade_positions').get();
        
        const allPositions = posSnapshot.docs.map(doc => {
            const data = doc.data();
            let closedPnlPercentage = null;
            if (data.status === 'CLOSED' && data.entryPrice && data.closePrice) {
                const diff = data.side === 'BUY' 
                    ? data.closePrice - data.entryPrice 
                    : data.entryPrice - data.closePrice;
                closedPnlPercentage = (diff / data.entryPrice) * 100;
            }

            return {
                id: doc.id,
                symbol: data.symbol,
                side: data.side,
                entryPrice: data.entryPrice,
                stopLossPrice: data.stopLossPrice,
                takeProfitPrices: data.takeProfitPrices || { tp1: 0, tp2: 0, tp3: 0 },
                reason: data.reason,
                status: data.status,
                closePrice: data.closePrice || null,
                closeReason: data.closeReason || null,
                closedPnlPercentage,
                openedAt: data.openedAt?.toDate ? data.openedAt.toDate().toISOString() : null,
                closedAt: data.closedAt?.toDate ? data.closedAt.toDate().toISOString() : null,
            };
        });

        openPositions = allPositions.filter(p => p.status === 'OPEN');
        closedPositions = allPositions.filter(p => p.status === 'CLOSED');

        // 抓取 AI 分析報告
        const repSnapshot = await adminDb.collection('market_reports')
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();
            
        reports = repSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null,
                totalCoinsAnalyzed: data.totalCoinsAnalyzed,
                signals: data.signals || []
            };
        });
    } catch (error) {
        console.error("SSR 載入資料失敗:", error);
    }

    // 計算總結算盈虧百分比 (累加所有已平倉的 PnL%)
    const totalClosedPnl = closedPositions.reduce((acc, pos) => acc + (pos.closedPnlPercentage || 0), 0);
    const isOverallProfitable = totalClosedPnl >= 0;

    return (
        <main className="min-h-screen bg-gray-950 text-gray-100 p-6 md:p-10">
            <div className="max-w-7xl mx-auto space-y-12">
                
                <header className="border-b border-gray-800 pb-5 flex flex-col md:flex-row justify-between md:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">
                            🚀 加密貨幣 AI 自動化交易儀表板
                        </h1>
                        <p className="text-sm text-gray-400 mt-1">結合 Binance WebSocket 即時價格、持倉追蹤與 AI 歷史報告監控</p>
                    </div>

                    {/* 最上方的總盈虧百分比看板 */}
                    <div className="bg-gray-900/80 border border-gray-800 px-5 py-3 rounded-xl shadow-lg flex items-center gap-4">
                        <span className="text-sm text-gray-400">已平倉總結算績效:</span>
                        <span className={`font-mono text-lg font-bold ${isOverallProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isOverallProfitable ? '+' : ''}{totalClosedPnl.toFixed(2)}%
                        </span>
                    </div>
                </header>

                {/* 區塊一：目前持倉 (Open Positions) */}
                <section className="space-y-4">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-emerald-400">
                        🟢 目前持倉追蹤 (<span className="text-white">{openPositions.length}</span>)
                    </h2>
                    
                    {openPositions.length === 0 ? (
                        <p className="text-sm text-gray-500 bg-gray-900/30 p-4 rounded-xl border border-gray-800/65">目前持倉為空</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {openPositions.map((pos) => (
                                <PositionCard key={pos.id} position={pos} />
                            ))}
                        </div>
                    )}
                </section>

                {/* 區塊二：已平倉紀錄 (帶有 More 展開/收合功能) */}
                <ClosedPositionsSection closedPositions={closedPositions} />

                {/* 區塊三：AI 歷史分析報告 (透過左側清單選擇顯示) */}
                <section className="space-y-4">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-blue-400">
                        🤖 AI 市場分析報告與訊號清單
                    </h2>
                    <MarketReportsSection reports={reports} />
                </section>

            </div>
        </main>
    );
}