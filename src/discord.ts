import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { cert, initializeApp } from 'firebase-admin/app';
import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { fileURLToPath } from 'url';
import { runMarketAnalysisPipeline } from './analyze.js';
import type { TradingSignal } from './analyze.js';
import serviceAccount from '../services.json' with { type: 'json' };
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});
initializeApp({
    credential: cert(serviceAccount as any),
});
const db = getFirestore();

const BOT_TOKEN = process.env.BOT_TOKEN as string;
const TARGET_CHANNEL_ID = '1559964513824940184';

export async function saveSignalsToFirestore(signals: TradingSignal[]) {
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

        // 指定寫入 market_reports 集合
        const docRef = db.collection('market_reports').doc(docId);

        await docRef.set({
            createdAt: Timestamp.fromDate(batchTimestamp),
            totalCoinsAnalyzed: signals.length,
            signals: signals // 將整個陣列完整存入欄位中
        });

        console.log(`✅ [Firestore 策略A] 成功儲存整批分析報告！文件 ID: ${docId}`);

    } catch (error: any) {
        console.error('❌ [Firestore 策略A] 寫入失敗：', error.message || error);
    }
}

async function sendAnalysisReport(headerTitle: string) {
    try {
        const channel = await client.channels.fetch(TARGET_CHANNEL_ID) as TextChannel;
        if (!channel) return;

        const { messageChunks, signals } = await runMarketAnalysisPipeline();
        await channel.send(`# 📊 ${headerTitle}`);
        for (const chunk of messageChunks) {
            await channel.send(chunk);
        }

        await saveSignalsToFirestore(signals); // 儲存到 Firestore

    } catch (error) {
        console.error('❌ 定時發送分析報告失敗：', error);
    }
}

client.once('ready', async () => {
    console.log(`機器人已成功登入：${client.user?.tag}`);

    // await sendAnalysisReport('【趨勢分析】');
    // 1. 早上 08:00
    cron.schedule('0 8 * * *', async () => {
        await sendAnalysisReport('🌅 【早盤趨勢分析】');
    });

    // 2. 下午 16:00
    cron.schedule('0 16 * * *', async () => {
        await sendAnalysisReport('☀️ 【歐盤盤中分析】');
    });

    // 3. 晚上 20:00
    cron.schedule('0 20 * * *', async () => {
        await sendAnalysisReport('🌙 【美盤黃金時段分析】');
    });
});


client.login(BOT_TOKEN);