'use client';

import { useState, useEffect } from 'react';

interface ClosedPosition {
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    closePrice: number | null;
    takeProfitPrices?: { tp1: number; tp2: number; tp3: number };
    closedPnlPercentage: number | null;
    reason?: string | null;
    closeReason: string | null;
    openedAt?: string | null; // 開倉時間
    closedAt: string | null;  // 平倉時間
}

interface ClosedPositionsSectionProps {
    closedPositions: ClosedPosition[];
}

export default function ClosedPositionsSection({ closedPositions }: ClosedPositionsSectionProps) {
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [isMounted, setIsMounted] = useState<boolean>(false);

    function getTaiwanDateKey(dateString?: string | null): string {
        if (!dateString) return '未分類';

        const date = new Date(dateString);

        if (Number.isNaN(date.getTime())) return '未分類';

        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Taipei',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(date);

        const year = parts.find(p => p.type === 'year')?.value;
        const month = parts.find(p => p.type === 'month')?.value;
        const day = parts.find(p => p.type === 'day')?.value;

        return year && month && day
            ? `${year}-${month}-${day}`
            : '未分類';
    }

    // 將日期轉成毫秒，方便排序
    function getTimestamp(dateString?: string | null): number {
        if (!dateString) return 0;

        const timestamp = new Date(dateString).getTime();

        return Number.isNaN(timestamp) ? 0 : timestamp;
    }

    useEffect(() => {
        setIsMounted(true);

        const dates = Array.from(
            new Set(
                closedPositions.map(pos =>
                    getTaiwanDateKey(pos.closedAt)
                )
            )
        ).sort((a, b) => {
            if (a === '未分類') return 1;
            if (b === '未分類') return -1;

            return b.localeCompare(a);
        });

        setSelectedDate(previousDate => {
            if (dates.includes(previousDate)) {
                return previousDate;
            }

            return dates[0] ?? '';
        });
    }, [closedPositions]);

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

    // 計算持倉時間格式化工具
    const formatDuration = (openedAt?: string | null, closedAt?: string | null) => {
        if (!openedAt || !closedAt) return '未知';
        const start = new Date(openedAt).getTime();
        const end = new Date(closedAt).getTime();
        const diffMs = end - start;
        if (diffMs < 0) return '未知';

        const diffMins = Math.floor(diffMs / (1000 * 60));
        const hours = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        const days = Math.floor(hours / 24);
        const remainHours = hours % 24;

        if (days > 0) {
            return `${days}天 ${remainHours}小時 ${mins}分`;
        } else if (hours > 0) {
            return `${hours}小時 ${mins}分`;
        } else {
            return `${mins} 分鐘`;
        }
    };

    const groupedByDate: {
        [date: string]: {
            positions: ClosedPosition[];
            dailyTotalPnl: number;
        };
    } = {};

    closedPositions.forEach(pos => {
        const dateKey = getTaiwanDateKey(pos.closedAt);

        if (!groupedByDate[dateKey]) {
            groupedByDate[dateKey] = {
                positions: [],
                dailyTotalPnl: 0,
            };
        }

        groupedByDate[dateKey].positions.push(pos);

        groupedByDate[dateKey].dailyTotalPnl +=
            pos.closedPnlPercentage ?? 0;
    });

    // 同一天的交易依照平倉時間：早 → 晚
    Object.values(groupedByDate).forEach(group => {
        group.positions.sort((a, b) => {
            return getTimestamp(a.closedAt) -
                getTimestamp(b.closedAt);
        });
    });

    // 左側日期：新 → 舊，「未分類」放最後
    const availableDates = Object.keys(groupedByDate).sort((a, b) => {
        if (a === '未分類') return 1;
        if (b === '未分類') return -1;

        return b.localeCompare(a);
    });

    // 避免選取日期不存在時，右側顯示空白
    const effectiveDate = availableDates.includes(selectedDate)
        ? selectedDate
        : (availableDates[0] ?? '');

    const currentGroup = groupedByDate[effectiveDate] ?? {
        positions: [],
        dailyTotalPnl: 0,
    };

    return (
        <section className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2 text-rose-400">
                🔴 已平倉紀錄與結算盈虧 (<span className="text-white">{closedPositions.length}</span>)
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                {/* 左側：改用 lg:sticky lg:top-6，避免行動端被 sticky 卡住 */}
                <div className="lg:col-span-1 bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-2 lg:sticky lg:top-6">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-2">
                        選擇平倉日期 ({availableDates.length})
                    </h3>
                    {availableDates.map((dateStr) => {
                        const isSelected = dateStr === effectiveDate;
                        const dayData = groupedByDate[dateStr];
                        const isDayProfitable = dayData.dailyTotalPnl >= 0;

                        return (
                            <button
                                key={dateStr}
                                onClick={() => setSelectedDate(dateStr)}
                                className={`w-full text-left p-3 rounded-lg transition-all text-sm flex flex-col gap-1.5 border ${isSelected
                                    ? 'bg-rose-600/20 border-rose-500/50 text-rose-300 shadow-md'
                                    : 'bg-gray-950/40 border-gray-800/60 text-gray-300 hover:bg-gray-800/50'
                                    }`}
                            >
                                <div className="flex justify-between items-center">
                                    <span className="font-mono font-bold text-xs">📅 {dateStr}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                                        {dayData.positions.length}筆
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-gray-400">當日總盈虧:</span>
                                    <span className={`font-mono font-bold ${isDayProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {isDayProfitable ? '+' : ''}{dayData.dailyTotalPnl.toFixed(2)}%
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* 右側：詳細平倉卡片清單 */}
                <div className="lg:col-span-3 space-y-4">
                    <div className="text-xs text-gray-400 bg-gray-900/60 px-4 py-2.5 rounded-lg border border-gray-800 flex justify-between items-center">
                        <span>目前檢視日期：<strong className="text-rose-400">{effectiveDate}</strong></span>
                        <span>當日總盈虧：
                            <strong className={`font-mono ${currentGroup.dailyTotalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {currentGroup.dailyTotalPnl >= 0 ? '+' : ''}{currentGroup.dailyTotalPnl.toFixed(2)}%
                            </strong>
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {currentGroup.positions.map((pos) => {
                            const isProfitable = (pos.closedPnlPercentage ?? 0) >= 0;
                            const openDateStr = pos.openedAt && isMounted ? new Date(pos.openedAt).toLocaleString() : '';
                            const closeDateStr = pos.closedAt && isMounted ? new Date(pos.closedAt).toLocaleString() : '';
                            const durationStr = formatDuration(pos.openedAt, pos.closedAt);

                            return (
                                <div key={pos.id} className="p-4 rounded-xl border border-gray-800 bg-gray-900/40 backdrop-blur shadow-lg space-y-3">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-base">{pos.symbol}</span>
                                            <span className={`px-2 py-0.5 text-xs font-semibold rounded ${pos.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                                                }`}>
                                                {pos.side}
                                            </span>
                                        </div>
                                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-gray-800 text-gray-400">
                                            CLOSED
                                        </span>
                                    </div>

                                    <div className="space-y-1.5 text-xs text-gray-300">
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

                                        {/* 完整顯示 tp1, tp2, tp3 */}
                                        <div className="bg-gray-950/60 p-2 rounded border border-gray-800 space-y-1">
                                            <div className="flex justify-between text-[11px]">
                                                <span className="text-gray-400">TP1:</span>
                                                <span className="font-mono text-emerald-400">${pos.takeProfitPrices?.tp1 ?? 'N/A'}</span>
                                            </div>
                                            <div className="flex justify-between text-[11px]">
                                                <span className="text-gray-400">TP2:</span>
                                                <span className="font-mono text-emerald-400">${pos.takeProfitPrices?.tp2 ?? 'N/A'}</span>
                                            </div>
                                            <div className="flex justify-between text-[11px]">
                                                <span className="text-gray-400">TP3:</span>
                                                <span className="font-mono text-emerald-400">${pos.takeProfitPrices?.tp3 ?? 'N/A'}</span>
                                            </div>
                                        </div>

                                        {/* 時間資訊：開倉時間、平倉時間、持倉時間 */}
                                        <div className="bg-gray-950/40 p-2 rounded border border-gray-800 space-y-1 text-[11px] text-gray-400">
                                            <div>📈 開倉：{openDateStr}</div>
                                            <div>📉 平倉：{closeDateStr}</div>
                                            <div>⏱️ 持倉時間：<span className="text-gray-200 font-semibold">{durationStr}</span></div>
                                        </div>
                                    </div>

                                    {/* 開倉理由 */}
                                    {pos.reason && (
                                        <div className="text-xs text-gray-300 bg-gray-950/80 p-2.5 rounded-lg border border-gray-800/60 break-words whitespace-pre-wrap leading-relaxed">
                                            💡 <span className="font-semibold text-gray-400">開倉理由：</span>{pos.reason}
                                        </div>
                                    )}

                                    {/* 平倉理由 */}
                                    {pos.closeReason && (
                                        <div className="text-xs text-gray-300 bg-gray-950/80 p-2.5 rounded-lg border border-gray-800/60 break-words whitespace-pre-wrap leading-relaxed">
                                            📌 <span className="font-semibold text-gray-400">平倉理由：</span>{pos.closeReason}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
}