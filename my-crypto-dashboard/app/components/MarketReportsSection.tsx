'use client';

import { useState, useEffect } from 'react';

interface Signal {
    symbol: string;
    action: string;
    side: string;
    strength: string | number;
    bias: string;
    reason: string;
    supports?: number[];
    resistances?: number[];
    entryPrice?: number;
    stopLossPrice?: number;
}

interface Report {
    id: string;
    createdAt: string | null;
    totalCoinsAnalyzed: number;
    signals: Signal[];
}

interface MarketReportsSectionProps {
    reports: Report[];
}

// 統一使用台灣時區取得日期 YYYY-MM-DD
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

// 取得時間戳，方便依照實際時間排序
function getTimestamp(dateString?: string | null): number {
    if (!dateString) return 0;

    const timestamp = new Date(dateString).getTime();

    return Number.isNaN(timestamp) ? 0 : timestamp;
}

// 格式化為台灣當地時間
function formatTaiwanDateTime(
    dateString?: string | null,
    includeDate = false
): string {
    if (!dateString) return '';

    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) return dateString;

    return new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei',
        ...(includeDate
            ? {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }
            : {}),
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(date);
}

export default function MarketReportsSection({
    reports,
}: MarketReportsSectionProps) {
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [selectedReportId, setSelectedReportId] = useState<string>('');
    const [isMounted, setIsMounted] = useState<boolean>(false);

    // 先建立完整日期分組，並確保每一天的報告都有排序
    const groupedByDate: { [date: string]: Report[] } = {};

    (reports ?? []).forEach(report => {
        const dateKey = getTaiwanDateKey(report.createdAt);

        if (!groupedByDate[dateKey]) {
            groupedByDate[dateKey] = [];
        }

        groupedByDate[dateKey].push(report);
    });

    // 同一天的報告依照建立時間：早 → 晚
    Object.values(groupedByDate).forEach(dayReports => {
        dayReports.sort((a, b) => {
            const timeA = getTimestamp(a.createdAt);
            const timeB = getTimestamp(b.createdAt);

            if (timeA !== timeB) {
                // 沒有時間的報告放在最後
                if (!a.createdAt || !timeA) return 1;
                if (!b.createdAt || !timeB) return -1;

                return timeA - timeB;
            }

            return a.id.localeCompare(b.id);
        });
    });

    // 日期由新到舊，「未分類」永遠放最後
    const availableDates = Object.keys(groupedByDate).sort((a, b) => {
        if (a === '未分類' && b !== '未分類') return 1;
        if (b === '未分類' && a !== '未分類') return -1;

        return b.localeCompare(a);
    });

    // 確保選取日期始終有效
    const effectiveDate = availableDates.includes(selectedDate)
        ? selectedDate
        : (availableDates[0] ?? '');

    const reportsForSelectedDate = effectiveDate
        ? groupedByDate[effectiveDate] ?? []
        : [];

    // 當資料更新或日期失效時，修正目前選取的報告
    useEffect(() => {
        setIsMounted(true);

        setSelectedDate(previousDate => {
            if (availableDates.includes(previousDate)) {
                return previousDate;
            }

            return availableDates[0] ?? '';
        });
    }, [reports]);

    useEffect(() => {
        if (reportsForSelectedDate.length === 0) {
            setSelectedReportId('');
            return;
        }

        setSelectedReportId(previousId => {
            const stillExists = reportsForSelectedDate.some(
                report => report.id === previousId
            );

            return stillExists
                ? previousId
                : reportsForSelectedDate[0].id;
        });
    }, [selectedDate, reports]);

    if (!reports || reports.length === 0) {
        return (
            <p className="text-sm text-gray-500 bg-gray-900/30 p-4 rounded-xl border border-gray-800/60">
                目前尚無 AI 市場分析報告紀錄。
            </p>
        );
    }

    // 確保目前顯示的報告一定屬於所選日期
    const currentReport =
        reportsForSelectedDate.find(
            report => report.id === selectedReportId
        ) ??
        reportsForSelectedDate[0];

    // 切換日期時，預設選擇該日最早的一份報告
    const handleDateChange = (date: string) => {
        setSelectedDate(date);

        const dayReports = groupedByDate[date] ?? [];

        setSelectedReportId(dayReports[0]?.id ?? '');
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">

            {/* 左側：日期列表與報告時段 */}
            <div className="lg:col-span-1 bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-4 lg:sticky lg:top-6">

                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2">
                    選擇分析日期 ({availableDates.length})
                </h3>

                {/* 日期選擇：最新日期在最上方 */}
                <div className="space-y-1.5">
                    {availableDates.map(dateStr => {
                        const isDateSelected =
                            dateStr === effectiveDate;

                        const count = groupedByDate[dateStr].length;

                        return (
                            <button
                                key={dateStr}
                                onClick={() => handleDateChange(dateStr)}
                                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-xs flex justify-between items-center border ${
                                    isDateSelected
                                        ? 'bg-blue-600/20 border-blue-500/50 text-blue-300 font-bold shadow-md'
                                        : 'bg-gray-950/40 border-gray-800/60 text-gray-400 hover:bg-gray-800/50'
                                }`}
                            >
                                <span>📅 {dateStr}</span>

                                <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 text-[10px]">
                                    {count} 份
                                </span>
                            </button>
                        );
                    })}
                </div>

                <hr className="border-gray-800" />

                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2">
                    該日報告時段 ({reportsForSelectedDate.length})
                </h3>

                {/* 同一天的報告時間：早 → 晚 */}
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {reportsForSelectedDate.map(rep => {
                        const isSelected =
                            rep.id === currentReport?.id;

                        const timeStr = rep.createdAt && isMounted
                            ? formatTaiwanDateTime(rep.createdAt)
                            : rep.createdAt
                                ? '時間格式錯誤'
                                : '時間未知';

                        return (
                            <button
                                key={rep.id}
                                onClick={() => setSelectedReportId(rep.id)}
                                className={`w-full text-left p-2.5 rounded-lg transition-all text-xs flex flex-col gap-1 border ${
                                    isSelected
                                        ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300 shadow-md'
                                        : 'bg-gray-950/40 border-gray-800/60 text-gray-300 hover:bg-gray-800/50'
                                }`}
                            >
                                <span className="font-mono font-bold">
                                    🕒 時段：{timeStr}
                                </span>

                                <span className="text-[10px] text-gray-400">
                                    分析幣種：{rep.totalCoinsAnalyzed} 個
                                </span>
                            </button>
                        );
                    })}

                    {reportsForSelectedDate.length === 0 && (
                        <p className="text-xs text-gray-500 px-2 py-3">
                            此日期目前沒有分析報告。
                        </p>
                    )}
                </div>
            </div>

            {/* 右側：報告詳細內容 */}
            <div className="lg:col-span-3 bg-gray-900/40 border border-gray-800 rounded-xl p-6 space-y-4 shadow-md">

                {currentReport ? (
                    <>
                        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 border-b border-gray-800 pb-3">
                            <div>
                                <span className="text-xs font-mono bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded border border-blue-500/20">
                                    檢視中 ID：{currentReport.id}
                                </span>

                                <span className="ml-3 text-sm text-gray-400">
                                    🕒 {isMounted
                                        ? formatTaiwanDateTime(
                                            currentReport.createdAt,
                                            true
                                        )
                                        : ''}
                                </span>
                            </div>

                            <span className="text-xs text-gray-400">
                                分析幣種數：{currentReport.totalCoinsAnalyzed}
                            </span>
                        </div>

                        {/* 分析訊號卡片 */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {currentReport.signals?.map((sig, idx) => (
                                <div
                                    key={`${currentReport.id}-${idx}`}
                                    className="bg-gray-950/70 p-4 rounded-xl border border-gray-800/80 space-y-3 shadow-inner"
                                >
                                    <div className="flex justify-between items-center">
                                        <span className="font-bold text-sm text-blue-300">
                                            {sig.symbol}
                                        </span>

                                        <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-300 rounded font-medium">
                                            {sig.action} ({sig.side})
                                        </span>
                                    </div>

                                    <div className="text-xs text-gray-400 flex justify-between bg-gray-900/60 p-2 rounded border border-gray-800/50">
                                        <span>
                                            強度：
                                            <strong className="text-gray-200">
                                                {sig.strength}
                                            </strong>
                                        </span>

                                        <span>
                                            傾向：
                                            <strong className="text-gray-200">
                                                {sig.bias}
                                            </strong>
                                        </span>
                                    </div>

                                    {/* 支撐與阻力位 */}
                                    <div className="grid grid-cols-1 gap-2 text-xs bg-gray-900/80 p-2.5 rounded border border-gray-800">
                                        <div className="flex justify-between gap-2">
                                            <span className="text-gray-400">
                                                支撐位 (Supports)：
                                            </span>

                                            <span className="font-mono text-emerald-400 font-semibold text-right break-words">
                                                {sig.supports &&
                                                sig.supports.length > 0
                                                    ? sig.supports.join(', ')
                                                    : '無'}
                                            </span>
                                        </div>

                                        <div className="flex justify-between gap-2">
                                            <span className="text-gray-400">
                                                阻力位 (Resistances)：
                                            </span>

                                            <span className="font-mono text-rose-400 font-semibold text-right break-words">
                                                {sig.resistances &&
                                                sig.resistances.length > 0
                                                    ? sig.resistances.join(', ')
                                                    : '無'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* 研判理由 */}
                                    <div className="text-xs text-gray-300 bg-gray-900 p-3 rounded-lg border border-gray-800/60 break-words whitespace-pre-wrap leading-relaxed">
                                        💡{' '}
                                        <span className="font-semibold text-gray-400">
                                            研判理由：
                                        </span>
                                        {sig.reason}
                                    </div>
                                </div>
                            ))}

                            {(!currentReport.signals ||
                                currentReport.signals.length === 0) && (
                                <p className="text-sm text-gray-500">
                                    此份報告沒有分析訊號。
                                </p>
                            )}
                        </div>
                    </>
                ) : (
                    <p className="text-sm text-gray-500">
                        請從左側選擇日期與分析報告。
                    </p>
                )}
            </div>
        </div>
    );
}