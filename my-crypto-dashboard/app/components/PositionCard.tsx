'use client';

import React, { useEffect, useState } from 'react';

interface Position {
    id: string;
    symbol: string;         // 例如 'BTCUSDT' 或 'BTCUSD_PERP'
    side: 'BUY' | 'SELL';
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrices: { tp1: number; tp2: number; tp3: number };
    reason: string;
    status: 'OPEN' | 'CLOSED';
}

interface PositionCardProps {
    position: Position;
}

export default function PositionCard({ position }: PositionCardProps) {
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);
    const isOpen = position.status === 'OPEN';

    // 處理幣安 WebSocket 串接
    useEffect(() => {
        if (!isOpen) return;

        // 將 symbol 轉為小寫以符合幣安 stream 格式 (例如 btcusdt@ticker)
        const formattedSymbol = position.symbol.toLowerCase();
        // 如果你的 symbol 是幣本位或U本位，請依實際格式調整 (例如 dstream 適用合約)
        const wsUrl = `wss://fstream.binance.com/market/ws/${formattedSymbol}@ticker`;

        const ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            // c 代表 Last price (最新成交價)
            if (data.c) {
                setCurrentPrice(parseFloat(data.c));
            }
        };

        ws.onerror = (error) => {
            console.error(`WebSocket 錯誤 (${position.symbol}):`, error);
        };

    }, [position.symbol, isOpen]);

    // 計算即時盈虧 (以多單/空單簡易公式估算)
    let pnl = 0;
    let pnlPercentage = 0;
    if (currentPrice !== null && isOpen) {
        const diff = position.side === 'BUY' 
            ? currentPrice - position.entryPrice 
            : position.entryPrice - currentPrice;
        
        pnl = diff; // 可依合約規格乘上合約張數/合約面值
        pnlPercentage = (diff / position.entryPrice) * 100;
    }

    return (
        <div className={`p-5 rounded-xl border bg-gray-900/50 backdrop-blur shadow-lg transition-all ${
            isOpen ? 'border-emerald-500/50 shadow-emerald-950/20' : 'border-gray-800 opacity-75'
        }`}>
            <div className="flex justify-between items-start mb-3">
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

            <div className="space-y-2 text-sm text-gray-300 mb-4">
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
                    <span className="text-gray-400">停損價格:</span>
                    <span className="font-mono text-rose-400">${position.stopLossPrice}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-400">止盈目標 (TP1):</span>
                    <span className="font-mono text-emerald-400">${position.takeProfitPrices?.tp1}</span>
                </div>
            </div>

            {/* 解決 reason 文字溢出：使用 break-words 與 max-h 捲軸或展開 */}
            <div className="text-xs text-gray-300 bg-gray-950/80 p-3 rounded-lg border border-gray-800/60 break-words whitespace-pre-wrap leading-relaxed">
                💡 <span className="font-semibold text-gray-400">研判理由：</span>{position.reason}
            </div>
        </div>
    );
}