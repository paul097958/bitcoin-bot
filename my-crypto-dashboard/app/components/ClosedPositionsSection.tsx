'use client';

import { useState, useEffect } from 'react';

interface ClosedPosition {
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    closePrice: number | null;
    closedPnlPercentage: number | null;
    closeReason: string | null;
    closedAt: string | null;
}

interface ClosedPositionsSectionProps {
    closedPositions: ClosedPosition[];
}

export default function ClosedPositionsSection({ closedPositions }: ClosedPositionsSectionProps) {
    const [visibleCount, setVisibleCount] = useState<number>(6); // 預設顯示前 6 筆
    const [isMounted, setIsMounted] = useState<boolean>(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!closedPositions || closedPositions.length === 0) {
        return (
            <section className="space-y-4">
                <h2 className="text-xl font-bold flex items-center gap-2 text-rose-400">
                    🔴 已平倉紀錄與結算盈虧 (<span className="text-white">0</span>)
                </h2>
                <p className="text-sm text-gray-500 bg-gray-900/30 p-4 rounded-xl border border-gray-800/60">目前尚無已平倉紀錄。</p>
            </section>
        );
    }

    const displayedPositions = closedPositions.slice(0, visibleCount);
    const hasMore = visibleCount < closedPositions.length;

    return (
        <section className="space-y-4">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold flex items-center gap-2 text-rose-400">
                    🔴 已平倉紀錄與結算盈虧 (<span className="text-white">{closedPositions.length}</span>)
                </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayedPositions.map((pos) => {
                    const isProfitable = (pos.closedPnlPercentage ?? 0) >= 0;
                    const closeDateStr = pos.closedAt && isMounted ? new Date(pos.closedAt).toLocaleString() : '';
                    
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
                                <div className="text-xs text-gray-300 bg-gray-950/80 p-3 rounded-lg border border-gray-800/60 break-words whitespace-pre-wrap leading-relaxed">
                                    📌 <span className="font-semibold text-gray-400">平倉理由：</span>{pos.closeReason}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* 展開更多 / 收合按鈕 */}
            <div className="flex justify-center pt-4">
                {hasMore ? (
                    <button
                        onClick={() => setVisibleCount(prev => prev + 6)}
                        className="px-6 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-semibold rounded-xl border border-gray-700 transition-all shadow-md"
                    >
                        顯示更多 (More)...
                    </button>
                ) : closedPositions.length > 6 ? (
                    <button
                        onClick={() => setVisibleCount(6)}
                        className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-gray-400 text-sm font-semibold rounded-xl border border-gray-800 transition-all"
                    >
                        收合列表 (Less)
                    </button>
                ) : null}
            </div>
        </section>
    );
}