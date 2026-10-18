'use client';

import { useEffect, useState } from 'react';

interface Position {
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrices: { tp1: number; tp2: number; tp3: number };
    reason: string;
    status: 'OPEN' | 'CLOSED';
    openedAt?: string | null; // 開倉時間
}

interface PositionCardProps {
    position: Position;
}

export default function PositionCard({ position }: PositionCardProps) {
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);
    const [durationStr, setDurationStr] = useState<string>('');
    const [isMounted, setIsMounted] = useState<boolean>(false);
    const isOpen = position.status === 'OPEN';

    useEffect(() => {
        setIsMounted(true);

        // 計算持倉時間的工具函式
        const updateDuration = () => {
            if (!position.openedAt) return;
            const start = new Date(position.openedAt).getTime();
            const now = Date.now();
            const diffMs = now - start;
            if (diffMs < 0) {
                setDurationStr('剛剛');
                return;
            }

            const diffMins = Math.floor(diffMs / (1000 * 60));
            const hours = Math.floor(diffMins / 60);
            const mins = diffMins % 60;
            const days = Math.floor(hours / 24);
            const remainHours = hours % 24;

            if (days > 0) {
                setDurationStr(`${days}天 ${remainHours}小時 ${mins}分`);
            } else if (hours > 0) {
                setDurationStr(`${hours}小時 ${mins}分`);
            } else {
                setDurationStr(`${mins} 分鐘`);
            }
        };

        updateDuration();
        // 每分鐘自動更新一次持倉時間顯示
        const timer = setInterval(updateDuration, 60000);

        if (!isOpen) return;

        const formattedSymbol = position.symbol.toLowerCase();
        const wsUrl = `wss://fstream.binance.com/market/ws/${formattedSymbol}@ticker`;
        const ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.c) {
                setCurrentPrice(parseFloat(data.c));
            }
        };

        return () => {
            clearInterval(timer);
            ws.close();
        };
    }, [position.symbol, position.openedAt, isOpen]);

    // 計算即時盈虧
    let pnl = 0;
    let pnlPercentage = 0;
    if (currentPrice !== null && isOpen) {
        const diff = position.side === 'BUY' 
            ? currentPrice - position.entryPrice 
            : position.entryPrice - currentPrice;
        
        pnl = diff;
        pnlPercentage = (diff / position.entryPrice) * 100;
    }

    const openDateStr = position.openedAt && isMounted ? new Date(position.openedAt).toLocaleString() : '未知';

    return (
        <div className={`p-5 rounded-xl border bg-gray-900/50 backdrop-blur shadow-lg transition-all space-y-3 ${
            isOpen ? 'border-emerald-500/50 shadow-emerald-950/20' : 'border-gray-800 opacity-75'
        }`}>
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">{position.symbol}</span>
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                        position.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}>
                        {position.side}
                    </span>
                </div>
                <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                    isOpen ? 'bg-emerald-500 text-gray-950 animate-pulse' : 'bg-gray-700 text-gray-300'
                }`}>
                    {position.status}
                </span>
            </div>

            <div className="space-y-2 text-sm text-gray-300">
                <div className="flex justify-between items-center bg-gray-950/40 p-2 rounded border border-gray-800">
                    <span className="text-gray-400">即時現價:</span>
                    <span className="font-mono font-bold text-amber-300">
                        {currentPrice !== null ? `$${currentPrice.toLocaleString()}` : '連線中...'}
                    </span>
                </div>

                {isOpen && currentPrice !== null && (
                    <div className="flex justify-between items-center bg-gray-950/40 p-2 rounded border border-gray-800">
                        <span className="text-gray-400">未實現盈虧:</span>
                        <span className={`font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnlPercentage >= 0 ? '+' : ''}{pnlPercentage.toFixed(2)}%)
                        </span>
                    </div>
                )}

                <div className="flex justify-between">
                    <span className="text-gray-400">進場價格:</span>
                    <span className="font-mono font-medium">${position.entryPrice}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-400">停損價格 (SL):</span>
                    <span className="font-mono text-rose-400">${position.stopLossPrice}</span>
                </div>

                {/* 完整顯示 TP1, TP2, TP3 */}
                <div className="bg-gray-950/60 p-2.5 rounded border border-gray-800 space-y-1 text-xs">
                    <div className="flex justify-between">
                        <span className="text-gray-400">止盈目標 TP1:</span>
                        <span className="font-mono text-emerald-400">${position.takeProfitPrices?.tp1 ?? 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-400">止盈目標 TP2:</span>
                        <span className="font-mono text-emerald-400">${position.takeProfitPrices?.tp2 ?? 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-400">止盈目標 TP3:</span>
                        <span className="font-mono text-emerald-400">${position.takeProfitPrices?.tp3 ?? 'N/A'}</span>
                    </div>
                </div>

                {/* 開倉時間與目前持倉時間 */}
                <div className="bg-gray-950/40 p-2 rounded border border-gray-800 space-y-1 text-[11px] text-gray-400">
                    <div>📈 開倉時間: {openDateStr}</div>
                    <div>⏱️ 目前持倉時間: <span className="text-gray-200 font-semibold">{durationStr}</span></div>
                </div>
            </div>

            {/* 開倉理由 */}
            {position.reason && (
                <div className="text-xs text-gray-300 bg-gray-950/80 p-3 rounded-lg border border-gray-800/60 break-words whitespace-pre-wrap leading-relaxed">
                    💡 <span className="font-semibold text-gray-400">開倉理由：</span>{position.reason}
                </div>
            )}
        </div>
    );
}