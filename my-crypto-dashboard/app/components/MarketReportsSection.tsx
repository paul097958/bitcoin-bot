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

export default function MarketReportsSection({ reports }: MarketReportsSectionProps) {
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [selectedReportId, setSelectedReportId] = useState<string>('');
    const [isMounted, setIsMounted] = useState<boolean>(false);

    // 確保元件載入後才執行客戶端專屬渲染，並初始化預設日期與報告
    useEffect(() => {
        setIsMounted(true);
        if (reports && reports.length > 0) {
            // 找出所有報告的日期 (YYYY-MM-DD)
            const dates = Array.from(new Set(reports.map(r => {
                if (!r.createdAt) return '未分類';
                return new Date(r.createdAt).toISOString().split('T')[0];
            }))).sort((a, b) => b.localeCompare(a)); // 依日期降冪排序（最新在前）

            if (dates.length > 0) {
                const latestDate = dates[0];
                setSelectedDate(latestDate);

                // 預設選取該最新日期底下的第一份報告
                const reportsOfLatestDate = reports.filter(r => {
                    const d = r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : '未分類';
                    return d === latestDate;
                });

                if (reportsOfLatestDate.length > 0) {
                    setSelectedReportId(reportsOfLatestDate[0].id);
                }
            }
        }
    }, [reports]);

    if (!reports || reports.length === 0) {
        return (
            <p className="text-sm text-gray-500 bg-gray-900/30 p-4 rounded-xl border border-gray-800/60">
                目前尚無 AI 市場分析報告紀錄。
            </p>
        );
    }

    // 1. 將報告依照日期 (YYYY-MM-DD) 分組
    const groupedByDate: { [date: string]: Report[] } = {};
    reports.forEach(report => {
        const dateKey = report.createdAt ? new Date(report.createdAt).toISOString().split('T')[0] : '未分類';
        if (!groupedByDate[dateKey]) {
            groupedByDate[dateKey] = [];
        }
        groupedByDate[dateKey].push(report);
    });

    const availableDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));
    const reportsForSelectedDate = groupedByDate[selectedDate] || [];

    // 確保當前選中的 reportId 存在於當前日期的報告中，若無則切換到該日的第一個
    const currentReport = reportsForSelectedDate.find(r => r.id === selectedReportId) || reportsForSelectedDate[0] || reports[0];

    // 當切換日期時，自動選取該日期的第一份報告
    const handleDateChange = (date: string) => {
        setSelectedDate(date);
        const dayReports = groupedByDate[date] || [];
        if (dayReports.length > 0) {
            setSelectedReportId(dayReports[0].id);
        }
    };

    // 安全格式化日期時間的小工具
    const formatDateTime = (dateStr: string | null) => {
        if (!dateStr || !isMounted) return '';
        try {
            return new Date(dateStr).toLocaleTimeString(); // 顯示時分秒就好，因為日期已經在左側分類
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            {/* 左側：階層式選單 (先選天、再選報告)，加上 sticky top-6 固定在畫面 */}
            <div className="lg:col-span-1 bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-4 lg:sticky lg:top-6">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2">
                    選擇分析日期 ({availableDates.length})
                </h3>

                {/* 1. 日期選擇按鈕清單 */}
                <div className="space-y-1.5">
                    {availableDates.map((dateStr) => {
                        const isDateSelected = dateStr === selectedDate;
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

                {/* 2. 該日期底下的具體報告時間清單 */}
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {reportsForSelectedDate.map((rep) => {
                        const isSelected = rep.id === selectedReportId;
                        const timeStr = rep.createdAt && isMounted ? new Date(rep.createdAt).toLocaleTimeString() : rep.id;

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
                                <span className="font-mono font-bold">🕒 時段: {timeStr}</span>
                                <span className="text-[10px] text-gray-400">分析幣種: {rep.totalCoinsAnalyzed} 個</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 右側：被選中報告的詳細訊號內容（自然展開，不壓縮） */}
            <div className="lg:col-span-3 bg-gray-900/40 border border-gray-800 rounded-xl p-6 space-y-4 shadow-md">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 border-b border-gray-800 pb-3">
                    <div>
                        <span className="text-xs font-mono bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded border border-blue-500/20">
                            檢視中 ID: {currentReport.id}
                        </span>
                        <span className="ml-3 text-sm text-gray-400">
                            🕒 {currentReport.createdAt && isMounted ? new Date(currentReport.createdAt).toLocaleString() : ''}
                        </span>
                    </div>
                    <span className="text-xs text-gray-400">分析幣種數: {currentReport.totalCoinsAnalyzed}</span>
                </div>

                {/* 右側列表：卡片自然展開，不壓縮 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {currentReport.signals?.map((sig, idx) => (
                        <div key={idx} className="bg-gray-950/70 p-4 rounded-xl border border-gray-800/80 space-y-3 shadow-inner">
                            <div className="flex justify-between items-center">
                                <span className="font-bold text-sm text-blue-300">{sig.symbol}</span>
                                <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-300 rounded font-medium">
                                    {sig.action} ({sig.side})
                                </span>
                            </div>

                            <div className="text-xs text-gray-400 flex justify-between bg-gray-900/60 p-2 rounded border border-gray-800/50">
                                <span>強度: <strong className="text-gray-200">{sig.strength}</strong></span>
                                <span>傾向: <strong className="text-gray-200">{sig.bias}</strong></span>
                            </div>

                            {/* 支撐與阻力位 */}
                            <div className="grid grid-cols-1 gap-2 text-xs bg-gray-900/80 p-2.5 rounded border border-gray-800">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">支撐位 (Supports):</span>
                                    <span className="font-mono text-emerald-400 font-semibold">
                                        {sig.supports && sig.supports.length > 0 ? sig.supports.join(', ') : '無'}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">阻力位 (Resistances):</span>
                                    <span className="font-mono text-rose-400 font-semibold">
                                        {sig.resistances && sig.resistances.length > 0 ? sig.resistances.join(', ') : '無'}
                                    </span>
                                </div>
                            </div>

                            {/* Reason 文字框 */}
                            <div className="text-xs text-gray-300 bg-gray-900 p-3 rounded-lg border border-gray-800/60 break-words whitespace-pre-wrap leading-relaxed">
                                💡 <span className="font-semibold text-gray-400">研判理由：</span>{sig.reason}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}