'use client';

import React, { useState, useEffect } from 'react';

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
    const [selectedReportId, setSelectedReportId] = useState<string>('');
    const [isMounted, setIsMounted] = useState<boolean>(false);

    // 確保元件載入後才執行客戶端專屬渲染，避免 SSR 日期不一致
    useEffect(() => {
        setIsMounted(true);
        if (reports && reports.length > 0) {
            setSelectedReportId(reports[0].id);
        }
    }, [reports]);

    if (!reports || reports.length === 0) {
        return (
            <p className="text-sm text-gray-500 bg-gray-900/30 p-4 rounded-xl border border-gray-800/60">
                目前尚無 AI 市場分析報告紀錄。
            </p>
        );
    }

    const currentReport = reports.find(r => r.id === selectedReportId) || reports[0];

    // 安全格式化日期的小工具
    const formatDate = (dateStr: string | null) => {
        if (!dateStr || !isMounted) return '';
        try {
            return new Date(dateStr).toLocaleString();
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* 左側：報告列表清單 (Sidebar) */}
            <div className="lg:col-span-1 bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-2 max-h-[500px] overflow-y-auto">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-2">
                    選擇歷史報告 ({reports.length})
                </h3>
                {reports.map((rep) => {
                    const isSelected = rep.id === selectedReportId;
                    
                    return (
                        <button
                            key={rep.id}
                            onClick={() => setSelectedReportId(rep.id)}
                            className={`w-full text-left p-3 rounded-lg transition-all text-sm flex flex-col gap-1 border ${
                                isSelected
                                    ? 'bg-blue-600/20 border-blue-500/50 text-blue-300 shadow-md'
                                    : 'bg-gray-950/40 border-gray-800/60 text-gray-300 hover:bg-gray-800/50'
                            }`}
                        >
                            <span className="font-mono text-xs font-bold truncate">ID: {rep.id}</span>
                            <span className="text-xs text-gray-400">🕒 {formatDate(rep.createdAt) || rep.id}</span>
                            <span className="text-[10px] text-gray-500">分析幣種: {rep.totalCoinsAnalyzed} 個</span>
                        </button>
                    );
                })}
            </div>

            {/* 右側：被選中報告的詳細訊號內容 */}
            <div className="lg:col-span-3 bg-gray-900/40 border border-gray-800 rounded-xl p-6 space-y-4 shadow-md">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 border-b border-gray-800 pb-3">
                    <div>
                        <span className="text-xs font-mono bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded border border-blue-500/20">
                            檢視中 ID: {currentReport.id}
                        </span>
                        <span className="ml-3 text-sm text-gray-400">
                            🕒 {formatDate(currentReport.createdAt)}
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

                            {/* Reason 文字框：修正錯誤的 wrap-break-word 為 break-words */}
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