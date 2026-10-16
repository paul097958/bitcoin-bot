import { adminDb } from '../lib/firebase-admin';
import PositionCard from './components/PositionCard';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    let openPositions: any[] = [];
    let closedPositions: any[] = [];
    let reports: any[] = [];

    try {
        // 抓取所有持倉紀錄
        const posSnapshot = await adminDb.collection('trade_positions').get();
        
        const allPositions = posSnapshot.docs.map(doc => {
            const data = doc.data();
            
            // 計算已平倉的損益百分比 (若有記錄 entryPrice 與 closePrice)
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

        // 區分「目前持倉」與「已平倉」
        openPositions = allPositions.filter(p => p.status === 'OPEN');
        closedPositions = allPositions.filter(p => p.status === 'CLOSED');

        // 抓取 AI 分析報告
        const repSnapshot = await adminDb.collection('market_reports')
            .orderBy('createdAt', 'desc')
            .limit(5)
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

    return (
        <main className="min-h-screen bg-gray-950 text-gray-100 p-6 md:p-10">
            <div className="max-w-7xl mx-auto space-y-12">
                
                <header className="border-b border-gray-800 pb-5">
                    <h1 className="text-3xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">
                        🚀 加密貨幣 AI 自動化交易儀表板
                    </h1>
                    <p className="text-sm text-gray-400 mt-1">結合 Binance WebSocket 即時價格、持倉追蹤與 AI 歷史報告監控</p>
                </header>

                {/* 區塊一：目前持倉 (Open Positions) */}
                <section className="space-y-4">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-emerald-400">
                        🟢 目前持倉追蹤 (<span className="text-white">{openPositions.length}</span>)
                    </h2>
                    
                    {openPositions.length === 0 ? ('目前持倉為空') : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {openPositions.map((pos) => (
                                <PositionCard key={pos.id} position={pos} />
                            ))}
                        </div>
                    )}
                </section>

                {/* 區塊二：已平倉紀錄 (Closed Positions) */}
                <section className="space-y-4">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-rose-400">
                        🔴 已平倉紀錄與結算盈虧 (<span className="text-white">{closedPositions.length}</span>)
                    </h2>

                    {closedPositions.length === 0 ? (
                        <p className="text-sm text-gray-500 bg-gray-900/30 p-4 rounded-xl border border-gray-800/60">目前尚無已平倉紀錄。</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {closedPositions.map((pos) => {
                                const isProfitable = (pos.closedPnlPercentage ?? 0) >= 0;
                                const closeDateStr = pos.closedAt ? new Date(pos.closedAt).toLocaleString() : '';
                                
                                return (
                                    <div key={pos.id} className="p-5 rounded-xl border border-gray-800 bg-gray-900/40 backdrop-blur shadow-lg space-y-3">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-lg">{pos.symbol}</span>
                                                <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                                                    pos.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                                                }`}>
                                                    {pos.side}
                                                </span>
                                            </div>
                                            <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-gray-800 text-gray-400">
                                                CLOSED
                                            </span>
                                        </div>

                                        <div className="space-y-2 text-sm text-gray-300">
                                            <div className="flex justify-between items-center bg-gray-950/50 p-2 rounded border border-gray-800">
                                                <span className="text-gray-400">結算盈虧:</span>
                                                <span className={`font-mono font-bold ${isProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                    {pos.closedPnlPercentage !== null ? `${isProfitable ? '+' : ''}${pos.closedPnlPercentage.toFixed(2)}%` : 'N/A'}
                                                </span>
                                            </div>

                                            <div className="flex justify-between">
                                                <span className="text-gray-400">進場價格:</span>
                                                <span className="font-mono">${pos.entryPrice}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">平倉價格:</span>
                                                <span className="font-mono text-amber-300">${pos.closePrice ?? 'N/A'}</span>
                                            </div>
                                            <div className="text-xs text-gray-500 pt-1">🕒 平倉時間: {closeDateStr}</div>
                                        </div>

                                        {pos.closeReason && (
                                            <div className="text-xs bg-gray-950/80 p-2.5 rounded border border-gray-800 text-gray-300 break-words whitespace-pre-wrap max-h-20 overflow-y-auto">
                                                📌 <span className="font-semibold text-gray-400">平倉理由：</span>{pos.closeReason}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* 區塊三：AI 歷史分析報告 (Market Reports) */}
                <section className="space-y-4">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-blue-400">
                        🤖 AI 市場分析報告與訊號
                    </h2>

                    <div className="space-y-4">
                        {reports.map((rep) => (
                            <div key={rep.id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-6 space-y-4 shadow-md">
                                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 border-b border-gray-800 pb-3">
                                    <div>
                                        <span className="text-xs font-mono bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded border border-blue-500/20">
                                            ID: {rep.id}
                                        </span>
                                        <span className="ml-3 text-sm text-gray-400">🕒 {rep.createdAt ? new Date(rep.createdAt).toLocaleString() : '剛剛'}</span>
                                    </div>
                                    <span className="text-xs text-gray-400">分析幣種數: {rep.totalCoinsAnalyzed}</span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {rep.signals?.map((sig: any, idx: number) => (
                                        <div key={idx} className="bg-gray-950/70 p-3.5 rounded-lg border border-gray-800/80 space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="font-bold text-sm text-blue-300">{sig.symbol}</span>
                                                <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-300 rounded">
                                                    {sig.action} ({sig.side})
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-400 flex gap-3">
                                                <span>強度: <strong className="text-gray-200">{sig.strength}</strong></span>
                                                <span>傾向: <strong className="text-gray-200">{sig.bias}</strong></span>
                                            </div>
                                            <p className="text-xs text-gray-300 bg-gray-900 p-2.5 rounded border border-gray-800/50 break-words whitespace-pre-wrap max-h-24 overflow-y-auto">
                                                {sig.reason}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

            </div>
        </main>
    );
}