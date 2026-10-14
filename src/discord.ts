import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { fileURLToPath } from 'url';
import runMarketAnalysis from './analyze.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const BOT_TOKEN = process.env.BOT_TOKEN as string;
const TARGET_CHANNEL_ID = '1559964513824940184';

async function sendAnalysisReport(headerTitle: string) {
    try {
        const channel = await client.channels.fetch(TARGET_CHANNEL_ID) as TextChannel;
        if (!channel) return;

        const aiAnalysisResult = await runMarketAnalysis();
        // 3. 組合標題與 AI 分析結果發送到 Discord
        const finalMessage = `${headerTitle}\n\n${aiAnalysisResult}`;

        // Discord 單一訊息有 2000 字限制，如果太長可以分段發送
        if (finalMessage.length > 2000) {
            // 簡易分段傳送（或分批發送）
            channel.send(finalMessage.substring(0, 2000));
        } else {
            channel.send(finalMessage);
        }

    } catch (error) {
        console.error('❌ 定時發送分析報告失敗：', error);
    }
}

client.once('ready', async () => {
    console.log(`機器人已成功登入：${client.user?.tag}`);
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